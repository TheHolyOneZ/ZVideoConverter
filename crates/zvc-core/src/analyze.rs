use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::ffmpeg::{command, run_with_timeout};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub width: u32,
    pub height: u32,
    pub x: u32,
    pub y: u32,
}

pub(crate) fn parse_cropdetect(stderr: &str) -> Option<CropRect> {
    let last = stderr.lines().rev().find_map(|l| l.split("crop=").nth(1))?;
    let nums: Vec<u32> = last.split_whitespace().next()?.split(':').filter_map(|n| n.parse().ok()).collect();
    match nums[..] {
        [w, h, x, y] if w > 0 && h > 0 => Some(CropRect { width: w, height: h, x, y }),
        _ => None,
    }
}

pub fn detect_crop(ffmpeg: &Path, input: &Path, duration: Option<f64>, frame: (u32, u32)) -> Option<CropRect> {
    let dur = duration.unwrap_or(60.0).max(4.0);
    let mut votes: HashMap<CropRect, usize> = HashMap::new();
    for f in [0.15, 0.3, 0.5, 0.7, 0.85] {
        let at = format!("{:.2}", dur * f);
        let mut cmd = command(ffmpeg);
        cmd.args(["-hide_banner", "-nostdin", "-ss", &at, "-i"])
            .arg(input)
            .args(["-map", "0:v:0", "-t", "2", "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"]);
        if let Ok(out) = run_with_timeout(cmd, Duration::from_secs(60)) {
            if let Some(c) = parse_cropdetect(&String::from_utf8_lossy(&out.stderr)) {
                *votes.entry(c).or_default() += 1;
            }
        }
    }
    let best = votes.into_iter().max_by_key(|(_, n)| *n).map(|(c, _)| c)?;
    let (fw, fh) = frame;
    let meaningful = (fw > 0 && best.width < fw * 99 / 100) || (fh > 0 && best.height < fh * 99 / 100);
    meaningful.then_some(best)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_last_crop_line() {
        let log = "[Parsed_cropdetect_0 @ 0x1] x1:0 x2:1919 y1:140 y2:939 w:1920 h:800 x:0 y:140 pts:1 t:0.04 limit:0.09 crop=1920:800:0:140\n[Parsed_cropdetect_0 @ 0x1] x1:0 x2:1919 y1:138 y2:941 w:1920 h:802 x:0 y:139 pts:2 t:0.08 limit:0.09 crop=1920:802:0:139\n";
        assert_eq!(parse_cropdetect(log), Some(CropRect { width: 1920, height: 802, x: 0, y: 139 }));
        assert_eq!(parse_cropdetect("nothing"), None);
    }
}
