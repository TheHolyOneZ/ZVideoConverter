import { create } from "zustand";
import { setLocale } from "../lib/i18n";
import type { NamingOptions, OriginalAction } from "../lib/tauri";

export type ThemePref = "dark" | "light" | "system";

export interface Settings {
  locale: string;
  theme: ThemePref;
  parallel: number;
  hwDecode: boolean;
  ffmpegPath: string;
  naming: NamingOptions;
  defaultProfileId: string;
  openFolderWhenDone: boolean;
  soundWhenDone: boolean;
  keepDates: boolean;
  originalAction: OriginalAction;
  lowPriority: boolean;
  watchFolders: WatchFolder[];
  checkUpdates: boolean;
  lastUpdateCheck: number;
  showIntro: boolean;
  onboarded: boolean;
  collapsedGroups: string[];
  inspectorCollapsed: boolean;
}

export interface WatchFolder {
  id: string;
  path: string;
  profileId: string;
  enabled: boolean;
}

const KEY = "zvc.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  locale: "en",
  theme: "dark",
  parallel: 2,
  hwDecode: true,
  ffmpegPath: "",
  naming: {
    template: "{name}",
    location: { kind: "sameAsSource" },
    keepStructure: true,
    collision: "suffix",
  },
  defaultProfileId: "builtin.mp4-h264",
  openFolderWhenDone: false,
  soundWhenDone: true,
  keepDates: true,
  originalAction: "keep",
  lowPriority: true,
  watchFolders: [],
  checkUpdates: true,
  lastUpdateCheck: 0,
  showIntro: true,
  onboarded: false,
  collapsedGroups: [],
  inspectorCollapsed: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed, naming: { ...DEFAULT_SETTINGS.naming, ...parsed.naming } };
    }
  } catch {
  }
  return DEFAULT_SETTINGS;
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  setNaming: (patch: Partial<NamingOptions>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    persist(get());
    if (patch.theme) applyTheme(patch.theme);
    if (patch.locale) setLocale(patch.locale);
  },
  setNaming: (patch) => get().set({ naming: { ...get().naming, ...patch } }),
}));

function persist(s: SettingsState) {
  const { set: _s, setNaming: _n, ...data } = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
  }
}

const media = window.matchMedia?.("(prefers-color-scheme: light)");

export function applyTheme(pref: ThemePref) {
  const resolved = pref === "system" ? (media?.matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = resolved;
}

export function initSettings() {
  const s = useSettingsStore.getState();
  applyTheme(s.theme);
  setLocale(s.locale);
  media?.addEventListener?.("change", () => {
    if (useSettingsStore.getState().theme === "system") applyTheme("system");
  });
}
