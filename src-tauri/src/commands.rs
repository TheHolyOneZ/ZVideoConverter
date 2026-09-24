use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

use zvc_core::args::{self, BuildRequest, JobOptions};
use zvc_core::engine::{self as zengine, temp_path, Engine, Event, JobSpec, OriginalAction, CAN_SUSPEND};
use zvc_core::error::ErrorDto;
use zvc_core::ffmpeg::{self, download::DownloadProgress, FfmpegInstall};
use zvc_core::hw::{self, HwInfo};
use zvc_core::naming::{self, NameRequest, NameStatus, NameVars, NamingOptions};
use zvc_core::probe::{self, MediaInfo};
use zvc_core::profile::{Crop, Profile, ProfileWarning, StreamMode};
use zvc_core::thumbs;

use crate::state::AppState;

pub const ENGINE_EVENT: &str = "zvc://engine";
pub const OPEN_EVENT: &str = "zvc://open";

type Res<T> = Result<T, ErrorDto>;

fn err(code: &'static str, detail: impl ToString) -> ErrorDto {
    ErrorDto { code, detail: detail.to_string() }
}

fn core(e: zvc_core::Error) -> ErrorDto {
    ErrorDto::from(&e)
}

fn installed(state: &AppState) -> Res<FfmpegInstall> {
    state.ffmpeg.lock().unwrap().clone().ok_or_else(|| err("ffmpegMissing", "ffmpeg was not found"))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| err("internal", e))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    can_suspend: bool,
    platform: &'static str,
}

#[tauri::command]
pub fn startup_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo { version: env!("CARGO_PKG_VERSION"), can_suspend: CAN_SUSPEND, platform: std::env::consts::OS }
}

fn set_ffmpeg(state: &AppState, found: Option<FfmpegInstall>) {
    let mut cur = state.ffmpeg.lock().unwrap();
    let changed = cur.as_ref().map(|c| (&c.ffmpeg, &c.version)) != found.as_ref().map(|f| (&f.ffmpeg, &f.version));
    if changed {
        *state.hw.lock().unwrap() = None;
        if let (Some(engine), Some(f)) = (state.engine.lock().unwrap().as_ref(), found.as_ref()) {
            engine.set_ffmpeg(f.ffmpeg.clone());
        }
    }
    *cur = found;
}

#[tauri::command]
pub async fn ffmpeg_status(state: State<'_, AppState>, custom_path: Option<String>) -> Res<Option<FfmpegInstall>> {
    let managed = state.paths.managed_ffmpeg.clone();
    let custom = custom_path.filter(|s| !s.trim().is_empty()).map(PathBuf::from);
    let found = blocking(move || Ok(ffmpeg::locate(custom.as_deref(), &managed))).await?;
    set_ffmpeg(&state, found.clone());
    Ok(found)
}

#[tauri::command]
pub async fn ffmpeg_download(state: State<'_, AppState>, on_progress: Channel<DownloadProgress>) -> Res<FfmpegInstall> {
    let dir = state.paths.managed_ffmpeg.clone();
    let cancel = Arc::clone(&state.download_cancel);
    cancel.store(false, Ordering::SeqCst);
    let found = blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| err("io", e))?;
        ffmpeg::download::download(&dir, &cancel, |p| {
            let _ = on_progress.send(p);
        })
        .map_err(core)
    })
    .await?;
    set_ffmpeg(&state, Some(found.clone()));
    Ok(found)
}

#[tauri::command]
pub fn ffmpeg_download_cancel(state: State<'_, AppState>) {
    state.download_cancel.store(true, Ordering::SeqCst);
}

#[derive(Serialize, Deserialize)]
struct HwCache {
    ffmpeg: PathBuf,
    version: String,
    info: HwInfo,
}

