import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  CheckCheck,
  ChevronDown,
  CircleSlash,
  Cpu,
  Eraser,
  FileVideo,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Image,
  Loader2,
  MoreHorizontal,
  Play,
  RotateCcw,
  Search,
  SortIcon,
  ScrollText,
  Trash2,
  Undo2,
  X,
  Gpu,
} from "./icons";
import { useT } from "../lib/i18n";
import { api, errorOf, type OriginalFate } from "../lib/tauri";
import { toast } from "../store/useToastStore";
import { codecLabel, dirName, FAMILY_LABELS, fileName, formatBytes, formatDuration, resolutionLabel, splitExt } from "../lib/format";
import { ACTIVE, FINAL, effectiveProfile, sizeEstimate, useQueueStore, type Job } from "../store/useQueueStore";
import { profileName, useProfileStore } from "../store/useProfileStore";
import { MenuButton, MenuList, Popover, type MenuEntry } from "./ui";
import { profileIcon } from "./ProfileRail";
import { compareFinished } from "./Compare";

export async function pickFiles() {
  const r = await openDialog({ multiple: true, directory: false });
  const paths = Array.isArray(r) ? r : r ? [r] : [];
  if (paths.length) await useQueueStore.getState().add(paths);
}

export async function pickFolder() {
  const r = await openDialog({ multiple: true, directory: true });
  const paths = Array.isArray(r) ? r : r ? [r] : [];
  if (paths.length) await useQueueStore.getState().add(paths);
}

const ROW_H = 88;

