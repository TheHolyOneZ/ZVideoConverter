use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::ffmpeg::{command, run_with_timeout};
use crate::Result;

const CLIPS: &[(&str, &str, u32)] = &[
    ("Show.S01E01.[720p].WEB.mkv", "testsrc2=size=1280x720:rate=25", 440),
    ("Show.S01E02.[720p].WEB.mkv", "smptehdbars=size=1280x720:rate=25", 550),
    ("Holiday.2024.(Part 1).[Family].mp4", "testsrc=size=1280x720:rate=25", 660),
];

pub fn make(ffmpeg: &Path, dir: &Path) -> Result<Vec<PathBuf>> {
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir)?;
    let mut made = Vec::new();
    for (name, pattern, tone) in CLIPS {
        let out = dir.join(name);
        let mut cmd = command(ffmpeg);
        cmd.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i"])
            .arg(format!("{pattern}:duration=6"))
            .args(["-f", "lavfi", "-i"])
            .arg(format!("sine=frequency={tone}:duration=6"))
            .args(["-map", "0:v", "-map", "1:a", "-c:v", "mpeg4", "-q:v", "4", "-c:a", "aac", "-b:a", "96k", "-shortest"])
            .arg(&out);
        let res = run_with_timeout(cmd, Duration::from_secs(60))?;
        if !res.status_ok || !out.is_file() {
            return Err(std::io::Error::other(format!("could not create {name}")).into());
        }
        made.push(out);
    }
    Ok(made)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_the_tricky_kind() {
        for (name, _, _) in CLIPS {
            assert!(name.matches('.').count() >= 2, "{name}");
            assert!(name.contains('['), "{name}");
        }
    }
}