#[tauri::command]
pub async fn hw_info(state: State<'_, AppState>, force: bool) -> Res<HwInfo> {
    if !force {
        if let Some(h) = state.hw.lock().unwrap().clone() {
            return Ok(h);
        }
    }
    let ff = installed(&state)?;
    let cache_file = state.paths.hw_cache.clone();
    let info = blocking(move || {
        if !force {
            if let Ok(bytes) = fs::read(&cache_file) {
                if let Ok(c) = serde_json::from_slice::<HwCache>(&bytes) {
                    if c.ffmpeg == ff.ffmpeg && c.version == ff.version {
                        return Ok(c.info);
                    }
                }
            }
        }
        let info = hw::detect(&ff.ffmpeg, &ff.version);
        if let Some(dir) = cache_file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let cache = HwCache { ffmpeg: ff.ffmpeg.clone(), version: ff.version.clone(), info: info.clone() };
        let _ = fs::write(&cache_file, serde_json::to_vec_pretty(&cache).unwrap_or_default());
        Ok(info)
    })
    .await?;
    *state.hw.lock().unwrap() = Some(info.clone());
    Ok(info)
}

const MEDIA_EXTS: &[&str] = &[
    "mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "f4v", "mpg", "mpeg", "m2v", "ts", "m2ts", "mts", "vob",
    "3gp", "3g2", "ogv", "divx", "xvid", "asf", "rm", "rmvb", "dv", "mxf", "gif", "y4m", "mp3", "m4a", "aac", "flac",
    "wav", "ogg", "opus", "wma", "ac3", "eac3", "dts", "mka", "aiff", "aif", "ape", "wv", "alac",
];

pub fn is_media(p: &Path) -> bool {
    let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if name.contains(".zvc-part.") {
        return false;
    }
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).is_some_and(|e| MEDIA_EXTS.contains(&e.as_str()))
}

fn walk(dir: &Path, root: &Path, depth: usize, out: &mut Vec<ExpandedPath>) {
    if depth > 32 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| natural_key(&e.file_name().to_string_lossy()));
    for e in entries {
        let p = e.path();
        let hidden = e.file_name().to_string_lossy().starts_with('.');
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() && !hidden {
            walk(&p, root, depth + 1, out);
        } else if (ft.is_file() || ft.is_symlink()) && !hidden && is_media(&p) {
            out.push(ExpandedPath { path: p.to_string_lossy().into_owned(), root: Some(root.to_string_lossy().into_owned()) });
        }
    }
}

fn natural_key(s: &str) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut num = String::new();
    for c in s.to_lowercase().chars() {
        if c.is_ascii_digit() {
            num.push(c);
        } else {
            if !num.is_empty() {
                out.push((std::mem::take(&mut text), num.parse().unwrap_or(u64::MAX)));
                num.clear();
            }
            text.push(c);
        }
    }
    out.push((text, num.parse().unwrap_or(0)));
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedPath {
    path: String,
    root: Option<String>,
}

