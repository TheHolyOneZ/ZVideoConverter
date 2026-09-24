use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use super::{command, exe_name, run_with_timeout};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FfmpegSource {
    Custom,
    Managed,
    System,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInstall {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub source: FfmpegSource,
    pub version: String,
}

fn version_of(ffmpeg: &Path) -> Option<String> {
    let mut cmd = command(ffmpeg);
    cmd.arg("-version");
    let out = run_with_timeout(cmd, Duration::from_secs(10)).ok()?;
    if !out.status_ok {
        return None;
    }
    parse_version(&String::from_utf8_lossy(&out.stdout))
}

pub(crate) fn parse_version(text: &str) -> Option<String> {
    let first = text.lines().next()?;
    let rest = first.strip_prefix("ffmpeg version ")?;
    Some(rest.split(" Copyright").next().unwrap_or(rest).trim().to_string())
}

fn pair_in(dir: &Path) -> Option<(PathBuf, PathBuf)> {
    let ffmpeg = dir.join(exe_name("ffmpeg"));
    let ffprobe = dir.join(exe_name("ffprobe"));
    (ffmpeg.is_file() && ffprobe.is_file()).then_some((ffmpeg, ffprobe))
}

fn check(pair: Option<(PathBuf, PathBuf)>, source: FfmpegSource) -> Option<FfmpegInstall> {
    let (ffmpeg, ffprobe) = pair?;
    let version = version_of(&ffmpeg)?;
    Some(FfmpegInstall { ffmpeg, ffprobe, source, version })
}

pub fn locate(custom: Option<&Path>, managed_dir: &Path) -> Option<FfmpegInstall> {
    if let Some(c) = custom.filter(|c| !c.as_os_str().is_empty()) {
        let dir = if c.is_dir() { c.to_path_buf() } else { c.parent().map(Path::to_path_buf).unwrap_or_default() };
        if let Some(found) = check(pair_in(&dir), FfmpegSource::Custom) {
            return Some(found);
        }
    }
    if let Some(found) = check(pair_in(managed_dir), FfmpegSource::Managed) {
        return Some(found);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| check(pair_in(&dir), FfmpegSource::System))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_line() {
        assert_eq!(
            parse_version("ffmpeg version n7.1-12-gabc Copyright (c) 2000-2024 the FFmpeg developers\nbuilt with gcc").as_deref(),
            Some("n7.1-12-gabc")
        );
        assert_eq!(parse_version("ffmpeg version 8.0 \n").as_deref(), Some("8.0"));
        assert_eq!(parse_version("nope"), None);
    }
}
