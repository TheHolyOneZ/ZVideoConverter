# Changelog

All notable changes to ZVideoConverter. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-25

Everything in this release comes from the first real-world testing.

### Added
- **Expected final size while converting**, next to the size written so far. It leans on the estimate at first and on the measured size as the file progresses.
- **Source bitrate** in the file list, next to resolution, codec, audio and size.
- **"ffmpeg command"** at the bottom of every settings tab: the exact command a file will run, ready to copy.
- **Collapsible profile groups**: "Favourites", "My profiles" and "Built-in" fold away with a click on their title.
- **Collapsible settings panel**: folds into a thin bar and opens again when you edit a profile. Both choices are remembered.
- A crash anywhere in the window now shows what happened and a Reload button instead of a black screen. The queue and profiles are kept.

### Changed
- **Size estimates start from the source's bitrate** and take the encoder that will really run into account. GPU encoders in CQ mode make much bigger files than x264/x265 at the same number (VA-API HEVC even bigger than VA-API H.264), which the old per-pixel estimate ignored: it could be five times too small on the GPU. Measured on real footage, the new estimate is usually within about ±40 %; the 10-second preview still measures exactly.
- **Profiles are read-only while conversions use them**, until those finish (duplicating still works).
- Every GPU encoder is now also tested for **constrained quality (QVBR)** at start-up. The hardware test runs again once after updating.

### Fixed
- Closing **"Compare with original"** crashed the interface and left a black window until the app was restarted.
- With a **bitrate ceiling** on a VA-API driver without QVBR (only CQP, CBR and VBR), the GPU encode failed and the whole file was redone on the CPU. The switch is now greyed out with an explanation on such drivers, and a profile that already has a ceiling encodes on the GPU with the CQ value alone (the log says so).
- The ceiling note now covers every encoder that can't cap the bitrate, not only AMF.

## [0.1.0] - 2026-09-24

First release.

### Added
- Bulk conversion of files and whole folders in one window, several files in parallel.
- GPU encoding with NVIDIA NVENC (with NVDEC/CUDA decoding), AMD AMF, VA-API and Intel Quick Sync, each tested with a real encode at start-up, with an automatic CPU fallback.
- H.264, HEVC, AV1, VP9, MPEG-4, ProRes and GIF; MP4, MKV, WebM, MOV, AVI, TS and six audio formats; 10-bit colour and HDR → SDR.
- Rate control: a quality slider, CRF/CQ values, constrained quality, CBR, VBR and target file size.
- Resolution presets from 480p to 8K (also for upright video) and exact sizes with black bars, crop or stretch.
- File names that stay intact, a naming template with tokens, and collisions shown before anything runs.
- 14 built-in profiles, editable profiles, per-file settings, import and export.
- 10-second preview encodes, a before/after comparison, watch folders, several outputs per file, subtitle and audio track handling, and safe handling of originals.
- One-click ffmpeg download with SHA-256 check, English and German, and a first-run tour.

[0.2.0]: https://github.com/TheHolyOneZ/ZVideoConverter/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TheHolyOneZ/ZVideoConverter/releases/tag/v0.1.0
