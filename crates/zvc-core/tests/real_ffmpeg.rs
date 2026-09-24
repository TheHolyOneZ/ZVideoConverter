use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{mpsc, Arc};
use std::time::Duration;

use zvc_core::args::{build, BuildRequest, JobOptions};
use zvc_core::engine::{temp_path, Engine, Event, JobSpec, OriginalAction, OriginalFate, Outcome};
use zvc_core::ffmpeg::locate;
use zvc_core::hw::{detect, Family};
use zvc_core::probe::probe;
use zvc_core::profile::{builtins, EncoderPref, Profile, SubtitleMode};

fn make_sample(dir: &Path, name: &str) -> PathBuf {
    let srt = dir.join("subs.srt");
    std::fs::write(&srt, "1\n00:00:00,000 --> 00:00:10,000\nHello [world], it's; fine\n").unwrap();
    let out = dir.join(name);
    let ok = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=24:d=12", "-f", "lavfi", "-i", "sine=f=440:d=12"])
        .arg("-i")
        .arg(&srt)
        .args(["-map", "0", "-map", "1", "-map", "2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-c:s", "srt"])
        .arg(&out)
        .status()
        .unwrap()
        .success();
    assert!(ok);
    out
}

fn profile(id: &str) -> Profile {
    builtins().into_iter().find(|p| p.id == format!("builtin.{id}")).unwrap()
}

