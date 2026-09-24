import { useSyncExternalStore } from "react";
import en from "../locales/en.json";

export type Dict = typeof en;
type Vars = Record<string, string | number>;

type PluralBase<K extends string> = K extends `${infer B}_one` ? B : K extends `${infer B}_other` ? B : never;
export type TKey = Exclude<keyof Dict, "_meta"> | PluralBase<keyof Dict & string>;

interface Meta {
  name: string;
  english: string;
}

export interface LocaleInfo extends Meta {
  code: string;
}

const modules = import.meta.glob<{ default: Record<string, unknown> }>("../locales/*.json", { eager: true });

const DICTS: Record<string, Record<string, string>> = {};
export const LOCALES: LocaleInfo[] = [];

for (const [path, mod] of Object.entries(modules)) {
  const code = path.split("/").pop()!.replace(/\.json$/, "");
  const data = mod.default as Record<string, unknown> & { _meta?: Meta };
  const strings: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (k !== "_meta" && typeof v === "string") strings[k] = v;
  DICTS[code] = strings;
  LOCALES.push({ code, name: data._meta?.name ?? code, english: data._meta?.english ?? code });
}
LOCALES.sort((a, b) => (a.code === "en" ? -1 : b.code === "en" ? 1 : a.english.localeCompare(b.english)));

export const FALLBACK = "en";
export type LocalePref = string;

export function resolveLocale(pref: LocalePref): string {
  if (pref !== "system" && DICTS[pref]) return pref;
  if (pref === "system") {
    for (const lang of navigator.languages ?? [navigator.language]) {
      const l = lang.toLowerCase();
      const exact = LOCALES.find((x) => x.code.toLowerCase() === l);
      if (exact) return exact.code;
      const base = LOCALES.find((x) => x.code.toLowerCase() === l.split("-")[0]);
      if (base) return base.code;
    }
  }
  return FALLBACK;
}

let current = FALLBACK;
let plural = new Intl.PluralRules(current);
const listeners = new Set<() => void>();

export function setLocale(pref: LocalePref) {
  const next = resolveLocale(pref);
  if (next === current) return;
  current = next;
  plural = new Intl.PluralRules(current);
  document.documentElement.lang = current;
  listeners.forEach((l) => l());
}

export function getLocale() {
  return current;
}

function lookup(key: string): string | undefined {
  return DICTS[current]?.[key] ?? DICTS[FALLBACK]?.[key];
}

function interpolate(s: string, vars?: Vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function t(key: TKey | (string & {}), vars?: Vars): string {
  if (vars && typeof vars.count === "number") {
    const cat = plural.select(vars.count);
    const s = lookup(`${key}_${cat}`) ?? lookup(`${key}_other`);
    if (s) return interpolate(s, vars);
  }
  const s = lookup(key);
  return s === undefined ? key : interpolate(s, vars);
}

export function tMaybe(key: string, vars?: Vars): string | undefined {
  const s = lookup(key);
  return s === undefined ? undefined : interpolate(s, vars);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useT() {
  useSyncExternalStore(subscribe, getLocale);
  return t;
}
