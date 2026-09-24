use std::process::Command;
use std::sync::atomic::AtomicBool;

use zvc_core::ffmpeg::download::{download, Stage};
use zvc_core::ffmpeg::FfmpegSource;

#[test]
#[ignore = "downloads ~100 MB from GitHub; run with --ignored"]
fn one_click_download_installs_a_working_ffmpeg() {
    let dir = tempfile::tempdir().unwrap();
    let cancel = AtomicBool::new(false);
    let mut stages: Vec<Stage> = Vec::new();

    let ff = download(dir.path(), &cancel, |p| {
        if stages.last() != Some(&p.stage) {
            stages.push(p.stage);
        }
    })
    .expect("download failed");

    assert_eq!(stages, [Stage::Downloading, Stage::Verifying, Stage::Extracting]);
    assert_eq!(ff.source, FfmpegSource::Managed);
    assert!(ff.ffmpeg.starts_with(dir.path()) && ff.ffprobe.starts_with(dir.path()));
    assert!(!ff.version.is_empty());
    assert!(!dir.path().join(".download").exists(), "the work folder was left behind");

    let out = dir.path().join("check [1080p].mp4");
    let ok = Command::new(&ff.ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=2"])
        .args(["-f", "lavfi", "-i", "sine=f=440:d=2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest"])
        .arg(&out)
        .status()
        .unwrap()
        .success();
    assert!(ok, "the downloaded ffmpeg failed to encode");

    let probe = Command::new(&ff.ffprobe)
        .args(["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0"])
        .arg(&out)
        .output()
        .unwrap();
    let codecs = String::from_utf8_lossy(&probe.stdout);
    assert!(codecs.contains("h264") && codecs.contains("aac"), "unexpected streams: {codecs}");
}