#[test]
fn converts_hostile_names_with_every_available_family() {
    let dir = tempfile::tempdir().unwrap();
    let Some(ff) = locate(None, dir.path()) else {
        eprintln!("no ffmpeg on PATH, skipping");
        return;
    };
    let hw = detect(&ff.ffmpeg, &ff.version);
    eprintln!("gpus: {:?}", hw.gpus);
    for e in &hw.encoders {
        eprintln!("  {:<12} {:<6} {}", e.name, if e.working { "OK" } else { "--" }, e.error.as_deref().unwrap_or(""));
    }

    let input = make_sample(dir.path(), "Show.S01E01.[1080p] it's, a;test.mkv");
    std::fs::write(dir.path().join("Show.S01E01.[1080p] it's, a;test.de.srt"), "1\n00:00:00,000 --> 00:00:05,000\nHallo [Welt]\n").unwrap();
    let media = probe(&ff.ffprobe, &input).unwrap();
    assert_eq!(media.subtitles.len(), 1);
    assert_eq!(media.external_subs.len(), 1, "the .de.srt next to the video is found");

    let (tx, rx) = mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    let engine = Engine::new(ff.ffmpeg.clone(), Arc::new(move |e| {
        let _ = tx.lock().unwrap().send(e);
    }));

    let mut cases: Vec<(String, Profile, JobOptions)> = Vec::new();
    let mut burn = profile("mp4-h264");
    burn.video.encoder = EncoderPref::Cpu;
    burn.subtitles = SubtitleMode::Burn;
    cases.push(("burn-trim".into(), burn.clone(), JobOptions { trim_start: Some(0.5), trim_end: Some(2.5), burn_track: 0, ..Default::default() }));
    cases.push(("burn-external".into(), burn, JobOptions { burn_track: 1, ..Default::default() }));
    for id in ["mp4-hevc", "mkv-hevc10", "webm-vp9", "remux-mkv", "audio-opus", "gif", "share"] {
        cases.push((id.into(), profile(id), JobOptions::default()));
    }
    for fam in [Family::Nvenc, Family::Amf, Family::Vaapi, Family::Qsv] {
        if hw.encoders.iter().any(|e| e.family == fam && e.working && e.codec == zvc_core::profile::VideoCodec::Hevc) {
            let mut p = profile("mp4-hevc");
            p.video.encoder = match fam {
                Family::Nvenc => EncoderPref::Nvenc,
                Family::Amf => EncoderPref::Amf,
                Family::Vaapi => EncoderPref::Vaapi,
                _ => EncoderPref::Qsv,
            };
            cases.push((format!("gpu-{fam:?}"), p.clone(), JobOptions::default()));
            let mut ten = p;
            ten.video.ten_bit = true;
            cases.push((format!("gpu10-{fam:?}"), ten, JobOptions::default()));
        }
    }

    let mut jobs = Vec::new();
    for (i, (label, p, opts)) in cases.iter().enumerate() {
        let out = dir.path().join(format!("out {label} [x].{}", p.container.ext()));
        let tmp = temp_path(&out);
        let log = dir.path().join(format!("pass{i}"));
        let plan = build(&BuildRequest { input: &input, output: &tmp, profile: p, media: &media, hw: &hw, hw_decode: true, force_cpu: false, job: opts, passlog: &log }).unwrap();
        eprintln!("{label}: {}", zvc_core::args::display_command(&ff.ffmpeg, plan.passes.last().unwrap()));
        jobs.push(JobSpec { id: label.clone(), passes: plan.passes, fallback: None, temp_output: tmp, final_output: out, overwrite: false, duration: media.duration, passlog: Some(log), source: input.clone(), keep_dates: false, original: OriginalAction::Keep });
    }
    let n = jobs.len();
    engine.set_parallel(3);
    engine.enqueue(jobs);

    let mut finished = 0;
    let mut failures = Vec::new();
    let mut saw_progress = false;
    while let Ok(ev) = rx.recv_timeout(Duration::from_secs(120)) {
        match ev {
            Event::Progress { .. } => saw_progress = true,
            Event::Finished { id, outcome, .. } => {
                finished += 1;
                match outcome {
                    Outcome::Done { output, size, .. } => {
                        assert!(size > 0 && output.exists(), "{id}");
                        let m = probe(&ff.ffprobe, &output).unwrap();
                        let dec = Command::new(&ff.ffmpeg).args(["-hide_banner", "-v", "error", "-i"]).arg(&output).args(["-f", "null", "-"]).output().unwrap();
                        let errors = String::from_utf8_lossy(&dec.stderr).trim().to_string();
                        assert!(dec.status.success() && errors.is_empty(), "{id}: output does not decode cleanly:\n{errors}");
                        eprintln!("{id}: OK {} bytes, {:?} {:?}", size, m.video.as_ref().map(|v| (&v.codec, v.width, v.height, v.bit_depth)), m.duration);
                        if id == "mkv-hevc10" {
                            let langs = Command::new(&ff.ffprobe).args(["-v", "error", "-select_streams", "s", "-show_entries", "stream_tags=language", "-of", "csv=p=0"]).arg(&output).output().unwrap();
                            let langs = String::from_utf8_lossy(&langs.stdout).to_string();
                            assert!(langs.contains("ger"), "external subtitle not muxed with its language: {langs:?}");
                            assert_eq!(m.subtitles.len(), 2);
                        }
                        if id == "burn-trim" {
                            assert!((m.duration.unwrap() - 2.0).abs() < 0.3, "trimmed duration {:?}", m.duration);
                        }
                    }
                    other => failures.push(format!("{id}: {other:?}")),
                }
            }
            Event::Idle { .. } => break,
            _ => {}
        }
    }
    assert_eq!(finished, n);
    assert!(saw_progress);
    assert!(failures.is_empty(), "{failures:#?}");
    let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap().flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains("zvc-part") || n.starts_with("pass")).collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn cancel_removes_partial_output() {
    let dir = tempfile::tempdir().unwrap();
    let Some(ff) = locate(None, dir.path()) else { return };
    let out = dir.path().join("long.mp4");
    let tmp = temp_path(&out);
    let args: Vec<std::ffi::OsString> = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", "-re", "-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=60", "-c:v", "libx264", "-f", "mp4"]
        .iter().map(Into::into).chain(std::iter::once(tmp.clone().into_os_string())).collect();
    let (tx, rx) = mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    let engine = Engine::new(ff.ffmpeg.clone(), Arc::new(move |e| { let _ = tx.lock().unwrap().send(e); }));
    engine.enqueue(vec![JobSpec { id: "x".into(), passes: vec![args], fallback: None, temp_output: tmp.clone(), final_output: out.clone(), overwrite: false, duration: Some(60.0), passlog: None, source: PathBuf::new(), keep_dates: false, original: OriginalAction::Keep }]);
    loop {
        match rx.recv_timeout(Duration::from_secs(20)).unwrap() {
            Event::Progress { .. } => { engine.cancel("x"); }
            Event::Finished { outcome, .. } => { assert!(matches!(outcome, Outcome::Cancelled)); break; }
            _ => {}
        }
    }
    assert!(!tmp.exists() && !out.exists());
}

