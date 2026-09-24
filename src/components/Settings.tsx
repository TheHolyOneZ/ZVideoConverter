import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, Compass, Cpu, Download, Eye, FolderPlus, FolderSearch, Gauge, Globe, RefreshCw, Settings as Cog, Trash2, XCircle } from "./icons";
import clsx from "clsx";
import { LOCALES, useT } from "../lib/i18n";
import { codecLabel, FAMILY_LABELS } from "../lib/format";
import { useHwStore } from "../store/useHwStore";
import { useSettingsStore, type ThemePref, type WatchFolder } from "../store/useSettingsStore";
import { profileName, useProfileStore } from "../store/useProfileStore";
import { api, type OriginalAction } from "../lib/tauri";
import { Modal, Row, Select, Seg, Switch } from "./ui";
import { FfmpegSetup } from "./FfmpegSetup";
import { startTour } from "./Onboarding";

export type SettingsTab = "general" | "hardware" | "watch" | "ffmpeg";

export function Settings({ open, tab, onTab, onClose }: { open: boolean; tab: SettingsTab; onTab: (t: SettingsTab) => void; onClose: () => void }) {
  const t = useT();
  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: t("settings.general"), icon: <Globe size={14} /> },
    { id: "hardware", label: t("settings.hardware"), icon: <Gauge size={14} /> },
    { id: "watch", label: t("watch.tab"), icon: <Eye size={14} /> },
    { id: "ffmpeg", label: "ffmpeg", icon: <Cpu size={14} /> },
  ];
  return (
    <Modal open={open} onClose={onClose} title={t("settings.title")} icon={<Cog size={16} />} width={760}>
      <div className="flex h-[520px]">
        <nav className="w-[180px] shrink-0 p-3 flex flex-col gap-1" style={{ borderRight: "1px solid var(--line)" }}>
          {tabs.map((x) => (
            <button
              key={x.id}
              className="flex items-center gap-2 h-9 px-3 rounded-[5px] text-[12.5px] font-semibold text-left"
              style={{ background: tab === x.id ? "var(--raised-2)" : "transparent", color: tab === x.id ? "var(--text)" : "var(--text-2)", border: "none" }}
              onClick={() => onTab(x.id)}
            >
              {x.icon}
              {x.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 px-6 py-4 overflow-y-auto">
          {tab === "general" && <General />}
          {tab === "hardware" && <Hardware />}
          {tab === "watch" && <WatchFolders />}
          {tab === "ffmpeg" && <Ffmpeg />}
        </div>
      </div>
    </Modal>
  );
}

function General() {
  const t = useT();
  const s = useSettingsStore();
  return (
    <>
      <Row label={t("settings.language")} hint={t("settings.languageHint")}>
        <div style={{ width: 200 }}>
          <Select
            value={s.locale}
            onChange={(v) => s.set({ locale: v })}
            options={[{ value: "system", label: t("settings.systemLanguage") }, ...LOCALES.map((l) => ({ value: l.code, label: l.name === l.english ? l.name : `${l.name} · ${l.english}` }))]}
          />
        </div>
      </Row>
      <Row label={t("settings.theme")}>
        <Seg<ThemePref>
          value={s.theme}
          onChange={(v) => s.set({ theme: v })}
          options={[
            { value: "dark", label: t("settings.dark") },
            { value: "light", label: t("settings.light") },
            { value: "system", label: t("settings.system") },
          ]}
        />
      </Row>
      <Row label={t("settings.intro")} hint={t("settings.introHint")}>
        <Switch on={s.showIntro} onChange={(v) => s.set({ showIntro: v })} />
      </Row>
      <Row label={t("tour.again")} hint={t("tour.againHint")}>
        <button className="btn btn-sm" onClick={startTour}>
          <Compass size={13} />
          {t("tour.take")}
        </button>
      </Row>
      <div className="h-px my-2" style={{ background: "var(--line)" }} />
      <Row label={t("settings.sound")} hint={t("settings.soundHint")}>
        <Switch on={s.soundWhenDone} onChange={(v) => s.set({ soundWhenDone: v })} />
      </Row>
      <Row label={t("settings.openFolder")} hint={t("settings.openFolderHint")}>
        <Switch on={s.openFolderWhenDone} onChange={(v) => s.set({ openFolderWhenDone: v })} />
      </Row>
      <Row label={t("update.setting")} hint={t("update.settingHint")}>
        <Switch on={s.checkUpdates} onChange={(v) => s.set({ checkUpdates: v })} />
      </Row>
      <div className="h-px my-2" style={{ background: "var(--line)" }} />
      <div className="label-quiet mt-3 mb-1">{t("settings.afterConvert")}</div>
      <Row label={t("settings.keepDates")} hint={t("settings.keepDatesHint")}>
        <Switch on={s.keepDates} onChange={(v) => s.set({ keepDates: v })} />
      </Row>
      <Row label={t("settings.originals")} hint={t(`settings.originals.${s.originalAction}Hint`)} stack>
        <Seg<OriginalAction>
          full
          value={s.originalAction}
          onChange={(v) => s.set({ originalAction: v })}
          options={[
            { value: "keep", label: t("settings.originals.keep") },
            { value: "trash", label: t("settings.originals.trash") },
            { value: "delete", label: t("settings.originals.delete") },
          ]}
        />
      </Row>
    </>
  );
}

function Hardware() {
  const t = useT();
  const s = useSettingsStore();
  const { hw, detecting, detect, app } = useHwStore();
  const families = ["nvenc", "amf", "vaapi", "qsv"] as const;
  const codecs = ["h264", "hevc", "av1", "vp9"] as const;
  return (
    <>
      <Row label={t("settings.parallel")} hint={t("settings.parallelHint")}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            className="range"
            style={{ width: 150, ["--v" as string]: `${((s.parallel - 1) / 7) * 100}%` }}
            min={1}
            max={8}
            value={s.parallel}
            onChange={(e) => {
              const n = Number(e.target.value);
              s.set({ parallel: n });
              api.setParallel(n).catch(() => {});
            }}
          />
          <span className="w-5 text-[15px] font-medium tnum">{s.parallel}</span>
        </div>
      </Row>
      <Row label={t("settings.hwDecode")} hint={t("settings.hwDecodeHint")}>
        <Switch on={s.hwDecode} onChange={(v) => s.set({ hwDecode: v })} />
      </Row>
      <Row label={t("settings.lowPriority")} hint={t("settings.lowPriorityHint")}>
        <Switch on={s.lowPriority} onChange={(v) => s.set({ lowPriority: v })} />
      </Row>
      {app && !app.canSuspend && <div className="text-[11.5px] mt-1" style={{ color: "var(--text-3)" }}>{t("settings.pauseNote")}</div>}

      <div className="flex items-center justify-between mt-5 mb-2">
        <span className="label">{t("settings.detected")}</span>
        <button className="btn btn-sm" onClick={() => detect(true)} disabled={detecting}>
          <RefreshCw size={13} className={clsx(detecting && "animate-spin")} />
          {detecting ? t("settings.detecting") : t("settings.redetect")}
        </button>
      </div>
      {!hw ? (
        <div className="text-[12px]" style={{ color: "var(--text-3)" }}>{detecting ? t("settings.detecting") : t("hw.unknown")}</div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {hw.gpus.length === 0 && <div className="text-[12px]" style={{ color: "var(--text-3)" }}>{t("settings.noGpu")}</div>}
            {hw.gpus.map((g, i) => (
              <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-[5px]" style={{ background: "var(--input)", border: "1px solid var(--line)" }}>
                <span className="tag tag-info uppercase">{g.vendor}</span>
                <span className="text-[12.5px] font-semibold truncate flex-1">{g.name}</span>
                {g.renderNode && <span className="mono text-[11px]" style={{ color: "var(--text-3)" }}>{g.renderNode}</span>}
              </div>
            ))}
          </div>
          <div className="mt-4 text-[11.5px] mb-2" style={{ color: "var(--text-3)" }}>{t("settings.matrixHint")}</div>
          <table className="w-full text-[12px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="text-left font-semibold py-1.5" style={{ color: "var(--text-3)" }} />
                {codecs.map((c) => (
                  <th key={c} className="font-medium py-1.5" style={{ color: "var(--text-2)" }}>{codecLabel(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="py-2 font-semibold">{FAMILY_LABELS[f]}</td>
                  {codecs.map((c) => {
                    const e = hw.encoders.find((x) => x.family === f && x.codec === c);
                    return (
                      <td key={c} className="text-center py-2" title={e ? (e.working ? e.name : `${e.name}: ${e.error ?? ""}`) : t("settings.notBuilt")}>
                        {!e ? (
                          <span style={{ color: "var(--text-3)" }}>–</span>
                        ) : e.working ? (
                          <CheckCircle2 size={16} className="inline" style={{ color: "var(--ok)" }} />
                        ) : (
                          <XCircle size={16} className="inline" style={{ color: "var(--text-3)" }} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="py-2 font-semibold">CPU</td>
                {codecs.map((c) => {
                  const names = { h264: ["libx264"], hevc: ["libx265"], av1: ["libsvtav1", "libaom-av1"], vp9: ["libvpx-vp9"] }[c];
                  const ok = names.find((n) => hw.cpuEncoders.includes(n));
                  return (
                    <td key={c} className="text-center py-2" title={ok ?? t("settings.notBuilt")}>
                      {ok ? <CheckCircle2 size={16} className="inline" style={{ color: "var(--text-2)" }} /> : <span style={{ color: "var(--text-3)" }}>–</span>}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className={clsx("tag", hw.hasZscale ? "tag-ok" : "tag-warn")}>{t("settings.tonemapping")}</span>
            <span className={clsx("tag", hw.hasSubtitlesFilter ? "tag-ok" : "tag-warn")}>{t("settings.subtitleBurn")}</span>
          </div>
        </>
      )}
    </>
  );
}

function WatchFolders() {
  const t = useT();
  const { watchFolders, defaultProfileId, set } = useSettingsStore();
  const profiles = useProfileStore((s) => s.profiles);
  const update = (id: string, patch: Partial<WatchFolder>) => set({ watchFolders: watchFolders.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const add = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== "string" || watchFolders.some((f) => f.path === dir)) return;
    set({ watchFolders: [...watchFolders, { id: `w${Date.now().toString(36)}`, path: dir, profileId: defaultProfileId, enabled: true }] });
  };
  return (
    <>
      <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>{t("watch.intro")}</div>
      <div className="flex flex-col gap-2 mt-4">
        {watchFolders.length === 0 && (
          <div className="text-[12px] p-4 rounded-[5px] text-center" style={{ color: "var(--text-3)", border: "1px dashed var(--line-strong)" }}>{t("watch.none")}</div>
        )}
        {watchFolders.map((f) => (
          <div key={f.id} className="flex items-center gap-2.5 p-2.5 rounded-[5px]" style={{ background: "var(--input)", border: "1px solid var(--line)" }}>
            <Switch on={f.enabled} onChange={(v) => update(f.id, { enabled: v })} label={t("watch.enabled")} />
            <div className="min-w-0 flex-1">
              <div className="mono text-[11.5px] truncate" title={f.path}>{f.path}</div>
            </div>
            <div style={{ width: 170 }}>
              <Select
                value={f.profileId}
                onChange={(v) => update(f.id, { profileId: v })}
                ariaLabel={t("watch.profile")}
                options={profiles.map((p) => ({ value: p.id, label: profileName(p) }))}
              />
            </div>
            <button className="btn btn-ghost btn-sm btn-icon" title={t("queue.remove")} aria-label={t("queue.remove")} onClick={() => set({ watchFolders: watchFolders.filter((x) => x.id !== f.id) })}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <button className="btn mt-3" onClick={add}>
        <FolderPlus size={14} />
        {t("watch.add")}
      </button>
      <div className="text-[11.5px] mt-4 leading-relaxed" style={{ color: "var(--text-3)" }}>{t("watch.note")}</div>
    </>
  );
}

function Ffmpeg() {
  const t = useT();
  const { ffmpeg, locate, detect } = useHwStore();
  const s = useSettingsStore();
  const [busy, setBusy] = useState(false);
  const recheck = async () => {
    setBusy(true);
    const found = await locate();
    if (found) await detect(false);
    setBusy(false);
  };
  const pick = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    s.set({ ffmpegPath: dir });
    await recheck();
  };
  return (
    <>
      {ffmpeg ? (
        <div className="p-3.5 rounded-[5px]" style={{ background: "var(--input)", border: "1px solid var(--line)" }}>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} style={{ color: "var(--ok)" }} />
            <span className="text-[13px] font-medium">{t("ffmpeg.found", { version: ffmpeg.version })}</span>
            <span className="tag ml-auto">{t(`ffmpeg.source.${ffmpeg.source}`)}</span>
          </div>
          <div className="mono text-[11.5px] mt-2 break-all" style={{ color: "var(--text-3)" }}>{ffmpeg.ffmpeg}</div>
          <div className="mono text-[11.5px] break-all" style={{ color: "var(--text-3)" }}>{ffmpeg.ffprobe}</div>
        </div>
      ) : ffmpeg === null ? (
        <FfmpegSetup compact />
      ) : (
        <div className="text-[12px]" style={{ color: "var(--text-3)" }}>{t("hw.checking")}</div>
      )}
      <Row label={t("ffmpeg.customPath")} hint={t("ffmpeg.customPathHint")} stack>
        <div className="flex gap-2">
          <input className="field mono text-[12px]" value={s.ffmpegPath} placeholder={t("ffmpeg.auto")} onChange={(e) => s.set({ ffmpegPath: e.target.value })} onBlur={recheck} />
          <button className="btn shrink-0" onClick={pick}>
            <FolderSearch size={14} />
            {t("common.browse")}
          </button>
          {s.ffmpegPath && (
            <button className="btn btn-ghost shrink-0" onClick={() => { s.set({ ffmpegPath: "" }); recheck(); }}>
              {t("common.reset")}
            </button>
          )}
        </div>
      </Row>
      <div className="flex gap-2 mt-3">
        <button className="btn" onClick={recheck} disabled={busy}>
          <RefreshCw size={14} className={clsx(busy && "animate-spin")} />
          {t("ffmpeg.lookAgain")}
        </button>
        {ffmpeg && ffmpeg.source !== "custom" && <UpdateButton />}
      </div>
      <div className="text-[11.5px] mt-4 leading-relaxed" style={{ color: "var(--text-3)" }}>{t("ffmpeg.license")}</div>
    </>
  );
}

function UpdateButton() {
  const t = useT();
  const { download, startDownload } = useHwStore();
  const p = download.progress;
  return (
    <button className="btn" onClick={startDownload} disabled={download.active} title={t("ffmpeg.updateHint")}>
      <Download size={14} />
      {download.active ? (p?.total ? `${Math.round((p.received / p.total) * 100)}%` : t(`ffmpeg.stage.${p?.stage ?? "downloading"}`)) : t("ffmpeg.downloadManaged")}
    </button>
  );
}
