import { getLocale } from "./i18n";
import type { JobOptions, MediaInfo } from "./tauri";

export const COMMON_LANGUAGES: [string, string][] = [
  ["ger", "de"], ["eng", "en"], ["fre", "fr"], ["spa", "es"], ["ita", "it"], ["por", "pt"], ["dut", "nl"],
  ["pol", "pl"], ["rus", "ru"], ["ukr", "uk"], ["cze", "cs"], ["hun", "hu"], ["tur", "tr"], ["swe", "sv"],
  ["dan", "da"], ["nor", "no"], ["fin", "fi"], ["gre", "el"], ["jpn", "ja"], ["kor", "ko"], ["chi", "zh"],
  ["ara", "ar"], ["heb", "he"], ["hin", "hi"], ["tha", "th"], ["vie", "vi"],
];

const ALIASES: Record<string, string> = {
  deu: "ger", de: "ger", en: "eng", fra: "fre", fr: "fre", es: "spa", it: "ita", pt: "por", nld: "dut", nl: "dut",
  pl: "pol", ru: "rus", uk: "ukr", ces: "cze", cs: "cze", hu: "hun", tr: "tur", sv: "swe", da: "dan", no: "nor",
  nob: "nor", fi: "fin", ell: "gre", el: "gre", ja: "jpn", ko: "kor", zho: "chi", zh: "chi", ar: "ara", he: "heb",
  hi: "hin", th: "tha", vi: "vie",
};

export function normalizeLang(code: string): string {
  const c = code.trim().toLowerCase();
  return ALIASES[c] ?? c;
}

export function languageName(code: string | null | undefined): string {
  if (!code) return "";
  const canonical = normalizeLang(code);
  const two = COMMON_LANGUAGES.find(([c]) => c === canonical)?.[1] ?? (canonical.length === 2 ? canonical : null);
  if (!two) return code;
  try {
    return new Intl.DisplayNames([getLocale()], { type: "language" }).of(two) ?? code;
  } catch {
    return code;
  }
}

export interface SubSource {
  file: string | null;
  stream: number;
  codec: string;
  bitmap: boolean;
  language: string | null;
}

export function subtitleSources(media: MediaInfo, options: JobOptions): SubSource[] {
  const out: SubSource[] = media.subtitles.map((s, i) => ({ file: null, stream: i, codec: s.codec, bitmap: s.bitmap, language: s.language }));
  if (!options.skipExternalSubs) {
    for (const e of media.externalSubs ?? []) out.push({ file: e.path, stream: 0, codec: e.codec, bitmap: false, language: e.language });
  }
  for (const p of options.extraSubs ?? []) {
    if (out.some((s) => s.file === p)) continue;
    const parts = (p.split(/[\\/]/).pop() ?? "").split(".").slice(1, -1);
    const lang = parts.map(normalizeLang).find((x) => COMMON_LANGUAGES.some(([c]) => c === x)) ?? null;
    const ext = p.split(".").pop()?.toLowerCase();
    out.push({ file: p, stream: 0, codec: ext === "ass" || ext === "ssa" ? "ass" : ext === "vtt" ? "webvtt" : "subrip", bitmap: false, language: lang });
  }
  return out;
}
