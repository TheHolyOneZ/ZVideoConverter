import { create } from "zustand";
import { api, errorOf, type AppInfo, type DownloadProgress, type FfmpegInstall, type HwInfo } from "../lib/tauri";
import { useSettingsStore } from "./useSettingsStore";

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
}

interface HwState {
  update: UpdateInfo | null;
  checkForUpdate: (force?: boolean) => Promise<void>;
  app: AppInfo | null;
  ffmpeg: FfmpegInstall | null | undefined;
  hw: HwInfo | null;
  detecting: boolean;
  download: { active: boolean; progress: DownloadProgress | null; error: string | null };
  init: () => Promise<void>;
  locate: () => Promise<FfmpegInstall | null>;
  detect: (force?: boolean) => Promise<void>;
  startDownload: () => Promise<void>;
  cancelDownload: () => void;
}

export const useHwStore = create<HwState>((set, get) => ({
  app: null,
  update: null,
  checkForUpdate: async (force = false) => {
    const s = useSettingsStore.getState();
    if (!force && (!s.checkUpdates || Date.now() - s.lastUpdateCheck < 24 * 3600 * 1000)) return;
    s.set({ lastUpdateCheck: Date.now() });
    try {
      set({ update: await api.checkUpdate() });
    } catch {
    }
  },
  ffmpeg: undefined,
  hw: null,
  detecting: false,
  download: { active: false, progress: null, error: null },

  init: async () => {
    api.appInfo().then((app) => set({ app })).catch(() => {});
    get().checkForUpdate();
    const found = await get().locate();
    if (found) await get().detect(false);
  },

  locate: async () => {
    set({ ffmpeg: undefined });
    try {
      const found = await api.ffmpegStatus(useSettingsStore.getState().ffmpegPath || null);
      set({ ffmpeg: found, hw: found ? get().hw : null });
      return found;
    } catch {
      set({ ffmpeg: null });
      return null;
    }
  },

  detect: async (force = false) => {
    if (get().detecting) return;
    set({ detecting: true });
    try {
      set({ hw: await api.hwInfo(force) });
    } catch {
      set({ hw: null });
    } finally {
      set({ detecting: false });
    }
  },

  startDownload: async () => {
    set({ download: { active: true, progress: null, error: null } });
    try {
      const found = await api.ffmpegDownload((p) => set({ download: { ...get().download, progress: p } }));
      set({ ffmpeg: found, download: { active: false, progress: null, error: null } });
      await get().detect(true);
    } catch (e) {
      set({ download: { active: false, progress: null, error: errorOf(e).detail } });
    }
  },

  cancelDownload: () => {
    api.ffmpegDownloadCancel().catch(() => {});
  },
}));

export function gpuShortName(name: string): string {
  return name
    .replace(/^(AMD|NVIDIA|Intel)\s+/i, "")
    .replace(/\s*\/.*$/, "")
    .replace(/\(TM\)|\(R\)/g, "")
    .trim();
}
