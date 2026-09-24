use std::fs;
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

use base64::Engine as _;
use sha2::{Digest, Sha256};

use crate::ffmpeg::{command, run_with_timeout};
use crate::{Error, Result};

fn cache_key(input: &Path) -> String {
    let meta = fs::metadata(input).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h = Sha256::new();
    h.update(input.to_string_lossy().as_bytes());
    h.update(size.to_le_bytes());
    h.update(mtime.to_le_bytes());
    h.finalize().iter().take(12).map(|b| format!("{b:02x}")).collect()
}

pub fn thumbnail(ffmpeg: &Path, input: &Path, duration: Option<f64>, cache_dir: &Path) -> Result<String> {
    fs::create_dir_all(cache_dir)?;
    let file = cache_dir.join(format!("{}.jpg", cache_key(input)));
    if !file.exists() {
        let at = duration.map(|d| (d * 0.1).min(120.0)).filter(|t| *t >= 1.0).unwrap_or(0.0);
        let tmp = cache_dir.join(format!("{}.tmp.jpg", cache_key(input)));
        let mut cmd = command(ffmpeg);
        cmd.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-ss", &format!("{at:.2}"), "-i"])
            .arg(input)
            .args(["-map", "0:v:0", "-frames:v", "1", "-vf", "scale=320:-2:flags=bicubic", "-q:v", "5", "-f", "image2", "-c:v", "mjpeg"])
            .arg(&tmp);
        let out = run_with_timeout(cmd, Duration::from_secs(30))?;
        if !out.status_ok || !tmp.exists() {
            let _ = fs::remove_file(&tmp);
            return Err(Error::Probe("no thumbnail".into()));
        }
        fs::rename(&tmp, &file)?;
    }
    let bytes = fs::read(&file)?;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

pub fn frame_at(ffmpeg: &Path, input: &Path, at: f64, max_width: u32, scratch: &Path) -> Result<String> {
    fs::create_dir_all(scratch)?;
    let file = scratch.join(format!("{}.jpg", uuid::Uuid::new_v4()));
    let mut cmd = command(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-ss", &format!("{:.3}", at.max(0.0)), "-i"])
        .arg(input)
        .args(["-map", "0:v:0", "-frames:v", "1", "-vf", &format!("scale='min({max_width},iw)':-2:flags=lanczos"), "-q:v", "2", "-f", "image2", "-c:v", "mjpeg"])
        .arg(&file);
    let out = run_with_timeout(cmd, Duration::from_secs(60))?;
    let bytes = fs::read(&file);
    let _ = fs::remove_file(&file);
    match (out.status_ok, bytes) {
        (true, Ok(b)) if !b.is_empty() => Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(b))),
        _ => Err(Error::Probe("no frame".into())),
    }
}
