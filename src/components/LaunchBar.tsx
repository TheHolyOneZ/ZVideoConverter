import { useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Braces, FolderInput, Pause, Play, Square, Zap } from "./icons";
import { useT } from "../lib/i18n";
import { FAMILY_LABELS, fileName, formatBytes, formatDuration } from "../lib/format";
import type { CollisionPolicy, NamingOptions } from "../lib/tauri";
import { ACTIVE, FINAL, effectiveProfile, sizeEstimate, useQueueStore, type Job, type WhenDone } from "../store/useQueueStore";
import { profileName } from "../store/useProfileStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { useHwStore } from "../store/useHwStore";
import { MenuList, Popover, Select, Seg } from "./ui";

const TOKENS = ["{name}", "{res}", "{vcodec}", "{acodec}", "{profile}", "{width}", "{height}", "{fps}", "{parent}", "{date}", "{counter:3}", "{ext}"];

export function LaunchBar() {
  const t = useT();
  const jobs = useQueueStore((s) => s.jobs);
  const running = useQueueStore((s) => s.running);
  const paused = useQueueStore((s) => s.paused);
  const { start, stopAll, togglePause } = useQueueStore();
  const canSuspend = useHwStore((s) => s.app?.canSuspend ?? false);
  const ffmpeg = useHwStore((s) => s.ffmpeg);
  const hw = useHwStore((s) => s.hw);
  const naming = useSettingsStore((s) => s.naming);

  const stats = useMemo(() => aggregate(jobs), [jobs]);
  const ready = jobs.filter((j) => j.status === "ready");

  return (
    <footer className="pane flex items-stretch h-full" style={{ minHeight: 96 }}>
      <Destination />

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-2.5 px-5" style={{ borderLeft: "1px solid var(--line)" }} data-tour="summary">
        <div className="flex items-baseline justify-between gap-4 min-w-0">
          <span className="text-[12.5px] truncate min-w-0">
            {jobs.length === 0 ? (
              <span style={{ color: "var(--text-3)" }}>{t("launch.idle")}</span>
            ) : running ? (
              <span className="font-medium">{paused ? t("launch.paused") : t("launch.running", { done: stats.finished, total: stats.inRun })}</span>
            ) : ready.length ? (
              <Summary jobs={ready} naming={naming} />
            ) : stats.done ? (
              <span className="font-medium">{t("launch.allDone", { count: stats.done })}</span>
            ) : (
              <span style={{ color: "var(--text-3)" }}>{t("launch.nothingReady")}</span>
            )}
          </span>
          <span className="text-[11.5px] tnum mono shrink-0" style={{ color: "var(--text-3)" }}>
            {[
              running && !paused && stats.eta != null ? t("launch.eta", { eta: formatDuration(stats.eta) }) : null,
              running && !paused && stats.speed > 0 ? `${stats.speed.toFixed(1)}×` : null,
              stats.estimate > 0 && !running ? t("launch.estimate", { size: formatBytes(stats.estimate) }) : null,
              stats.saved > 0 ? t("launch.saved", { size: formatBytes(stats.saved) }) : null,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </span>
        </div>
        <Timeline jobs={jobs} />
      </div>

      <div className="flex items-center gap-2 px-4 shrink-0" style={{ borderLeft: "1px solid var(--line)" }} data-tour="convert">
        <WhenDonePicker />
        {running ? (
          <>
            {ready.length > 0 && (
              <button className="btn btn-outline-accent !h-10" onClick={() => start()} title={t("launch.addToRunHint")}>
                <Play size={12} />
                {t("launch.addToRun", { count: ready.length })}
              </button>
            )}
            <button className="btn !h-10 !px-4" onClick={togglePause} title={canSuspend ? t("launch.pauseHint") : t("launch.pauseHintNoSuspend")}>
              {paused ? <Play size={12} /> : <Pause size={12} />}
              {paused ? t("launch.resume") : t("launch.pause")}
            </button>
            <button className="btn btn-danger !h-10 !px-4" onClick={stopAll}>
              <Square size={11} />
              {t("launch.stop")}
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary !h-10 !px-5 !text-[13.5px] min-w-[176px]"
            disabled={!ready.length || !ffmpeg || !hw}
            onClick={() => start()}
            title={!hw ? t("launch.waitHw") : t("launch.startHint")}
          >
            <Zap size={15} />
            {ready.length > 1 ? t("launch.convertN", { count: ready.length }) : t("launch.convert")}
          </button>
        )}
      </div>
    </footer>
  );
}

function WhenDonePicker() {
  const t = useT();
  const whenDone = useQueueStore((s) => s.whenDone);
  const setWhenDone = useQueueStore((s) => s.setWhenDone);
  return (
    <div className="flex flex-col gap-1 w-[138px]" title={t("when.hint")}>
      <span className="label-quiet !text-[9.5px]">{t("when.label")}</span>
      <Select<WhenDone>
        value={whenDone}
        onChange={setWhenDone}
        ariaLabel={t("when.label")}
        className={whenDone !== "nothing" ? "!border-[var(--accent-line)] !text-[var(--accent)]" : undefined}
        options={[
          { value: "nothing", label: t("when.nothing") },
          { value: "quit", label: t("when.quit") },
          { value: "sleep", label: t("when.sleep") },
          { value: "shutdown", label: t("when.shutdown") },
        ]}
      />
    </div>
  );
}

function Summary({ jobs, naming }: { jobs: Job[]; naming: NamingOptions }) {
  const t = useT();
  const profiles = new Set(jobs.map((j) => (j.override ? `~${j.id}` : j.profileId)));
  const first = effectiveProfile(jobs[0]);
  const profile =
    profiles.size === 1 && first
      ? jobs[0].override
        ? t("launch.customOf", { name: profileName(first) })
        : profileName(first)
      : t("launch.mixedProfiles", { count: profiles.size });
  const families = new Set(jobs.map((j) => j.preview?.encoder?.family).filter(Boolean));
  const gpu = [...families].filter((f) => f !== "cpu");
  const engine =
    families.size === 0
      ? ""
      : gpu.length && !families.has("cpu")
        ? t("launch.onGpu", { name: gpu.map((f) => FAMILY_LABELS[f!]).join(", ") })
        : gpu.length
          ? t("launch.onMixed")
          : t("launch.onCpu");
  const loc = naming.location;
  const where =
    loc.kind === "sameAsSource"
      ? t("where.same")
      : loc.kind === "subfolder"
        ? t("where.sub", { name: loc.name })
        : t("where.folder", { name: fileName(loc.path) || loc.path });
  return (
    <>
      <span className="font-medium">{t("launch.nFiles", { count: jobs.length })}</span>
      <span style={{ color: "var(--text-3)" }}> → </span>
      <span className="font-medium">{profile}</span>
      {engine && <span style={{ color: "var(--text-2)" }}> {engine}</span>}
      <span style={{ color: "var(--text-2)" }}>, {where}</span>
    </>
  );
}

function aggregate(jobs: Job[]) {
  const run = jobs.filter((j) => ACTIVE.includes(j.status) || (FINAL.includes(j.status) && j.outcome));
  let eta: number | null = null;
  let speed = 0;
  let estimate = 0;
  let saved = 0;
  let done = 0;
  for (const j of jobs) {
    if (j.status === "running" && j.progress) {
      speed += j.progress.speed;
      if (j.progress.eta != null) eta = Math.max(eta ?? 0, j.progress.eta);
    }
    if (j.status === "ready") estimate += sizeEstimate(j)?.bytes ?? 0;
    if (j.outcome?.kind === "done") {
      done++;
      if (j.media?.size) saved += Math.max(0, j.media.size - j.outcome.size);
    }
  }
  const queued = jobs.filter((j) => j.status === "queued");
  const running = jobs.filter((j) => j.status === "running");
  if (eta != null && queued.length && running.length) {
    const avg = running.reduce((a, j) => a + (j.media?.duration ?? 0) / Math.max(0.01, j.progress?.speed || 1), 0) / running.length;
    eta += (avg * queued.length) / running.length;
  }
  return { inRun: run.length, finished: run.filter((j) => FINAL.includes(j.status)).length, done, eta, speed, estimate, saved };
}

function Timeline({ jobs }: { jobs: Job[] }) {
  const t = useT();
  const shown = jobs.length > 240 ? jobs.slice(0, 240) : jobs;
  if (!shown.length) {
    return (
      <div className="timeline">
        <span style={{ flex: 1, opacity: 0.5 }} />
      </div>
    );
  }
  return (
    <div className="timeline" role="progressbar" aria-label={t("launch.timeline")}>
      {shown.map((j) => {
        const pct = FINAL.includes(j.status) && j.status !== "skipped" ? 100 : j.status === "running" ? j.progress?.percent ?? 0 : 0;
        const grow = Math.max(1, Math.min(600, j.media?.duration ?? 30));
        return (
          <span key={j.id} data-s={j.status} style={{ flex: `${grow} 1 0` }} title={`${j.name} · ${Math.round(pct)}%`}>
            <i style={{ width: `${pct}%` }} />
          </span>
        );
      })}
    </div>
  );
}

function Destination() {
  const t = useT();
  const naming = useSettingsStore((s) => s.naming);
  const setNaming = useSettingsStore((s) => s.setNaming);
  const tokRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [tokOpen, setTokOpen] = useState(false);
  const loc = naming.location;
  const firstJob = useQueueStore((s) => s.jobs.find((j) => j.preview && j.status === "ready"));

  const browse = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") setNaming({ location: { kind: "folder", path: dir } });
  };

  const insertToken = (tok: string) => {
    const el = inputRef.current;
    const tpl = naming.template;
    const at = el?.selectionStart ?? tpl.length;
    const end = el?.selectionEnd ?? at;
    setNaming({ template: tpl.slice(0, at) + tok + tpl.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + tok.length, at + tok.length);
    });
  };

  return (
    <div className="flex flex-col justify-center gap-2 px-4 py-3 w-[540px] shrink-0" data-tour="output">
      <div className="flex items-center gap-2">
        <span className="step">3</span>
        <span className="label w-[64px] shrink-0">{t("launch.saveTo")}</span>
        <Seg
          value={loc.kind}
          onChange={(k) => {
            if (k === "sameAsSource") setNaming({ location: { kind: "sameAsSource" } });
            else if (k === "subfolder") setNaming({ location: { kind: "subfolder", name: loc.kind === "subfolder" ? loc.name : "converted" } });
            else if (loc.kind !== "folder") browse();
          }}
          options={[
            { value: "sameAsSource", label: t("launch.sameFolder") },
            { value: "subfolder", label: t("launch.subfolder") },
            { value: "folder", label: t("launch.folder") },
          ]}
        />
        {loc.kind === "subfolder" && (
          <input className="field flex-1 min-w-0" value={loc.name} onChange={(e) => setNaming({ location: { kind: "subfolder", name: e.target.value } })} aria-label={t("launch.subfolderName")} />
        )}
        {loc.kind === "folder" && (
          <button className="field flex-1 min-w-0 flex items-center gap-2 text-left" onClick={browse} title={loc.path}>
            <FolderInput size={14} style={{ color: "var(--text-3)" }} />
            <span className="truncate mono text-[11.5px]">{loc.path}</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-[18px] shrink-0" />
        <span className="label w-[64px] shrink-0">{t("launch.name")}</span>
        <div className="relative flex-1 min-w-0">
          <input
            ref={inputRef}
            className="field mono !text-[12px] pr-8"
            value={naming.template}
            spellCheck={false}
            onChange={(e) => setNaming({ template: e.target.value })}
            aria-label={t("launch.template")}
            title={firstJob?.preview ? t("launch.example", { name: fileName(firstJob.preview.output) }) : t("launch.templateHint")}
          />
          <button ref={tokRef} className="btn btn-ghost btn-sm btn-icon absolute right-0.5 top-1/2 -translate-y-1/2" title={t("launch.tokens")} aria-label={t("launch.tokens")} onClick={() => setTokOpen((v) => !v)}>
            <Braces size={13} />
          </button>
          <Popover anchor={tokRef} open={tokOpen} onDismiss={() => setTokOpen(false)} width={290} align="right">
            <div className="px-2 pt-1.5 pb-1 text-[11.5px] leading-snug" style={{ color: "var(--text-3)" }}>{t("launch.tokensHint")}</div>
            <MenuList
              items={TOKENS.map((tok) => ({ label: tok, hint: t(`token.${tok.replace(/[{}]|:\d+/g, "")}`), onSelect: () => insertToken(tok) }))}
              onClose={() => setTokOpen(false)}
            />
          </Popover>
        </div>
        {loc.kind === "folder" && (
          <label className="flex items-center gap-1.5 text-[12px] shrink-0 cursor-pointer" style={{ color: "var(--text-2)" }} title={t("launch.keepStructureHint")}>
            <input type="checkbox" checked={naming.keepStructure} onChange={(e) => setNaming({ keepStructure: e.target.checked })} style={{ accentColor: "var(--accent)" }} />
            {t("launch.keepStructure")}
          </label>
        )}
        <div className="w-[150px] shrink-0" title={t("launch.collision")}>
          <Select<CollisionPolicy>
            value={naming.collision}
            onChange={(c) => setNaming({ collision: c })}
            ariaLabel={t("launch.collision")}
            options={[
              { value: "suffix", label: t("collision.suffix") },
              { value: "overwrite", label: t("collision.overwrite") },
              { value: "skip", label: t("collision.skip") },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