#[tauri::command]
pub async fn expand_paths(paths: Vec<String>) -> Res<Vec<ExpandedPath>> {
    blocking(move || {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for p in paths {
            let path = PathBuf::from(&p);
            let path = match fs::canonicalize(&path) {
                Ok(c) if cfg!(windows) => PathBuf::from(naming::simplify_verbatim(&c.to_string_lossy())),
                Ok(c) => c,
                Err(_) => path,
            };
            if path.is_dir() {
                let mut found = Vec::new();
                walk(&path, &path, 0, &mut found);
                out.extend(found);
            } else if path.is_file() {
                out.push(ExpandedPath { path: path.to_string_lossy().into_owned(), root: None });
            }
        }
        out.retain(|e| seen.insert(e.path.clone()));
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn probe_file(state: State<'_, AppState>, path: String) -> Res<MediaInfo> {
    let ff = installed(&state)?;
    blocking(move || probe::probe(&ff.ffprobe, Path::new(&path)).map_err(core)).await
}

#[tauri::command]
pub async fn thumbnail(state: State<'_, AppState>, path: String, duration: Option<f64>) -> Res<String> {
    let ff = installed(&state)?;
    let dir = state.paths.thumbs.clone();
    blocking(move || thumbs::thumbnail(&ff.ffmpeg, Path::new(&path), duration, &dir).map_err(core)).await
}

#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> Vec<Profile> {
    state.profiles.list()
}

#[tauri::command]
pub fn save_profile(state: State<'_, AppState>, profile: Profile) -> Res<Profile> {
    state.profiles.save(profile).map_err(core)
}

#[tauri::command]
pub fn delete_profile(state: State<'_, AppState>, id: String) -> Res<()> {
    state.profiles.delete(&id).map_err(core)
}

#[tauri::command]
pub fn duplicate_profile(state: State<'_, AppState>, id: String, name: String) -> Res<Profile> {
    state.profiles.duplicate(&id, &name).map_err(core)
}

#[tauri::command]
pub fn reorder_profiles(state: State<'_, AppState>, ids: Vec<String>) -> Res<()> {
    state.profiles.reorder(&ids).map_err(core)
}

#[tauri::command]
pub fn import_profile(state: State<'_, AppState>, path: String) -> Res<Profile> {
    state.profiles.import(Path::new(&path)).map_err(core)
}

#[tauri::command]
pub fn export_profile(state: State<'_, AppState>, id: String, path: String) -> Res<()> {
    state.profiles.export(&id, Path::new(&path)).map_err(core)
}

#[tauri::command]
pub fn profile_warnings(profile: Profile) -> Vec<ProfileWarning> {
    profile.warnings()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInput {
    id: String,
    input: PathBuf,
    root: Option<PathBuf>,
    profile: Profile,
    media: MediaInfo,
    #[serde(default)]
    options: JobOptions,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JobPreview {
    id: String,
    output: PathBuf,
    name_status: NameStatus,
    estimate: Option<u64>,
    encoder: Option<hw::EncoderChoice>,
    notes: Vec<&'static str>,
    error: Option<&'static str>,
    command: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOptions {
    hw_decode: bool,
    parallel: usize,
    #[serde(default)]
    keep_dates: bool,
    #[serde(default)]
    original: OriginalAction,
    #[serde(default)]
    low_priority: bool,
}

fn name_vars(j: &JobInput) -> NameVars {
    let p = &j.profile;
    let v = j.media.video.as_ref();
    NameVars {
        profile: p.name.clone(),
        vcodec: match p.video.mode {
            StreamMode::Copy => v.map(|v| v.codec.clone()).unwrap_or_default(),
            _ if p.container.is_audio_only() => String::new(),
            _ => serde_json::to_value(p.video.codec).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default(),
        },
        acodec: match p.audio.mode {
            StreamMode::Copy => j.media.audio.first().map(|a| a.codec.clone()).unwrap_or_default(),
            StreamMode::Off => String::new(),
            _ => serde_json::to_value(p.audio.codec).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default(),
        },
        width: v.map(|v| zvc_core::args::output_size(p, v.width, v.height).0),
        height: v.map(|v| zvc_core::args::output_size(p, v.width, v.height).1),
        fps: v.and_then(|v| p.video.fps.filter(|f| *f > 0.0 && p.video.mode == StreamMode::Encode).or(v.fps)),
    }
}

struct Planned {
    preview: JobPreview,
    spec: Option<JobSpec>,
}

#[derive(Clone, Copy, Default)]
struct AfterOptions {
    keep_dates: bool,
    original: OriginalAction,
}

fn plan_jobs(state: &AppState, jobs: &[JobInput], naming_opts: &NamingOptions, hw_decode: bool, after: AfterOptions) -> Vec<Planned> {
    let ffmpeg_path = state.ffmpeg.lock().unwrap().as_ref().map(|f| f.ffmpeg.clone()).unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let hw = state.hw.lock().unwrap().clone();
    let windows = cfg!(windows);
    let claimed: HashSet<String> = state.claimed_set().iter().map(|p| naming::path_key(p, windows)).collect();
    let requests: Vec<NameRequest> = jobs
        .iter()
        .map(|j| NameRequest {
            id: j.id.clone(),
            input: j.input.clone(),
            root: j.root.clone(),
            ext: j.profile.container.ext().into(),
            vars: name_vars(j),
        })
        .collect();
    let names = naming::plan(&requests, naming_opts, windows, |p| p.exists() || claimed.contains(&naming::path_key(p, windows)));

    jobs.iter()
        .zip(names)
        .map(|(j, name)| {
            let estimate = args::estimate_size(&j.profile, &j.media, &j.options);
            let tmp = temp_path(&name.output);
            let passlog = state.paths.passlogs.join(&j.id);
            let mut preview = JobPreview {
                id: j.id.clone(),
                output: name.output.clone(),
                name_status: name.status,
                estimate,
                encoder: None,
                notes: Vec::new(),
                error: None,
                command: None,
            };
            let Some(hw) = hw.as_ref() else {
                return Planned { preview, spec: None };
            };
            let req = |force_cpu| BuildRequest {
                input: &j.input,
                output: &tmp,
                profile: &j.profile,
                media: &j.media,
                hw,
                hw_decode,
                force_cpu,
                job: &j.options,
                passlog: &passlog,
            };
            match args::build(&req(false)) {
                Err(e) => {
                    preview.error = Some(e.code());
                    Planned { preview, spec: None }
                }
                Ok(plan) => {
                    preview.command = plan.passes.iter().map(|p| args::display_command(&ffmpeg_path, p)).reduce(|a, b| format!("{a}\n{b}"));
                    preview.notes = plan.notes.clone();
                    preview.encoder = plan.encoder.clone();
                    let gpu = plan.encoder.as_ref().is_some_and(|e| e.family.is_gpu());
                    let fallback = if gpu { args::build(&req(true)).ok().map(|p| p.passes) } else { None };
                    let spec = (name.status != NameStatus::Skipped).then(|| JobSpec {
                        id: j.id.clone(),
                        passes: plan.passes,
                        fallback,
                        temp_output: tmp.clone(),
                        final_output: name.output.clone(),
                        overwrite: name.status == NameStatus::Overwrites,
                        duration: {
                            let start = j.options.trim_start.unwrap_or(0.0);
                            j.options.trim_end.or(j.media.duration).map(|e| (e - start).max(0.1))
                        },
                        passlog: Some(passlog.clone()),
                        source: j.input.clone(),
                        keep_dates: after.keep_dates,
                        original: after.original,
                    });
                    Planned { preview, spec }
                }
            }
        })
        .collect()
}

#[tauri::command]
pub async fn preview_jobs(state: State<'_, AppState>, jobs: Vec<JobInput>, naming: NamingOptions) -> Res<Vec<JobPreview>> {
    let state = state.inner();
    Ok(plan_jobs(state, &jobs, &naming, true, AfterOptions::default()).into_iter().map(|p| p.preview).collect())
}

async fn fill_detected_crops(state: &AppState, ff: &FfmpegInstall, jobs: &mut [JobInput]) {
    type CropTask = (usize, PathBuf, Option<f64>, (u32, u32));
    let todo: Vec<CropTask> = jobs
        .iter()
        .enumerate()
        .filter(|(_, j)| j.profile.video.crop == Crop::Auto && !j.options.crop_checked)
        .map(|(i, j)| {
            let frame = j.media.video.as_ref().map(|v| (v.width, v.height)).unwrap_or((0, 0));
            (i, j.input.clone(), j.media.duration, frame)
        })
        .collect();
    let mut handles = Vec::new();
    for (i, path, duration, frame) in todo {
        if let Some(cached) = state.crops.lock().unwrap().get(&path) {
            jobs[i].options.detected_crop = *cached;
            jobs[i].options.crop_checked = true;
            continue;
        }
        let ffmpeg = ff.ffmpeg.clone();
        handles.push((i, path.clone(), tauri::async_runtime::spawn_blocking(move || zvc_core::analyze::detect_crop(&ffmpeg, &path, duration, frame))));
    }
    for (i, path, h) in handles {
        let found = h.await.ok().flatten();
        state.crops.lock().unwrap().insert(path, found);
        jobs[i].options.detected_crop = found;
        jobs[i].options.crop_checked = true;
    }
}

#[tauri::command]
pub async fn detect_crop(state: State<'_, AppState>, path: String, duration: Option<f64>, width: u32, height: u32) -> Res<Option<zvc_core::analyze::CropRect>> {
    let ff = installed(&state)?;
    let key = PathBuf::from(&path);
    if let Some(c) = state.crops.lock().unwrap().get(&key) {
        return Ok(*c);
    }
    let p = key.clone();
    let found = blocking(move || Ok(zvc_core::analyze::detect_crop(&ff.ffmpeg, &p, duration, (width, height)))).await?;
    state.crops.lock().unwrap().insert(key, found);
    Ok(found)
}

fn engine(app: &AppHandle, state: &AppState) -> Res<Arc<Engine>> {
    let mut slot = state.engine.lock().unwrap();
    if let Some(e) = slot.as_ref() {
        return Ok(Arc::clone(e));
    }
    let ff = installed(state)?;
    let handle = app.clone();
    let claimed = Arc::clone(&state.claimed);
    let produced = Arc::clone(&state.watching.produced);
    let e = Engine::new(
        ff.ffmpeg,
        Arc::new(move |ev: Event| {
            if let Event::Finished { id, outcome, .. } = &ev {
                claimed.lock().unwrap().remove(id);
                if let zvc_core::engine::Outcome::Done { output, .. } = outcome {
                    produced.lock().unwrap().insert(output.clone());
                }
            }
            let _ = handle.emit(ENGINE_EVENT, ev);
        }),
    );
    *slot = Some(Arc::clone(&e));
    Ok(e)
}

#[tauri::command]
pub async fn start_jobs(
    app: AppHandle,
    state: State<'_, AppState>,
    mut jobs: Vec<JobInput>,
    naming: NamingOptions,
    run: RunOptions,
) -> Res<Vec<JobPreview>> {
    let state = state.inner();
    let ff = installed(state)?;
    fill_detected_crops(state, &ff, &mut jobs).await;
    if state.hw.lock().unwrap().is_none() {
        return Err(err("hwUnknown", "hardware detection has not finished"));
    }
    let _ = fs::create_dir_all(&state.paths.passlogs);
    let after = AfterOptions { keep_dates: run.keep_dates, original: run.original };
    let planned = plan_jobs(state, &jobs, &naming, run.hw_decode, after);
    let engine = engine(&app, state)?;
    engine.set_low_priority(run.low_priority);
    engine.set_parallel(run.parallel);
    let mut specs = Vec::new();
    let mut previews = Vec::new();
    {
        let mut claimed = state.claimed.lock().unwrap();
        for p in planned {
            if let Some(spec) = p.spec {
                claimed.insert(spec.id.clone(), spec.final_output.clone());
                specs.push(spec);
            }
            previews.push(p.preview);
        }
    }
    engine.enqueue(specs);
    Ok(previews)
}

fn with_engine(state: &AppState, f: impl FnOnce(&Arc<Engine>)) {
    if let Some(e) = state.engine.lock().unwrap().as_ref() {
        f(e);
    }
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, id: String) {
    with_engine(&state, |e| e.cancel(&id));
}

#[tauri::command]
pub fn cancel_all(state: State<'_, AppState>) {
    with_engine(&state, |e| e.cancel_all());
}

#[tauri::command]
pub fn set_paused(state: State<'_, AppState>, paused: bool) {
    with_engine(&state, |e| e.set_paused(paused));
}

#[tauri::command]
pub fn set_parallel(state: State<'_, AppState>, parallel: usize) {
    with_engine(&state, |e| e.set_parallel(parallel));
}

#[cfg(test)]
mod tests {
    use super::natural_key;

    #[test]
    fn version_compare() {
        use super::is_newer;
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("v1.0.0", "0.9.12"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("garbage", "0.1.0"));
        assert!(is_newer("0.1.10", "0.1.9"));
    }

    #[test]
    fn natural_sort() {
        let mut v = vec!["ep10.mkv", "ep2.mkv", "Ep1.mkv"];
        v.sort_by_key(|s| natural_key(s));
        assert_eq!(v, vec!["Ep1.mkv", "ep2.mkv", "ep10.mkv"]);
    }
}

#[tauri::command]
pub async fn restore_original(path: String) -> Res<bool> {
    blocking(move || zengine::restore_from_trash(Path::new(&path)).map_err(|e| err("io", e))).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    file: PathBuf,
    start: f64,
    seconds: f64,
    size: u64,
    estimate: u64,
    speed: f64,
    encoder: Option<hw::EncoderChoice>,
    fell_back: bool,
}

#[tauri::command]
pub async fn preview_job(state: State<'_, AppState>, mut job: JobInput, hw_decode: bool) -> Res<PreviewResult> {
    let state = state.inner();
    let ff = installed(state)?;
    let hw = state.hw.lock().unwrap().clone().ok_or_else(|| err("hwUnknown", "hardware detection has not finished"))?;
    fill_detected_crops(state, &ff, std::slice::from_mut(&mut job)).await;
    let dir = state.paths.previews.clone();
    blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| err("io", e))?;
        let begin = job.options.trim_start.unwrap_or(0.0).max(0.0);
        let end = job.options.trim_end.or(job.media.duration).unwrap_or(begin + 10.0);
        let window = (end - begin).max(0.1);
        let len = window.min(10.0);
        let start = begin + ((window - len) * 0.45).max(0.0);
        let mut opts = job.options.clone();
        opts.trim_start = Some(start);
        opts.trim_end = Some(start + len);
        let out = dir.join(format!("{}-preview.{}", job.id, job.profile.container.ext()));
        let _ = std::fs::remove_file(&out);
        let passlog = dir.join(format!("{}-pass", job.id));

        let attempt = |force_cpu: bool| -> Res<(Option<hw::EncoderChoice>, f64)> {
            let plan = args::build(&BuildRequest {
                input: &job.input,
                output: &out,
                profile: &job.profile,
                media: &job.media,
                hw: &hw,
                hw_decode,
                force_cpu,
                job: &opts,
                passlog: &passlog,
            })
            .map_err(|e| err(e.code(), e.code()))?;
            let started = std::time::Instant::now();
            for pass in &plan.passes {
                let mut cmd = ffmpeg::command(&ff.ffmpeg);
                cmd.args(pass);
                let o = ffmpeg::run_with_timeout(cmd, std::time::Duration::from_secs(600)).map_err(|e| err("io", e))?;
                if !o.status_ok {
                    let log = String::from_utf8_lossy(&o.stderr).into_owned();
                    return Err(err("previewFailed", ffmpeg::root_cause(&log).unwrap_or(log)));
                }
            }
            Ok((plan.encoder, started.elapsed().as_secs_f64()))
        };
        let (encoder, elapsed, fell_back) = match attempt(false) {
            Ok((e, t)) => (e, t, false),
            Err(first) => match attempt(true) {
                Ok((e, t)) => (e, t, true),
                Err(_) => return Err(first),
            },
        };
        let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            if e.file_name().to_string_lossy().starts_with(&format!("{}-pass", job.id)) {
                let _ = std::fs::remove_file(e.path());
            }
        }
        Ok(PreviewResult {
            file: out,
            start,
            seconds: len,
            size,
            estimate: (size as f64 / len * window) as u64,
            speed: if elapsed > 0.0 { len / elapsed } else { 0.0 },
            encoder,
            fell_back,
        })
    })
    .await
}

#[tauri::command]
pub async fn save_session(state: State<'_, AppState>, data: String) -> Res<()> {
    let path = state.paths.session.clone();
    blocking(move || {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| err("io", e))?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, data).map_err(|e| err("io", e))?;
        fs::rename(&tmp, &path).map_err(|e| err("io", e))
    })
    .await
}

