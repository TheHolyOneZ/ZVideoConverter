use serde::{Deserialize, Serialize};

use super::HwInfo;
use crate::profile::{EncoderPref, Speed, VideoCodec};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Cpu,
    Nvenc,
    Amf,
    Vaapi,
    Qsv,
}

impl Family {
    pub fn is_gpu(self) -> bool {
        self != Family::Cpu
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EncoderChoice {
    pub family: Family,
    pub name: String,
}

pub const HW_ENCODERS: &[(&str, Family, VideoCodec)] = &[
    ("h264_nvenc", Family::Nvenc, VideoCodec::H264),
    ("hevc_nvenc", Family::Nvenc, VideoCodec::Hevc),
    ("av1_nvenc", Family::Nvenc, VideoCodec::Av1),
    ("h264_amf", Family::Amf, VideoCodec::H264),
    ("hevc_amf", Family::Amf, VideoCodec::Hevc),
    ("av1_amf", Family::Amf, VideoCodec::Av1),
    ("h264_vaapi", Family::Vaapi, VideoCodec::H264),
    ("hevc_vaapi", Family::Vaapi, VideoCodec::Hevc),
    ("av1_vaapi", Family::Vaapi, VideoCodec::Av1),
    ("vp9_vaapi", Family::Vaapi, VideoCodec::Vp9),
    ("h264_qsv", Family::Qsv, VideoCodec::H264),
    ("hevc_qsv", Family::Qsv, VideoCodec::Hevc),
    ("av1_qsv", Family::Qsv, VideoCodec::Av1),
    ("vp9_qsv", Family::Qsv, VideoCodec::Vp9),
];

pub fn cpu_encoders(codec: VideoCodec) -> &'static [&'static str] {
    match codec {
        VideoCodec::H264 => &["libx264"],
        VideoCodec::Hevc => &["libx265"],
        VideoCodec::Av1 => &["libsvtav1", "libaom-av1"],
        VideoCodec::Vp9 => &["libvpx-vp9"],
        VideoCodec::Mpeg4 => &["mpeg4"],
        VideoCodec::Prores => &["prores_ks"],
        VideoCodec::Gif => &["gif"],
    }
}

pub fn hw_encoder(codec: VideoCodec, family: Family) -> Option<&'static str> {
    HW_ENCODERS.iter().find(|(_, f, c)| *f == family && *c == codec).map(|(n, _, _)| *n)
}

const AUTO_ORDER: [Family; 4] = [Family::Nvenc, Family::Amf, Family::Vaapi, Family::Qsv];

pub fn choose(codec: VideoCodec, pref: EncoderPref, hw: &HwInfo) -> Option<EncoderChoice> {
    let gpu = |family: Family| {
        hw_encoder(codec, family)
            .filter(|n| hw.works(n))
            .map(|n| EncoderChoice { family, name: n.to_string() })
    };
    let pick = match pref {
        EncoderPref::Cpu => None,
        EncoderPref::Auto => AUTO_ORDER.iter().find_map(|f| gpu(*f)),
        EncoderPref::Nvenc => gpu(Family::Nvenc),
        EncoderPref::Amf => gpu(Family::Amf),
        EncoderPref::Vaapi => gpu(Family::Vaapi),
        EncoderPref::Qsv => gpu(Family::Qsv),
    };
    pick.or_else(|| cpu_choice(codec, hw))
}

pub fn cpu_choice(codec: VideoCodec, hw: &HwInfo) -> Option<EncoderChoice> {
    cpu_encoders(codec)
        .iter()
        .find(|n| hw.cpu_encoders.iter().any(|c| c == *n))
        .map(|n| EncoderChoice { family: Family::Cpu, name: n.to_string() })
}

pub fn scale(quality: u8, worst: i32, best: i32) -> i32 {
    let q = quality.min(100) as f64 / 100.0;
    (worst as f64 + (best - worst) as f64 * q).round() as i32
}

pub fn supports_ten_bit(name: &str) -> bool {
    !(name.starts_with("h264_") || name == "mpeg4" || name == "gif")
}

