use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub out_time: f64,
    pub frame: u64,
    pub fps: f64,
    pub speed: f64,
    pub total_size: u64,
    pub done: bool,
}

#[derive(Default)]
pub struct ProgressParser {
    current: Progress,
}

impl ProgressParser {
    pub fn line(&mut self, line: &str) -> Option<Progress> {
        let (k, v) = line.trim().split_once('=')?;
        let v = v.trim();
        match k {
            "out_time_us" | "out_time_ms" => {
                if let Ok(us) = v.parse::<i64>() {
                    self.current.out_time = (us.max(0) as f64) / 1_000_000.0;
                }
            }
            "frame" => self.current.frame = v.parse().unwrap_or(self.current.frame),
            "fps" => self.current.fps = v.parse().unwrap_or(0.0),
            "speed" => self.current.speed = v.trim_end_matches('x').trim().parse().unwrap_or(0.0),
            "total_size" => self.current.total_size = v.parse().unwrap_or(self.current.total_size),
            "progress" => {
                self.current.done = v == "end";
                return Some(self.current.clone());
            }
            _ => {}
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_blocks() {
        let mut p = ProgressParser::default();
        let text = "frame=120\nfps=59.9\nbitrate=N/A\ntotal_size=1048576\nout_time_us=5005000\nout_time_ms=5005000\nout_time=00:00:05.005000\nspeed=2.5x\nprogress=continue\nframe=240\nout_time_us=N/A\nspeed=N/A\nprogress=end\n";
        let snaps: Vec<_> = text.lines().filter_map(|l| p.line(l)).collect();
        assert_eq!(snaps.len(), 2);
        assert_eq!(snaps[0], Progress { out_time: 5.005, frame: 120, fps: 59.9, speed: 2.5, total_size: 1048576, done: false });
        assert_eq!(snaps[1].frame, 240);
        assert_eq!(snaps[1].out_time, 5.005);
        assert_eq!(snaps[1].speed, 0.0);
        assert!(snaps[1].done);
    }
}
