import { useEffect, useMemo, useState } from "react";
import {
  CheckCheck,
  Code,
  Compass,
  Cpu,
  Eraser,
  FilePlus2,
  FolderPlus,
  Globe,
  Info,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings as Cog,
  Square,
  Trash2,
  Zap,
} from "./components/icons";
import { LOCALES, useT } from "./lib/i18n";
import { api } from "./lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import { About, LINKS } from "./components/About";
import { useHwStore } from "./store/useHwStore";
import { useProfileStore } from "./store/useProfileStore";
import { initQueue, restoreSession, useQueueStore } from "./store/useQueueStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { Titlebar } from "./components/Titlebar";
import { ResizeHandles } from "./components/ResizeHandles";
import { ProfileRail } from "./components/ProfileRail";
import { pickFiles, pickFolder, Queue } from "./components/Queue";
import { Inspector } from "./components/Inspector";
import { LaunchBar } from "./components/LaunchBar";
import { FfmpegSetup } from "./components/FfmpegSetup";
import { Settings, type SettingsTab } from "./components/Settings";
import { Toasts } from "./components/Toasts";
import { LogDrawer } from "./components/LogDrawer";
import { PowerCountdown } from "./components/PowerCountdown";
import { CompareView } from "./components/Compare";
import { DropOverlay } from "./components/DropOverlay";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { Splash } from "./components/Splash";
import { Onboarding, startTour, useTour } from "./components/Onboarding";

let startupHandled = false;

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el?.closest("input, textarea, [contenteditable='true']");
}

export default function App() {
  const inspectorCollapsed = useSettingsStore((s) => s.inspectorCollapsed);
  const t = useT();
  const ffmpeg = useHwStore((s) => s.ffmpeg);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [introDone, setIntroDone] = useState(() => !useSettingsStore.getState().showIntro);
  const touring = useTour((s) => s.active || s.welcome);

  useEffect(() => {
    useProfileStore.getState().load();
    useHwStore
      .getState()
      .init()
      .then(async () => {
        if (startupHandled) return;
        startupHandled = true;
        if (useHwStore.getState().ffmpeg) await restoreSession();
        const paths = await api.startupPaths();
        if (paths.length) await useQueueStore.getState().add(paths);
      })
      .catch(() => {})
      .finally(() => setBooted(true));
    const un = initQueue();
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (introDone && !useSettingsStore.getState().onboarded) useTour.getState().showWelcome();
  }, [introDone]);

  useEffect(() => {
    if (!touring) return;
    setSettingsOpen(false);
    setAboutOpen(false);
    setPaletteOpen(false);
  }, [touring]);

  const openSettings = (tab?: string) => {
    setSettingsTab((tab as SettingsTab) ?? "general");
    setSettingsOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const q = useQueueStore.getState();
      if (ctrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (ctrl && e.key.toLowerCase() === "o") {
        e.preventDefault();
        (e.shiftKey ? pickFolder : pickFiles)();
      } else if (ctrl && e.key === "Enter") {
        e.preventDefault();
        if (!q.running) q.start();
      } else if (ctrl && e.key === ",") {
        e.preventDefault();
        openSettings();
      } else if (isTyping(e) || settingsOpen || paletteOpen || aboutOpen || useTour.getState().welcome) {
        return;
      } else if (ctrl && e.key.toLowerCase() === "a") {
        e.preventDefault();
        q.selectAll();
      } else if (e.key === "Delete" && q.selected.length) {
        e.preventDefault();
        q.remove(q.selected);
      } else if (e.key === "Escape") {
        if (q.logJobId) q.setLogJob(null);
        else if (useProfileStore.getState().editingId) useProfileStore.getState().setEditing(null);
        else q.clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, paletteOpen, aboutOpen]);

  const actions = usePaletteActions(openSettings, () => setAboutOpen(true));

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg)" }}>
      <ResizeHandles />
      <Titlebar onSettings={openSettings} onAbout={() => setAboutOpen(true)} onPalette={() => setPaletteOpen(true)} />
      <main
        className="flex-1 min-h-0 grid"
        style={{
          gap: 1,
          background: "var(--line)",
          gridTemplateColumns: `clamp(250px, 18vw, 300px) minmax(0,1fr) ${inspectorCollapsed ? "40px" : "clamp(320px, 25vw, 410px)"}`,
          gridTemplateRows: "minmax(0,1fr) auto",
        }}
      >
        <ProfileRail />
        {ffmpeg === null ? (
          <section className="pane flex min-h-0">
            <FfmpegSetup />
          </section>
        ) : (
          <Queue />
        )}
        <Inspector />
        <div style={{ gridColumn: "1 / -1" }}>
          <LaunchBar />
        </div>
      </main>
      <Settings open={settingsOpen} tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsOpen(false)} />
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={actions} />
      <LogDrawer />
      <PowerCountdown />
      <CompareView />
      <Toasts />
      <DropOverlay />
      <Onboarding />
      {!introDone && <Splash ready={booted} onDone={() => setIntroDone(true)} />}
      <span className="sr-only">{t("app.name")}</span>
    </div>
  );
}