pub fn pix_fmt(name: &str, family: Family, ten_bit: bool) -> Option<&'static str> {
    let ten = ten_bit && supports_ten_bit(name);
    match name {
        "gif" => return None,
        "prores_ks" => return Some("yuv422p10le"),
        "mpeg4" => return Some("yuv420p"),
        _ => {}
    }
    Some(match (family, ten) {
        (Family::Cpu, false) | (Family::Nvenc, false) => "yuv420p",
        (Family::Cpu, true) => "yuv420p10le",
        (Family::Vaapi, false) | (Family::Amf, false) | (Family::Qsv, false) => "nv12",
        (Family::Vaapi, true) => "p010",
        (_, true) => "p010le",
    })
}

pub enum Rate {
    Quality(u8),
    Cq(u8, Option<u32>),
    Bitrate(u32),
    Cbr(u32),
}

fn cq_on(value: u8, max: i32) -> i32 {
    (value.min(51) as f64 * max as f64 / 51.0).round() as i32
}

fn ceiling(args: &mut Vec<String>, kbps: u32) {
    let kbps = kbps.max(50);
    args.extend(["-maxrate".into(), format!("{kbps}k"), "-bufsize".into(), format!("{}k", kbps * 2)]);
}

fn cbr(args: &mut Vec<String>, kbps: u32) {
    let k = format!("{}k", kbps.max(50));
    args.extend(["-b:v".into(), k.clone(), "-minrate".into(), k.clone(), "-maxrate".into(), k.clone(), "-bufsize".into(), k]);
}

fn push(args: &mut Vec<String>, items: &[&str]) {
    args.extend(items.iter().map(|s| s.to_string()));
}

fn vbv(args: &mut Vec<String>, kbps: u32) {
    let kbps = kbps.max(50);
    args.extend([
        "-b:v".into(),
        format!("{kbps}k"),
        "-maxrate".into(),
        format!("{}k", kbps * 3 / 2),
        "-bufsize".into(),
        format!("{}k", kbps * 2),
    ]);
}

