use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

pub const PROFILE_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Container {
    Mp4,
    Mkv,
    Webm,
    Mov,
    Avi,
    Ts,
    Gif,
    Mp3,
    M4a,
    Flac,
    Opus,
    Ogg,
    Wav,
}

impl Container {
    pub fn ext(self) -> &'static str {
        match self {
            Container::Mp4 => "mp4",
            Container::Mkv => "mkv",
            Container::Webm => "webm",
            Container::Mov => "mov",
            Container::Avi => "avi",
            Container::Ts => "ts",
            Container::Gif => "gif",
            Container::Mp3 => "mp3",
            Container::M4a => "m4a",
            Container::Flac => "flac",
            Container::Opus => "opus",
            Container::Ogg => "ogg",
            Container::Wav => "wav",
        }
    }

    pub fn muxer(self) -> &'static str {
        match self {
            Container::Mp4 => "mp4",
            Container::Mkv => "matroska",
            Container::Webm => "webm",
            Container::Mov => "mov",
            Container::Avi => "avi",
            Container::Ts => "mpegts",
            Container::Gif => "gif",
            Container::Mp3 => "mp3",
            Container::M4a => "ipod",
            Container::Flac => "flac",
            Container::Opus | Container::Ogg => "ogg",
            Container::Wav => "wav",
        }
    }

    pub fn is_audio_only(self) -> bool {
        matches!(
            self,
            Container::Mp3 | Container::M4a | Container::Flac | Container::Opus | Container::Ogg | Container::Wav
        )
    }

    pub fn video_codecs(self) -> &'static [VideoCodec] {
        use VideoCodec::*;
        match self {
            Container::Mp4 | Container::Mov => &[H264, Hevc, Av1, Vp9, Mpeg4, Prores],
            Container::Mkv => &[H264, Hevc, Av1, Vp9, Mpeg4, Prores],
            Container::Webm => &[Vp9, Av1],
            Container::Avi => &[H264, Mpeg4],
            Container::Ts => &[H264, Hevc],
            Container::Gif => &[Gif],
            _ => &[],
        }
    }

    pub fn audio_codecs(self) -> &'static [AudioCodec] {
        use AudioCodec::*;
        match self {
            Container::Mp4 | Container::Mov => &[Aac, Mp3, Ac3, Opus, Flac, Alac],
            Container::Mkv => &[Aac, Mp3, Ac3, Opus, Flac, Vorbis, Pcm, Alac],
            Container::Webm => &[Opus, Vorbis],
            Container::Avi => &[Mp3, Ac3, Pcm],
            Container::Ts => &[Aac, Mp3, Ac3],
            Container::Gif => &[],
            Container::Mp3 => &[Mp3],
            Container::M4a => &[Aac, Alac],
            Container::Flac => &[Flac],
            Container::Opus => &[Opus],
            Container::Ogg => &[Vorbis, Opus, Flac],
            Container::Wav => &[Pcm],
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum VideoCodec {
    H264,
    Hevc,
    Av1,
    Vp9,
    Mpeg4,
    Prores,
    Gif,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum AudioCodec {
    Aac,
    Mp3,
    Opus,
    Vorbis,
    Flac,
    Alac,
    Ac3,
    Pcm,
}

impl AudioCodec {
    pub fn lossless(self) -> bool {
        matches!(self, AudioCodec::Flac | AudioCodec::Alac | AudioCodec::Pcm)
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StreamMode {
    Encode,
    Copy,
    Off,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum EncoderPref {
    Auto,
    Cpu,
    Nvenc,
    Amf,
    Vaapi,
    Qsv,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Speed {
    Fastest,
    Fast,
    Balanced,
    Slow,
    Slowest,
}

impl Speed {
    pub fn index(self) -> usize {
        self as usize
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RateControl {
    Quality { value: u8 },
    Cq {
        value: u8,
        #[serde(default, rename = "maxKbps")]
        max_kbps: Option<u32>,
    },
    Bitrate {
        kbps: u32,
        #[serde(default)]
        cbr: bool,
    },
    TargetSize { mib: u32 },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Resolution {
    Keep,
    Height { value: u32 },
    MaxEdge { value: u32 },
    Custom {
        width: u32,
        height: u32,
        #[serde(default)]
        fit: Fit,
    },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    #[default]
    Pad,
    Crop,
    Stretch,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Crop {
    #[default]
    Off,
    Auto,
    Manual { top: u32, bottom: u32, left: u32, right: u32 },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Rotate {
    None,
    Cw90,
    Cw180,
    Cw270,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct VideoSettings {
    pub mode: StreamMode,
    pub codec: VideoCodec,
    pub encoder: EncoderPref,
    pub rate: RateControl,
    pub speed: Speed,
    pub ten_bit: bool,
    pub resolution: Resolution,
    pub crop: Crop,
    pub fps: Option<f64>,
    pub deinterlace: bool,
    pub tonemap: bool,
    pub rotate: Rotate,
    pub flip_h: bool,
    pub two_pass: bool,
}

impl Default for VideoSettings {
    fn default() -> Self {
        VideoSettings {
            mode: StreamMode::Encode,
            codec: VideoCodec::H264,
            encoder: EncoderPref::Auto,
            rate: RateControl::Quality { value: 70 },
            speed: Speed::Balanced,
            ten_bit: false,
            resolution: Resolution::Keep,
            crop: Crop::Off,
            fps: None,
            deinterlace: false,
            tonemap: true,
            rotate: Rotate::None,
            flip_h: false,
            two_pass: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioTracks {
    First,
    All,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioSettings {
    pub mode: StreamMode,
    pub codec: AudioCodec,
    pub bitrate_kbps: u32,
    pub channels: Option<u8>,
    pub sample_rate: Option<u32>,
    pub normalize: bool,
    pub tracks: AudioTracks,
    pub languages: Vec<String>,
}

impl Default for AudioSettings {
    fn default() -> Self {
        AudioSettings {
            mode: StreamMode::Encode,
            codec: AudioCodec::Aac,
            bitrate_kbps: 192,
            channels: None,
            sample_rate: None,
            normalize: false,
            tracks: AudioTracks::All,
            languages: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SubtitleMode {
    Copy,
    Burn,
    Off,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GifSettings {
    pub fps: u32,
    pub width: u32,
}

impl Default for GifSettings {
    fn default() -> Self {
        GifSettings { fps: 15, width: 480 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(skip_deserializing)]
    pub builtin: bool,
    pub favourite: bool,
    pub order: i32,
    pub container: Container,
    pub video: VideoSettings,
    pub audio: AudioSettings,
    pub subtitles: SubtitleMode,
    pub subtitle_languages: Vec<String>,
    pub keep_metadata: bool,
    pub keep_chapters: bool,
    pub fast_start: bool,
    pub gif: GifSettings,
    pub extra_args: String,
}

impl Default for Profile {
    fn default() -> Self {
        Profile {
            version: PROFILE_VERSION,
            id: String::new(),
            name: String::new(),
            description: String::new(),
            builtin: false,
            favourite: false,
            order: 0,
            container: Container::Mp4,
            video: VideoSettings::default(),
            audio: AudioSettings::default(),
            subtitles: SubtitleMode::Copy,
            subtitle_languages: Vec::new(),
            keep_metadata: true,
            keep_chapters: true,
            fast_start: true,
            gif: GifSettings::default(),
            extra_args: String::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileWarning {
    pub code: &'static str,
}

impl Profile {
    pub fn warnings(&self) -> Vec<ProfileWarning> {
        let mut w = Vec::new();
        let c = self.container;
        if !c.is_audio_only()
            && c != Container::Gif
            && self.video.mode == StreamMode::Encode
            && !c.video_codecs().contains(&self.video.codec)
        {
            w.push(ProfileWarning { code: "videoCodecContainer" });
        }
        if c != Container::Gif
            && self.audio.mode == StreamMode::Encode
            && !c.audio_codecs().contains(&self.audio.codec)
        {
            w.push(ProfileWarning { code: "audioCodecContainer" });
        }
        if c.is_audio_only() && self.audio.mode == StreamMode::Off {
            w.push(ProfileWarning { code: "nothingToEncode" });
        }
        if self.video.mode == StreamMode::Copy && self.subtitles == SubtitleMode::Burn {
            w.push(ProfileWarning { code: "burnNeedsEncode" });
        }
        if self.video.mode == StreamMode::Copy
            && (self.video.resolution != Resolution::Keep || self.video.fps.is_some() || self.video.crop != Crop::Off)
        {
            w.push(ProfileWarning { code: "filtersNeedEncode" });
        }
        w
    }

    pub fn normalize(&mut self) {
        self.version = PROFILE_VERSION;
        self.name = self.name.trim().to_string();
        match &mut self.video.rate {
            RateControl::Quality { value } => *value = (*value).min(100),
            RateControl::Cq { value, max_kbps } => {
                *value = (*value).min(51);
                if let Some(k) = max_kbps {
                    *k = (*k).clamp(50, 500_000);
                }
            }
            RateControl::Bitrate { kbps, .. } => *kbps = (*kbps).clamp(50, 500_000),
            RateControl::TargetSize { .. } => {}
        }
        if let Resolution::Custom { width, height, .. } = &mut self.video.resolution {
            *width = ((*width).clamp(16, 16384) / 2) * 2;
            *height = ((*height).clamp(16, 16384) / 2) * 2;
        }
        self.audio.bitrate_kbps = self.audio.bitrate_kbps.clamp(8, 1536);
        self.gif.fps = self.gif.fps.clamp(1, 60);
        self.gif.width = self.gif.width.clamp(16, 3840);
        let tidy = |v: &mut Vec<String>| {
            let mut seen = std::collections::HashSet::new();
            v.retain(|c| !c.trim().is_empty() && seen.insert(crate::lang::normalize(c)));
        };
        tidy(&mut self.audio.languages);
        tidy(&mut self.subtitle_languages);
    }
}

fn builtin(id: &str, name: &str, order: i32, f: impl FnOnce(&mut Profile)) -> Profile {
    let mut p = Profile {
        id: format!("builtin.{id}"),
        name: name.into(),
        builtin: true,
        order,
        ..Profile::default()
    };
    f(&mut p);
    p
}

pub fn builtins() -> Vec<Profile> {
    use AudioCodec as A;
    use Container as C;
    use VideoCodec as V;
    vec![
        builtin("mp4-h264", "MP4 · H.264", 0, |p| {
            p.description = "Plays everywhere. The safe default.".into();
        }),
        builtin("mp4-hevc", "MP4 · HEVC", 1, |p| {
            p.description = "About half the size of H.264 at the same quality.".into();
            p.video.codec = V::Hevc;
            p.video.rate = RateControl::Quality { value: 65 };
        }),
        builtin("mkv-hevc10", "MKV · HEVC 10-bit", 2, |p| {
            p.description = "Archive quality. Keeps every audio and subtitle track.".into();
            p.container = C::Mkv;
            p.video.codec = V::Hevc;
            p.video.ten_bit = true;
            p.video.tonemap = false;
            p.video.rate = RateControl::Quality { value: 75 };
            p.video.speed = Speed::Slow;
            p.audio.mode = StreamMode::Copy;
            p.fast_start = false;
        }),
        builtin("mp4-av1", "MP4 · AV1", 3, |p| {
            p.description = "Smallest files. Slower on the CPU, fast on new GPUs.".into();
            p.video.codec = V::Av1;
            p.video.rate = RateControl::Quality { value: 65 };
            p.audio.codec = A::Opus;
            p.audio.bitrate_kbps = 128;
        }),
        builtin("webm-vp9", "WebM · VP9", 4, |p| {
            p.description = "For the web. VP9 video with Opus audio.".into();
            p.container = C::Webm;
            p.video.codec = V::Vp9;
            p.video.rate = RateControl::Quality { value: 65 };
            p.audio.codec = A::Opus;
            p.audio.bitrate_kbps = 128;
            p.subtitles = SubtitleMode::Off;
            p.fast_start = false;
        }),
        builtin("share", "Shrink for sharing", 5, |p| {
            p.description = "720p H.264 under chat-app limits. Stereo AAC.".into();
            p.video.rate = RateControl::Quality { value: 50 };
            p.video.resolution = Resolution::MaxEdge { value: 1280 };
            p.audio.bitrate_kbps = 128;
            p.audio.channels = Some(2);
            p.audio.tracks = AudioTracks::First;
            p.subtitles = SubtitleMode::Off;
            p.keep_chapters = false;
        }),
        builtin("device", "Phone & TV", 6, |p| {
            p.description = "1080p H.264 + stereo AAC. Plays on anything with a screen.".into();
            p.video.resolution = Resolution::Height { value: 1080 };
            p.video.fps = None;
            p.audio.channels = Some(2);
            p.audio.tracks = AudioTracks::First;
            p.subtitles = SubtitleMode::Copy;
        }),
        builtin("remux-mkv", "Remux to MKV", 7, |p| {
            p.description = "Copies every stream as-is into MKV. Instant, lossless.".into();
            p.container = C::Mkv;
            p.video.mode = StreamMode::Copy;
            p.audio.mode = StreamMode::Copy;
            p.fast_start = false;
        }),
        builtin("remux-mp4", "Remux to MP4", 8, |p| {
            p.description = "Copies video and audio as-is into MP4. Instant, lossless.".into();
            p.video.mode = StreamMode::Copy;
            p.audio.mode = StreamMode::Copy;
        }),
        builtin("audio-mp3", "Audio · MP3", 9, |p| {
            p.description = "Extract the soundtrack as MP3.".into();
            p.container = C::Mp3;
            p.video.mode = StreamMode::Off;
            p.audio.codec = A::Mp3;
            p.audio.bitrate_kbps = 256;
            p.audio.tracks = AudioTracks::First;
            p.subtitles = SubtitleMode::Off;
            p.keep_chapters = false;
        }),
        builtin("audio-aac", "Audio · AAC (M4A)", 10, |p| {
            p.description = "Extract the soundtrack as AAC.".into();
            p.container = C::M4a;
            p.video.mode = StreamMode::Off;
            p.audio.bitrate_kbps = 256;
            p.audio.tracks = AudioTracks::First;
            p.subtitles = SubtitleMode::Off;
        }),
        builtin("audio-flac", "Audio · FLAC", 11, |p| {
            p.description = "Lossless soundtrack.".into();
            p.container = C::Flac;
            p.video.mode = StreamMode::Off;
            p.audio.codec = A::Flac;
            p.audio.tracks = AudioTracks::First;
            p.subtitles = SubtitleMode::Off;
            p.keep_chapters = false;
        }),
        builtin("audio-opus", "Audio · Opus", 12, |p| {
            p.description = "Best quality per byte for speech and music.".into();
            p.container = C::Opus;
            p.video.mode = StreamMode::Off;
            p.audio.codec = A::Opus;
            p.audio.bitrate_kbps = 160;
            p.audio.tracks = AudioTracks::First;
            p.subtitles = SubtitleMode::Off;
            p.keep_chapters = false;
        }),
        builtin("gif", "Animated GIF", 13, |p| {
            p.description = "Palette-optimised GIF, 480 px wide at 15 fps.".into();
            p.container = C::Gif;
            p.video.codec = V::Gif;
            p.video.encoder = EncoderPref::Cpu;
            p.audio.mode = StreamMode::Off;
            p.subtitles = SubtitleMode::Off;
            p.keep_metadata = false;
            p.keep_chapters = false;
        }),
    ]
}

pub struct ProfileStore {
    dir: PathBuf,
}

impl ProfileStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        ProfileStore { dir: dir.into() }
    }

    fn path_for(&self, id: &str) -> Result<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err(Error::InvalidProfile(format!("bad id {id:?}")));
        }
        Ok(self.dir.join(format!("{id}.json")))
    }

    pub fn list(&self) -> Vec<Profile> {
        let mut custom = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for e in entries.flatten() {
                let p = e.path();
                if p.extension().is_some_and(|x| x == "json") {
                    if let Ok(prof) = read_profile(&p) {
                        custom.push(prof);
                    }
                }
            }
        }
        custom.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.name.cmp(&b.name)));
        let mut all = builtins();
        all.extend(custom);
        all
    }

    pub fn get(&self, id: &str) -> Result<Profile> {
        if let Some(b) = builtins().into_iter().find(|p| p.id == id) {
            return Ok(b);
        }
        let path = self.path_for(id)?;
        if !path.exists() {
            return Err(Error::ProfileNotFound(id.into()));
        }
        read_profile(&path)
    }

    pub fn save(&self, mut profile: Profile) -> Result<Profile> {
        if profile.id.starts_with("builtin.") {
            return Err(Error::ProfileReadOnly);
        }
        if profile.name.trim().is_empty() {
            return Err(Error::InvalidProfile("empty name".into()));
        }
        if profile.id.is_empty() {
            profile.id = uuid::Uuid::new_v4().to_string();
            profile.order = self.list().iter().filter(|p| !p.builtin).map(|p| p.order + 1).max().unwrap_or(0);
        }
        profile.builtin = false;
        profile.normalize();
        fs::create_dir_all(&self.dir)?;
        let path = self.path_for(&profile.id)?;
        write_atomic(&path, &serde_json::to_vec_pretty(&profile)?)?;
        Ok(profile)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        if id.starts_with("builtin.") {
            return Err(Error::ProfileReadOnly);
        }
        let path = self.path_for(id)?;
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    pub fn duplicate(&self, id: &str, new_name: &str) -> Result<Profile> {
        let mut p = self.get(id)?;
        p.id = String::new();
        p.name = new_name.into();
        p.description = String::new();
        p.favourite = false;
        self.save(p)
    }

    pub fn reorder(&self, ids: &[String]) -> Result<()> {
        for (i, id) in ids.iter().enumerate() {
            if id.starts_with("builtin.") {
                continue;
            }
            let mut p = self.get(id)?;
            if p.order != i as i32 {
                p.order = i as i32;
                self.save(p)?;
            }
        }
        Ok(())
    }

    pub fn import(&self, file: &Path) -> Result<Profile> {
        let mut p = read_profile(file)?;
        p.id = String::new();
        self.save(p)
    }

    pub fn export(&self, id: &str, file: &Path) -> Result<()> {
        let mut p = self.get(id)?;
        p.builtin = false;
        write_atomic(file, &serde_json::to_vec_pretty(&p)?)?;
        Ok(())
    }
}

fn read_profile(path: &Path) -> Result<Profile> {
    let bytes = fs::read(path)?;
    let mut p: Profile = serde_json::from_slice(&bytes)?;
    if p.version > PROFILE_VERSION {
        return Err(Error::InvalidProfile(format!("made by a newer version ({})", p.version)));
    }
    p.normalize();
    Ok(p)
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_are_consistent() {
        let all = builtins();
        let mut ids: Vec<_> = all.iter().map(|p| &p.id).collect();
        ids.dedup();
        assert_eq!(ids.len(), all.len());
        for p in &all {
            assert!(p.warnings().is_empty(), "{} has warnings {:?}", p.id, p.warnings());
        }
    }

    #[test]
    fn crud_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path());
        let mut p = store.duplicate("builtin.mp4-hevc", "Mine").unwrap();
        assert!(!p.builtin && !p.id.is_empty());

        p.video.rate = RateControl::Quality { value: 90 };
        p.name = "Mine, edited".into();
        let saved = store.save(p.clone()).unwrap();
        assert_eq!(saved.id, p.id);
        let back = store.get(&p.id).unwrap();
        assert_eq!(back.name, "Mine, edited");
        assert_eq!(back.video.rate, RateControl::Quality { value: 90 });

        let old = r#"{"kind":"bitrate","kbps":4000}"#;
        assert_eq!(serde_json::from_str::<RateControl>(old).unwrap(), RateControl::Bitrate { kbps: 4000, cbr: false });
        let old = r#"{"kind":"custom","width":1280,"height":720}"#;
        assert_eq!(serde_json::from_str::<Resolution>(old).unwrap(), Resolution::Custom { width: 1280, height: 720, fit: Fit::Pad });
        let cq = RateControl::Cq { value: 20, max_kbps: Some(8000) };
        let json = serde_json::to_string(&cq).unwrap();
        assert_eq!(json, r#"{"kind":"cq","value":20,"maxKbps":8000}"#);
        assert_eq!(serde_json::from_str::<RateControl>(&json).unwrap(), cq);
        assert_eq!(store.list().iter().filter(|x| !x.builtin).count(), 1);

        let file = dir.path().join("export.json");
        store.export(&p.id, &file).unwrap();
        let imported = store.import(&file).unwrap();
        assert_ne!(imported.id, p.id);

        store.delete(&p.id).unwrap();
        assert!(store.get(&p.id).is_err());
        assert!(matches!(store.delete("builtin.gif"), Err(Error::ProfileReadOnly)));
        assert!(store.get("../etc/passwd").is_err());
    }

    #[test]
    fn old_files_with_missing_fields_load() {
        let p: Profile = serde_json::from_str(r#"{"id":"x","name":"Old","container":"mkv"}"#).unwrap();
        assert_eq!(p.container, Container::Mkv);
        assert_eq!(p.video.codec, VideoCodec::H264);
    }
}
