use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::ffmpeg::{command, command_with_priority, run_with_timeout};
use crate::progress::ProgressParser;

#[derive(Clone, Debug)]
pub struct JobSpec {
    pub id: String,
    pub passes: Vec<Vec<OsString>>,
    pub fallback: Option<Vec<Vec<OsString>>>,
    pub temp_output: PathBuf,
    pub final_output: PathBuf,
    pub overwrite: bool,
    pub duration: Option<f64>,
    pub passlog: Option<PathBuf>,
    pub source: PathBuf,
    pub keep_dates: bool,
    pub original: OriginalAction,
}

#[derive(Clone, Copy, Debug, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OriginalAction {
    #[default]
    Keep,
    Trash,
    Delete,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OriginalFate {
    Trashed,
    Deleted,
    #[serde(rename_all = "camelCase")]
    Kept { reason: String, detail: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Outcome {
    #[serde(rename_all = "camelCase")]
    Done { output: PathBuf, size: u64, fell_back: bool, original: Option<OriginalFate> },
    #[serde(rename_all = "camelCase")]
    Failed { error: String, log: String },
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    #[serde(rename_all = "camelCase")]
    Started { id: String, pass: usize, passes: usize, fallback: bool },
    #[serde(rename_all = "camelCase")]
    Progress { id: String, percent: f64, fps: f64, speed: f64, eta: Option<f64>, size: u64, out_time: f64 },
    #[serde(rename_all = "camelCase")]
    FellBack { id: String, reason: String },
    #[serde(rename_all = "camelCase")]
    Finished { id: String, outcome: Outcome, elapsed: f64 },
    #[serde(rename_all = "camelCase")]
    Idle { done: usize, failed: usize, cancelled: usize },
}

pub type Emit = Arc<dyn Fn(Event) + Send + Sync>;

#[derive(Default)]
struct State {
    pending: VecDeque<JobSpec>,
    workers: usize,
    done: usize,
    failed: usize,
    cancelled: usize,
    sources: HashMap<PathBuf, SourceTally>,
}

#[derive(Default)]
struct SourceTally {
    remaining: usize,
    all_ok: bool,
    outputs: Vec<(PathBuf, u64)>,
}

pub struct Engine {
    ffmpeg: Mutex<PathBuf>,
    emit: Emit,
    state: Mutex<State>,
    parallel: AtomicUsize,
    paused: AtomicBool,
    cancelled: Mutex<HashSet<String>>,
    running: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    low_priority: AtomicBool,
}

pub const CAN_SUSPEND: bool = cfg!(unix);

enum PassResult {
    Ok,
    Cancelled,
    Failed { error: String, log: String },
}

impl Engine {
    pub fn new(ffmpeg: PathBuf, emit: Emit) -> Arc<Self> {
        Arc::new(Engine {
            ffmpeg: Mutex::new(ffmpeg),
            emit,
            state: Mutex::new(State::default()),
            parallel: AtomicUsize::new(2),
            paused: AtomicBool::new(false),
            cancelled: Mutex::new(HashSet::new()),
            running: Mutex::new(HashMap::new()),
            low_priority: AtomicBool::new(false),
        })
    }

    pub fn set_low_priority(&self, on: bool) {
        self.low_priority.store(on, Ordering::Relaxed);
    }

    pub fn set_ffmpeg(&self, path: PathBuf) {
        *self.ffmpeg.lock().unwrap() = path;
    }

    pub fn set_parallel(self: &Arc<Self>, n: usize) {
        self.parallel.store(n.clamp(1, 16), Ordering::Relaxed);
        self.spawn_workers();
    }

    pub fn is_busy(&self) -> bool {
        self.state.lock().unwrap().workers > 0
    }

    pub fn enqueue(self: &Arc<Self>, jobs: Vec<JobSpec>) {
        {
            let mut st = self.state.lock().unwrap();
            if st.workers == 0 {
                st.done = 0;
                st.failed = 0;
                st.cancelled = 0;
            }
            let mut cancelled = self.cancelled.lock().unwrap();
            for j in jobs {
                cancelled.remove(&j.id);
                if !st.pending.iter().any(|p| p.id == j.id) {
                    if j.original != OriginalAction::Keep {
                        let t = st.sources.entry(j.source.clone()).or_insert_with(|| SourceTally { all_ok: true, ..Default::default() });
                        t.remaining += 1;
                    }
                    st.pending.push_back(j);
                }
            }
        }
        self.spawn_workers();
    }

    fn spawn_workers(self: &Arc<Self>) {
        let mut st = self.state.lock().unwrap();
        let want = self.parallel.load(Ordering::Relaxed).min(st.pending.len() + st.workers);
        while st.workers < want {
            st.workers += 1;
            let me = Arc::clone(self);
            thread::spawn(move || me.worker());
        }
    }

    pub fn cancel(&self, id: &str) {
        self.cancelled.lock().unwrap().insert(id.to_string());
        let removed = {
            let mut st = self.state.lock().unwrap();
            let before = st.pending.len();
            let dropped: Vec<PathBuf> = st.pending.iter().filter(|j| j.id == id && j.original != OriginalAction::Keep).map(|j| j.source.clone()).collect();
            st.pending.retain(|j| j.id != id);
            let removed = before != st.pending.len();
            for src in dropped {
                let _ = Self::settle(&mut st, &src, None);
            }
            if removed {
                st.cancelled += 1;
            }
            removed
        };
        if removed {
            (self.emit)(Event::Finished { id: id.into(), outcome: Outcome::Cancelled, elapsed: 0.0 });
        }
        if let Some(child) = self.running.lock().unwrap().get(id) {
            let mut c = child.lock().unwrap();
            let _ = c.kill();
        }
    }

    pub fn cancel_all(&self) {
        let ids: Vec<String> = {
            let st = self.state.lock().unwrap();
            st.pending.iter().map(|j| j.id.clone()).collect()
        };
        let running: Vec<String> = self.running.lock().unwrap().keys().cloned().collect();
        for id in ids.into_iter().chain(running) {
            self.cancel(&id);
        }
        self.set_paused(false);
    }

    pub fn set_paused(&self, paused: bool) {
        let was = self.paused.swap(paused, Ordering::SeqCst);
        #[cfg(unix)]
        if was != paused {
            for child in self.running.lock().unwrap().values() {
                let pid = child.lock().unwrap().id().to_string();
                let sig = if paused { "-STOP" } else { "-CONT" };
                let _ = command("kill").args([sig, &pid]).stdout(Stdio::null()).stderr(Stdio::null()).status();
            }
        }
        #[cfg(not(unix))]
        let _ = was;
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    fn next_job(&self) -> Option<JobSpec> {
        loop {
            {
                let mut st = self.state.lock().unwrap();
                if st.pending.is_empty() {
                    st.workers -= 1;
                    if st.workers == 0 {
                        let (done, failed, cancelled) = (st.done, st.failed, st.cancelled);
                        drop(st);
                        self.paused.store(false, Ordering::SeqCst);
                        (self.emit)(Event::Idle { done, failed, cancelled });
                    }
                    return None;
                }
                if st.workers > self.parallel.load(Ordering::Relaxed) {
                    st.workers -= 1;
                    return None;
                }
                if !self.paused.load(Ordering::SeqCst) {
                    return st.pending.pop_front();
                }
            }
            thread::sleep(Duration::from_millis(200));
        }
    }

    fn settle(st: &mut State, source: &Path, done: Option<(PathBuf, u64)>) -> Result<Option<Vec<(PathBuf, u64)>>, ()> {
        let Some(t) = st.sources.get_mut(source) else { return Ok(None) };
        t.remaining = t.remaining.saturating_sub(1);
        match done {
            Some(o) => t.outputs.push(o),
            None => t.all_ok = false,
        }
        if t.remaining > 0 {
            return Ok(None);
        }
        let t = st.sources.remove(source).expect("present");
        if t.all_ok { Ok(Some(t.outputs)) } else { Err(()) }
    }

    fn worker(self: Arc<Self>) {
        while let Some(job) = self.next_job() {
            let started = Instant::now();
            let mut outcome = self.run_job(&job);
            if job.original != OriginalAction::Keep {
                let done = match &outcome {
                    Outcome::Done { output, size, .. } => Some((output.clone(), *size)),
                    _ => None,
                };
                let settled = Self::settle(&mut self.state.lock().unwrap(), &job.source, done);
                if let Outcome::Done { original, .. } = &mut outcome {
                    *original = match settled {
                        Ok(Some(outputs)) => self.handle_original(&job, &outputs),
                        Ok(None) => None,
                        Err(()) => Some(OriginalFate::Kept { reason: "otherOutputFailed".into(), detail: String::new() }),
                    };
                }
            }
            {
                let mut st = self.state.lock().unwrap();
                match outcome {
                    Outcome::Done { .. } => st.done += 1,
                    Outcome::Failed { .. } => st.failed += 1,
                    Outcome::Cancelled => st.cancelled += 1,
                }
            }
            (self.emit)(Event::Finished { id: job.id.clone(), outcome, elapsed: started.elapsed().as_secs_f64() });
        }
    }

    fn is_cancelled(&self, id: &str) -> bool {
        self.cancelled.lock().unwrap().contains(id)
    }

    fn run_job(&self, job: &JobSpec) -> Outcome {
        if let Some(dir) = job.temp_output.parent() {
            if let Err(e) = fs::create_dir_all(dir) {
                return Outcome::Failed { error: e.to_string(), log: String::new() };
            }
        }
        let attempts: Vec<(&Vec<Vec<OsString>>, bool)> =
            std::iter::once((&job.passes, false)).chain(job.fallback.as_ref().map(|f| (f, true))).collect();

        let mut last_failure = None;
        'attempts: for (passes, is_fallback) in attempts {
            let n = passes.len();
            for (i, args) in passes.iter().enumerate() {
                if self.is_cancelled(&job.id) {
                    self.cleanup(job);
                    return Outcome::Cancelled;
                }
                (self.emit)(Event::Started { id: job.id.clone(), pass: i + 1, passes: n, fallback: is_fallback });
                match self.run_pass(job, args, i, n) {
                    PassResult::Ok => {}
                    PassResult::Cancelled => {
                        self.cleanup(job);
                        return Outcome::Cancelled;
                    }
                    PassResult::Failed { error, log } => {
                        self.cleanup(job);
                        if !is_fallback && job.fallback.is_some() {
                            (self.emit)(Event::FellBack { id: job.id.clone(), reason: error.clone() });
                        }
                        last_failure = Some((error, log));
                        continue 'attempts;
                    }
                }
            }
            self.cleanup_passlog(job);
            return match finalize(&job.temp_output, &job.final_output, job.overwrite) {
                Ok((output, size)) => {
                    if job.keep_dates {
                        copy_dates(&job.source, &output);
                    }
                    Outcome::Done { output, size, fell_back: is_fallback, original: None }
                }
                Err(e) => {
                    let _ = fs::remove_file(&job.temp_output);
                    Outcome::Failed { error: e.to_string(), log: String::new() }
                }
            };
        }
        let (error, log) = last_failure.unwrap_or_else(|| ("failed".into(), String::new()));
        Outcome::Failed { error, log }
    }

    fn run_pass(&self, job: &JobSpec, args: &[OsString], pass: usize, passes: usize) -> PassResult {
        let ffmpeg = self.ffmpeg.lock().unwrap().clone();
        let mut cmd = command_with_priority(&ffmpeg, self.low_priority.load(Ordering::Relaxed));
        cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => return PassResult::Failed { error: e.to_string(), log: String::new() },
        };
        let stdout = child.stdout.take().expect("piped");
        let stderr = child.stderr.take().expect("piped");
        let child = Arc::new(Mutex::new(child));
        self.running.lock().unwrap().insert(job.id.clone(), Arc::clone(&child));
        if self.paused.load(Ordering::SeqCst) && CAN_SUSPEND {
            #[cfg(unix)]
            {
                let pid = child.lock().unwrap().id().to_string();
                let _ = command("kill").args(["-STOP", &pid]).status();
            }
        }

        let log_thread = thread::spawn(move || {
            let mut tail: VecDeque<String> = VecDeque::new();
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if tail.len() == 80 {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
            tail.into_iter().collect::<Vec<_>>().join("\n")
        });

        let mut parser = ProgressParser::default();
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Some(p) = parser.line(&line) else { continue };
            if last_emit.elapsed() < Duration::from_millis(150) && !p.done {
                continue;
            }
            last_emit = Instant::now();
            let frac = match job.duration {
                Some(d) if d > 0.0 => (p.out_time / d).clamp(0.0, 1.0),
                _ => 0.0,
            };
            let percent = ((pass as f64 + frac) / passes as f64 * 100.0).min(100.0);
            let eta = match job.duration {
                Some(d) if p.speed > 0.0 => {
                    let left_this = (d - p.out_time).max(0.0) / p.speed;
                    let left_other = (passes - pass - 1) as f64 * d / p.speed;
                    Some(left_this + left_other)
                }
                _ => None,
            };
            (self.emit)(Event::Progress {
                id: job.id.clone(),
                percent,
                fps: p.fps,
                speed: p.speed,
                eta,
                size: p.total_size,
                out_time: p.out_time,
            });
        }

        let status = loop {
            let r = child.lock().unwrap().try_wait();
            match r {
                Ok(Some(s)) => break Some(s),
                Ok(None) => thread::sleep(Duration::from_millis(30)),
                Err(_) => break None,
            }
        };
        self.running.lock().unwrap().remove(&job.id);
        let log = log_thread.join().unwrap_or_default();

        if self.is_cancelled(&job.id) {
            return PassResult::Cancelled;
        }
        match status {
            Some(s) if s.success() => PassResult::Ok,
            _ => {
                let error = crate::ffmpeg::root_cause(&log).unwrap_or_else(|| "ffmpeg exited with an error".into());
                PassResult::Failed { error, log }
            }
        }
    }

    fn handle_original(&self, job: &JobSpec, outputs: &[(PathBuf, u64)]) -> Option<OriginalFate> {
        if job.original == OriginalAction::Keep || outputs.iter().any(|(o, _)| same_file(&job.source, o)) {
            return None;
        }
        let ffmpeg = self.ffmpeg.lock().unwrap().clone();
        if outputs.is_empty() || outputs.iter().any(|(o, size)| *size == 0 || !decodes_cleanly(&ffmpeg, o)) {
            return Some(OriginalFate::Kept { reason: "verifyFailed".into(), detail: String::new() });
        }
        let result = match job.original {
            OriginalAction::Trash => trash::delete(&job.source).map(|_| OriginalFate::Trashed).map_err(|e| e.to_string()),
            OriginalAction::Delete => fs::remove_file(&job.source).map(|_| OriginalFate::Deleted).map_err(|e| e.to_string()),
            OriginalAction::Keep => unreachable!(),
        };
        Some(result.unwrap_or_else(|detail| OriginalFate::Kept { reason: "error".into(), detail }))
    }

    fn cleanup(&self, job: &JobSpec) {
        let _ = fs::remove_file(&job.temp_output);
        self.cleanup_passlog(job);
    }

    fn cleanup_passlog(&self, job: &JobSpec) {
        let Some(prefix) = &job.passlog else { return };
        let (Some(dir), Some(stem)) = (prefix.parent(), prefix.file_name()) else { return };
        let stem = stem.to_string_lossy().into_owned();
        if let Ok(entries) = fs::read_dir(dir) {
            for e in entries.flatten() {
                if e.file_name().to_string_lossy().starts_with(&stem) {
                    let _ = fs::remove_file(e.path());
                }
            }
        }
    }
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

pub fn decodes_cleanly(ffmpeg: &Path, file: &Path) -> bool {
    let check = |extra: &[&str]| {
        let mut cmd = command(ffmpeg);
        cmd.args(["-hide_banner", "-v", "error"]).args(extra).arg("-i").arg(file).args(["-t", "20", "-f", "null", "-"]);
        matches!(run_with_timeout(cmd, Duration::from_secs(300)), Ok(o) if o.status_ok && o.stderr.iter().all(|b| b.is_ascii_whitespace()))
    };
    check(&[]) && check(&["-sseof", "-10"])
}

fn copy_dates(from: &Path, to: &Path) {
    if let Ok(meta) = fs::metadata(from) {
        let mtime = filetime::FileTime::from_last_modification_time(&meta);
        let atime = filetime::FileTime::from_last_access_time(&meta);
        let _ = filetime::set_file_times(to, atime, mtime);
    }
}

fn finalize(temp: &Path, target: &Path, overwrite: bool) -> std::io::Result<(PathBuf, u64)> {
    let mut dest = target.to_path_buf();
    if dest.exists() {
        if overwrite {
            fs::remove_file(&dest)?;
        } else {
            let stem = target.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let ext = target.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
            let dir = target.parent().unwrap_or(Path::new(""));
            let mut n = 2;
            while dest.exists() {
                dest = dir.join(format!("{stem} ({n}){ext}"));
                n += 1;
            }
        }
    }
    fs::rename(temp, &dest)?;
    let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok((dest, size))
}

#[cfg(any(target_os = "linux", windows))]
pub fn restore_from_trash(original: &Path) -> Result<bool, String> {
    let items = trash::os_limited::list().map_err(|e| e.to_string())?;
    let wanted: Vec<_> = items
        .into_iter()
        .filter(|i| i.original_parent.join(&i.name) == original)
        .collect();
    if wanted.is_empty() {
        return Ok(false);
    }
    let newest = wanted.into_iter().max_by_key(|i| i.time_deleted).expect("non-empty");
    trash::os_limited::restore_all([newest]).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn restore_from_trash(_original: &Path) -> Result<bool, String> {
    Ok(false)
}

pub fn temp_path(final_output: &Path) -> PathBuf {
    let stem = final_output.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let name = match final_output.extension() {
        Some(ext) => format!("{stem}.zvc-part.{}", ext.to_string_lossy()),
        None => format!("{stem}.zvc-part"),
    };
    final_output.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_paths() {
        assert_eq!(temp_path(Path::new("/o/Show.[1080p].mp4")), PathBuf::from("/o/Show.[1080p].zvc-part.mp4"));
        assert_eq!(temp_path(Path::new("/o/noext")), PathBuf::from("/o/noext.zvc-part"));
    }

    #[test]
    fn finalize_never_clobbers_without_overwrite() {
        let d = tempfile::tempdir().unwrap();
        let target = d.path().join("a.mp4");
        fs::write(&target, "old").unwrap();
        let tmp = d.path().join("a.zvc-part.mp4");
        fs::write(&tmp, "new").unwrap();
        let (out, _) = finalize(&tmp, &target, false).unwrap();
        assert_eq!(out, d.path().join("a (2).mp4"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "old");

        fs::write(&tmp, "newer").unwrap();
        let (out, size) = finalize(&tmp, &target, true).unwrap();
        assert_eq!((out, size), (target.clone(), 5));
    }
}