export function MiddleName({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    const fit = () => {
      if (!parent) return;
      const ps = getComputedStyle(parent);
      const gap = parseFloat(ps.columnGap) || 0;
      const siblings = [...parent.children].filter((c) => c !== el) as HTMLElement[];
      const width =
        parent.clientWidth -
        parseFloat(ps.paddingLeft) -
        parseFloat(ps.paddingRight) -
        siblings.reduce((a, c) => a + c.offsetWidth, 0) -
        gap * siblings.length -
        1;
      const cs = getComputedStyle(el);
      const ctx = (MiddleName as unknown as { ctx?: CanvasRenderingContext2D }).ctx ?? document.createElement("canvas").getContext("2d")!;
      (MiddleName as unknown as { ctx?: CanvasRenderingContext2D }).ctx = ctx;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const w = (s: string) => ctx.measureText(s).width;
      if (!width || w(text) <= width) {
        setShown(text);
        return;
      }
      let lo = 0;
      let hi = text.length;
      const make = (n: number) => text.slice(0, Math.floor(n / 2)) + "…" + text.slice(text.length - Math.ceil(n / 2));
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (w(make(mid)) <= width) lo = mid;
        else hi = mid - 1;
      }
      setShown(make(lo));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (parent) ro.observe(parent);
    let alive = true;
    document.fonts?.ready.then(() => alive && fit());
    document.fonts?.addEventListener("loadingdone", fit);
    return () => {
      alive = false;
      ro.disconnect();
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [text]);

  return (
    <span ref={ref} className={clsx("block min-w-0 shrink overflow-hidden whitespace-pre", className)} style={style}>
      {shown}
    </span>
  );
}

export function Queue() {
  const t = useT();
  const jobs = useQueueStore((s) => s.jobs);
  const selected = useQueueStore((s) => s.selected);
  const { clear, clearFinished, selectAll, clearSelection } = useQueueStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null);
  const ctxAnchor = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<QueueFilter>("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => FILTERS[filter](j) && (!q || j.name.toLowerCase().includes(q)));
  }, [jobs, filter, query]);
  const canReorder = filter === "all" && !query.trim();
  const virt = useVirtualizer({ count: visible.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 8 });
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);

  const startDrag = (id: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    const indexAt = (clientY: number) => {
      const r = el.getBoundingClientRect();
      const y = clientY - r.top + el.scrollTop;
      return Math.max(0, Math.min(useQueueStore.getState().jobs.length, Math.round(y / ROW_H)));
    };
    let current = { id, to: indexAt(e.clientY) };
    setDrag(current);
    let raf = 0;
    let lastY = e.clientY;
    const autoscroll = () => {
      const r = el.getBoundingClientRect();
      const edge = 48;
      if (lastY < r.top + edge) el.scrollTop -= Math.ceil((r.top + edge - lastY) / 4);
      else if (lastY > r.bottom - edge) el.scrollTop += Math.ceil((lastY - (r.bottom - edge)) / 4);
      current = { id, to: indexAt(lastY) };
      setDrag(current);
      raf = requestAnimationFrame(autoscroll);
    };
    raf = requestAnimationFrame(autoscroll);
    const onMove = (ev: MouseEvent) => {
      lastY = ev.clientY;
    };
    const onUp = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const all = useQueueStore.getState().jobs;
      const from = all.findIndex((j) => j.id === id);
      if (from >= 0) {
        const to = current.to > from ? current.to - 1 : current.to;
        if (to !== from) useQueueStore.getState().move(id, to);
      }
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const totals = summarize(jobs);
  const sel = new Set(selected);

  return (
    <section className="pane flex flex-col min-h-0 min-w-0 overflow-hidden" data-tour="files">
      <div className="pane-head">
        <span className="step" data-live={jobs.length === 0}>1</span>
        <span className="label">{t("steps.files")}</span>
        {jobs.length > 0 && (
          <span className="text-[11.5px] tnum ml-1 whitespace-nowrap truncate min-w-0" style={{ color: "var(--text-3)" }}>
            {t("queue.summary", { count: jobs.length, duration: formatDuration(totals.duration), size: formatBytes(totals.size) })}
          </span>
        )}
        <div className="flex-1 min-w-2" />
        {jobs.length > 0 && (
          <>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={selected.length === jobs.length ? clearSelection : selectAll}
              title={selected.length === jobs.length ? t("queue.selectNone") : t("queue.selectAll")}
              aria-label={selected.length === jobs.length ? t("queue.selectNone") : t("queue.selectAll")}
            >
              <CheckCheck size={14} />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={clearFinished}
              disabled={!jobs.some((j) => FINAL.includes(j.status))}
              title={t("queue.clearFinished")}
              aria-label={t("queue.clearFinished")}
            >
              <Eraser size={14} />
            </button>
            <button className="btn btn-ghost btn-sm btn-danger shrink-0" onClick={clear} title={t("queue.clearHint")}>
              <Trash2 size={13} />
              {t("queue.clear")}
            </button>
            <span className="w-px h-5 mx-1" style={{ background: "var(--line-strong)" }} />
          </>
        )}
        <button className="btn btn-sm shrink-0" onClick={pickFiles} title="Ctrl+O">
          <FilePlus2 size={13} />
          {t("queue.addFiles")}
        </button>
        <button className="btn btn-sm shrink-0" onClick={pickFolder} title="Ctrl+Shift+O">
          <FolderPlus size={13} />
          {t("queue.addFolder")}
        </button>
      </div>

      {jobs.length > 0 && (
        <QueueTools jobs={jobs} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} />
      )}
      {jobs.length === 0 ? (
        <EmptyQueue />
      ) : visible.length === 0 ? (
        <div className="flex-1 grid place-items-center text-[12.5px]" style={{ color: "var(--text-3)" }}>{t("tools.noMatch")}</div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto min-h-0"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) clearSelection();
          }}
        >
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((v) => {
              const job = visible[v.index];
              return (
                <div key={job.id} style={{ position: "absolute", top: 0, left: 0, right: 0, height: v.size, transform: `translateY(${v.start}px)` }}>
                  <QueueRow job={job} selected={sel.has(job.id)} dragging={drag?.id === job.id} onDragHandle={canReorder ? startDrag : undefined} onContext={(x, y) => setCtx({ x, y, id: job.id })} />
                </div>
              );
            })}
            {drag && (
              <div className="absolute left-0 right-0 h-[2px] pointer-events-none" style={{ top: drag.to * ROW_H - 1, background: "var(--accent)", zIndex: 5 }}>
                <span className="absolute -left-px -top-[3px] w-2 h-2" style={{ background: "var(--accent)" }} />
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={ctxAnchor} />
      <Popover anchor={ctxAnchor} open={!!ctx} at={ctx} onDismiss={() => setCtx(null)} width={230}>
        {ctx && <MenuList items={rowMenu(ctx.id, t)} onClose={() => setCtx(null)} />}
      </Popover>
    </section>
  );
}

