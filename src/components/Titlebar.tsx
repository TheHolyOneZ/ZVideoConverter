import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { Command, Copy, Eye, Gpu, Info, Minus, Moon, Settings, Square, Sun, X } from "./icons";
import { useT } from "../lib/i18n";
import { FAMILY_LABELS } from "../lib/format";
import { gpuShortName, useHwStore } from "../store/useHwStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { Logo } from "./Logo";

interface Props {
  onSettings: (tab?: string) => void;
  onAbout: () => void;
  onPalette: () => void;
}

export function Titlebar({ onSettings, onAbout, onPalette }: Props) {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  const setSettings = useSettingsStore((s) => s.set);
  useSettingsStore((s) => s.theme);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const un = win.onResized(async () => {
      try {
        setMaximized(await win.isMaximized());
      } catch {
      }
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

  const win = getCurrentWindow();
  const dark = document.documentElement.dataset.theme !== "light";

  return (
    <header
      data-tauri-drag-region
      className="flex items-center h-10 pl-3 pr-1 gap-2 shrink-0 select-none"
      style={{ background: "var(--bg)", borderBottom: "1px solid var(--line)" }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        win.toggleMaximize().catch(() => {});
      }}
    >
      <div className="flex items-center gap-2 pointer-events-none">
        <Logo size={20} />
        <span className="text-[13px] font-semibold tracking-[-0.01em]">ZVideoConverter</span>
      </div>

      <span className="w-px h-4 mx-2" style={{ background: "var(--line-strong)" }} />
      <GpuStatus onClick={() => onSettings("hardware")} />
      <WatchStatus onClick={() => onSettings("watch")} />
      <UpdateLink onClick={onAbout} />

      <div className="flex-1 h-full" data-tauri-drag-region />

      <button className="btn btn-ghost btn-sm gap-2" onClick={onPalette} title={t("palette.title")}>
        <Command size={14} />
        <span>{t("palette.open")}</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <button
        className="btn btn-ghost btn-sm btn-icon"
        title={t("settings.theme")}
        aria-label={t("settings.theme")}
        onClick={() => setSettings({ theme: dark ? "light" : "dark" })}
      >
        {dark ? <Sun size={14} /> : <Moon size={14} />}
      </button>
      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onSettings()} title={t("settings.title")} aria-label={t("settings.title")}>
        <Settings size={14} />
      </button>
      <button className="btn btn-ghost btn-sm btn-icon" onClick={onAbout} title={t("about.title")} aria-label={t("about.title")}>
        <Info size={14} />
      </button>

      <div className="flex items-center ml-2 h-full">
        <WinBtn label={t("window.minimize")} onClick={() => win.minimize()}>
          <Minus size={14} />
        </WinBtn>
        <WinBtn label={maximized ? t("window.restore") : t("window.maximize")} onClick={() => win.toggleMaximize()}>
          {maximized ? <Copy size={12} /> : <Square size={11} fill="none" />}
        </WinBtn>
        <WinBtn label={t("window.close")} danger onClick={() => win.close()}>
          <X size={14} />
        </WinBtn>
      </div>
    </header>
  );
}

function WinBtn({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className="grid place-items-center w-10 h-full transition-colors"
      style={{ color: "var(--text-2)", background: "transparent", border: "none" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "#D93A26" : "var(--hover)";
        e.currentTarget.style.color = danger ? "#fff" : "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-2)";
      }}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function GpuStatus({ onClick }: { onClick: () => void }) {
  const t = useT();
  const { ffmpeg, hw, detecting } = useHwStore();
  let color = "var(--text-3)";
  let label = t("hw.checking");
  let sub = "";
  if (ffmpeg === null) {
    color = "var(--err)";
    label = t("hw.noFfmpeg");
  } else if (hw) {
    const families = [...new Set(hw.encoders.filter((e) => e.working).map((e) => e.family))];
    const gpu = hw.gpus.find((g) => g.vendor !== "other") ?? hw.gpus[0];
    if (families.length) {
      color = "var(--ok)";
      label = gpu ? gpuShortName(gpu.name) : t("hw.gpu");
      sub = families.map((f) => FAMILY_LABELS[f]).join(" · ");
    } else {
      color = "var(--warn)";
      label = t("hw.cpuOnly");
    }
  } else if (!detecting && ffmpeg) {
    color = "var(--warn)";
    label = t("hw.unknown");
  }
  return (
    <button className="btn btn-ghost btn-sm gap-2 min-w-0 !px-2" onClick={onClick} title={t("hw.badgeTitle")} data-tour="gpu">
      <Gpu size={15} style={{ color }} />
      <span className="truncate" style={{ color: "var(--text)" }}>{label}</span>
      {sub && <span className="mono text-[11px] truncate" style={{ color: "var(--text-3)" }}>{sub}</span>}
      {(detecting || ffmpeg === undefined) && <span className="w-1.5 h-1.5" style={{ background: color, animation: "blink 1s infinite" }} />}
    </button>
  );
}

function WatchStatus({ onClick }: { onClick: () => void }) {
  const t = useT();
  const count = useSettingsStore((s) => s.watchFolders.filter((f) => f.enabled).length);
  if (!count) return null;
  return (
    <button className="btn btn-ghost btn-sm gap-2 !px-2" onClick={onClick} title={t("watch.tab")}>
      <Eye size={14} style={{ color: "var(--accent)" }} />
      <span>{t("watch.active", { count })}</span>
    </button>
  );
}

function UpdateLink({ onClick }: { onClick: () => void }) {
  const t = useT();
  const update = useHwStore((s) => s.update);
  if (!update) return null;
  return (
    <button className="btn btn-outline-accent btn-sm" onClick={onClick}>
      {t("update.available", { version: update.version })}
    </button>
  );
}
