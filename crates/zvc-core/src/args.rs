use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::hw::encoders::{self, cpu_choice, encoder_args, pix_fmt, supports_ten_bit, supports_two_pass, Rate};
use crate::hw::{choose, EncoderChoice, Family, HwInfo};
use crate::analyze::CropRect;
use crate::probe::MediaInfo;
use crate::profile::{
    AudioCodec, AudioTracks, Container, Crop, Fit, Profile, RateControl, Resolution, Rotate, StreamMode, SubtitleMode,
    VideoCodec,
};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct JobOptions {
    pub trim_start: Option<f64>,
    pub trim_end: Option<f64>,
    pub burn_track: usize,
    pub extra_subs: Vec<PathBuf>,
    pub skip_external_subs: bool,
    pub detected_crop: Option<CropRect>,
    pub crop_checked: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SubSource {
    pub file: Option<PathBuf>,
    pub stream: usize,
    pub codec: String,
    pub bitmap: bool,
    pub language: Option<String>,
}

pub fn subtitle_sources(media: &MediaInfo, job: &JobOptions) -> Vec<SubSource> {
    let mut out: Vec<SubSource> = media
        .subtitles
        .iter()
        .enumerate()
        .map(|(i, s)| SubSource { file: None, stream: i, codec: s.codec.clone(), bitmap: s.bitmap, language: s.language.clone() })
        .collect();
    if !job.skip_external_subs {
        out.extend(media.external_subs.iter().map(|e| SubSource {
            file: Some(e.path.clone()),
            stream: 0,
            codec: e.codec.clone(),
            bitmap: false,
            language: e.language.clone(),
        }));
    }
    for path in &job.extra_subs {
        if out.iter().any(|s| s.file.as_deref() == Some(path.as_path())) {
            continue;
        }
        let language = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .and_then(|n| n.split('.').skip(1).find(|p| crate::lang::looks_like_code(p)).map(crate::lang::normalize));
        out.push(SubSource {
            file: Some(path.clone()),
            stream: 0,
            codec: crate::probe::sub_codec_for(path).unwrap_or("subrip").into(),
            bitmap: false,
            language,
        });
    }
    out
}

enum Burn {
    Overlay(usize),
    Text { file: PathBuf, stream: Option<usize> },
}

pub struct BuildRequest<'a> {
    pub input: &'a Path,
    pub output: &'a Path,
    pub profile: &'a Profile,
    pub media: &'a MediaInfo,
    pub hw: &'a HwInfo,
    pub hw_decode: bool,
    pub force_cpu: bool,
    pub job: &'a JobOptions,
    pub passlog: &'a Path,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPlan {
    pub passes: Vec<Vec<OsString>>,
    pub encoder: Option<EncoderChoice>,
    pub notes: Vec<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildError {
    NoEncoder,
}

impl BuildError {
    pub fn code(self) -> &'static str {
        match self {
            BuildError::NoEncoder => "noEncoder",
        }
    }
}

fn video_copy_ok(container: Container, codec: &str) -> bool {
    match container {
        Container::Mkv => true,
        Container::Mp4 => matches!(codec, "h264" | "hevc" | "av1" | "vp9" | "mpeg4" | "mpeg2video"),
        Container::Mov => matches!(codec, "h264" | "hevc" | "av1" | "vp9" | "mpeg4" | "mpeg2video" | "prores" | "mjpeg"),
        Container::Webm => matches!(codec, "vp8" | "vp9" | "av1"),
        Container::Avi => matches!(codec, "h264" | "mpeg4" | "mjpeg" | "msmpeg4v3" | "mpeg2video"),
        Container::Ts => matches!(codec, "h264" | "hevc" | "mpeg2video"),
        _ => false,
    }
}

fn audio_copy_ok(container: Container, codec: &str) -> bool {
    let pcm = codec.starts_with("pcm_");
    match container {
        Container::Mkv => true,
        Container::Mp4 | Container::Mov => matches!(codec, "aac" | "mp3" | "ac3" | "eac3" | "alac" | "flac" | "opus"),
        Container::Webm => matches!(codec, "opus" | "vorbis"),
        Container::Avi => matches!(codec, "mp3" | "ac3" | "mp2") || pcm,
        Container::Ts => matches!(codec, "aac" | "mp3" | "ac3" | "eac3" | "mp2"),
        Container::M4a => matches!(codec, "aac" | "alac"),
        Container::Mp3 => codec == "mp3",
        Container::Flac => codec == "flac",
        Container::Opus => codec == "opus",
        Container::Ogg => matches!(codec, "vorbis" | "opus" | "flac"),
        Container::Wav => pcm,
        Container::Gif => false,
    }
}

fn audio_encoder(codec: AudioCodec) -> &'static str {
    match codec {
        AudioCodec::Aac => "aac",
        AudioCodec::Mp3 => "libmp3lame",
        AudioCodec::Opus => "libopus",
        AudioCodec::Vorbis => "libvorbis",
        AudioCodec::Flac => "flac",
        AudioCodec::Alac => "alac",
        AudioCodec::Ac3 => "ac3",
        AudioCodec::Pcm => "pcm_s16le",
    }
}

fn audio_bitrate(codec: AudioCodec, kbps: u32) -> Option<u32> {
    match codec {
        AudioCodec::Flac | AudioCodec::Alac | AudioCodec::Pcm => None,
        AudioCodec::Mp3 => Some(kbps.clamp(8, 320)),
        AudioCodec::Opus => Some(kbps.clamp(6, 510)),
        AudioCodec::Ac3 => Some(kbps.clamp(32, 640)),
        AudioCodec::Aac | AudioCodec::Vorbis => Some(kbps.clamp(8, 512)),
    }
}

pub fn escape_filter_path(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let mut level1 = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        if matches!(c, '\\' | '\'' | ':') {
            level1.push('\\');
        }
        level1.push(c);
    }
    let mut level2 = String::with_capacity(level1.len() + 8);
    for c in level1.chars() {
        if matches!(c, '\\' | '\'' | '[' | ']' | ',' | ';') {
            level2.push('\\');
        }
        level2.push(c);
    }
    level2
}

pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    for c in s.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                has = true;
            }
            (None, c) if c.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn fmt_secs(s: f64) -> String {
    format!("{:.3}", s.max(0.0))
}

struct Args(Vec<OsString>);

impl Args {
    fn s(&mut self, items: &[&str]) -> &mut Self {
        self.0.extend(items.iter().map(OsString::from));
        self
    }
    fn o(&mut self, item: impl Into<OsString>) -> &mut Self {
        self.0.push(item.into());
        self
    }
}

