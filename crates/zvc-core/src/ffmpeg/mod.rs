pub mod download;
pub mod locate;

use std::ffi::OsStr;
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub use locate::{locate, FfmpegInstall, FfmpegSource};

pub fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub fn command(program: impl AsRef<OsStr>) -> Command {
    command_with_priority(program, false)
}

pub fn command_with_priority(program: impl AsRef<OsStr>, low_priority: bool) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        cmd.creation_flags(CREATE_NO_WINDOW | if low_priority { BELOW_NORMAL_PRIORITY_CLASS } else { 0 });
    }
    #[cfg(unix)]
    if low_priority {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                libc::nice(10);
                Ok(())
            });
        }
    }
    cmd
}

pub struct Output {
    pub status_ok: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub fn run_with_timeout(mut cmd: Command, timeout: Duration) -> std::io::Result<Output> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let mut out = child.stdout.take().expect("piped");
    let mut err = child.stderr.take().expect("piped");
    let t_out = thread::spawn(move || {
        let mut v = Vec::new();
        let _ = out.read_to_end(&mut v);
        v
    });
    let t_err = thread::spawn(move || {
        let mut v = Vec::new();
        let _ = err.read_to_end(&mut v);
        v
    });
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break Some(s);
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        thread::sleep(Duration::from_millis(15));
    };
    let stdout = t_out.join().unwrap_or_default();
    let stderr = t_err.join().unwrap_or_default();
    match status {
        Some(s) => Ok(Output { status_ok: s.success(), stdout, stderr }),
        None => Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "timed out")),
    }
}

const CASCADE: &[&str] = &[
    "Error while opening encoder",
    "Task finished with error",
    "Terminating thread",
    "Could not open encoder before EOF",
    "Nothing was written into output",
    "Conversion failed",
    "Error sending frames",
    "Error while filtering",
    "Error marking filters as finished",
];

fn strip_context(line: &str) -> &str {
    let mut s = line.trim();
    while s.starts_with('[') {
        match s.find("] ") {
            Some(i) => s = s[i + 2..].trim_start(),
            None => break,
        }
    }
    s
}

pub fn root_cause(log: &str) -> Option<String> {
    let lines: Vec<&str> = log.lines().map(strip_context).filter(|l| !l.is_empty()).collect();
    let pick = lines.iter().find(|l| !CASCADE.iter().any(|c| l.contains(c))).or(lines.first())?;
    Some(pick.chars().take(300).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_cause_skips_cascade() {
        let log = "[h264_nvenc @ 0x562ad08de200] Cannot load libcuda.so.1\n[vost#0:0/h264_nvenc @ 0x5] [enc:h264_nvenc @ 0x5] Error while opening encoder - maybe incorrect parameters\n[out#0/null @ 0x5] Nothing was written into output file";
        assert_eq!(root_cause(log).unwrap(), "Cannot load libcuda.so.1");
        assert_eq!(root_cause("[out#0 @ 0x1] Nothing was written into output file").unwrap(), "Nothing was written into output file");
        assert_eq!(root_cause("\n \n"), None);
    }
}