#[test]
fn gpu_failure_falls_back_to_cpu() {
    let dir = tempfile::tempdir().unwrap();
    let Some(ff) = locate(None, dir.path()) else { return };
    let out = dir.path().join("fb.mp4");
    let tmp = temp_path(&out);
    let mk = |enc: &str| -> Vec<std::ffi::OsString> {
        ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=1", "-c:v", enc, "-f", "mp4"]
            .iter().map(Into::into).chain(std::iter::once(tmp.clone().into_os_string())).collect()
    };
    let (tx, rx) = mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    let engine = Engine::new(ff.ffmpeg.clone(), Arc::new(move |e| { let _ = tx.lock().unwrap().send(e); }));
    engine.enqueue(vec![JobSpec { id: "f".into(), passes: vec![mk("definitely_not_an_encoder")], fallback: Some(vec![mk("libx264")]), temp_output: tmp, final_output: out.clone(), overwrite: false, duration: Some(1.0), passlog: None, source: PathBuf::new(), keep_dates: false, original: OriginalAction::Keep }]);
    let mut fell_back = false;
    loop {
        match rx.recv_timeout(Duration::from_secs(30)).unwrap() {
            Event::FellBack { .. } => fell_back = true,
            Event::Finished { outcome, .. } => { assert!(matches!(outcome, Outcome::Done { fell_back: true, .. }), "{outcome:?}"); break; }
            _ => {}
        }
    }
    assert!(fell_back && out.exists());
}

#[test]
fn keeps_dates_and_removes_original_only_after_verifying() {
    let dir = tempfile::tempdir().unwrap();
    let Some(ff) = locate(None, dir.path()) else { return };
    let src = make_sample(dir.path(), "source [old].mkv");
    let old = filetime::FileTime::from_unix_time(1_560_000_000, 0);
    filetime::set_file_mtime(&src, old).unwrap();
    let hw = detect(&ff.ffmpeg, &ff.version);
    let media = probe(&ff.ffprobe, &src).unwrap();
    let out = dir.path().join("source [old].mp4");
    let tmp = temp_path(&out);
    let mut p = profile("remux-mp4");
    p.subtitles = SubtitleMode::Off;
    let plan = build(&BuildRequest { input: &src, output: &tmp, profile: &p, media: &media, hw: &hw, hw_decode: false, force_cpu: false, job: &JobOptions::default(), passlog: &dir.path().join("pl") }).unwrap();
    let (tx, rx) = mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    let engine = Engine::new(ff.ffmpeg.clone(), Arc::new(move |e| { let _ = tx.lock().unwrap().send(e); }));
    engine.set_low_priority(true);
    engine.enqueue(vec![JobSpec { id: "k".into(), passes: plan.passes, fallback: None, temp_output: tmp, final_output: out.clone(), overwrite: false, duration: media.duration, passlog: None, source: src.clone(), keep_dates: true, original: OriginalAction::Delete }]);
    loop {
        if let Event::Finished { outcome, .. } = rx.recv_timeout(Duration::from_secs(60)).unwrap() {
            match outcome {
                Outcome::Done { original, .. } => assert_eq!(original, Some(OriginalFate::Deleted)),
                other => panic!("{other:?}"),
            }
            break;
        }
    }
    assert!(!src.exists(), "original should be gone");
    let mtime = filetime::FileTime::from_last_modification_time(&std::fs::metadata(&out).unwrap());
    assert_eq!(mtime.unix_seconds(), old.unix_seconds());
}