fn duration_window(media: &MediaInfo, job: &JobOptions) -> Option<f64> {
    let start = job.trim_start.unwrap_or(0.0).max(0.0);
    let end = job.trim_end.filter(|e| *e > start).or(media.duration)?;
    Some((end - start).max(0.1))
}

pub fn build(req: &BuildRequest) -> Result<BuildPlan, BuildError> {
    let p = req.profile;
    let media = req.media;
    let container = p.container;
    let mut notes: Vec<&'static str> = Vec::new();

    let video_mode = if container.is_audio_only() || media.video.is_none() {
        StreamMode::Off
    } else if container == Container::Gif {
        StreamMode::Encode
    } else {
        p.video.mode
    };
    let video_mode = match (video_mode, &media.video) {
        (StreamMode::Copy, Some(v)) if !video_copy_ok(container, &v.codec) => {
            notes.push("videoCopyReencoded");
            StreamMode::Encode
        }
        (m, _) => m,
    };
    let codec = if container == Container::Gif { VideoCodec::Gif } else { p.video.codec };
    let encoder = if video_mode == StreamMode::Encode {
        let e = if req.force_cpu { cpu_choice(codec, req.hw) } else { choose(codec, p.video.encoder, req.hw) };
        Some(e.ok_or(BuildError::NoEncoder)?)
    } else {
        None
    };
    if let Some(e) = &encoder {
        if p.video.ten_bit && !supports_ten_bit(&e.name) {
            notes.push("tenBitUnsupported");
        }
    }
    let family = encoder.as_ref().map(|e| e.family);

    let sub_sources = subtitle_sources(media, req.job);
    let burn = if video_mode == StreamMode::Encode && p.subtitles == SubtitleMode::Burn && !sub_sources.is_empty() {
        let src = &sub_sources[req.job.burn_track.min(sub_sources.len() - 1)];
        if src.bitmap {
            Some(Burn::Overlay(src.stream))
        } else if !req.hw.has_subtitles_filter {
            notes.push("burnUnavailable");
            None
        } else {
            match &src.file {
                Some(f) => Some(Burn::Text { file: f.clone(), stream: None }),
                None => Some(Burn::Text { file: req.input.to_path_buf(), stream: Some(src.stream) }),
            }
        }
    } else {
        None
    };
    let text_burn = matches!(burn, Some(Burn::Text { .. }));

    let mut kept_subs: Vec<(&SubSource, &'static str)> = Vec::new();
    if p.subtitles == SubtitleMode::Copy && video_mode != StreamMode::Off {
        let mut dropped_bitmap = false;
        let mut candidates: Vec<&SubSource> = sub_sources.iter().collect();
        if !p.subtitle_languages.is_empty() {
            candidates.retain(|s| crate::lang::rank(s.language.as_deref(), &p.subtitle_languages).is_some());
            candidates.sort_by_key(|s| crate::lang::rank(s.language.as_deref(), &p.subtitle_languages));
        }
        for s in candidates {
            let target = match container {
                Container::Mkv => Some(if s.codec == "mov_text" { "srt" } else { "copy" }),
                Container::Mp4 | Container::Mov if !s.bitmap => Some(if s.codec == "mov_text" { "copy" } else { "mov_text" }),
                Container::Webm if !s.bitmap => Some(if s.codec == "webvtt" { "copy" } else { "webvtt" }),
                _ => {
                    dropped_bitmap |= s.bitmap && matches!(container, Container::Mp4 | Container::Mov | Container::Webm);
                    None
                }
            };
            if let Some(t) = target {
                kept_subs.push((s, t));
            }
        }
        if dropped_bitmap {
            notes.push("bitmapSubsDropped");
        }
    }

    let mut head = Args(Vec::new());
    head.s(&["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]);
    match family {
        Some(Family::Vaapi) => {
            let dev = req.hw.vaapi_device.clone().unwrap_or_else(|| "/dev/dri/renderD128".into());
            head.o("-init_hw_device").o(format!("vaapi=va:{dev}")).s(&["-filter_hw_device", "va"]);
            if req.hw_decode {
                head.s(&["-hwaccel", "vaapi", "-hwaccel_device", "va"]);
            }
        }
        Some(Family::Nvenc) if req.hw_decode => {
            head.s(&["-hwaccel", "cuda"]);
        }
        Some(Family::Amf) if req.hw_decode && cfg!(windows) => {
            head.s(&["-hwaccel", "d3d11va"]);
        }
        _ => {}
    }
    let start = req.job.trim_start.filter(|s| *s > 0.0);
    if let (Some(s), false) = (start, text_burn) {
        head.o("-ss").o(fmt_secs(s));
    }
    head.o("-i").o(req.input);
    let mut sub_inputs: Vec<usize> = Vec::new();
    for (s, _) in &kept_subs {
        if let Some(f) = &s.file {
            if let (Some(t), false) = (start, text_burn) {
                head.o("-ss").o(fmt_secs(t));
            }
            head.o("-i").o(f);
            sub_inputs.push(sub_inputs.len() + 1);
        }
    }
    if let (Some(s), true) = (start, text_burn) {
        head.o("-ss").o(fmt_secs(s));
    }

    let mut video = Args(Vec::new());
    let mut rate_for_twopass = false;
    match video_mode {
        StreamMode::Off => {
            video.s(&["-vn"]);
        }
        StreamMode::Copy => {
            video.s(&["-map", "0:v:0?", "-c:v", "copy"]);
            if matches!(container, Container::Mp4 | Container::Mov)
                && media.video.as_ref().is_some_and(|v| v.codec == "hevc")
            {
                video.s(&["-tag:v", "hvc1"]);
            }
        }
        StreamMode::Encode => {
            let enc = encoder.as_ref().expect("encoder chosen above");
            let mut chain: Vec<String> = Vec::new();
            if p.video.deinterlace {
                chain.push("bwdif=mode=send_frame:parity=auto:deint=interlaced".into());
            }
            match &p.video.crop {
                Crop::Manual { top, bottom, left, right } if top + bottom + left + right > 0 => chain.push(format!(
                    "crop='trunc((iw-{})/2)*2':'trunc((ih-{})/2)*2':{left}:{top}",
                    left + right,
                    top + bottom
                )),
                Crop::Auto => match req.job.detected_crop {
                    Some(c) => chain.push(format!("crop={}:{}:{}:{}", c.width, c.height, c.x, c.y)),
                    None if req.job.crop_checked => notes.push("noBlackBars"),
                    None => {}
                },
                _ => {}
            }
            let hdr = media.video.as_ref().is_some_and(|v| v.hdr);
            if hdr && p.video.tonemap {
                if req.hw.has_zscale {
                    chain.push(
                        "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p".into(),
                    );
                } else {
                    notes.push("tonemapUnavailable");
                }
            }
            if let Some(Burn::Text { file, stream }) = &burn {
                match stream {
                    Some(si) => chain.push(format!("subtitles=filename={}:si={si}", escape_filter_path(file))),
                    None => chain.push(format!("subtitles=filename={}", escape_filter_path(file))),
                }
            }
            if codec == VideoCodec::Gif {
                if p.video.rotate != Rotate::None || p.video.flip_h {
                    chain.extend(rotate_filters(p.video.rotate, p.video.flip_h));
                }
                chain.push(format!("fps={}", p.gif.fps));
                chain.push(format!("scale='min({},iw)':-1:flags=lanczos", p.gif.width));
                chain.push("split[g0][g1];[g0]palettegen=stats_mode=diff[gp];[g1][gp]paletteuse=dither=bayer:bayer_scale=5".into());
            } else {
                match &p.video.resolution {
                    Resolution::Keep => {}
                    Resolution::Height { value } => chain.push(format!(
                        "scale='if(gte(iw,ih),-2,min({value},iw))':'if(gte(iw,ih),min({value},ih),-2)':flags=lanczos"
                    )),
                    Resolution::MaxEdge { value } => chain.push(format!(
                        "scale='if(gte(iw,ih),min({value},iw),-2)':'if(gte(iw,ih),-2,min({value},ih))':flags=lanczos"
                    )),
                    Resolution::Custom { width, height, fit } => {
                        let (w, h) = (even(*width), even(*height));
                        chain.push(match fit {
                            Fit::Pad => format!(
                                "scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1"
                            ),
                            Fit::Crop => format!("scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{h},setsar=1"),
                            Fit::Stretch => format!("scale={w}:{h}:flags=lanczos,setsar=1"),
                        });
                    }
                }
                if let Some(fps) = p.video.fps.filter(|f| *f > 0.0) {
                    chain.push(format!("fps={fps}"));
                }
                chain.extend(rotate_filters(p.video.rotate, p.video.flip_h));
                if let Some(pf) = pix_fmt(&enc.name, enc.family, p.video.ten_bit) {
                    if enc.family == Family::Vaapi {
                        chain.push(format!("format={pf},hwupload"));
                    } else {
                        chain.push(format!("format={pf}"));
                    }
                }
            }
            let body = chain.join(",");
            let graph = match (&burn, body.is_empty()) {
                (Some(Burn::Overlay(idx)), true) => format!("[0:v:0][0:s:{idx}]overlay[vout]"),
                (Some(Burn::Overlay(idx)), false) => format!("[0:v:0][0:s:{idx}]overlay,{body}[vout]"),
                (_, true) => "[0:v:0]null[vout]".to_string(),
                (_, false) => format!("[0:v:0]{body}[vout]"),
            };
            video.o("-filter_complex").o(graph).s(&["-map", "[vout]", "-c:v"]).o(&enc.name);

            let rate = match &p.video.rate {
                RateControl::Quality { value } => Rate::Quality(*value),
                RateControl::Cq { value, max_kbps: Some(_) } if !req.hw.ceiling_ok(&enc.name) => {
                    notes.push("ceilingUnsupported");
                    Rate::Cq(*value, None)
                }
                RateControl::Cq { value, max_kbps } => Rate::Cq(*value, *max_kbps),
                RateControl::Bitrate { kbps, cbr: true } => Rate::Cbr(*kbps),
                RateControl::Bitrate { kbps, cbr: false } => {
                    rate_for_twopass = true;
                    Rate::Bitrate(*kbps)
                }
                RateControl::TargetSize { mib } => match duration_window(media, req.job) {
                    Some(d) => {
                        rate_for_twopass = true;
                        let total = (*mib as f64) * 8388.608 / d;
                        let audio = planned_audio_kbps(p, media);
                        Rate::Bitrate(((total * 0.97) - audio as f64).max(100.0) as u32)
                    }
                    None => {
                        notes.push("targetSizeNoDuration");
                        Rate::Quality(60)
                    }
                },
            };
            for a in encoder_args(&enc.name, enc.family, &rate, p.video.speed) {
                video.o(a);
            }
            if codec == VideoCodec::Hevc && enc.family == Family::Cpu && matches!(container, Container::Mp4 | Container::Mov) {
                video.s(&["-tag:v", "hvc1"]);
            }
        }
    }

    let mut audio = Args(Vec::new());
    let tracks: Vec<usize> = if container == Container::Gif || p.audio.mode == StreamMode::Off {
        Vec::new()
    } else {
        let mut all: Vec<usize> = (0..media.audio.len()).collect();
        if !p.audio.languages.is_empty() && !all.is_empty() {
            let rank = |i: &usize| crate::lang::rank(media.audio[*i].language.as_deref(), &p.audio.languages);
            let mut wanted: Vec<usize> = all.iter().copied().filter(|i| rank(i).is_some()).collect();
            wanted.sort_by_key(|i| rank(i));
            if wanted.is_empty() {
                notes.push("noLanguageMatch");
                wanted.push(0);
            }
            all = wanted;
        }
        if p.audio.tracks == AudioTracks::First || container.is_audio_only() {
            all.truncate(1);
        }
        all
    };
    if tracks.is_empty() {
        audio.s(&["-an"]);
    } else {
        let wanted = if container.audio_codecs().contains(&p.audio.codec) {
            p.audio.codec
        } else {
            notes.push("audioCodecSwapped");
            container.audio_codecs()[0]
        };
        let mut reencoded_copy = false;
        for (j, &i) in tracks.iter().enumerate() {
            audio.o("-map").o(format!("0:a:{i}"));
            let src = &media.audio[i];
            let copy = p.audio.mode == StreamMode::Copy && audio_copy_ok(container, &src.codec);
            if p.audio.mode == StreamMode::Copy && !copy {
                reencoded_copy = true;
            }
            if copy {
                audio.o(format!("-c:a:{j}")).o("copy");
                continue;
            }
            audio.o(format!("-c:a:{j}")).o(audio_encoder(wanted));
            if let Some(k) = audio_bitrate(wanted, p.audio.bitrate_kbps) {
                audio.o(format!("-b:a:{j}")).o(format!("{k}k"));
            }
            let channels = p.audio.channels.map(u32::from).or_else(|| {
                (wanted == AudioCodec::Ac3 && src.channels > 6).then_some(6)
            });
            if let Some(ch) = channels {
                audio.o(format!("-ac:a:{j}")).o(ch.to_string());
            }
            if let Some(sr) = p.audio.sample_rate {
                audio.o(format!("-ar:a:{j}")).o(sr.to_string());
            }
            let mut af: Vec<&str> = Vec::new();
            if p.audio.normalize {
                af.push("loudnorm=I=-16:TP=-1.5:LRA=11");
            }
            if wanted == AudioCodec::Opus {
                af.push("aformat=channel_layouts=7.1|5.1|stereo|mono");
            }
            if !af.is_empty() {
                audio.o(format!("-filter:a:{j}")).o(af.join(","));
            }
        }
        if reencoded_copy {
            notes.push("audioCopyReencoded");
        }
        if !p.audio.languages.is_empty() && tracks.len() > 1 && !container.is_audio_only() {
            for j in 0..tracks.len() {
                audio.o(format!("-disposition:a:{j}")).o(if j == 0 { "default" } else { "0" });
            }
        }
    }

    let mut subs = Args(Vec::new());
    let mut ext_input = sub_inputs.iter();
    for (out_idx, (s, codec)) in kept_subs.iter().enumerate() {
        match &s.file {
            None => {
                subs.o("-map").o(format!("0:s:{}", s.stream));
            }
            Some(_) => {
                let input = ext_input.next().copied().unwrap_or(1);
                subs.o("-map").o(format!("{input}:s:0"));
                if let Some(lang) = &s.language {
                    subs.o(format!("-metadata:s:s:{out_idx}")).o(format!("language={lang}"));
                }
            }
        }
        subs.o(format!("-c:s:{out_idx}")).o(*codec);
    }
    if container == Container::Mkv && p.subtitles == SubtitleMode::Copy && video_mode != StreamMode::Off {
        subs.s(&["-map", "0:t?"]);
    }

    let mut tail = Args(Vec::new());
    tail.s(&["-map_metadata", if p.keep_metadata { "0" } else { "-1" }]);
    tail.s(&["-map_chapters", if p.keep_chapters && container != Container::Gif { "0" } else { "-1" }]);
    if p.fast_start && matches!(container, Container::Mp4 | Container::Mov | Container::M4a) {
        tail.s(&["-movflags", "+faststart"]);
    }
    if container == Container::Gif {
        tail.s(&["-loop", "0"]);
    }
    if matches!(container, Container::Mp4 | Container::Mov) {
        tail.s(&["-strict", "experimental"]);
    }
    tail.s(&["-max_muxing_queue_size", "4096"]);
    let limit = match (req.job.trim_start.filter(|s| *s > 0.0), req.job.trim_end) {
        (s, Some(e)) if e > s.unwrap_or(0.0) => Some(e - s.unwrap_or(0.0)),
        _ => None,
    };
    if let Some(t) = limit {
        tail.o("-t").o(fmt_secs(t));
    }
    for a in split_args(&p.extra_args) {
        tail.o(a);
    }

    let mut passes = Vec::new();
    let two_pass = p.video.two_pass
        && rate_for_twopass
        && encoder.as_ref().is_some_and(|e| e.family == Family::Cpu && supports_two_pass(&e.name));
    if two_pass {
        let mut p1 = Args(head.0.clone());
        p1.0.extend(video.0.iter().cloned());
        p1.s(&["-pass", "1", "-passlogfile"]).o(req.passlog).s(&["-an", "-sn", "-dn"]);
        if let Some(t) = limit {
            p1.o("-t").o(fmt_secs(t));
        }
        p1.s(&["-f", "null", if cfg!(windows) { "NUL" } else { "/dev/null" }]);
        passes.push(p1.0);
    }
    let mut full = head;
    full.0.extend(video.0);
    if two_pass {
        full.s(&["-pass", "2", "-passlogfile"]).o(req.passlog);
    }
    full.0.extend(audio.0);
    full.0.extend(subs.0);
    full.0.extend(tail.0);
    full.s(&["-f", container.muxer()]).o(req.output);
    passes.push(full.0);

    Ok(BuildPlan { passes, encoder, notes })
}

fn rotate_filters(rotate: Rotate, flip_h: bool) -> Vec<String> {
    let mut v: Vec<String> = match rotate {
        Rotate::None => vec![],
        Rotate::Cw90 => vec!["transpose=1".into()],
        Rotate::Cw180 => vec!["hflip".into(), "vflip".into()],
        Rotate::Cw270 => vec!["transpose=2".into()],
    };
    if flip_h {
        v.push("hflip".into());
    }
    v
}

fn planned_audio_kbps(p: &Profile, media: &MediaInfo) -> u32 {
    if p.audio.mode == StreamMode::Off || media.audio.is_empty() {
        return 0;
    }
    let n = if p.audio.tracks == AudioTracks::First { 1 } else { media.audio.len() };
    let per = |i: usize| -> u32 {
        if p.audio.mode == StreamMode::Copy {
            media.audio.get(i).and_then(|a| a.bitrate).map(|b| (b / 1000) as u32).unwrap_or(192)
        } else if p.audio.codec.lossless() {
            900
        } else {
            p.audio.bitrate_kbps
        }
    };
    (0..n).map(per).sum()
}

pub fn estimate_size(p: &Profile, media: &MediaInfo, job: &JobOptions, hw: Option<&HwInfo>) -> Option<u64> {
    let dur = duration_window(media, job)?;
    let audio_kbps = if p.container == Container::Gif { 0 } else { planned_audio_kbps(p, media) } as f64;
    let video_kbps = if p.container.is_audio_only() {
        0.0
    } else if p.container != Container::Gif && p.video.mode == StreamMode::Copy {
        let src = media.video.as_ref().and_then(|v| v.bitrate).or(media.bitrate)?;
        src as f64 / 1000.0
    } else {
        let v = media.video.as_ref()?;
        match &p.video.rate {
            RateControl::Bitrate { kbps, .. } => *kbps as f64,
            RateControl::TargetSize { mib } => return Some(*mib as u64 * 1024 * 1024),
            RateControl::Quality { .. } | RateControl::Cq { .. } => {
                let mut est = quality_kbps(p, media, v, hw);
                if let RateControl::Cq { max_kbps: Some(k), .. } = &p.video.rate {
                    est = est.min(*k as f64);
                }
                est
            }
        }
    };
    Some(((video_kbps + audio_kbps) * 1000.0 / 8.0 * dur) as u64)
}

fn quality_kbps(p: &Profile, media: &MediaInfo, v: &crate::probe::VideoStream, hw: Option<&HwInfo>) -> f64 {
    let gif = p.container == Container::Gif;
    let (w, h) = if gif {
        let nw = (p.gif.width as f64).min(v.width as f64);
        (nw, v.height as f64 * nw / (v.width as f64).max(1.0))
    } else {
        let (w, h) = output_size(p, v.width, v.height);
        (w as f64, h as f64)
    };
    let src_fps = v.fps.unwrap_or(30.0).max(1.0);
    let fps = if gif { p.gif.fps as f64 } else { p.video.fps.filter(|f| *f > 0.0).unwrap_or(src_fps) };

    let codec = if gif { VideoCodec::Gif } else { p.video.codec };
    let encoder = hw.and_then(|hw| encoders::choose(codec, p.video.encoder, hw)).map(|c| c.name);
    let enc = encoder.as_deref().unwrap_or(match codec {
        VideoCodec::H264 => "libx264",
        VideoCodec::Hevc => "libx265",
        VideoCodec::Av1 => "libsvtav1",
        VideoCodec::Vp9 => "libvpx-vp9",
        VideoCodec::Mpeg4 => "mpeg4",
        VideoCodec::Prores => "prores_ks",
        VideoCodec::Gif => "gif",
    });
    let gpu = !matches!(enc, "libx264" | "libx265" | "libsvtav1" | "libaom-av1" | "libvpx-vp9" | "mpeg4" | "prores_ks" | "gif");

    let cq = match &p.video.rate {
        RateControl::Cq { value, .. } => *value as f64,
        RateControl::Quality { value } => {
            if gpu { encoders::scale(*value, 42, 16) as f64 } else { encoders::scale(*value, 40, 15) as f64 }
        }
        _ => 22.0,
    };
    let enc_factor = match enc {
        "libx264" => 1.0,
        "libx265" => 0.8,
        "libsvtav1" | "libaom-av1" => 0.7,
        "libvpx-vp9" => 0.8,
        "mpeg4" => 1.6,
        "h264_vaapi" => 1.33,
        "hevc_vaapi" => 1.72,
        "av1_vaapi" => 1.1,
        "vp9_vaapi" => 1.4,
        "h264_nvenc" => 1.15,
        "hevc_nvenc" => 0.95,
        "av1_nvenc" => 0.8,
        "h264_amf" => 1.35,
        "hevc_amf" => 1.6,
        "av1_amf" => 1.2,
        "h264_qsv" => 1.2,
        "hevc_qsv" => 1.0,
        "av1_qsv" => 0.9,
        _ => 1.0,
    };

    let pixels = w * h * fps;
    if matches!(enc, "prores_ks" | "gif") {
        let bpp = if enc == "gif" { 0.96 } else { 2.0 * 2f64.powf((22.0 - cq) / 12.0) };
        return pixels * bpp / 1000.0;
    }

    let src_kbps = v.bitrate.map(|b| b as f64 / 1000.0).or_else(|| media.bitrate.map(|b| b as f64 / 1000.0 * 0.92));
    let src_codec = match v.codec.as_str() {
        "h264" => 1.0,
        "hevc" | "vp9" => 0.72,
        "av1" => 0.62,
        "prores" | "dnxhd" | "rawvideo" | "ffv1" | "huffyuv" | "utvideo" => 12.0,
        _ => 1.6,
    };
    let quality = 2f64.powf((22.0 - cq) / 6.0) * enc_factor;
    match src_kbps.filter(|k| *k > 50.0) {
        Some(src) => {
            let h264_eq = src / src_codec;
            let src_pixels = (v.width as f64 * v.height as f64 * src_fps).max(1.0);
            let scale = (pixels / src_pixels).powf(0.75);
            let est = h264_eq * 0.42 * quality * scale;
            est.min(src * 2.2 * scale.max(1.0))
        }
        None => pixels * 0.09 * quality / 1000.0,
    }
}

fn even(v: u32) -> u32 {
    (v.max(2) / 2) * 2
}

pub fn output_size(p: &Profile, width: u32, height: u32) -> (u32, u32) {
    let (w, h) = match p.video.rotate {
        Rotate::Cw90 | Rotate::Cw270 => (height, width),
        _ => (width, height),
    };
    if p.video.mode != StreamMode::Encode || w == 0 || h == 0 {
        return (w, h);
    }
    let fit_short = |limit: u32| {
        let short = w.min(h);
        if limit >= short {
            return (w, h);
        }
        let k = limit as f64 / short as f64;
        if w <= h { (limit, even((h as f64 * k).round() as u32)) } else { (even((w as f64 * k).round() as u32), limit) }
    };
    match &p.video.resolution {
        Resolution::Keep => (w, h),
        Resolution::Height { value } => fit_short(*value),
        Resolution::MaxEdge { value } => {
            let long = w.max(h);
            if *value >= long {
                (w, h)
            } else {
                let k = *value as f64 / long as f64;
                if w >= h { (*value, even((h as f64 * k).round() as u32)) } else { (even((w as f64 * k).round() as u32), *value) }
            }
        }
        Resolution::Custom { width, height, .. } => (even(*width), even(*height)),
    }
}

pub fn display_command(program: &Path, args: &[OsString]) -> String {
    let quote = |s: &str| -> String {
        let plain = !s.is_empty()
            && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:=+,@%".contains(c));
        if plain {
            s.to_string()
        } else if cfg!(windows) {
            format!("\"{}\"", s.replace('"', "\\\""))
        } else {
            format!("'{}'", s.replace('\'', "'\\''"))
        }
    };
    std::iter::once(program.as_os_str())
        .chain(args.iter().map(|a| a.as_os_str()))
        .map(|a| quote(&a.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(" ")
}

#[doc(hidden)]
pub use encoders::scale as quality_scale;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hw::detect::EncoderStatus;
    use crate::hw::encoders::HW_ENCODERS;
    use crate::probe::{AudioStream, SubtitleStream, VideoStream};
    use crate::profile::builtins;
    use std::path::PathBuf;

    fn hw(working: &[&str]) -> HwInfo {
        HwInfo {
            encoders: HW_ENCODERS
                .iter()
                .map(|(n, f, c)| EncoderStatus { name: n.to_string(), family: *f, codec: *c, working: working.contains(n), error: None, ceiling: *f != Family::Amf })
                .collect(),
            cpu_encoders: ["libx264", "libx265", "libsvtav1", "libvpx-vp9", "gif", "mpeg4", "prores_ks"].iter().map(|s| s.to_string()).collect(),
            vaapi_device: Some("/dev/dri/renderD128".into()),
            has_zscale: true,
            has_subtitles_filter: true,
            ..HwInfo::default()
        }
    }

    fn media() -> MediaInfo {
        MediaInfo {
            format: "matroska,webm".into(),
            duration: Some(600.0),
            size: 1,
            bitrate: Some(8_000_000),
            video: Some(VideoStream { codec: "h264".into(), width: 1920, height: 1080, fps: Some(24.0), pix_fmt: "yuv420p".into(), bit_depth: 8, hdr: false, bitrate: None }),
            audio: vec![
                AudioStream { codec: "dts".into(), channels: 6, ..Default::default() },
                AudioStream { codec: "aac".into(), channels: 2, ..Default::default() },
            ],
            subtitles: vec![
                SubtitleStream { codec: "subrip".into(), bitmap: false, ..Default::default() },
                SubtitleStream { codec: "hdmv_pgs_subtitle".into(), bitmap: true, ..Default::default() },
            ],
            chapters: 0,
            external_subs: vec![],
        }
    }

    fn profile(id: &str) -> Profile {
        builtins().into_iter().find(|p| p.id == format!("builtin.{id}")).unwrap()
    }

    fn run(p: &Profile, m: &MediaInfo, h: &HwInfo, job: &JobOptions, force_cpu: bool) -> (String, BuildPlan) {
        let input = PathBuf::from("/in/Show.S01E01.[1080p].mkv");
        let output = PathBuf::from("/out/Show.S01E01.[1080p].zvc-part.mp4");
        let plan = build(&BuildRequest {
            input: &input,
            output: &output,
            profile: p,
            media: m,
            hw: h,
            hw_decode: true,
            force_cpu,
            job,
            passlog: Path::new("/tmp/log"),
        })
        .unwrap();
        let s = plan.passes.last().unwrap().iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" ");
        (s, plan)
    }

    #[test]
    fn vaapi_hevc_full_command() {
        let (cmd, plan) = run(&profile("mp4-hevc"), &media(), &hw(&["hevc_vaapi"]), &JobOptions::default(), false);
        assert_eq!(plan.encoder.unwrap().name, "hevc_vaapi");
        assert_eq!(
            cmd,
            "-hide_banner -nostdin -y -loglevel error -progress pipe:1 -nostats \
-init_hw_device vaapi=va:/dev/dri/renderD128 -filter_hw_device va -hwaccel vaapi -hwaccel_device va \
-i /in/Show.S01E01.[1080p].mkv \
-filter_complex [0:v:0]format=nv12,hwupload[vout] -map [vout] -c:v hevc_vaapi -rc_mode CQP -qp 25 \
-map 0:a:0 -c:a:0 aac -b:a:0 192k -map 0:a:1 -c:a:1 aac -b:a:1 192k \
-map 0:s:0 -c:s:0 mov_text \
-map_metadata 0 -map_chapters 0 -movflags +faststart -strict experimental -max_muxing_queue_size 4096 \
-f mp4 /out/Show.S01E01.[1080p].zvc-part.mp4"
        );
        assert_eq!(plan.notes, vec!["bitmapSubsDropped"]);
    }

    #[test]
    fn cpu_fallback_uses_software_encoder() {
        let (cmd, plan) = run(&profile("mp4-hevc"), &media(), &hw(&["hevc_vaapi"]), &JobOptions::default(), true);
        assert_eq!(plan.encoder.unwrap().name, "libx265");
        assert!(!cmd.contains("vaapi"));
        assert!(cmd.contains("format=yuv420p[vout]"));
        assert!(cmd.contains("-c:v libx265") && cmd.contains("-tag:v hvc1"));
    }

    #[test]
    fn nvenc_uses_cuda_decode() {
        let (cmd, _) = run(&profile("mp4-h264"), &media(), &hw(&["h264_nvenc", "h264_vaapi"]), &JobOptions::default(), false);
        assert!(cmd.contains("-hwaccel cuda -i"));
        assert!(cmd.contains("-c:v h264_nvenc -preset p5"));
    }

    #[test]
    fn remux_copies_and_reencodes_incompatible_audio() {
        let (cmd, plan) = run(&profile("remux-mp4"), &media(), &hw(&[]), &JobOptions::default(), false);
        assert!(cmd.contains("-map 0:v:0? -c:v copy"));
        assert!(cmd.contains("-map 0:a:0 -c:a:0 aac -b:a:0 192k -map 0:a:1 -c:a:1 copy"));
        assert!(plan.notes.contains(&"audioCopyReencoded"));
        assert!(plan.encoder.is_none());
    }

    #[test]
    fn mkv_remux_keeps_everything() {
        let (cmd, _) = run(&profile("remux-mkv"), &media(), &hw(&[]), &JobOptions::default(), false);
        assert!(cmd.contains("-map 0:s:0 -c:s:0 copy -map 0:s:1 -c:s:1 copy -map 0:t?"));
        assert!(cmd.contains("-f matroska"));
    }

    #[test]
    fn trim_and_text_burn_seek_after_input() {
        let mut p = profile("mp4-h264");
        p.subtitles = SubtitleMode::Burn;
        let job = JobOptions { trim_start: Some(10.0), trim_end: Some(70.0), burn_track: 0, ..Default::default() };
        let (cmd, _) = run(&p, &media(), &hw(&[]), &job, false);
        assert!(cmd.contains("-i /in/Show.S01E01.[1080p].mkv -ss 10.000"));
        assert!(cmd.contains("subtitles=filename=/in/Show.S01E01.\\[1080p\\].mkv:si=0"));
        assert!(cmd.contains("-t 60.000"));
        assert!(!cmd.contains("-map 0:s"));

        let job = JobOptions { trim_start: Some(10.0), trim_end: None, burn_track: 1, ..Default::default() };
        let (cmd, _) = run(&p, &media(), &hw(&[]), &job, false);
        assert!(cmd.contains("-ss 10.000 -i"));
        assert!(cmd.contains("[0:v:0][0:s:1]overlay,format=yuv420p[vout]"));
    }

    #[test]
    fn audio_only_and_gif() {
        let (cmd, plan) = run(&profile("audio-mp3"), &media(), &hw(&[]), &JobOptions::default(), false);
        assert!(cmd.contains("-vn -map 0:a:0 -c:a:0 libmp3lame -b:a:0 256k"));
        assert!(!cmd.contains("0:a:1"));
        assert!(plan.encoder.is_none());
        let (cmd, _) = run(&profile("gif"), &media(), &hw(&["h264_vaapi"]), &JobOptions::default(), false);
        assert!(cmd.contains("-c:v gif"));
        assert!(cmd.contains("paletteuse"));
        assert!(cmd.contains("-an"));
        assert!(cmd.contains("-loop 0"));
    }

    #[test]
    fn two_pass_target_size() {
        let mut p = profile("mp4-h264");
        p.video.rate = RateControl::TargetSize { mib: 100 };
        p.video.two_pass = true;
        p.video.encoder = crate::profile::EncoderPref::Cpu;
        let (_, plan) = run(&p, &media(), &hw(&[]), &JobOptions::default(), false);
        assert_eq!(plan.passes.len(), 2);
        let p1: Vec<String> = plan.passes[0].iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(p1.join(" ").contains("-pass 1 -passlogfile /tmp/log -an -sn -dn"));
        let bv = p1.iter().position(|a| a == "-b:v").unwrap();
        assert_eq!(p1[bv + 1], "972k");
    }

    #[test]
    fn opus_gets_layout_fix_and_scaling() {
        let mut p = profile("mp4-av1");
        p.video.resolution = Resolution::MaxEdge { value: 1280 };
        let (cmd, _) = run(&p, &media(), &hw(&[]), &JobOptions::default(), false);
        assert!(cmd.contains("-c:a:0 libopus"));
        assert!(cmd.contains("aformat=channel_layouts=7.1|5.1|stereo|mono"));
        assert!(cmd.contains("scale='if(gte(iw,ih),min(1280,iw),-2)'"));
        assert!(cmd.contains("-c:v libsvtav1"));
    }

    #[test]
    fn no_encoder_is_an_error() {
        let mut h = hw(&[]);
        h.cpu_encoders.clear();
        let input = PathBuf::from("/a.mkv");
        let r = build(&BuildRequest {
            input: &input,
            output: &input,
            profile: &profile("mp4-h264"),
            media: &media(),
            hw: &h,
            hw_decode: false,
            force_cpu: false,
            job: &JobOptions::default(),
            passlog: Path::new("/tmp/x"),
        });
        assert_eq!(r.unwrap_err(), BuildError::NoEncoder);
    }

    #[test]
    fn external_subtitles_and_languages() {
        let mut m = media();
        m.audio[0].language = Some("eng".into());
        m.audio[1].language = Some("ger".into());
        m.subtitles[0].language = Some("eng".into());
        m.external_subs = vec![crate::probe::ExternalSub { path: "/in/Show.de.srt".into(), codec: "subrip".into(), language: Some("ger".into()) }];
        let mut p = profile("mkv-hevc10");
        p.audio.languages = vec!["de".into(), "en".into()];
        p.subtitle_languages = vec!["de".into()];
        let job = JobOptions { trim_start: Some(5.0), ..Default::default() };
        let (cmd, plan) = run(&p, &m, &hw(&[]), &job, false);
        assert!(cmd.contains("-ss 5.000 -i /in/Show.S01E01.[1080p].mkv -ss 5.000 -i /in/Show.de.srt"), "{cmd}");
        assert!(cmd.contains("-map 0:a:1 -c:a:0 copy -map 0:a:0 -c:a:1 copy -disposition:a:0 default -disposition:a:1 0"), "{cmd}");
        assert!(cmd.contains("-map 1:s:0 -metadata:s:s:0 language=ger -c:s:0 copy"), "{cmd}");
        assert!(!cmd.contains("0:s:0"), "{cmd}");
        assert!(plan.notes.is_empty(), "{:?}", plan.notes);

        p.audio.languages = vec!["jpn".into()];
        let (cmd, plan) = run(&p, &m, &hw(&[]), &job, false);
        assert!(cmd.contains("-map 0:a:0 -c:a:0 copy -map_metadata") || cmd.contains("-map 0:a:0 -c:a:0 copy -map 1"), "{cmd}");
        assert!(plan.notes.contains(&"noLanguageMatch"));
    }

    #[test]
    fn burn_external_subtitle_file_and_crop() {
        let mut m = media();
        m.external_subs = vec![crate::probe::ExternalSub { path: "/in/it's [x].srt".into(), codec: "subrip".into(), language: None }];
        let mut p = profile("mp4-h264");
        p.subtitles = SubtitleMode::Burn;
        p.video.crop = Crop::Manual { top: 140, bottom: 140, left: 0, right: 0 };
        let job = JobOptions { burn_track: 2, ..Default::default() };
        let (cmd, _) = run(&p, &m, &hw(&[]), &job, false);
        assert!(cmd.contains("crop='trunc((iw-0)/2)*2':'trunc((ih-280)/2)*2':0:140,subtitles=filename=/in/it\\\\\\'s \\[x\\].srt,format=yuv420p"), "{cmd}");
        assert!(!cmd.contains("-i /in/it"), "burned subtitles are read by the filter, not mapped");

        p.subtitles = SubtitleMode::Off;
        p.video.crop = Crop::Auto;
        let job = JobOptions { detected_crop: Some(CropRect { width: 1920, height: 800, x: 0, y: 140 }), ..Default::default() };
        let (cmd, _) = run(&p, &m, &hw(&[]), &job, false);
        assert!(cmd.contains("[0:v:0]crop=1920:800:0:140,format=yuv420p[vout]"), "{cmd}");
        let (_, plan) = run(&p, &m, &hw(&[]), &JobOptions::default(), false);
        assert!(!plan.notes.contains(&"noBlackBars"), "not checked yet: no note");
        let (_, plan) = run(&p, &m, &hw(&[]), &JobOptions { crop_checked: true, ..Default::default() }, false);
        assert!(plan.notes.contains(&"noBlackBars"));
    }

    #[test]
    fn filter_path_escaping() {
        assert_eq!(escape_filter_path(Path::new("/a/b.mkv")), "/a/b.mkv");
        assert_eq!(escape_filter_path(Path::new("/a/[x], y;z.mkv")), "/a/\\[x\\]\\, y\\;z.mkv");
        assert_eq!(escape_filter_path(Path::new("/a/it's.mkv")), "/a/it\\\\\\'s.mkv");
        assert_eq!(escape_filter_path(Path::new("C:\\v\\a.mkv")), "C\\\\:/v/a.mkv");
    }

    #[test]
    fn split_extra_args() {
        assert_eq!(split_args(r#"-x265-params "aq-mode=3:psy-rd=1"  -metadata title='My Film' '' "#), vec![
            "-x265-params", "aq-mode=3:psy-rd=1", "-metadata", "title=My Film", ""
        ]);
        assert!(split_args("   ").is_empty());
    }

    #[test]
    fn estimates_are_sane() {
        let m = media();
        let job = JobOptions::default();
        let h264 = estimate_size(&profile("mp4-h264"), &m, &job, None).unwrap();
        let hevc = estimate_size(&profile("mp4-hevc"), &m, &job, None).unwrap();
        let share = estimate_size(&profile("share"), &m, &job, None).unwrap();
        assert!(hevc < h264 && share < h264, "{h264} {hevc} {share}");
        assert!(h264 < 600 * 8_000_000 / 8 * 12 / 10);
    }

    #[test]
    fn estimates_match_real_encodes() {
        let mut m = media();
        m.duration = Some(40.0);
        m.audio.clear();
        m.video = Some(VideoStream { codec: "h264".into(), width: 1280, height: 534, fps: Some(24.0), pix_fmt: "yuv420p".into(), bit_depth: 8, hdr: false, bitrate: Some(4_182_000) });
        let job = JobOptions::default();
        let kbps = |codec: VideoCodec, pref: crate::profile::EncoderPref, hw: &HwInfo| {
            let mut p = profile("mp4-h264");
            p.audio.mode = StreamMode::Off;
            p.video.codec = codec;
            p.video.encoder = pref;
            p.video.rate = RateControl::Cq { value: 22, max_kbps: None };
            estimate_size(&p, &m, &job, Some(hw)).unwrap() as f64 * 8.0 / 40.0 / 1000.0
        };
        use crate::profile::EncoderPref::{Cpu, Vaapi};
        let gpu = hw(&["h264_vaapi", "hevc_vaapi"]);
        let cases = [(kbps(VideoCodec::Hevc, Cpu, &gpu), 2211.0), (kbps(VideoCodec::H264, Vaapi, &gpu), 3225.0), (kbps(VideoCodec::Hevc, Vaapi, &gpu), 4287.0)];
        for (est, real) in cases {
            assert!((0.55..=1.8).contains(&(est / real)), "estimated {est:.0} kb/s, real {real} kb/s");
        }
        assert!(cases[2].0 > cases[1].0 && cases[1].0 > cases[0].0);
    }

    #[test]
    fn output_sizes() {
        let mut p = profile("mp4-h264");
        let at = |p: &Profile, w, h| output_size(p, w, h);
        p.video.resolution = Resolution::Height { value: 1080 };
        assert_eq!(at(&p, 3840, 2160), (1920, 1080));
        assert_eq!(at(&p, 2160, 3840), (1080, 1920), "portrait: the shorter edge is 1080");
        assert_eq!(at(&p, 1280, 720), (1280, 720), "never scaled up");
        p.video.resolution = Resolution::Height { value: 540 };
        assert_eq!(at(&p, 1920, 1080), (960, 540));
        p.video.resolution = Resolution::Height { value: 4320 };
        assert_eq!(at(&p, 7680, 4320), (7680, 4320));
        p.video.resolution = Resolution::Custom { width: 540, height: 960, fit: Fit::Pad };
        assert_eq!(at(&p, 1920, 1080), (540, 960));
        p.video.resolution = Resolution::Keep;
        p.video.rotate = Rotate::Cw90;
        assert_eq!(at(&p, 1920, 1080), (1080, 1920));
    }

    #[test]
    fn resolution_filters() {
        let mut p = profile("mp4-h264");
        let (m, h, j) = (media(), hw(&[]), JobOptions::default());
        p.video.resolution = Resolution::Height { value: 1080 };
        let (cmd, _) = run(&p, &m, &h, &j, false);
        assert!(cmd.contains("scale='if(gte(iw,ih),-2,min(1080,iw))':'if(gte(iw,ih),min(1080,ih),-2)'"), "{cmd}");
        p.video.resolution = Resolution::Custom { width: 540, height: 960, fit: Fit::Pad };
        let (cmd, _) = run(&p, &m, &h, &j, false);
        assert!(cmd.contains("scale=540:960:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=540:960:(ow-iw)/2:(oh-ih)/2,setsar=1"), "{cmd}");
        p.video.resolution = Resolution::Custom { width: 540, height: 960, fit: Fit::Crop };
        let (cmd, _) = run(&p, &m, &h, &j, false);
        assert!(cmd.contains("force_original_aspect_ratio=increase:flags=lanczos,crop=540:960"), "{cmd}");
    }

    #[test]
    fn cbr_skips_two_pass_and_amf_ceiling_is_noted() {
        let mut p = profile("mp4-h264");
        p.video.encoder = crate::profile::EncoderPref::Cpu;
        p.video.two_pass = true;
        p.video.rate = RateControl::Bitrate { kbps: 3000, cbr: true };
        let (cmd, plan) = run(&p, &media(), &hw(&[]), &JobOptions::default(), false);
        assert!(cmd.contains("-x264-params nal-hrd=cbr") && plan.passes.len() == 1, "{cmd}");

        p.video.encoder = crate::profile::EncoderPref::Amf;
        p.video.rate = RateControl::Cq { value: 20, max_kbps: Some(4000) };
        let (_, plan) = run(&p, &media(), &hw(&["h264_amf"]), &JobOptions::default(), false);
        assert!(plan.notes.contains(&"ceilingUnsupported"));
    }

    #[test]
    fn vaapi_without_qvbr_keeps_the_gpu() {
        let mut p = profile("mp4-hevc");
        p.video.encoder = crate::profile::EncoderPref::Vaapi;
        p.video.rate = RateControl::Cq { value: 22, max_kbps: Some(6000) };
        let mut h = hw(&["hevc_vaapi"]);
        h.encoders.iter_mut().for_each(|e| e.ceiling = false);
        let (cmd, plan) = run(&p, &media(), &h, &JobOptions::default(), false);
        assert!(cmd.contains("-c:v hevc_vaapi -rc_mode CQP -qp 22") && !cmd.contains("QVBR"), "{cmd}");
        assert!(plan.notes.contains(&"ceilingUnsupported"));
        let (cmd, plan) = run(&p, &media(), &hw(&["hevc_vaapi"]), &JobOptions::default(), false);
        assert!(cmd.contains("-rc_mode QVBR") && !plan.notes.contains(&"ceilingUnsupported"), "{cmd}");
    }

    #[test]
    fn display_quotes() {
        let s = display_command(Path::new("ffmpeg"), &["-i".into(), "/a b/it's.mkv".into()]);
        if !cfg!(windows) {
            assert_eq!(s, "ffmpeg -i '/a b/it'\\''s.mkv'");
        }
    }
}
