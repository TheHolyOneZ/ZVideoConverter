use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::ffmpeg::command;

fn existing_ancestor(p: &Path) -> Option<PathBuf> {
    let mut cur = Some(p);
    while let Some(c) = cur {
        if c.is_dir() {
            return Some(c.to_path_buf());
        }
        cur = c.parent();
    }
    None
}

fn volume_key(dir: &Path) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(m) = std::fs::metadata(dir) {
            return m.dev().to_string();
        }
    }
    #[cfg(windows)]
    {
        if let Some(std::path::Component::Prefix(p)) = dir.components().next() {
            return p.as_os_str().to_string_lossy().to_uppercase();
        }
    }
    dir.to_string_lossy().into_owned()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceNeed {
    pub dir: PathBuf,
    pub bytes: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpaceShortage {
    pub dir: PathBuf,
    pub needed: u64,
    pub free: u64,
}

pub fn check_space(needs: &[SpaceNeed]) -> Vec<SpaceShortage> {
    let mut per_volume: HashMap<String, (PathBuf, u64)> = HashMap::new();
    for n in needs {
        let Some(dir) = existing_ancestor(&n.dir) else { continue };
        let entry = per_volume.entry(volume_key(&dir)).or_insert((dir, 0));
        entry.1 += n.bytes;
    }
    let mut out: Vec<SpaceShortage> = per_volume
        .into_values()
        .filter_map(|(dir, needed)| {
            let free = fs4::available_space(&dir).ok()?;
            (needed > free).then_some(SpaceShortage { dir, needed, free })
        })
        .collect();
    out.sort_by(|a, b| a.dir.cmp(&b.dir));
    out
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PowerAction {
    Sleep,
    Shutdown,
}

pub fn power(action: PowerAction) -> std::io::Result<()> {
    let mut cmd = if cfg!(windows) {
        match action {
            PowerAction::Shutdown => {
                let mut c = command("shutdown");
                c.args(["/s", "/t", "0"]);
                c
            }
            PowerAction::Sleep => {
                let mut c = command("rundll32.exe");
                c.args(["powrprof.dll,SetSuspendState", "0,1,0"]);
                c
            }
        }
    } else {
        let mut c = command("systemctl");
        c.arg(match action {
            PowerAction::Sleep => "suspend",
            PowerAction::Shutdown => "poweroff",
        });
        c
    };
    let status = cmd.status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!("exit status {status}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn space_is_grouped_per_volume() {
        let d = tempfile::tempdir().unwrap();
        let needs = vec![
            SpaceNeed { dir: d.path().join("converted"), bytes: 1 },
            SpaceNeed { dir: d.path().to_path_buf(), bytes: 1 },
        ];
        assert!(check_space(&needs).is_empty());
        let huge = vec![SpaceNeed { dir: d.path().join("x/y"), bytes: u64::MAX / 2 }];
        let short = check_space(&huge);
        assert_eq!(short.len(), 1);
        assert_eq!(short[0].needed, u64::MAX / 2);
    }
}
