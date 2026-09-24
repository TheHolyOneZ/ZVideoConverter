use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use zvc_core::engine::Engine;
use zvc_core::ffmpeg::FfmpegInstall;
use zvc_core::hw::HwInfo;
use zvc_core::profile::ProfileStore;

pub struct Paths {
    pub managed_ffmpeg: PathBuf,
    pub thumbs: PathBuf,
    pub passlogs: PathBuf,
    pub hw_cache: PathBuf,
    pub previews: PathBuf,
    pub samples: PathBuf,
    pub session: PathBuf,
}

pub struct AppState {
    pub paths: Paths,
    pub profiles: ProfileStore,
    pub ffmpeg: Mutex<Option<FfmpegInstall>>,
    pub hw: Mutex<Option<HwInfo>>,
    pub engine: Mutex<Option<Arc<Engine>>>,
    pub claimed: Arc<Mutex<HashMap<String, PathBuf>>>,
    pub download_cancel: Arc<AtomicBool>,
    pub crops: Mutex<HashMap<PathBuf, Option<zvc_core::analyze::CropRect>>>,
    pub watching: crate::watch::Watching,
}

impl AppState {
    pub fn new(config: PathBuf, data: PathBuf, cache: PathBuf) -> Self {
        AppState {
            paths: Paths {
                managed_ffmpeg: data.join("ffmpeg"),
                thumbs: cache.join("thumbs"),
                passlogs: cache.join("passlog"),
                hw_cache: cache.join("hw.json"),
                previews: cache.join("previews"),
                samples: cache.join("tour-samples"),
                session: data.join("queue.json"),
            },
            profiles: ProfileStore::new(config.join("profiles")),
            ffmpeg: Mutex::new(None),
            hw: Mutex::new(None),
            engine: Mutex::new(None),
            claimed: Arc::new(Mutex::new(HashMap::new())),
            download_cancel: Arc::new(AtomicBool::new(false)),
            crops: Mutex::new(HashMap::new()),
            watching: Default::default(),
        }
    }

    pub fn claimed_set(&self) -> HashSet<PathBuf> {
        self.claimed.lock().unwrap().values().cloned().collect()
    }
}