function usePaletteActions(openSettings: (tab?: string) => void, openAbout: () => void): PaletteAction[] {
  const t = useT();
  const profiles = useProfileStore((s) => s.profiles);
  const running = useQueueStore((s) => s.running);
  const locale = useSettingsStore((s) => s.locale);
  return useMemo(() => {
    const q = () => useQueueStore.getState();
    const s = () => useSettingsStore.getState();
    const gQueue = t("palette.groupQueue");
    const gProfiles = t("palette.groupProfiles");
    const gApp = t("palette.groupApp");
    const list: PaletteAction[] = [
      { id: "add-files", group: gQueue, label: t("queue.addFiles"), icon: <FilePlus2 size={14} />, hint: "Ctrl O", run: pickFiles },
      { id: "add-folder", group: gQueue, label: t("queue.addFolder"), icon: <FolderPlus size={14} />, hint: "Ctrl ⇧ O", run: pickFolder },
      running
        ? { id: "pause", group: gQueue, label: q().paused ? t("launch.resume") : t("launch.pause"), icon: <Pause size={14} />, run: () => q().togglePause() }
        : { id: "start", group: gQueue, label: t("launch.convert"), icon: <Play size={14} />, hint: "Ctrl ↵", run: () => q().start() },
      ...(running ? [{ id: "stop", group: gQueue, label: t("launch.stop"), icon: <Square size={14} />, run: () => q().stopAll() }] : []),
      { id: "select-all", group: gQueue, label: t("queue.selectAll"), icon: <CheckCheck size={14} />, hint: "Ctrl A", run: () => q().selectAll() },
      { id: "clear-finished", group: gQueue, label: t("queue.clearFinished"), icon: <Eraser size={14} />, run: () => q().clearFinished() },
      { id: "clear", group: gQueue, label: t("queue.clear"), icon: <Trash2 size={14} />, run: () => q().clear() },
      { id: "new-profile", group: gProfiles, label: t("profiles.new"), icon: <Plus size={14} />, run: () => useProfileStore.getState().create(useProfileStore.getState().byId(s().defaultProfileId)) },
      ...profiles.map((p) => ({
        id: `use-${p.id}`,
        group: gProfiles,
        label: t("palette.useProfile", { name: p.builtin ? t(`profile.${p.id.slice(8)}.name`) : p.name }),
        icon: <Zap size={14} />,
        run: () => {
          s().set({ defaultProfileId: p.id });
          const sel = q().selected;
          if (sel.length) q().setProfile(sel, p.id);
        },
      })),
      { id: "settings", group: gApp, label: t("settings.title"), icon: <Cog size={14} />, hint: "Ctrl ,", run: () => openSettings() },
      { id: "hardware", group: gApp, label: t("settings.hardware"), icon: <Cpu size={14} />, run: () => openSettings("hardware") },
      { id: "redetect", group: gApp, label: t("settings.redetect"), icon: <RefreshCw size={14} />, run: () => useHwStore.getState().detect(true) },
      { id: "theme", group: gApp, label: t("palette.toggleTheme"), icon: <Moon size={14} />, run: () => s().set({ theme: document.documentElement.dataset.theme === "light" ? "dark" : "light" }) },
      ...LOCALES.filter((l) => l.code !== locale).map((l) => ({
        id: `lang-${l.code}`,
        group: gApp,
        label: t("palette.language", { name: l.name }),
        icon: <Globe size={14} />,
        run: () => s().set({ locale: l.code }),
      })),
      { id: "tour", group: gApp, label: t("tour.take"), icon: <Compass size={14} />, run: startTour },
      { id: "about", group: gApp, label: t("about.title"), icon: <Info size={14} />, run: openAbout },
      { id: "website", group: gApp, label: t("palette.website"), icon: <Globe size={14} />, run: () => openUrl(LINKS.website).catch(() => {}) },
      { id: "source", group: gApp, label: t("palette.source"), icon: <Code size={14} />, run: () => openUrl(LINKS.source).catch(() => {}) },
    ];
    return list;
  }, [t, profiles, running, locale, openSettings, openAbout]);
}