#[tauri::command]
pub async fn load_session(state: State<'_, AppState>) -> Res<Option<String>> {
    let path = state.paths.session.clone();
    blocking(move || Ok(fs::read_to_string(path).ok())).await
}

#[tauri::command]
pub async fn remove_partials(outputs: Vec<String>) -> Res<usize> {
    blocking(move || {
        let mut removed = 0;
        for o in outputs {
            let tmp = temp_path(Path::new(&o));
            if tmp.is_file() && fs::remove_file(&tmp).is_ok() {
                removed += 1;
            }
        }
        Ok(removed)
    })
    .await
}

#[tauri::command]
pub async fn check_space(needs: Vec<zvc_core::system::SpaceNeed>) -> Res<Vec<zvc_core::system::SpaceShortage>> {
    blocking(move || Ok(zvc_core::system::check_space(&needs))).await
}

#[tauri::command]
pub async fn power_action(action: zvc_core::system::PowerAction) -> Res<()> {
    blocking(move || zvc_core::system::power(action).map_err(|e| err("power", e))).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePair {
    before: String,
    after: String,
}

#[tauri::command]
pub async fn compare_frames(state: State<'_, AppState>, source: String, source_at: f64, output: String, output_at: f64) -> Res<FramePair> {
    let ff = installed(&state)?;
    let scratch = state.paths.previews.join("frames");
    blocking(move || {
        let before = thumbs::frame_at(&ff.ffmpeg, Path::new(&source), source_at, 1920, &scratch).map_err(core)?;
        let after = thumbs::frame_at(&ff.ffmpeg, Path::new(&output), output_at, 1920, &scratch).map_err(core)?;
        Ok(FramePair { before, after })
    })
    .await
}

#[tauri::command]
pub fn set_watch_folders(app: AppHandle, state: State<'_, AppState>, folders: Vec<crate::watch::WatchFolder>) -> Vec<String> {
    state.watching.set(&app, folders)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    notes: String,
}

#[tauri::command]
pub async fn check_update() -> Res<Option<UpdateInfo>> {
    blocking(|| {
        let agent = ureq_agent();
        let info: UpdateInfo = match agent.get("https://zsync.eu/zvideoconverter/version.json").call() {
            Ok(r) => match r.into_json() {
                Ok(i) => i,
                Err(_) => return Ok(None),
            },
            Err(_) => return Ok(None),
        };
        Ok(is_newer(&info.version, env!("CARGO_PKG_VERSION")).then_some(info))
    })
    .await
}

fn ureq_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent(concat!("ZVideoConverter/", env!("CARGO_PKG_VERSION")))
        .build()
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    let parse = |v: &str| -> Option<Vec<u64>> { v.trim().trim_start_matches('v').split('.').map(|p| p.parse().ok()).collect() };
    match (parse(candidate), parse(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

#[tauri::command]
pub async fn make_samples(state: State<'_, AppState>) -> Res<Vec<String>> {
    let ff = installed(&state)?;
    let dir = state.paths.samples.clone();
    blocking(move || {
        let made = zvc_core::samples::make(&ff.ffmpeg, &dir).map_err(core)?;
        Ok(made.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
    })
    .await
}

#[tauri::command]
pub async fn remove_samples(state: State<'_, AppState>) -> Res<()> {
    let dir = state.paths.samples.clone();
    blocking(move || {
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| err("io", e))?;
        }
        Ok(())
    })
    .await
}
