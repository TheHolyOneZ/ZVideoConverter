import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderSearch, RefreshCw, ShieldCheck, X } from "./icons";
import { useT } from "../lib/i18n";
import { formatBytes } from "../lib/format";
import { useHwStore } from "../store/useHwStore";
import { useSettingsStore } from "../store/useSettingsStore";

export function FfmpegSetup({ compact }: { compact?: boolean }) {
  const t = useT();
  const { download, startDownload, cancelDownload, locate, detect } = useHwStore();
  const setSettings = useSettingsStore((s) => s.set);
  const p = download.progress;
  const pct = p?.total ? (p.received / p.total) * 100 : null;

  const pick = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    setSettings({ ffmpegPath: dir });
    if (await locate()) await detect(false);
  };

  return (
    <div className={compact ? "" : "flex-1 grid place-items-center p-8"}>
      <div className={compact ? "p-4 rounded-[5px]" : "p-7 max-w-[520px] w-full rounded-[8px]"} style={compact ? { background: "var(--input)", border: "1px solid var(--line)" } : { background: "var(--pane-2)", border: "1px solid var(--line-strong)" }}>
        <div className="text-[17px] font-medium">{t("ffmpeg.missingTitle")}</div>
        <div className="text-[12.5px] mt-2 leading-relaxed" style={{ color: "var(--text-2)" }}>{t("ffmpeg.missingText")}</div>
        {download.active ? (
          <div className="mt-5">
            <div className="flex justify-between text-[12px] mb-1.5 tnum">
              <span className="font-semibold">{t(`ffmpeg.stage.${p?.stage ?? "downloading"}`)}</span>
              <span style={{ color: "var(--text-3)" }}>
                {p ? `${formatBytes(p.received)}${p.total ? ` / ${formatBytes(p.total)}` : ""}` : ""}
              </span>
            </div>
            <div className="bar" data-running="true">
              <i style={{ width: `${pct ?? (p?.stage === "downloading" ? 5 : 100)}%` }} />
            </div>
            <button className="btn btn-ghost btn-sm mt-3" onClick={cancelDownload}>
              <X size={13} />
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mt-5">
              <button className="btn btn-primary" onClick={startDownload}>
                <Download size={15} />
                {t("ffmpeg.download")}
              </button>
              <button className="btn" onClick={pick}>
                <FolderSearch size={15} />
                {t("ffmpeg.pick")}
              </button>
              <button className="btn btn-ghost" onClick={async () => (await locate()) && detect(false)}>
                <RefreshCw size={14} />
                {t("ffmpeg.lookAgain")}
              </button>
            </div>
            {download.error && <div className="text-[12px] mt-3" style={{ color: "var(--err)" }}>{t("ffmpeg.downloadFailed", { error: download.error })}</div>}
            <div className="flex items-start gap-2 mt-4 text-[11.5px] leading-snug" style={{ color: "var(--text-3)" }}>
              <ShieldCheck size={14} className="shrink-0 mt-px" />
              {t("ffmpeg.downloadNote")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
