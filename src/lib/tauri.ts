import { Channel, invoke } from "@tauri-apps/api/core";

export type Container = "mp4" | "mkv" | "webm" | "mov" | "avi" | "ts" | "gif" | "mp3" | "m4a" | "flac" | "opus" | "ogg" | "wav";
export type VideoCodec = "h264" | "hevc" | "av1" | "vp9" | "mpeg4" | "prores" | "gif";
export type AudioCodec = "aac" | "mp3" | "opus" | "vorbis" | "flac" | "alac" | "ac3" | "pcm";
export type StreamMode = "encode" | "copy" | "off";
export type EncoderPref = "auto" | "cpu" | "nvenc" | "amf" | "vaapi" | "qsv";
export type Family = "cpu" | "nvenc" | "amf" | "vaapi" | "qsv";
export type Speed = "fastest" | "fast" | "balanced" | "slow" | "slowest";
export type RateControl =
  | { kind: "quality"; value: number }
  | { kind: "cq"; value: number; maxKbps?: number | null }
  | { kind: "bitrate"; kbps: number; cbr?: boolean }
  | { kind: "targetSize"; mib: number };
export type Fit = "pad" | "crop" | "stretch";
export type Resolution =
  | { kind: "keep" }
  | { kind: "height"; value: number }
  | { kind: "maxEdge"; value: number }
  | { kind: "custom"; width: number; height: number; fit?: Fit };
export type Rotate = "none" | "cw90" | "cw180" | "cw270";
export type Crop = { kind: "off" } | { kind: "auto" } | { kind: "manual"; top: number; bottom: number; left: number; right: number };
export interface CropRect {
  width: number;
  height: number;
  x: number;
  y: number;
}
export type SubtitleMode = "copy" | "burn" | "off";
export type AudioTracks = "first" | "all";

export interface VideoSettings {
  mode: StreamMode;
  codec: VideoCodec;
  encoder: EncoderPref;
  rate: RateControl;
  speed: Speed;
  tenBit: boolean;
  resolution: Resolution;
  crop: Crop;
  fps: number | null;
  deinterlace: boolean;
  tonemap: boolean;
  rotate: Rotate;
  flipH: boolean;
  twoPass: boolean;
}

export interface AudioSettings {
  mode: StreamMode;
  codec: AudioCodec;
  bitrateKbps: number;
  channels: number | null;
  sampleRate: number | null;
  normalize: boolean;
  tracks: AudioTracks;
  languages: string[];
}

export interface Profile {
  version: number;
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  favourite: boolean;
  order: number;
  container: Container;
  video: VideoSettings;
  audio: AudioSettings;
  subtitles: SubtitleMode;
  subtitleLanguages: string[];
  keepMetadata: boolean;
  keepChapters: boolean;
  fastStart: boolean;
  gif: { fps: number; width: number };
  extraArgs: string;
}

export interface VideoStream {
  codec: string;
  width: number;
  height: number;
  fps: number | null;
  pixFmt: string;
  bitDepth: number;
  hdr: boolean;
  bitrate: number | null;
}
export interface AudioStream {
  codec: string;
  channels: number;
  sampleRate: number | null;
  language: string | null;
  title: string | null;
  bitrate: number | null;
}
export interface SubtitleStream {
  codec: string;
  language: string | null;
  title: string | null;
  bitmap: boolean;
}
export interface MediaInfo {
  format: string;
  duration: number | null;
  size: number;
  bitrate: number | null;
  video: VideoStream | null;
  audio: AudioStream[];
  subtitles: SubtitleStream[];
  chapters: number;
  externalSubs: ExternalSub[];
}

export interface ExternalSub {
  path: string;
  codec: string;
  language: string | null;
}

export interface JobOptions {
  trimStart: number | null;
  trimEnd: number | null;
  burnTrack: number;
  extraSubs: string[];
  skipExternalSubs: boolean;
  detectedCrop: CropRect | null;
  cropChecked: boolean;
}

export type OutputLocation = { kind: "sameAsSource" } | { kind: "folder"; path: string } | { kind: "subfolder"; name: string };
export type CollisionPolicy = "suffix" | "overwrite" | "skip";
export interface NamingOptions {
  template: string;
  location: OutputLocation;
  keepStructure: boolean;
  collision: CollisionPolicy;
}
export type NameStatus = "ok" | "suffixed" | "overwrites" | "skipped";

export type Vendor = "nvidia" | "amd" | "intel" | "other";
export interface Gpu {
  vendor: Vendor;
  name: string;
  renderNode: string | null;
}
export interface EncoderStatus {
  name: string;
  family: Family;
  codec: VideoCodec;
  working: boolean;
  error: string | null;
}
export interface HwInfo {
  ffmpegVersion: string;
  gpus: Gpu[];
  encoders: EncoderStatus[];
  cpuEncoders: string[];
  vaapiDevice: string | null;
  hasZscale: boolean;
  hasSubtitlesFilter: boolean;
}
export interface EncoderChoice {
  family: Family;
  name: string;
}

export interface FfmpegInstall {
  ffmpeg: string;
  ffprobe: string;
  source: "custom" | "managed" | "system";
  version: string;
}
export interface DownloadProgress {
  stage: "downloading" | "verifying" | "extracting";
  received: number;
  total: number | null;
}

export interface AppInfo {
  version: string;
  canSuspend: boolean;
  platform: string;
}

export interface ExpandedPath {
  path: string;
  root: string | null;
}