type QueueFilter = "all" | "ready" | "running" | "done" | "failed";
const FILTERS: Record<QueueFilter, (j: Job) => boolean> = {
  all: () => true,
  ready: (j) => j.status === "ready" || j.status === "probing",
  running: (j) => ACTIVE.includes(j.status),
  done: (j) => j.status === "done",
  failed: (j) => j.status === "failed" || j.status === "invalid" || j.status === "cancelled",
};

function QueueTools({
  jobs,
  filter,
  setFilter,
  query,
  setQuery,
}: {
  jobs: Job[];
  filter: QueueFilter;
  setFilter: (f: QueueFilter) => void;
  query: string;
  setQuery: (q: string) => void;
}) {
  const t = useT();
  const q = useQueueStore();
  const counts = (Object.keys(FILTERS) as QueueFilter[]).map((f) => [f, jobs.filter(FILTERS[f]).length] as const);
  const failed = jobs.filter((j) => (j.status === "failed" || j.status === "cancelled") && j.media);
  const sortBy = (key: "name" | "size" | "duration" | "added") => {
    const order = [...jobs].sort((a, b) =>
      key === "name"
        ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        : key === "size"
          ? (b.media?.size ?? 0) - (a.media?.size ?? 0)
          : key === "duration"
            ? (b.media?.duration ?? 0) - (a.media?.duration ?? 0)
            : a.added - b.added,
    );
    useQueueStore.setState({ jobs: order });
  };
  return (
    <div className="flex items-center gap-1.5 px-3 h-10 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
      {counts.map(([f, n]) =>
        f !== "all" && n === 0 ? null : (
          <button
            key={f}
            className="h-6 px-2 rounded-[4px] text-[11.5px] flex items-center gap-1.5"
            style={{
              border: "1px solid",
              borderColor: filter === f ? "var(--accent-line)" : "transparent",
              background: filter === f ? "var(--accent-soft)" : "transparent",
              color: filter === f ? "var(--text)" : "var(--text-2)",
            }}
            onClick={() => setFilter(f)}
          >
            {t(`tools.${f}`)}
            <span className="mono text-[10.5px]" style={{ color: "var(--text-3)" }}>{n}</span>
          </button>
        ),
      )}
      {failed.length > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={() => q.requeue(failed.map((j) => j.id))} title={t("tools.retryHint")}>
          <RotateCcw size={12} />
          {t("tools.retry", { count: failed.length })}
        </button>
      )}
      <div className="flex-1" />
      <div className="relative w-[180px]">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
        <input className="field !h-6 !text-[12px] pl-7" placeholder={t("tools.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <MenuButton
        className="btn btn-ghost btn-sm"
        title={t("tools.sort")}
        align="right"
        items={[
          { label: t("tools.sortName"), onSelect: () => sortBy("name") },
          { label: t("tools.sortSize"), onSelect: () => sortBy("size") },
          { label: t("tools.sortDuration"), onSelect: () => sortBy("duration") },
          { label: t("tools.sortAdded"), onSelect: () => sortBy("added") },
        ]}
      >
        <SortIcon size={13} />
        {t("tools.sort")}
      </MenuButton>
    </div>
  );
}

function summarize(jobs: Job[]) {
  let duration = 0;
  let size = 0;
  for (const j of jobs) {
    duration += j.media?.duration ?? 0;
    size += j.media?.size ?? 0;
  }
  return { duration, size };
}

function isAudioContainer(path: string) {
  return /\.(mp3|m4a|flac|opus|ogg|wav)$/i.test(path);
}

function rowMenu(id: string, t: ReturnType<typeof useT>): MenuEntry[] {
  const q = useQueueStore.getState();
  const job = q.jobs.find((j) => j.id === id);
  if (!job) return [];
  const targets = q.selected.includes(id) ? q.selected : [id];
  const many = targets.length > 1;
  const output = job.outcome?.kind === "done" ? job.outcome.output : null;
  return [
    ...(job.status === "ready" ? [{ label: many ? t("queue.convertSelected", { count: targets.length }) : t("queue.convertThis"), icon: <Play size={14} />, onSelect: () => q.start(targets) }] : []),
    ...(job.media?.video || job.media ? [{ label: t("preview.action"), icon: <FileVideo size={14} />, disabled: many || !!job.sampling || ACTIVE.includes(job.status), onSelect: () => q.sampleJob(id) }] : []),
    ...(FINAL.includes(job.status) && job.media ? [{ label: t("queue.convertAgain"), icon: <RotateCcw size={14} />, onSelect: () => q.requeue(targets) }] : []),
    ...(ACTIVE.includes(job.status) ? [{ label: t("queue.cancel"), icon: <X size={14} />, onSelect: () => targets.forEach((x) => q.cancel(x)) }] : []),
    "sep",
    { label: t("queue.openSource"), icon: <FileVideo size={14} />, onSelect: () => openPath(job.path).catch(() => {}) },
    { label: t("queue.showSource"), icon: <FolderOpen size={14} />, onSelect: () => revealItemInDir(job.path).catch(() => {}) },
    ...(output ? [{ label: t("queue.showOutput"), icon: <FolderOpen size={14} />, onSelect: () => revealItemInDir(output).catch(() => {}) }] : []),
    ...(output && job.media?.video && !isAudioContainer(output) ? [{ label: t("compare.action"), icon: <Image size={14} />, disabled: many, onSelect: () => compareFinished(job, output) }] : []),
    { label: t("queue.showLog"), icon: <ScrollText size={14} />, onSelect: () => q.setLogJob(id) },
    "sep",
    ...(job.override ? [{ label: t("queue.resetOverride"), icon: <Undo2 size={14} />, onSelect: () => q.resetOverride(targets) }] : []),
    { label: t("queue.moveTop"), icon: <ArrowUpToLine size={14} />, disabled: many, onSelect: () => q.move(id, 0) },
    { label: t("queue.moveBottom"), icon: <ArrowDownToLine size={14} />, disabled: many, onSelect: () => q.move(id, q.jobs.length) },
    "sep",
    { label: many ? t("queue.removeSelected", { count: targets.length }) : t("queue.remove"), icon: <Trash2 size={14} />, danger: true, onSelect: () => q.remove(targets) },
  ];
}

function EmptyQueue() {
  const t = useT();
  const steps = [
    { n: 1, title: t("guide.addTitle"), text: t("guide.addText") },
    { n: 2, title: t("guide.profileTitle"), text: t("guide.profileText") },
    { n: 3, title: t("guide.convertTitle"), text: t("guide.convertText") },
  ];
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 p-10 row-enter overflow-y-auto">
      <Viewfinder>
        <ArrowDownToLine size={28} style={{ color: "var(--text-2)" }} />
        <div className="text-[17px] font-medium mt-3">{t("queue.emptyTitle")}</div>
        <div className="text-[12.5px] mt-1" style={{ color: "var(--text-3)" }}>{t("queue.emptyHint")}</div>
        <div className="flex gap-2 mt-5">
          <button className="btn btn-primary" onClick={pickFiles}>
            <FilePlus2 size={14} />
            {t("queue.addFiles")}
          </button>
          <button className="btn" onClick={pickFolder}>
            <FolderPlus size={14} />
            {t("queue.addFolder")}
          </button>
        </div>
      </Viewfinder>
      <ol className="grid grid-cols-3 gap-6 w-full max-w-[640px] m-0 p-0 list-none">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-2.5">
            <span className="step shrink-0 mt-px" data-live={s.n === 1}>{s.n}</span>
            <div>
              <div className="text-[12.5px] font-medium">{s.title}</div>
              <div className="text-[12px] mt-0.5 leading-snug" style={{ color: "var(--text-3)" }}>{s.text}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Viewfinder({ children, size = "normal" }: { children: React.ReactNode; size?: "normal" | "large" }) {
  const w = size === "large" ? 420 : 460;
  const h = size === "large" ? 260 : 230;
  const mark = (pos: React.CSSProperties, rot: number) => (
    <svg width="22" height="22" viewBox="0 0 22 22" className="absolute" style={{ ...pos, transform: `rotate(${rot}deg)` }} aria-hidden="true">
      <path d="M1 21V1h20" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
  return (
    <div className="relative flex flex-col items-center justify-center text-center" style={{ width: w, height: h, maxWidth: "100%", color: "var(--line-strong)" }}>
      {mark({ left: 0, top: 0 }, 0)}
      {mark({ right: 0, top: 0 }, 90)}
      {mark({ right: 0, bottom: 0 }, 180)}
      {mark({ left: 0, bottom: 0 }, 270)}
      <div style={{ color: "var(--text)" }} className="flex flex-col items-center">{children}</div>
    </div>
  );
}

const QueueRow = memo(function QueueRow({
  job,
  selected,
  dragging,
  onDragHandle,
  onContext,
}: {
  job: Job;
  selected: boolean;
  dragging: boolean;
  onDragHandle?: (id: string, e: React.MouseEvent) => void;
  onContext: (x: number, y: number) => void;
}) {
  const t = useT();
  const select = useQueueStore((s) => s.select);
  const profiles = useProfileStore((s) => s.profiles);
  const profile = effectiveProfile(job);
  void profiles;
  const [stem, ext] = splitExt(job.name);
  const m = job.media;
  const v = m?.video;
  const out = job.outcome?.kind === "done" ? job.outcome.output : job.preview?.output;

  return (
    <div
      className={clsx("group row-enter relative h-full flex items-center gap-3.5 pl-3 pr-2", !selected && "hover:bg-[var(--hover)]")}
      style={{ background: selected ? "var(--selected)" : undefined, borderBottom: "1px solid var(--line)", opacity: dragging ? 0.45 : 1 }}
      onMouseDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
        if (e.shiftKey) e.preventDefault();
        select(job.id, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "single");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selected) select(job.id);
        onContext(e.clientX, e.clientY);
      }}
      onDoubleClick={() => openPath(job.path).catch(() => {})}
    >
      {selected && <span className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: "var(--accent)" }} />}
      {!ACTIVE.includes(job.status) && onDragHandle && (
        <span
          className="absolute left-0 top-0 bottom-0 w-3 grid place-items-center cursor-grab opacity-0 group-hover:opacity-100"
          style={{ color: "var(--text-3)" }}
          title={t("queue.dragHint")}
          onMouseDown={(e) => onDragHandle(job.id, e)}
        >
          <GripVertical size={12} />
        </span>
      )}
      <div className="film">
        {job.thumb ? (
          <img src={job.thumb} alt="" draggable={false} />
        ) : (
          <div className="film-empty">{job.thumb === null ? <FileVideo size={18} /> : <Loader2 size={16} className="animate-spin" />}</div>
        )}
        {m?.duration != null && (
          <span className="absolute right-1 bottom-2 text-[9.5px] mono px-1 rounded-[2px]" style={{ background: "rgba(0,0,0,.75)", color: "#fff" }}>
            {formatDuration(m.duration)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1 min-w-0 pr-2" title={job.path}>
          <MiddleName text={stem} className="text-[13px] font-medium" />
          {ext && (
            <span className="text-[11px] mono shrink-0" style={{ color: "var(--text-3)" }}>
              .{ext}
            </span>
          )}
        </div>
        <OutputLine job={job} out={out} />
        <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
          {profile && <ProfilePill job={job} />}
          <EncoderChip job={job} />
          {job.status === "probing" && <span className="tag">{t("status.probing")}</span>}
          {job.status === "invalid" && (
            <span className="tag tag-err truncate" title={job.probeError}>
              <AlertTriangle size={11} />
              {t("status.invalid")}
            </span>
          )}
          <span className="w-px h-3.5 mx-0.5 shrink-0" style={{ background: "var(--line-strong)" }} />
          <div className="flex flex-wrap items-center gap-1.5 min-w-0 h-[19px] overflow-hidden">
            {v && <span className="tag">{resolutionLabel(v.width, v.height)}{v.hdr ? " HDR" : ""}</span>}
            {v && <span className="tag">{codecLabel(v.codec)}</span>}
            {m && m.audio.length > 0 && (
              <span className="tag" title={m.audio.map((a) => `${codecLabel(a.codec)} ${a.channels}ch ${a.language ?? ""}`).join("\n")}>
                {codecLabel(m.audio[0].codec)}
                {m.audio.length > 1 ? ` +${m.audio.length - 1}` : ""}
              </span>
            )}
            {m && m.subtitles.length > 0 && <span className="tag">{t("queue.subs", { count: m.subtitles.length })}</span>}
            {m && <span className="tag tnum">{formatBytes(m.size)}</span>}
          </div>
        </div>
      </div>

      <StatusCell job={job} />

      <RowActions job={job} />
    </div>
  );
});

function OutputLine({ job, out }: { job: Job; out?: string }) {
  const t = useT();
  if (!out) return <div className="h-[18px]" />;
  const status = job.preview?.nameStatus;
  const color = status === "overwrites" ? "var(--err)" : status === "suffixed" ? "var(--warn)" : status === "skipped" ? "var(--text-3)" : "var(--text-2)";
  const note =
    status === "suffixed" ? t("name.suffixed") : status === "overwrites" ? t("name.overwrites") : status === "skipped" ? t("name.skipped") : null;
  const sameDir = dirName(out) === dirName(job.path);
  return (
    <div className="flex items-center gap-1.5 min-w-0 mt-0.5 text-[11.5px] mono" title={out} data-tour="outname">
      <span style={{ color: "var(--text-3)" }}>→</span>
      {!sameDir && (
        <span className="truncate shrink" style={{ color: "var(--text-3)", maxWidth: "40%" }}>
          {fileName(dirName(out))}/
        </span>
      )}
      <MiddleName text={fileName(out)} style={{ color }} />
      {note && FINAL.includes(job.status) === false && (
        <span className="tag !h-[17px] !text-[10px] shrink-0" style={{ color, background: "transparent", borderColor: color }} title={t(`name.${status}Hint`)}>
          {note}
        </span>
      )}
    </div>
  );
}

function ProfilePill({ job }: { job: Job }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const profiles = useProfileStore((s) => s.profiles);
  const { setProfile, selected } = useQueueStore();
  const p = effectiveProfile(job)!;
  const locked = ACTIVE.includes(job.status);
  const targets = selected.includes(job.id) ? selected : [job.id];
  return (
    <>
      <button
        ref={ref}
        className="flex items-center gap-1.5 h-[22px] pl-2 pr-1.5 rounded-md text-[11px] font-semibold max-w-[190px] shrink-0"
        style={{ background: "var(--hover)", border: "1px solid var(--line)", color: "var(--text)" }}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
        title={job.override ? t("queue.customSettings") : t("queue.changeProfile")}
      >
        <span style={{ color: job.override ? "var(--info)" : "var(--text-3)" }}>{profileIcon(p, 12)}</span>
        <span className="truncate">{job.override ? t("queue.customOf", { name: profileName(useProfileStore.getState().byId(job.profileId) ?? p) }) : profileName(p)}</span>
        {!locked && <ChevronDown size={12} style={{ color: "var(--text-3)" }} />}
      </button>
      <Popover anchor={ref} open={open} onDismiss={() => setOpen(false)} width={250} align="right" maxHeight={380}>
        <MenuList
          items={profiles.map((x) => ({
            label: profileName(x),
            checked: !job.override && x.id === job.profileId,
            onSelect: () => setProfile(targets, x.id),
          }))}
          onClose={() => setOpen(false)}
        />
      </Popover>
    </>
  );
}

function EncoderChip({ job }: { job: Job }) {
  const t = useT();
  const enc = job.preview?.encoder;
  const fell = !!job.fellBackReason;
  if (job.preview?.error) {
    return (
      <span className="tag tag-err" title={t(`error.${job.preview.error}`)}>
        <CircleSlash size={11} />
        {t("queue.noEncoder")}
      </span>
    );
  }
  if (!enc) {
    const p = effectiveProfile(job);
    if (!p || !job.preview) return null;
    return <span className="tag">{p.video.mode === "copy" && p.container !== "gif" ? t("queue.copyStreams") : t("queue.audioOnly")}</span>;
  }
  const gpu = enc.family !== "cpu" && !fell;
  return (
    <span className={clsx("tag", gpu ? "tag-ok" : "")} title={fell ? t("queue.fellBack", { reason: job.fellBackReason ?? "" }) : enc.name}>
      {gpu ? <Gpu size={12} /> : <Cpu size={12} />}
      {fell ? "CPU" : FAMILY_LABELS[enc.family]}
    </span>
  );
}

function ExtrasLine({ job }: { job: Job }) {
  const t = useT();
  if (!job.extras.length) return null;
  const done = job.extras.filter((x) => x.status === "done").length;
  const failed = job.extras.filter((x) => x.status === "failed").length;
  const running = job.extras.filter((x) => x.status === "running");
  const text = running.length
    ? t("extras.running", { count: job.extras.length, pct: Math.round(running.reduce((a, x) => a + (x.progress?.percent ?? 0), 0) / running.length) })
    : failed
      ? t("extras.failed", { count: failed })
      : done
        ? t("extras.done", { done, count: job.extras.length })
        : t("extras.planned", { count: job.extras.length });
  return (
    <span className="text-[10.5px] truncate" style={{ color: failed ? "var(--err)" : "var(--text-3)" }} title={job.extras.map((x) => x.preview?.output ?? x.profileId).join("\n")}>
      + {text}
    </span>
  );
}

function StatusCell({ job }: { job: Job }) {
  return (
    <div className="w-[176px] shrink-0 flex flex-col gap-1">
      <StatusBody job={job} />
      <ExtrasLine job={job} />
    </div>
  );
}

function StatusBody({ job }: { job: Job }) {
  const t = useT();
  const pr = job.progress;
  const o = job.outcome;
  return (
    <div className="flex flex-col gap-1.5">
      {job.status === "running" || job.status === "queued" ? (
        <>
          <div className="flex items-center justify-between text-[11.5px] tnum">
            <span className="font-medium mono" style={{ color: job.status === "queued" ? "var(--text-3)" : "var(--text)" }}>
              {job.status === "queued" ? t("status.queued") : `${(pr?.percent ?? 0).toFixed(1)}%`}
              {job.pass && job.pass.passes > 1 && <span style={{ color: "var(--text-3)" }}> · {t("status.pass", { pass: job.pass.pass, passes: job.pass.passes })}</span>}
            </span>
            {pr?.eta != null && job.status === "running" && <span style={{ color: "var(--text-3)" }}>{t("status.eta", { eta: formatDuration(pr.eta) })}</span>}
          </div>
          <div className="bar" data-running={job.status === "running"}>
            <i style={{ width: `${pr?.percent ?? 0}%` }} />
          </div>
          <div className="text-[10.5px] mono tnum h-3.5" style={{ color: "var(--text-3)" }}>
            {job.status === "running" && pr ? `${pr.speed.toFixed(2)}× · ${Math.round(pr.fps)} fps · ${formatBytes(pr.size)}` : ""}
            {job.fellBackReason && job.status === "running" && <span style={{ color: "var(--warn)" }}> · CPU</span>}
          </div>
        </>
      ) : job.status === "done" && o?.kind === "done" ? (
        <div className="flex flex-col gap-1">
          <span className="state self-start" style={{ color: "var(--ok)" }}>
            {t("status.done")}
            {job.elapsed != null && <span className="mono text-[11px]" style={{ color: "var(--text-3)" }}>{formatDuration(job.elapsed)}</span>}
          </span>
          <span className="text-[11.5px] tnum" style={{ color: "var(--text-2)" }}>
            {formatBytes(job.media?.size)} → <span style={{ color: "var(--text)" }}>{formatBytes(o.size)}</span>
            {job.media?.size ? <SavedPct from={job.media.size} to={o.size} /> : null}
          </span>
          {o.fellBack && <span className="text-[10.5px]" style={{ color: "var(--warn)" }}>{t("status.fellBack")}</span>}
          {o.original && <OriginalLine job={job} fate={o.original} />}
        </div>
      ) : job.status === "failed" ? (
        <div className="flex flex-col gap-1 min-w-0">
          <span className="state self-start" style={{ color: "var(--err)" }}>{t("status.failed")}</span>
          <span className="text-[11px] leading-snug line-clamp-2" style={{ color: "var(--text-2)" }} title={job.error}>
            {job.error}
          </span>
        </div>
      ) : job.status === "cancelled" ? (
        <span className="state self-start" style={{ color: "var(--text-3)" }}>{t("status.cancelled")}</span>
      ) : job.status === "skipped" ? (
        <span className="state self-start" style={{ color: "var(--text-3)" }} title={t("name.skippedHint")}>{t("status.skipped")}</span>
      ) : job.status === "ready" ? (
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="state" style={{ color: "var(--text-2)" }}>{t("status.ready")}</span>
            <EstimateText job={job} />
          </span>
          {job.preview?.notes.length ? (
            <span className="text-[10.5px] leading-snug line-clamp-2" style={{ color: "var(--warn)" }} title={job.preview.notes.map((n) => t(`note.${n}`)).join("\n")}>
              {t(`note.${job.preview.notes[0]}`)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OriginalLine({ job, fate }: { job: Job; fate: OriginalFate }) {
  const t = useT();
  const [restored, setRestored] = useState(false);
  if (restored) return <span className="text-[10.5px]" style={{ color: "var(--text-3)" }}>{t("original.restored")}</span>;
  if (fate.kind === "kept") {
    return (
      <span className="text-[10.5px]" style={{ color: "var(--warn)" }} title={fate.detail}>
        {t(`original.kept.${fate.reason}`)}
      </span>
    );
  }
  return (
    <span className="text-[10.5px] flex items-center gap-1.5" style={{ color: "var(--text-3)" }}>
      {fate.kind === "trashed" ? t("original.trashed") : t("original.deleted")}
      {fate.kind === "trashed" && (
        <button
          className="underline underline-offset-2"
          style={{ background: "none", border: "none", padding: 0, color: "var(--text-2)" }}
          onClick={async () => {
            try {
              if (await api.restoreOriginal(job.path)) {
                setRestored(true);
                toast("ok", t("original.restoredToast"));
              } else toast("warn", t("original.notInTrash"));
            } catch (e) {
              toast("err", errorOf(e).detail);
            }
          }}
        >
          {t("original.restore")}
        </button>
      )}
    </span>
  );
}

function EstimateText({ job }: { job: Job }) {
  const t = useT();
  if (job.sampling) return <span className="text-[11px]" style={{ color: "var(--text-3)" }}>{t("preview.running")}</span>;
  const e = sizeEstimate(job);
  if (!e) return null;
  return (
    <span className="text-[11px] tnum" style={{ color: e.measured ? "var(--text-2)" : "var(--text-3)" }} title={e.measured ? t("preview.measuredHint") : t("queue.estimateHint")}>
      ≈ {formatBytes(e.bytes)}
      {e.measured && <span className="ml-1 label-quiet !text-[9.5px]">{t("preview.measured")}</span>}
    </span>
  );
}

function SavedPct({ from, to }: { from: number; to: number }) {
  const pct = Math.round((1 - to / from) * 100);
  if (!isFinite(pct) || pct === 0) return null;
  return (
    <span className="ml-1.5 mono" style={{ color: pct > 0 ? "var(--ok)" : "var(--warn)" }}>
      {pct > 0 ? `−${pct}%` : `+${-pct}%`}
    </span>
  );
}

function RowActions({ job }: { job: Job }) {
  const t = useT();
  const q = useQueueStore();
  const output = job.outcome?.kind === "done" ? job.outcome.output : null;
  return (
    <div className="flex items-center gap-0.5 shrink-0 w-[58px] justify-end">
      {output ? (
        <button className="btn btn-ghost btn-sm btn-icon" title={t("queue.showOutput")} aria-label={t("queue.showOutput")} onClick={() => revealItemInDir(output).catch(() => {})}>
          <FolderOpen size={14} />
        </button>
      ) : ACTIVE.includes(job.status) ? (
        <button className="btn btn-ghost btn-sm btn-icon" title={t("queue.cancel")} aria-label={t("queue.cancel")} onClick={() => q.cancel(job.id)}>
          <X size={14} />
        </button>
      ) : job.status === "failed" || job.status === "cancelled" ? (
        <button className="btn btn-ghost btn-sm btn-icon" title={t("queue.convertAgain")} aria-label={t("queue.convertAgain")} onClick={() => q.requeue([job.id])}>
          <RotateCcw size={14} />
        </button>
      ) : (
        <button
          className="btn btn-ghost btn-sm btn-icon opacity-0 group-hover:opacity-100"
          title={t("queue.remove")}
          aria-label={t("queue.remove")}
          onClick={() => q.remove([job.id])}
        >
          <Trash2 size={14} />
        </button>
      )}
      <button
        className="btn btn-ghost btn-sm btn-icon"
        title={t("common.more")}
        aria-label={t("common.more")}
        onClick={(e) => {
          if (!q.selected.includes(job.id)) q.select(job.id);
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left - 200, clientY: r.bottom + 4 }));
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}
