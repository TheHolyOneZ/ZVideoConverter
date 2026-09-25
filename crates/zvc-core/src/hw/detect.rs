use std::collections::HashSet;
use std::path::Path;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::encoders::{Family, HW_ENCODERS};
use crate::ffmpeg::{command, root_cause, run_with_timeout};
use crate::profile::VideoCodec;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Vendor {
    Nvidia,
    Amd,
    Intel,
    Other,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub vendor: Vendor,
    pub name: String,
    pub render_node: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EncoderStatus {
    pub name: String,
    pub family: Family,
    pub codec: VideoCodec,
    pub working: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub ceiling: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HwInfo {
    pub ffmpeg_version: String,
    pub gpus: Vec<Gpu>,
    pub encoders: Vec<EncoderStatus>,
    pub cpu_encoders: Vec<String>,
    pub vaapi_device: Option<String>,
    pub has_zscale: bool,
    pub has_subtitles_filter: bool,
}

impl HwInfo {
    pub fn ceiling_ok(&self, encoder: &str) -> bool {
        self.cpu_encoders.iter().any(|c| c == encoder) || self.encoders.iter().any(|e| e.name == encoder && e.working && e.ceiling)
    }

    pub fn works(&self, encoder: &str) -> bool {
        self.encoders.iter().any(|e| e.name == encoder && e.working)
            || self.cpu_encoders.iter().any(|c| c == encoder)
    }
}

pub fn vendor_from_pci(id: &str) -> Vendor {
    match id.trim().to_ascii_lowercase().as_str() {
        "0x10de" => Vendor::Nvidia,
        "0x1002" | "0x1022" => Vendor::Amd,
        "0x8086" => Vendor::Intel,
        _ => Vendor::Other,
    }
}

pub fn vendor_from_name(name: &str) -> Vendor {
    let n = name.to_ascii_lowercase();
    if n.contains("nvidia") || n.contains("geforce") || n.contains("quadro") || n.contains("rtx") {
        Vendor::Nvidia
    } else if n.contains("amd") || n.contains("radeon") || n.contains("ati ") {
        Vendor::Amd
    } else if n.contains("intel") || n.contains("arc") || n.contains("iris") || n.contains("uhd graphics") {
        Vendor::Intel
    } else {
        Vendor::Other
    }
}

pub(crate) fn listing_names(text: &str) -> HashSet<String> {
    let mut seen_rule = false;
    let mut out = HashSet::new();
    for line in text.lines() {
        if line.trim_start().starts_with("---") || line.trim() == "------" {
            seen_rule = true;
            continue;
        }
        if !seen_rule {
            continue;
        }
        let mut parts = line.split_whitespace();
        if let (Some(_flags), Some(name)) = (parts.next(), parts.next()) {
            out.insert(name.to_string());
        }
    }
    out
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn lspci_name(line: &str, vendor: Vendor) -> Option<String> {
    let quoted: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
    let device = quoted.get(2)?.trim();
    let pretty = match (device.find('['), device.rfind(']')) {
        (Some(a), Some(b)) if b > a + 1 => &device[a + 1..b],
        _ => device,
    };
    let prefix = match vendor {
        Vendor::Nvidia => "NVIDIA ",
        Vendor::Amd if !pretty.to_ascii_lowercase().contains("amd") => "AMD ",
        Vendor::Intel if !pretty.to_ascii_lowercase().contains("intel") => "Intel ",
        _ => "",
    };
    Some(format!("{prefix}{pretty}"))
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn vendor_label(v: Vendor) -> &'static str {
    match v {
        Vendor::Nvidia => "NVIDIA GPU",
        Vendor::Amd => "AMD GPU",
        Vendor::Intel => "Intel GPU",
        Vendor::Other => "GPU",
    }
}

#[cfg(target_os = "linux")]
fn list_gpus() -> Vec<Gpu> {
    use std::fs;
    let mut gpus = Vec::new();
    let mut seen = HashSet::new();
    let Ok(entries) = fs::read_dir("/sys/class/drm") else { return gpus };
    let mut cards: Vec<_> = entries
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("card") && n[4..].chars().all(|c| c.is_ascii_digit()))
        .collect();
    cards.sort();
    let renders: Vec<(std::path::PathBuf, String)> = fs::read_dir("/sys/class/drm")
        .map(|it| {
            it.flatten()
                .filter(|e| e.file_name().to_string_lossy().starts_with("renderD"))
                .filter_map(|e| {
                    let dev = fs::canonicalize(e.path().join("device")).ok()?;
                    Some((dev, format!("/dev/dri/{}", e.file_name().to_string_lossy())))
                })
                .collect()
        })
        .unwrap_or_default();

    for card in cards {
        let Ok(dev) = fs::canonicalize(format!("/sys/class/drm/{card}/device")) else { continue };
        if !seen.insert(dev.clone()) {
            continue;
        }
        let vendor = fs::read_to_string(dev.join("vendor")).map(|v| vendor_from_pci(&v)).unwrap_or(Vendor::Other);
        let slot = dev.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let name = {
            let mut cmd = command("lspci");
            cmd.args(["-mm", "-s", &slot]);
            run_with_timeout(cmd, Duration::from_secs(3))
                .ok()
                .and_then(|o| lspci_name(String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or(""), vendor))
                .unwrap_or_else(|| vendor_label(vendor).to_string())
        };
        let render_node = renders.iter().find(|(d, _)| *d == dev).map(|(_, n)| n.clone());
        gpus.push(Gpu { vendor, name, render_node });
    }
    gpus
}

#[cfg(windows)]
fn list_gpus() -> Vec<Gpu> {
    let mut cmd = command("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }",
    ]);
    let Ok(out) = run_with_timeout(cmd, Duration::from_secs(10)) else { return Vec::new() };
    parse_windows_gpus(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(not(any(target_os = "linux", windows)))]
fn list_gpus() -> Vec<Gpu> {
    Vec::new()
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn parse_windows_gpus(text: &str) -> Vec<Gpu> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter(|l| !l.contains("Basic Display") && !l.contains("Remote Display") && !l.contains("Hyper-V"))
        .map(|l| Gpu { vendor: vendor_from_name(l), name: l.to_string(), render_node: None })
        .collect()
}

pub fn pick_vaapi_device(gpus: &[Gpu]) -> Option<String> {
    [Vendor::Amd, Vendor::Intel, Vendor::Other, Vendor::Nvidia]
        .iter()
        .find_map(|v| gpus.iter().find(|g| g.vendor == *v).and_then(|g| g.render_node.clone()))
        .or_else(|| cfg!(target_os = "linux").then(|| "/dev/dri/renderD128".to_string()).filter(|p| Path::new(p).exists()))
}

fn test_args(name: &str, family: Family, vaapi: Option<&str>) -> Option<Vec<String>> {
    let mut a: Vec<String> = ["-hide_banner", "-nostdin", "-loglevel", "error"].iter().map(|s| s.to_string()).collect();
    if family == Family::Vaapi {
        a.extend(["-init_hw_device".into(), format!("vaapi=va:{}", vaapi?), "-filter_hw_device".into(), "va".into()]);
    }
    a.extend(["-f", "lavfi", "-i", "color=c=black:s=320x240:r=25", "-frames:v", "5"].iter().map(|s| s.to_string()));
    match family {
        Family::Vaapi => a.extend(["-vf".into(), "format=nv12,hwupload".into()]),
        Family::Nvenc => a.extend(["-pix_fmt".into(), "yuv420p".into()]),
        _ => a.extend(["-pix_fmt".into(), "nv12".into()]),
    }
    a.extend(["-c:v".into(), name.into(), "-f".into(), "null".into(), "-".into()]);
    Some(a)
}

fn ceiling_test_args(name: &str, vaapi: Option<&str>) -> Option<Vec<String>> {
    let mut a = test_args(name, Family::Vaapi, vaapi)?;
    let at = a.len() - 3;
    let wide = name.starts_with("av1") || name.starts_with("vp9");
    let q = if wide { "120" } else { "25" };
    a.splice(at..at, ["-rc_mode", "QVBR", "-global_quality", q, "-b:v", "2000k", "-maxrate", "2000k"].iter().map(|s| s.to_string()));
    Some(a)
}

fn run_listing(ffmpeg: &Path, flag: &str) -> String {
    let mut cmd = command(ffmpeg);
    cmd.args(["-hide_banner", flag]);
    run_with_timeout(cmd, Duration::from_secs(15))
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

pub fn detect(ffmpeg: &Path, ffmpeg_version: &str) -> HwInfo {
    let gpus = list_gpus();
    let vaapi_device = if cfg!(target_os = "linux") { pick_vaapi_device(&gpus) } else { None };
    let compiled = listing_names(&run_listing(ffmpeg, "-encoders"));
    let filters = listing_names(&run_listing(ffmpeg, "-filters"));

    let cpu_encoders: Vec<String> = ["libx264", "libx265", "libsvtav1", "libaom-av1", "libvpx-vp9", "mpeg4", "prores_ks", "gif"]
        .iter()
        .filter(|n| compiled.contains(**n))
        .map(|s| s.to_string())
        .collect();

    let handles: Vec<_> = HW_ENCODERS
        .iter()
        .filter(|(n, _, _)| compiled.contains(*n))
        .map(|(name, family, codec)| {
            let (name, family, codec) = (name.to_string(), *family, *codec);
            let ffmpeg = ffmpeg.to_path_buf();
            let vaapi = vaapi_device.clone();
            thread::spawn(move || {
                let result = match test_args(&name, family, vaapi.as_deref()) {
                    None => Err("no VA-API device".to_string()),
                    Some(args) => {
                        let mut cmd = command(&ffmpeg);
                        cmd.args(args);
                        match run_with_timeout(cmd, Duration::from_secs(20)) {
                            Ok(o) if o.status_ok => Ok(()),
                            Ok(o) => Err(root_cause(&String::from_utf8_lossy(&o.stderr)).unwrap_or_else(|| "failed".into())),
                            Err(e) => Err(e.to_string()),
                        }
                    }
                };
                let working = result.is_ok();
                let ceiling = working
                    && match family {
                        Family::Vaapi => ceiling_test_args(&name, vaapi.as_deref()).is_some_and(|args| {
                            let mut cmd = command(&ffmpeg);
                            cmd.args(args);
                            matches!(run_with_timeout(cmd, Duration::from_secs(20)), Ok(o) if o.status_ok)
                        }),
                        Family::Amf => false,
                        _ => true,
                    };
                EncoderStatus { name, family, codec, working, error: result.err(), ceiling }
            })
        })
        .collect();
    let encoders = handles.into_iter().filter_map(|h| h.join().ok()).collect();

    HwInfo {
        ffmpeg_version: ffmpeg_version.to_string(),
        gpus,
        encoders,
        cpu_encoders,
        vaapi_device,
        has_zscale: filters.contains("zscale"),
        has_subtitles_filter: filters.contains("subtitles"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_encoder_listing() {
        let text = "Encoders:\n V..... = Video\n ------\n V....D libx264              libx264 H.264\n V....D hevc_vaapi           H.265/HEVC (VAAPI)\n A....D aac                  AAC\n";
        let names = listing_names(text);
        assert!(names.contains("libx264") && names.contains("hevc_vaapi") && names.contains("aac"));
        assert!(!names.contains("Video"));
        let filters = " T.. = Timeline support\n ------\n ... zscale            V->V       Apply resizing\n";
        assert!(listing_names(filters).contains("zscale"));
    }

    #[test]
    fn lspci_names() {
        let amd = r#"09:00.0 "VGA compatible controller" "Advanced Micro Devices, Inc. [AMD/ATI]" "Navi 22 [Radeon RX 6700/6700 XT/6750 XT / 6800M/6850M XT]" -rc5 "Sapphire" "Device 2410""#;
        assert_eq!(lspci_name(amd, Vendor::Amd).unwrap(), "AMD Radeon RX 6700/6700 XT/6750 XT / 6800M/6850M XT");
        let nv = r#"01:00.0 "VGA compatible controller" "NVIDIA Corporation" "AD104 [GeForce RTX 4070]" -ra1"#;
        assert_eq!(lspci_name(nv, Vendor::Nvidia).unwrap(), "NVIDIA GeForce RTX 4070");
        assert_eq!(lspci_name("", Vendor::Amd), None);
    }

    #[test]
    fn windows_gpu_list() {
        let g = parse_windows_gpus("NVIDIA GeForce RTX 3080\r\nAMD Radeon(TM) Graphics\r\nMicrosoft Basic Display Adapter\r\n\r\nIntel(R) UHD Graphics 770\r\n");
        assert_eq!(g.iter().map(|g| g.vendor).collect::<Vec<_>>(), vec![Vendor::Nvidia, Vendor::Amd, Vendor::Intel]);
        assert_eq!(vendor_from_pci("0x10DE\n"), Vendor::Nvidia);
    }

    #[test]
    fn vaapi_device_prefers_amd() {
        let gpus = vec![
            Gpu { vendor: Vendor::Intel, name: "i".into(), render_node: Some("/dev/dri/renderD128".into()) },
            Gpu { vendor: Vendor::Amd, name: "a".into(), render_node: Some("/dev/dri/renderD129".into()) },
        ];
        assert_eq!(pick_vaapi_device(&gpus).as_deref(), Some("/dev/dri/renderD129"));
    }
}