export interface JobInput {
  id: string;
  input: string;
  root: string | null;
  profile: Profile;
  media: MediaInfo;
  options: JobOptions;
}

export interface JobPreview {
  id: string;
  output: string;
  nameStatus: NameStatus;
  estimate: number | null;
  encoder: EncoderChoice | null;
  notes: string[];
  error: string | null;
  command: string | null;
}

export type OriginalAction = "keep" | "trash" | "delete";
export type OriginalFate = { kind: "trashed" } | { kind: "deleted" } | { kind: "kept"; reason: string; detail: string };

export interface PreviewResult {
  file: string;
  start: number;
  seconds: number;
  size: number;
  estimate: number;
  speed: number;
  encoder: EncoderChoice | null;
  fellBack: boolean;
}

export interface RunOptions {
  hwDecode: boolean;
  parallel: number;
  keepDates: boolean;
  original: OriginalAction;
  lowPriority: boolean;
}

export type Outcome =
  | { kind: "done"; output: string; size: number; fellBack: boolean; original: OriginalFate | null }
  | { kind: "failed"; error: string; log: string }
  | { kind: "cancelled" };

export type EngineEvent =
  | { type: "started"; id: string; pass: number; passes: number; fallback: boolean }
  | { type: "progress"; id: string; percent: number; fps: number; speed: number; eta: number | null; size: number; outTime: number }
  | { type: "fellBack"; id: string; reason: string }
  | { type: "finished"; id: string; outcome: Outcome; elapsed: number }
  | { type: "idle"; done: number; failed: number; cancelled: number };

export interface BackendError {
  code: string;
  detail: string;
}

export const ENGINE_EVENT = "zvc://engine";
export const OPEN_EVENT = "zvc://open";
export const WATCH_EVENT = "zvc://watch";

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  startupPaths: () => invoke<string[]>("startup_paths"),
  ffmpegStatus: (customPath: string | null) => invoke<FfmpegInstall | null>("ffmpeg_status", { customPath }),
  ffmpegDownload: (onProgress: (p: DownloadProgress) => void) => {
    const ch = new Channel<DownloadProgress>();
    ch.onmessage = onProgress;
    return invoke<FfmpegInstall>("ffmpeg_download", { onProgress: ch });
  },
  ffmpegDownloadCancel: () => invoke<void>("ffmpeg_download_cancel"),
  hwInfo: (force: boolean) => invoke<HwInfo>("hw_info", { force }),
  expandPaths: (paths: string[]) => invoke<ExpandedPath[]>("expand_paths", { paths }),
  probeFile: (path: string) => invoke<MediaInfo>("probe_file", { path }),
  thumbnail: (path: string, duration: number | null) => invoke<string>("thumbnail", { path, duration }),
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  saveProfile: (profile: Profile) => invoke<Profile>("save_profile", { profile }),
  deleteProfile: (id: string) => invoke<void>("delete_profile", { id }),
  duplicateProfile: (id: string, name: string) => invoke<Profile>("duplicate_profile", { id, name }),
  reorderProfiles: (ids: string[]) => invoke<void>("reorder_profiles", { ids }),
  importProfile: (path: string) => invoke<Profile>("import_profile", { path }),
  exportProfile: (id: string, path: string) => invoke<void>("export_profile", { id, path }),
  profileWarnings: (profile: Profile) => invoke<{ code: string }[]>("profile_warnings", { profile }),
  previewJobs: (jobs: JobInput[], naming: NamingOptions) => invoke<JobPreview[]>("preview_jobs", { jobs, naming }),
  startJobs: (jobs: JobInput[], naming: NamingOptions, run: RunOptions) =>
    invoke<JobPreview[]>("start_jobs", { jobs, naming, run }),
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  cancelAll: () => invoke<void>("cancel_all"),
  setPaused: (paused: boolean) => invoke<void>("set_paused", { paused }),
  setParallel: (parallel: number) => invoke<void>("set_parallel", { parallel }),
  restoreOriginal: (path: string) => invoke<boolean>("restore_original", { path }),
  previewJob: (job: JobInput, hwDecode: boolean) => invoke<PreviewResult>("preview_job", { job, hwDecode }),
  saveSession: (data: string) => invoke<void>("save_session", { data }),
  loadSession: () => invoke<string | null>("load_session"),
  removePartials: (outputs: string[]) => invoke<number>("remove_partials", { outputs }),
  compareFrames: (source: string, sourceAt: number, output: string, outputAt: number) =>
    invoke<{ before: string; after: string }>("compare_frames", { source, sourceAt, output, outputAt }),
  setWatchFolders: (folders: { id: string; path: string }[]) => invoke<string[]>("set_watch_folders", { folders }),
  checkUpdate: () => invoke<{ version: string; url: string; notes: string } | null>("check_update"),
  makeSamples: () => invoke<string[]>("make_samples"),
  removeSamples: () => invoke<void>("remove_samples"),
  checkSpace: (needs: { dir: string; bytes: number }[]) => invoke<{ dir: string; needed: number; free: number }[]>("check_space", { needs }),
  powerAction: (action: "sleep" | "shutdown") => invoke<void>("power_action", { action }),
  detectCrop: (path: string, duration: number | null, width: number, height: number) =>
    invoke<CropRect | null>("detect_crop", { path, duration, width, height }),
};

export function errorOf(e: unknown): BackendError {
  if (e && typeof e === "object" && "code" in e) return e as BackendError;
  return { code: "unknown", detail: String(e) };
}