pub fn encoder_args(name: &str, family: Family, rate: &Rate, speed: Speed) -> Vec<String> {
    let s = speed.index();
    let mut a = Vec::new();
    match family {
        Family::Cpu => match name {
            "libx264" | "libx265" => {
                let preset = ["veryfast", "faster", "medium", "slow", "slower"][s];
                push(&mut a, &["-preset", preset]);
                let mut x265 = String::from("log-level=error");
                match rate {
                    Rate::Quality(q) => {
                        let crf = if name == "libx264" { scale(*q, 40, 14) } else { scale(*q, 40, 16) };
                        a.extend(["-crf".into(), crf.to_string()]);
                    }
                    Rate::Cq(v, max) => {
                        a.extend(["-crf".into(), v.min(&51).to_string()]);
                        if let Some(k) = max {
                            ceiling(&mut a, *k);
                        }
                    }
                    Rate::Bitrate(k) => vbv(&mut a, *k),
                    Rate::Cbr(k) if name == "libx264" => {
                        cbr(&mut a, *k);
                        push(&mut a, &["-x264-params", "nal-hrd=cbr"]);
                    }
                    Rate::Cbr(k) => {
                        let k = format!("{}k", k.max(&50));
                        a.extend(["-b:v".into(), k.clone(), "-maxrate".into(), k.clone(), "-bufsize".into(), k]);
                        x265.push_str(":strict-cbr=1");
                    }
                }
                if name == "libx265" {
                    a.extend(["-x265-params".into(), x265]);
                }
            }
            "libsvtav1" => {
                a.extend(["-preset".into(), ["12", "10", "8", "6", "4"][s].into()]);
                match rate {
                    Rate::Quality(q) => a.extend(["-crf".into(), scale(*q, 55, 18).to_string()]),
                    Rate::Cq(v, max) => {
                        a.extend(["-crf".into(), cq_on(*v, 63).to_string()]);
                        if let Some(k) = max {
                            ceiling(&mut a, *k);
                        }
                    }
                    Rate::Bitrate(k) => a.extend(["-b:v".into(), format!("{k}k")]),
                    Rate::Cbr(k) => a.extend(["-b:v".into(), format!("{k}k"), "-svtav1-params".into(), "pred-struct=1:rc=2".into()]),
                }
            }
            "libaom-av1" => {
                a.extend(["-cpu-used".into(), ["8", "6", "4", "3", "2"][s].into(), "-row-mt".into(), "1".into()]);
                match rate {
                    Rate::Quality(q) => a.extend(["-crf".into(), scale(*q, 55, 18).to_string(), "-b:v".into(), "0".into()]),
                    Rate::Cq(v, max) => a.extend(["-crf".into(), cq_on(*v, 63).to_string(), "-b:v".into(), max.map_or("0".into(), |k| format!("{k}k"))]),
                    Rate::Bitrate(k) => a.extend(["-b:v".into(), format!("{k}k")]),
                    Rate::Cbr(k) => cbr(&mut a, *k),
                }
            }
            "libvpx-vp9" => {
                a.extend([
                    "-deadline".into(),
                    "good".into(),
                    "-cpu-used".into(),
                    ["5", "4", "3", "2", "1"][s].into(),
                    "-row-mt".into(),
                    "1".into(),
                ]);
                match rate {
                    Rate::Quality(q) => a.extend(["-crf".into(), scale(*q, 55, 15).to_string(), "-b:v".into(), "0".into()]),
                    Rate::Cq(v, max) => a.extend(["-crf".into(), cq_on(*v, 63).to_string(), "-b:v".into(), max.map_or("0".into(), |k| format!("{k}k"))]),
                    Rate::Bitrate(k) => a.extend(["-b:v".into(), format!("{k}k")]),
                    Rate::Cbr(k) => cbr(&mut a, *k),
                }
            }
            "mpeg4" => match rate {
                Rate::Quality(q) => a.extend(["-q:v".into(), scale(*q, 20, 2).to_string()]),
                Rate::Cq(v, max) => {
                    a.extend(["-q:v".into(), cq_on(*v, 31).max(2).to_string()]);
                    if let Some(k) = max {
                        ceiling(&mut a, *k);
                    }
                }
                Rate::Bitrate(k) => vbv(&mut a, *k),
                Rate::Cbr(k) => cbr(&mut a, *k),
            },
            "prores_ks" => {
                let profile = match rate {
                    Rate::Quality(q) if *q < 40 => "1",
                    Rate::Quality(q) if *q < 70 => "2",
                    Rate::Cq(v, _) if *v > 28 => "1",
                    Rate::Cq(v, _) if *v > 20 => "2",
                    _ => "3",
                };
                push(&mut a, &["-profile:v", profile, "-vendor", "apl0"]);
            }
            _ => {}
        },
        Family::Nvenc => {
            a.extend(["-preset".into(), ["p1", "p3", "p5", "p6", "p7"][s].into(), "-tune".into(), "hq".into()]);
            match rate {
                Rate::Quality(q) => a.extend(["-rc".into(), "vbr".into(), "-cq".into(), scale(*q, 42, 16).to_string(), "-b:v".into(), "0".into()]),
                Rate::Cq(v, max) => {
                    a.extend(["-rc".into(), "vbr".into(), "-cq".into(), v.min(&51).to_string(), "-b:v".into(), "0".into()]);
                    if let Some(k) = max {
                        ceiling(&mut a, *k);
                    }
                }
                Rate::Bitrate(k) => {
                    push(&mut a, &["-rc", "vbr"]);
                    vbv(&mut a, *k);
                }
                Rate::Cbr(k) => {
                    let k = format!("{}k", k.max(&50));
                    a.extend(["-rc".into(), "cbr".into(), "-b:v".into(), k.clone(), "-maxrate".into(), k.clone(), "-bufsize".into(), k]);
                }
            }
            push(&mut a, &["-spatial-aq", "1"]);
        }
        Family::Amf => {
            let quality = if name.starts_with("av1") {
                ["speed", "speed", "balanced", "quality", "high_quality"][s]
            } else {
                ["speed", "speed", "balanced", "quality", "quality"][s]
            };
            push(&mut a, &["-quality", quality]);
            let av1 = name.starts_with("av1");
            let cqp = |a: &mut Vec<String>, qp: i32| {
                let qp = qp.to_string();
                a.extend(["-rc".into(), "cqp".into(), "-qp_i".into(), qp.clone(), "-qp_p".into(), qp.clone()]);
                if name.starts_with("h264") {
                    a.extend(["-qp_b".into(), qp]);
                }
            };
            match rate {
                Rate::Quality(q) => cqp(&mut a, if av1 { scale(*q, 200, 60) } else { scale(*q, 42, 16) }),
                Rate::Cq(v, _) => cqp(&mut a, if av1 { cq_on(*v, 255) } else { (*v).min(51) as i32 }),
                Rate::Bitrate(k) => {
                    push(&mut a, &["-rc", "vbr_peak"]);
                    vbv(&mut a, *k);
                }
                Rate::Cbr(k) => {
                    let k = format!("{}k", k.max(&50));
                    a.extend(["-rc".into(), "cbr".into(), "-b:v".into(), k.clone(), "-maxrate".into(), k.clone(), "-bufsize".into(), k]);
                }
            }
        }
        Family::Vaapi => {
            let wide = name.starts_with("av1") || name.starts_with("vp9");
            match rate {
                Rate::Quality(q) => {
                    let qp = if wide { scale(*q, 200, 60) } else { scale(*q, 42, 16) };
                    a.extend(["-rc_mode".into(), "CQP".into(), "-qp".into(), qp.to_string()]);
                }
                Rate::Cq(v, None) => {
                    let qp = if wide { cq_on(*v, 255) } else { (*v).min(51) as i32 };
                    a.extend(["-rc_mode".into(), "CQP".into(), "-qp".into(), qp.to_string()]);
                }
                Rate::Cq(v, Some(k)) => {
                    let quality = if wide { cq_on(*v, 255) } else { (*v).min(51) as i32 };
                    a.extend(["-rc_mode".into(), "QVBR".into(), "-global_quality".into(), quality.to_string(), "-b:v".into(), format!("{}k", k.max(&50))]);
                    ceiling(&mut a, *k);
                }
                Rate::Bitrate(k) => {
                    push(&mut a, &["-rc_mode", "VBR"]);
                    vbv(&mut a, *k);
                }
                Rate::Cbr(k) => {
                    let k = format!("{}k", k.max(&50));
                    a.extend(["-rc_mode".into(), "CBR".into(), "-b:v".into(), k.clone(), "-maxrate".into(), k.clone(), "-bufsize".into(), k]);
                }
            }
        }
        Family::Qsv => {
            a.extend(["-preset".into(), ["veryfast", "faster", "medium", "slow", "veryslow"][s].into()]);
            match rate {
                Rate::Quality(q) => a.extend(["-global_quality".into(), scale(*q, 40, 16).to_string()]),
                Rate::Cq(v, None) => a.extend(["-global_quality".into(), (*v).clamp(1, 51).to_string()]),
                Rate::Cq(v, Some(k)) => {
                    a.extend(["-global_quality".into(), (*v).clamp(1, 51).to_string(), "-b:v".into(), format!("{}k", k.max(&50))]);
                    ceiling(&mut a, *k);
                }
                Rate::Bitrate(k) => vbv(&mut a, *k),
                Rate::Cbr(k) => {
                    let k = (*k).max(50);
                    a.extend(["-b:v".into(), format!("{k}k"), "-maxrate".into(), format!("{k}k"), "-bufsize".into(), format!("{}k", k * 2)]);
                }
            }
        }
    }
    a
}

