import { getLocale } from "./i18n";

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0;
  return `${v.toLocaleString(getLocale(), { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[i]}`;
}

export function formatDuration(s: number | null | undefined): string {
  if (s == null || !isFinite(s) || s < 0) return "–";
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export function formatTimestamp(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "";
  const ms = Math.round((s % 1) * 1000);
  const base = formatDuration(Math.floor(s));
  return ms ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

export function parseTimestamp(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!s) return null;
  if (!/^[\d:.]+$/.test(s)) return null;
  const parts = s.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function resolutionLabel(w?: number, h?: number): string {
  if (!w || !h) return "";
  const short = Math.min(w, h);
  if (short >= 2100) return "4K";
  if (short >= 1400) return "1440p";
  return `${short}p`;
}

export function fileName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}

export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf(".");
  if (i <= 0) return [name, ""];
  return [name.slice(0, i), name.slice(i + 1)];
}

const CODEC_LABELS: Record<string, string> = {
  h264: "H.264",
  hevc: "HEVC",
  av1: "AV1",
  vp9: "VP9",
  vp8: "VP8",
  mpeg4: "MPEG-4",
  mpeg2video: "MPEG-2",
  prores: "ProRes",
  gif: "GIF",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC",
  alac: "ALAC",
  ac3: "AC-3",
  eac3: "E-AC-3",
  dts: "DTS",
  truehd: "TrueHD",
  pcm: "PCM",
};

export function codecLabel(c: string | null | undefined): string {
  if (!c) return "";
  if (c.startsWith("pcm_")) return "PCM";
  return CODEC_LABELS[c] ?? c.toUpperCase();
}

export const FAMILY_LABELS: Record<string, string> = {
  cpu: "CPU",
  nvenc: "NVENC",
  amf: "AMF",
  vaapi: "VA-API",
  qsv: "Quick Sync",
};
