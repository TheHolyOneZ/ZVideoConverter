use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{exe_name, locate, FfmpegInstall, FfmpegSource};
use crate::{Error, Result};

const BASE: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";

pub fn asset_name() -> &'static str {
    if cfg!(windows) {
        "ffmpeg-master-latest-win64-gpl.zip"
    } else {
        "ffmpeg-master-latest-linux64-gpl.tar.xz"
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Downloading,
    Verifying,
    Extracting,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub stage: Stage,
    pub received: u64,
    pub total: Option<u64>,
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .user_agent(concat!("ZVideoConverter/", env!("CARGO_PKG_VERSION")))
        .build()
}

pub(crate) fn find_checksum(list: &str, asset: &str) -> Option<String> {
    list.lines().find_map(|l| {
        let mut parts = l.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == asset && hash.len() == 64).then(|| hash.to_ascii_lowercase())
    })
}

pub fn download(
    managed_dir: &Path,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<FfmpegInstall> {
    let asset = asset_name();
    let agent = agent();
    let net = |e: ureq::Error| Error::Download(e.to_string());

    let sums = agent
        .get(&format!("{BASE}/checksums.sha256"))
        .call()
        .map_err(net)?
        .into_string()?;
    let expected = find_checksum(&sums, asset).ok_or_else(|| Error::Download("no checksum for this build".into()))?;

    let work = managed_dir.join(".download");
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work)?;
    let archive = work.join(asset);

    let resp = agent.get(&format!("{BASE}/{asset}")).call().map_err(net)?;
    let total = resp.header("Content-Length").and_then(|v| v.parse().ok());
    let mut reader = resp.into_reader();
    let mut file = File::create(&archive)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut received = 0u64;
    let mut last_report = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = fs::remove_dir_all(&work);
            return Err(Error::Download("cancelled".into()));
        }
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        hasher.update(&buf[..n]);
        received += n as u64;
        if received - last_report > 512 * 1024 {
            last_report = received;
            on_progress(DownloadProgress { stage: Stage::Downloading, received, total });
        }
    }
    file.flush()?;
    drop(file);

    on_progress(DownloadProgress { stage: Stage::Verifying, received, total });
    let actual = hex(&hasher.finalize());
    if actual != expected {
        let _ = fs::remove_dir_all(&work);
        return Err(Error::Checksum);
    }

    on_progress(DownloadProgress { stage: Stage::Extracting, received, total });
    let staged = work.join("bin");
    fs::create_dir_all(&staged)?;
    if asset.ends_with(".zip") {
        extract_zip_bins(&archive, &staged)?;
    } else {
        extract_tar_xz_bins(&archive, &work, &staged)?;
    }
    for name in ["ffmpeg", "ffprobe"] {
        let from = staged.join(exe_name(name));
        let to = managed_dir.join(exe_name(name));
        if to.exists() {
            fs::remove_file(&to)?;
        }
        fs::rename(&from, &to)?;
        make_executable(&to)?;
    }
    let _ = fs::remove_dir_all(&work);

    locate::locate(None, managed_dir)
        .filter(|i| i.source == FfmpegSource::Managed)
        .ok_or_else(|| Error::Download("the downloaded ffmpeg does not run".into()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(unix)]
fn make_executable(p: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(p, fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn make_executable(_: &Path) -> io::Result<()> {
    Ok(())
}

pub(crate) fn extract_zip_bins(archive: &Path, dest: &Path) -> Result<()> {
    let mut zip = zip::ZipArchive::new(File::open(archive)?).map_err(|e| Error::Download(e.to_string()))?;
    let mut found = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| Error::Download(e.to_string()))?;
        let name = entry.name().replace('\\', "/");
        for bin in ["ffmpeg.exe", "ffprobe.exe"] {
            if name.ends_with(&format!("/bin/{bin}")) || name == format!("bin/{bin}") {
                let mut out = File::create(dest.join(bin))?;
                io::copy(&mut entry, &mut out)?;
                found += 1;
            }
        }
    }
    if found < 2 {
        return Err(Error::Download("archive does not contain ffmpeg and ffprobe".into()));
    }
    Ok(())
}

fn extract_tar_xz_bins(archive: &Path, work: &Path, dest: &Path) -> Result<()> {
    let unpack = work.join("unpack");
    fs::create_dir_all(&unpack)?;
    let status = super::command("tar").arg("-xJf").arg(archive).arg("-C").arg(&unpack).status()?;
    if !status.success() {
        return Err(Error::Download("could not unpack the archive (is `tar` with xz support installed?)".into()));
    }
    for name in ["ffmpeg", "ffprobe"] {
        let src = find_bin(&unpack, name).ok_or_else(|| Error::Download(format!("{name} missing from archive")))?;
        fs::rename(src, dest.join(name))?;
    }
    Ok(())
}

fn find_bin(dir: &Path, name: &str) -> Option<PathBuf> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_bin(&p, name) {
                return Some(found);
            }
        } else if p.file_name().is_some_and(|n| n == name) && p.parent().and_then(|d| d.file_name()).is_some_and(|d| d == "bin") {
            return Some(p);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    #[test]
    fn checksum_lookup() {
        let list = "aaaa  other.zip\n0123456789abcdef0123456789abcdef0123456789abcdef0123456789ABCDEF  ffmpeg-master-latest-win64-gpl.zip\n";
        assert_eq!(
            find_checksum(list, "ffmpeg-master-latest-win64-gpl.zip").unwrap(),
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        );
        assert!(find_checksum(list, "other.zip").is_none());
    }

    #[test]
    fn zip_extraction_finds_bins() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("a.zip");
        let mut w = zip::ZipWriter::new(File::create(&archive).unwrap());
        for (name, body) in [
            ("ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe", "F"),
            ("ffmpeg-master-latest-win64-gpl/bin/ffprobe.exe", "P"),
            ("ffmpeg-master-latest-win64-gpl/bin/ffplay.exe", "X"),
            ("ffmpeg-master-latest-win64-gpl/doc/ffmpeg.exe.txt", "D"),
        ] {
            w.start_file(name, SimpleFileOptions::default()).unwrap();
            w.write_all(body.as_bytes()).unwrap();
        }
        w.finish().unwrap();
        let out = dir.path().join("out");
        fs::create_dir_all(&out).unwrap();
        extract_zip_bins(&archive, &out).unwrap();
        assert_eq!(fs::read_to_string(out.join("ffmpeg.exe")).unwrap(), "F");
        assert_eq!(fs::read_to_string(out.join("ffprobe.exe")).unwrap(), "P");
        assert!(!out.join("ffplay.exe").exists());
    }
}