pub fn supports_two_pass(name: &str) -> bool {
    matches!(name, "libx264" | "libvpx-vp9" | "libaom-av1")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hw::detect::EncoderStatus;

    fn hw(working: &[&str], cpu: &[&str]) -> HwInfo {
        HwInfo {
            encoders: HW_ENCODERS
                .iter()
                .map(|(n, f, c)| EncoderStatus {
                    name: n.to_string(),
                    family: *f,
                    codec: *c,
                    working: working.contains(n),
                    error: None,
                    ceiling: *f != Family::Amf,
                })
                .collect(),
            cpu_encoders: cpu.iter().map(|s| s.to_string()).collect(),
            ..HwInfo::default()
        }
    }

    #[test]
    fn scale_is_monotonic_and_bounded() {
        assert_eq!(scale(0, 40, 14), 40);
        assert_eq!(scale(100, 40, 14), 14);
        assert_eq!(scale(70, 40, 14), 22);
        assert_eq!(scale(255, 40, 14), 14);
        let mut prev = i32::MAX;
        for q in 0..=100 {
            let v = scale(q, 42, 16);
            assert!(v <= prev);
            prev = v;
        }
    }

    #[test]
    fn auto_prefers_working_gpu_then_cpu() {
        let h = hw(&["hevc_vaapi", "h264_vaapi"], &["libx264", "libx265", "libsvtav1"]);
        assert_eq!(choose(VideoCodec::Hevc, EncoderPref::Auto, &h).unwrap().name, "hevc_vaapi");
        assert_eq!(choose(VideoCodec::Av1, EncoderPref::Auto, &h).unwrap().name, "libsvtav1");
        assert_eq!(choose(VideoCodec::Hevc, EncoderPref::Nvenc, &h).unwrap().name, "libx265");
        assert_eq!(choose(VideoCodec::Hevc, EncoderPref::Cpu, &h).unwrap().name, "libx265");
        let n = hw(&["hevc_nvenc", "hevc_vaapi"], &[]);
        assert_eq!(choose(VideoCodec::Hevc, EncoderPref::Auto, &n).unwrap().family, Family::Nvenc);
        assert!(choose(VideoCodec::Vp9, EncoderPref::Auto, &n).is_none());
        let av1 = hw(&[], &["libaom-av1"]);
        assert_eq!(choose(VideoCodec::Av1, EncoderPref::Auto, &av1).unwrap().name, "libaom-av1");
    }

    #[test]
    fn encoder_arg_snapshots() {
        let q = Rate::Quality(70);
        let b = Rate::Bitrate(4000);
        let j = |v: Vec<String>| v.join(" ");
        assert_eq!(j(encoder_args("libx264", Family::Cpu, &q, Speed::Balanced)), "-preset medium -crf 22");
        assert_eq!(j(encoder_args("libx265", Family::Cpu, &b, Speed::Fast)), "-preset faster -b:v 4000k -maxrate 6000k -bufsize 8000k -x265-params log-level=error");
        assert_eq!(j(encoder_args("libsvtav1", Family::Cpu, &q, Speed::Slow)), "-preset 6 -crf 29");
        assert_eq!(j(encoder_args("libvpx-vp9", Family::Cpu, &q, Speed::Balanced)), "-deadline good -cpu-used 3 -row-mt 1 -crf 27 -b:v 0");
        assert_eq!(j(encoder_args("hevc_nvenc", Family::Nvenc, &q, Speed::Slowest)), "-preset p7 -tune hq -rc vbr -cq 24 -b:v 0 -spatial-aq 1");
        assert_eq!(j(encoder_args("h264_amf", Family::Amf, &q, Speed::Balanced)), "-quality balanced -rc cqp -qp_i 24 -qp_p 24 -qp_b 24");
        assert_eq!(j(encoder_args("hevc_amf", Family::Amf, &b, Speed::Fastest)), "-quality speed -rc vbr_peak -b:v 4000k -maxrate 6000k -bufsize 8000k");
        assert_eq!(j(encoder_args("hevc_vaapi", Family::Vaapi, &q, Speed::Balanced)), "-rc_mode CQP -qp 24");
        assert_eq!(j(encoder_args("av1_vaapi", Family::Vaapi, &q, Speed::Balanced)), "-rc_mode CQP -qp 102");
        assert_eq!(j(encoder_args("h264_qsv", Family::Qsv, &q, Speed::Fast)), "-preset faster -global_quality 23");
    }

    #[test]
    fn cq_constrained_and_cbr() {
        let cq = Rate::Cq(20, None);
        let capped = Rate::Cq(20, Some(5000));
        let cbr = Rate::Cbr(4000);
        let j = |n: &str, f: Family, r: &Rate| encoder_args(n, f, r, Speed::Balanced).join(" ");
        assert_eq!(j("libx264", Family::Cpu, &cq), "-preset medium -crf 20");
        assert_eq!(j("hevc_nvenc", Family::Nvenc, &cq), "-preset p5 -tune hq -rc vbr -cq 20 -b:v 0 -spatial-aq 1");
        assert_eq!(j("hevc_vaapi", Family::Vaapi, &cq), "-rc_mode CQP -qp 20");
        assert_eq!(j("hevc_amf", Family::Amf, &cq), "-quality balanced -rc cqp -qp_i 20 -qp_p 20");
        assert_eq!(j("libsvtav1", Family::Cpu, &cq), "-preset 8 -crf 25");
        assert_eq!(j("av1_vaapi", Family::Vaapi, &cq), "-rc_mode CQP -qp 100");
        assert_eq!(j("av1_nvenc", Family::Nvenc, &cq), "-preset p5 -tune hq -rc vbr -cq 20 -b:v 0 -spatial-aq 1");

        assert_eq!(j("libx264", Family::Cpu, &capped), "-preset medium -crf 20 -maxrate 5000k -bufsize 10000k");
        assert_eq!(j("libx265", Family::Cpu, &capped), "-preset medium -crf 20 -maxrate 5000k -bufsize 10000k -x265-params log-level=error");
        assert_eq!(j("h264_nvenc", Family::Nvenc, &capped), "-preset p5 -tune hq -rc vbr -cq 20 -b:v 0 -maxrate 5000k -bufsize 10000k -spatial-aq 1");
        assert_eq!(j("h264_vaapi", Family::Vaapi, &capped), "-rc_mode QVBR -global_quality 20 -b:v 5000k -maxrate 5000k -bufsize 10000k");
        assert_eq!(j("libvpx-vp9", Family::Cpu, &capped), "-deadline good -cpu-used 3 -row-mt 1 -crf 25 -b:v 5000k");

        assert_eq!(j("libx264", Family::Cpu, &cbr), "-preset medium -b:v 4000k -minrate 4000k -maxrate 4000k -bufsize 4000k -x264-params nal-hrd=cbr");
        assert_eq!(j("libx265", Family::Cpu, &cbr), "-preset medium -b:v 4000k -maxrate 4000k -bufsize 4000k -x265-params log-level=error:strict-cbr=1");
        assert_eq!(j("libsvtav1", Family::Cpu, &cbr), "-preset 8 -b:v 4000k -svtav1-params pred-struct=1:rc=2");
        assert_eq!(j("hevc_nvenc", Family::Nvenc, &cbr), "-preset p5 -tune hq -rc cbr -b:v 4000k -maxrate 4000k -bufsize 4000k -spatial-aq 1");
        assert_eq!(j("hevc_vaapi", Family::Vaapi, &cbr), "-rc_mode CBR -b:v 4000k -maxrate 4000k -bufsize 4000k");
        assert_eq!(j("h264_amf", Family::Amf, &cbr), "-quality balanced -rc cbr -b:v 4000k -maxrate 4000k -bufsize 4000k");
        assert_eq!(j("h264_qsv", Family::Qsv, &cbr), "-preset medium -b:v 4000k -maxrate 4000k -bufsize 8000k");
    }

    #[test]
    fn pixel_formats() {
        assert_eq!(pix_fmt("hevc_vaapi", Family::Vaapi, true), Some("p010"));
        assert_eq!(pix_fmt("h264_vaapi", Family::Vaapi, true), Some("nv12"));
        assert_eq!(pix_fmt("hevc_nvenc", Family::Nvenc, true), Some("p010le"));
        assert_eq!(pix_fmt("libx265", Family::Cpu, true), Some("yuv420p10le"));
        assert_eq!(pix_fmt("libx264", Family::Cpu, false), Some("yuv420p"));
        assert_eq!(pix_fmt("gif", Family::Cpu, false), None);
    }
}