#[test]
fn detects_black_bars() {
    let dir = tempfile::tempdir().unwrap();
    let Some(ff) = locate(None, dir.path()) else { return };
    let src = dir.path().join("letterbox.mkv");
    let ok = Command::new(&ff.ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x544:r=25:d=6", "-vf", "pad=1280:720:0:88:black", "-c:v", "libx264", "-preset", "ultrafast"])
        .arg(&src)
        .status()
        .unwrap()
        .success();
    assert!(ok);
    let c = zvc_core::analyze::detect_crop(&ff.ffmpeg, &src, Some(6.0), (1280, 720)).expect("bars found");
    assert_eq!((c.width, c.height), (1280, 544), "{c:?}");
    assert!((86..=90).contains(&c.y), "{c:?}");
    let full = make_sample(dir.path(), "full.mkv");
    assert_eq!(zvc_core::analyze::detect_crop(&ff.ffmpeg, &full, Some(12.0), (1920, 1080)), None);
}

#[test]
fn original_waits_for_every_output_of_the_source() {
    let dir = tempfile::tempdir().unwrap();
    let Some(ff) = locate(None, dir.path()) else { return };
    let src = make_sample(dir.path(), "two outputs.mkv");
    let hw = detect(&ff.ffmpeg, &ff.version);
    let media = probe(&ff.ffprobe, &src).unwrap();
    let (tx, rx) = mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    let engine = Engine::new(ff.ffmpeg.clone(), Arc::new(move |e| { let _ = tx.lock().unwrap().send(e); }));
    engine.set_parallel(2);
    let mut specs = Vec::new();
    for (id, prof) in [("video", "remux-mp4"), ("audio", "audio-opus")] {
        let mut p = profile(prof);
        p.subtitles = SubtitleMode::Off;
        let out = dir.path().join(format!("out-{id}.{}", p.container.ext()));
        let tmp = temp_path(&out);
        let plan = build(&BuildRequest { input: &src, output: &tmp, profile: &p, media: &media, hw: &hw, hw_decode: false, force_cpu: false, job: &JobOptions::default(), passlog: &dir.path().join(id) }).unwrap();
        specs.push(JobSpec { id: id.into(), passes: plan.passes, fallback: None, temp_output: tmp, final_output: out, overwrite: false, duration: media.duration, passlog: None, source: src.clone(), keep_dates: false, original: OriginalAction::Delete });
    }
    engine.enqueue(specs);
    let mut fates = Vec::new();
    loop {
        match rx.recv_timeout(Duration::from_secs(60)).unwrap() {
            Event::Finished { outcome: Outcome::Done { original, .. }, .. } => fates.push(original),
            Event::Finished { outcome, .. } => panic!("{outcome:?}"),
            Event::Idle { .. } => break,
            _ => {}
        }
    }
    assert_eq!(fates.iter().filter(|f| f.is_some()).count(), 1, "{fates:?}");
    assert!(fates.contains(&Some(OriginalFate::Deleted)));
    assert!(!src.exists());
}

#[test]
fn tour_samples_are_real_videos() {
    let dir = tempfile::tempdir().unwrap();
    let Some(ff) = locate(None, dir.path()) else {
        eprintln!("no ffmpeg on PATH, skipping");
        return;
    };
    let made = zvc_core::samples::make(&ff.ffmpeg, &dir.path().join("samples")).unwrap();
    assert_eq!(made.len(), 3);
    for f in &made {
        let info = probe(&ff.ffprobe, f).unwrap();
        assert!(info.video.is_some() && !info.audio.is_empty(), "{}", f.display());
        assert!(info.duration.unwrap_or(0.0) > 5.0);
    }
}

#[test]
fn rate_modes_and_sizes_with_every_available_encoder() {
    use zvc_core::profile::{Fit, RateControl, Resolution, VideoCodec};

    let dir = tempfile::tempdir().unwrap();
    let Some(ff) = locate(None, dir.path()) else {
        eprintln!("no ffmpeg on PATH, skipping");
        return;
    };
    let hw = detect(&ff.ffmpeg, &ff.version);
    let clip = |name: &str, size: &str| {
        let out = dir.path().join(name);
        let ok = Command::new(&ff.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", &format!("testsrc2=s={size}:r=30:d=6")])
            .args(["-c:v", "libx264", "-preset", "ultrafast", "-crf", "10"])
            .arg(&out)
            .status()
            .unwrap()
            .success();
        assert!(ok);
        out
    };
    let landscape = clip("land.mkv", "1280x720");
    let portrait = clip("port.mkv", "720x1280");

    let encode = |label: &str, input: &Path, p: &Profile| -> PathBuf {
        let media = probe(&ff.ffprobe, input).unwrap();
        let out = dir.path().join(format!("{label}.{}", p.container.ext()));
        let log = dir.path().join(format!("{label}-pass"));
        let plan = build(&BuildRequest { input, output: &out, profile: p, media: &media, hw: &hw, hw_decode: true, force_cpu: false, job: &JobOptions::default(), passlog: &log })
            .unwrap_or_else(|e| panic!("{label}: {e:?}"));
        for pass in &plan.passes {
            let res = Command::new(&ff.ffmpeg).args(pass).output().unwrap();
            assert!(res.status.success(), "{label} failed:\n{}\n{}", zvc_core::args::display_command(&ff.ffmpeg, pass), String::from_utf8_lossy(&res.stderr));
        }
        out
    };
    let video_kbps = |f: &Path| -> f64 {
        let o = Command::new(&ff.ffprobe).args(["-v", "error", "-show_entries", "format=size,duration", "-of", "csv=p=0"]).arg(f).output().unwrap();
        let s = String::from_utf8_lossy(&o.stdout);
        let mut it = s.trim().split(',');
        let dur: f64 = it.next().unwrap().parse().unwrap();
        let size: f64 = it.next().unwrap().parse().unwrap();
        size * 8.0 / dur / 1000.0
    };
    let dims = |f: &Path| {
        let m = probe(&ff.ffprobe, f).unwrap().video.unwrap();
        (m.width, m.height)
    };

    let mut targets: Vec<(String, EncoderPref, VideoCodec)> = vec![("cpu-h264".into(), EncoderPref::Cpu, VideoCodec::H264), ("cpu-hevc".into(), EncoderPref::Cpu, VideoCodec::Hevc)];
    if hw.cpu_encoders.iter().any(|e| e == "libsvtav1") {
        targets.push(("cpu-av1".into(), EncoderPref::Cpu, VideoCodec::Av1));
    }
    for (fam, pref) in [(Family::Nvenc, EncoderPref::Nvenc), (Family::Amf, EncoderPref::Amf), (Family::Vaapi, EncoderPref::Vaapi), (Family::Qsv, EncoderPref::Qsv)] {
        for codec in [VideoCodec::H264, VideoCodec::Hevc, VideoCodec::Av1] {
            if hw.encoders.iter().any(|e| e.family == fam && e.working && e.codec == codec) {
                targets.push((format!("{fam:?}-{codec:?}").to_lowercase(), pref, codec));
            }
        }
    }

    let mut report = Vec::new();
    for (label, pref, codec) in &targets {
        let mut p = profile("mp4-h264");
        p.audio.mode = zvc_core::profile::StreamMode::Off;
        p.video.encoder = *pref;
        p.video.codec = *codec;

        p.video.rate = RateControl::Cq { value: 20, max_kbps: None };
        let cq = video_kbps(&encode(&format!("{label}-cq20"), &landscape, &p));

        p.video.rate = RateControl::Bitrate { kbps: 2000, cbr: true };
        let cbr = video_kbps(&encode(&format!("{label}-cbr"), &landscape, &p));
        assert!((1500.0..=2500.0).contains(&cbr), "{label}: CBR 2000 kb/s came out at {cbr:.0}");

        let limit = if label.starts_with("amf") || label.starts_with("vaapi") {
            None
        } else if label == "cpu-av1" {
            Some(2.0)
        } else {
            Some(1.35)
        };
        p.video.rate = RateControl::Cq { value: 14, max_kbps: Some(1500) };
        let capped = video_kbps(&encode(&format!("{label}-capped"), &landscape, &p));
        if let Some(f) = limit {
            assert!(capped <= 1500.0 * f, "{label}: CQ 14 capped at 1500 kb/s came out at {capped:.0}");
        }
        report.push(format!("{label:<14} CQ20 {cq:>6.0}   CBR2000 {cbr:>6.0}   CQ14≤1500 {capped:>6.0} kb/s"));
    }

    let mut p = profile("mp4-h264");
    p.video.encoder = EncoderPref::Cpu;
    p.audio.mode = zvc_core::profile::StreamMode::Off;
    p.video.resolution = Resolution::Height { value: 540 };
    assert_eq!(dims(&encode("540p-landscape", &landscape, &p)), (960, 540));
    assert_eq!(dims(&encode("540p-portrait", &portrait, &p)), (540, 960), "presets use the shorter edge");
    p.video.resolution = Resolution::Height { value: 4320 };
    assert_eq!(dims(&encode("8k-no-upscale", &landscape, &p)), (1280, 720), "presets never scale up");
    for fit in [Fit::Pad, Fit::Crop, Fit::Stretch] {
        p.video.resolution = Resolution::Custom { width: 540, height: 960, fit };
        assert_eq!(dims(&encode(&format!("custom-{fit:?}"), &landscape, &p)), (540, 960), "{fit:?}");
    }

    for line in &report {
        eprintln!("{line}");
    }
}
