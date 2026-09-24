use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const WATCH_EVENT: &str = "zvc://watch";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchFolder {
    pub id: String,
    pub path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Found {
    folder_id: String,
    path: String,
}

struct Pending {
    folder_id: String,
    size: u64,
    stable_since: Instant,
}

#[derive(Default)]
pub struct Watching {
    watchers: Mutex<Vec<RecommendedWatcher>>,
    pending: Arc<Mutex<HashMap<PathBuf, Pending>>>,
    pub produced: Arc<Mutex<HashSet<PathBuf>>>,
    checker_started: Mutex<bool>,
}

const SETTLE: Duration = Duration::from_secs(6);

fn wanted(path: &Path, produced: &HashSet<PathBuf>) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    !name.starts_with('.') && !name.contains(".zvc-part") && crate::commands::is_media(path) && !produced.contains(path)
}

impl Watching {
    pub fn set(&self, app: &AppHandle, folders: Vec<WatchFolder>) -> Vec<String> {
        let mut failed = Vec::new();
        let mut watchers = self.watchers.lock().unwrap();
        watchers.clear();
        self.pending.lock().unwrap().clear();
        for f in folders {
            let pending = Arc::clone(&self.pending);
            let produced = Arc::clone(&self.produced);
            let id = f.id.clone();
            let handler = move |res: notify::Result<notify::Event>| {
                let Ok(ev) = res else { return };
                if !matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                    return;
                }
                let produced = produced.lock().unwrap();
                let mut pending = pending.lock().unwrap();
                for p in ev.paths {
                    if p.is_file() && wanted(&p, &produced) {
                        let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                        pending.insert(p, Pending { folder_id: id.clone(), size, stable_since: Instant::now() });
                    }
                }
            };
            match notify::recommended_watcher(handler).and_then(|mut w| w.watch(&f.path, RecursiveMode::Recursive).map(|_| w)) {
                Ok(w) => watchers.push(w),
                Err(_) => failed.push(f.id),
            }
        }
        drop(watchers);
        self.start_checker(app);
        failed
    }

    fn start_checker(&self, app: &AppHandle) {
        let mut started = self.checker_started.lock().unwrap();
        if *started {
            return;
        }
        *started = true;
        let pending = Arc::clone(&self.pending);
        let produced = Arc::clone(&self.produced);
        let app = app.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(2));
            let mut ready = Vec::new();
            {
                let mut pending = pending.lock().unwrap();
                let produced = produced.lock().unwrap();
                pending.retain(|path, p| {
                    let Ok(meta) = std::fs::metadata(path) else { return false };
                    if produced.contains(path) {
                        return false;
                    }
                    if meta.len() != p.size {
                        p.size = meta.len();
                        p.stable_since = Instant::now();
                        return true;
                    }
                    if p.size > 0 && p.stable_since.elapsed() >= SETTLE && std::fs::File::open(path).is_ok() {
                        ready.push(Found { folder_id: p.folder_id.clone(), path: path.to_string_lossy().into_owned() });
                        return false;
                    }
                    true
                });
            }
            for f in ready {
                let _ = app.emit(WATCH_EVENT, f);
            }
        });
    }
}
