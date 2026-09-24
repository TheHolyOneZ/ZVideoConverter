use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::ffmpeg::{command, run_with_timeout};
use crate::{Error, Result};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoStream {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: Option<f64>,
    pub pix_fmt: String,
    pub bit_depth: u8,
    pub hdr: bool,
    pub bitrate: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioStream {
    pub codec: String,
    pub channels: u32,
    pub sample_rate: Option<u32>,
    pub language: Option<String>,
    pub title: Option<String>,
    pub bitrate: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStream {
    pub codec: String,
    pub language: Option<String>,
    pub title: Option<String>,
    pub bitmap: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSub {
    pub path: std::path::PathBuf,
    pub codec: String,
    pub language: Option<String>,
}

const SUB_EXTS: &[(&str, &str)] = &[("srt", "subrip"), ("ass", "ass"), ("ssa", "ass"), ("vtt", "webvtt")];

pub fn sub_codec_for(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    SUB_EXTS.iter().find(|(e, _)| *e == ext).map(|(_, c)| *c)
}

pub fn find_external_subs(video: &Path) -> Vec<ExternalSub> {
    let (Some(dir), Some(stem)) = (video.parent(), video.file_stem()) else { return Vec::new() };
    let stem = stem.to_string_lossy().into_owned();
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<ExternalSub> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let codec = sub_codec_for(&path)?;
            let name = path.file_stem()?.to_string_lossy().into_owned();
            let rest = if name == stem { "" } else { name.strip_prefix(&stem)?.strip_prefix('.')? };
            let language = rest.split('.').find(|part| crate::lang::looks_like_code(part)).map(crate::lang::normalize);
            Some(ExternalSub { path, codec: codec.into(), language })
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub format: String,
    pub duration: Option<f64>,
    pub size: u64,
    pub bitrate: Option<u64>,
    pub video: Option<VideoStream>,
    pub audio: Vec<AudioStream>,
    pub subtitles: Vec<SubtitleStream>,
    pub chapters: u32,
    #[serde(default)]
    pub external_subs: Vec<ExternalSub>,
}

#[derive(Deserialize)]
struct Raw {
    #[serde(default)]
    streams: Vec<RawStream>,
    format: Option<RawFormat>,
    #[serde(default)]
    chapters: Vec<serde_json::Value>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawStream {
    codec_type: String,
    codec_name: String,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    pix_fmt: Option<String>,
    bits_per_raw_sample: Option<String>,
    color_transfer: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<String>,
    bit_rate: Option<String>,
    disposition: Option<RawDisposition>,
    tags: Option<RawTags>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawDisposition {
    attached_pic: u8,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawTags {
    language: Option<String>,
    title: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawFormat {
    format_name: String,
    duration: Option<String>,
    size: Option<String>,
    bit_rate: Option<String>,
}

fn rate(s: &Option<String>) -> Option<f64> {
    let s = s.as_deref()?;
    let (n, d) = s.split_once('/').unwrap_or((s, "1"));
    let (n, d): (f64, f64) = (n.parse().ok()?, d.parse().ok()?);
    (d > 0.0 && n > 0.0).then(|| n / d).filter(|f| *f < 1000.0)
}

fn num<T: std::str::FromStr>(s: &Option<String>) -> Option<T> {
    s.as_deref().and_then(|s| s.parse().ok())
}

fn bit_depth(pix_fmt: &str, raw: Option<u8>) -> u8 {
    if let Some(d) = raw.filter(|d| *d > 0) {
        return d;
    }
    for (tag, depth) in [("p16", 16), ("p14", 14), ("p12", 12), ("p010", 10), ("p10", 10)] {
        if pix_fmt.contains(tag) {
            return depth;
        }
    }
    8
}

const BITMAP_SUBS: &[&str] = &["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub", "dvb_teletext"];

pub fn parse(json: &[u8]) -> Result<MediaInfo> {
    let raw: Raw = serde_json::from_slice(json).map_err(|e| Error::Probe(e.to_string()))?;
    let f = raw.format.unwrap_or_default();
    let mut info = MediaInfo {
        format: f.format_name,
        duration: num::<f64>(&f.duration).filter(|d| *d > 0.0),
        size: num(&f.size).unwrap_or(0),
        bitrate: num(&f.bit_rate),
        chapters: raw.chapters.len() as u32,
        ..Default::default()
    };
    for s in raw.streams {
        let tags = s.tags.unwrap_or_default();
        match s.codec_type.as_str() {
            "video" => {
                let cover = s.disposition.as_ref().is_some_and(|d| d.attached_pic == 1);
                if cover || info.video.is_some() {
                    continue;
                }
                let pix = s.pix_fmt.clone().unwrap_or_default();
                let transfer = s.color_transfer.as_deref().unwrap_or("");
                info.video = Some(VideoStream {
                    codec: s.codec_name,
                    width: s.width.unwrap_or(0),
                    height: s.height.unwrap_or(0),
                    fps: rate(&s.avg_frame_rate).or_else(|| rate(&s.r_frame_rate)),
                    bit_depth: bit_depth(&pix, num(&s.bits_per_raw_sample)),
                    pix_fmt: pix,
                    hdr: matches!(transfer, "smpte2084" | "arib-std-b67"),
                    bitrate: num(&s.bit_rate),
                });
            }
            "audio" => info.audio.push(AudioStream {
                codec: s.codec_name,
                channels: s.channels.unwrap_or(0),
                sample_rate: num(&s.sample_rate),
                language: tags.language,
                title: tags.title,
                bitrate: num(&s.bit_rate),
            }),
            "subtitle" => info.subtitles.push(SubtitleStream {
                bitmap: BITMAP_SUBS.contains(&s.codec_name.as_str()),
                codec: s.codec_name,
                language: tags.language,
                title: tags.title,
            }),
            _ => {}
        }
    }
    Ok(info)
}

pub fn probe(ffprobe: &Path, input: &Path) -> Result<MediaInfo> {
    let mut cmd = command(ffprobe);
    cmd.args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", "-i"])
        .arg(input);
    let out = run_with_timeout(cmd, Duration::from_secs(60))?;
    if !out.status_ok {
        let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(Error::Probe(if msg.is_empty() { "unreadable file".into() } else { msg }));
    }
    let mut info = parse(&out.stdout)?;
    if info.size == 0 {
        info.size = std::fs::metadata(input).map(|m| m.len()).unwrap_or(0);
    }
    if info.video.is_none() && info.audio.is_empty() {
        return Err(Error::Probe("no audio or video streams".into()));
    }
    if info.video.is_some() {
        info.external_subs = find_external_subs(input);
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "streams": [
        {"codec_type":"video","codec_name":"hevc","width":3840,"height":2160,"avg_frame_rate":"24000/1001",
         "pix_fmt":"yuv420p10le","color_transfer":"smpte2084"},
        {"codec_type":"audio","codec_name":"eac3","channels":6,"sample_rate":"48000","tags":{"language":"eng","title":"Surround"}},
        {"codec_type":"audio","codec_name":"aac","channels":2,"sample_rate":"48000","tags":{"language":"ger"}},
        {"codec_type":"subtitle","codec_name":"subrip","tags":{"language":"eng"}},
        {"codec_type":"subtitle","codec_name":"hdmv_pgs_subtitle"},
        {"codec_type":"video","codec_name":"mjpeg","width":600,"height":600,"disposition":{"attached_pic":1}}
      ],
      "chapters": [{}, {}],
      "format": {"format_name":"matroska,webm","duration":"1320.5","size":"123456","bit_rate":"8000000"}
    }"#;

    #[test]
    fn parses_ffprobe_json() {
        let i = parse(SAMPLE.as_bytes()).unwrap();
        let v = i.video.unwrap();
        assert_eq!((v.codec.as_str(), v.width, v.height, v.bit_depth, v.hdr), ("hevc", 3840, 2160, 10, true));
        assert!((v.fps.unwrap() - 23.976).abs() < 0.001);
        assert_eq!(i.audio.len(), 2);
        assert_eq!(i.audio[1].language.as_deref(), Some("ger"));
        assert_eq!(i.subtitles.iter().map(|s| s.bitmap).collect::<Vec<_>>(), vec![false, true]);
        assert_eq!(i.duration, Some(1320.5));
        assert_eq!(i.chapters, 2);
    }

    #[test]
    fn finds_subtitle_files_next_to_the_video() {
        let d = tempfile::tempdir().unwrap();
        let v = d.path().join("Show.S01E01.[1080p].mkv");
        for f in ["Show.S01E01.[1080p].mkv", "Show.S01E01.[1080p].srt", "Show.S01E01.[1080p].de.srt", "Show.S01E01.[1080p].eng.forced.ass", "Show.S01E02.[1080p].srt", "Show.S01E01.[1080p].txt"] {
            std::fs::write(d.path().join(f), "x").unwrap();
        }
        let subs = find_external_subs(&v);
        let names: Vec<_> = subs.iter().map(|s| (s.path.file_name().unwrap().to_string_lossy().into_owned(), s.language.clone(), s.codec.clone())).collect();
        assert_eq!(names, vec![
            ("Show.S01E01.[1080p].de.srt".into(), Some("ger".into()), "subrip".into()),
            ("Show.S01E01.[1080p].eng.forced.ass".into(), Some("eng".into()), "ass".into()),
            ("Show.S01E01.[1080p].srt".into(), None, "subrip".into()),
        ]);
    }

    #[test]
    fn tolerates_missing_fields() {
        let i = parse(br#"{"streams":[{"codec_type":"audio","codec_name":"mp3"}],"format":{"duration":"N/A"}}"#).unwrap();
        assert!(i.video.is_none());
        assert_eq!(i.duration, None);
        assert_eq!(rate(&Some("0/0".into())), None);
    }
}
