import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  api,
  ENGINE_EVENT,
  OPEN_EVENT,
  WATCH_EVENT,
  errorOf,
  type EngineEvent,
  type JobInput,
  type JobOptions,
  type JobPreview,
  type MediaInfo,
  type Outcome,
  type PreviewResult,
  type Profile,
} from "../lib/tauri";
import { dirName, fileName, formatBytes } from "../lib/format";
import { ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../lib/i18n";
import { useProfileStore } from "./useProfileStore";
import { useSettingsStore } from "./useSettingsStore";
import { useHwStore } from "./useHwStore";
import { toast } from "./useToastStore";

export type JobStatus = "probing" | "ready" | "invalid" | "queued" | "running" | "done" | "failed" | "cancelled" | "skipped";

export interface JobProgress {
  percent: number;
  fps: number;
  speed: number;
  eta: number | null;
  size: number;
}

export interface Job {
  id: string;
  added: number;
  path: string;
  root: string | null;
  name: string;
  status: JobStatus;
  media?: MediaInfo;
  probeError?: string;
  thumb?: string | null;
  profileId: string;
  override: Profile | null;
  options: JobOptions;
  preview?: JobPreview;
  pass?: { pass: number; passes: number; fallback: boolean };
  progress?: JobProgress;
  outcome?: Outcome;
  elapsed?: number;
  fellBackReason?: string;
  error?: string;
  sample?: PreviewResult & { key: string };
  sampling?: boolean;
  extras: ExtraOutput[];
  autoStart?: boolean;
}

export interface ExtraOutput {
  profileId: string;
  status?: JobStatus;
  progress?: JobProgress;
  outcome?: Outcome;
  preview?: JobPreview;
}

const EXTRA_SEP = "~";
const extraId = (jobId: string, i: number) => `${jobId}${EXTRA_SEP}${i}`;

export interface SessionEntry {
  path: string;
  root: string | null;
  profileId: string;
  override: Profile | null;
  options: JobOptions;
  output: string | null;
  extras?: string[];
  autoStart?: boolean;
}

export const FINAL: JobStatus[] = ["done", "failed", "cancelled", "skipped"];
export const ACTIVE: JobStatus[] = ["queued", "running"];

interface QueueState {
  jobs: Job[];
  selected: string[];
  anchor: string | null;
  running: boolean;
  paused: boolean;
  logJobId: string | null;
  add: (paths: string[], restored?: Map<string, SessionEntry>) => Promise<void>;
  remove: (ids: string[]) => void;
  clear: () => void;
  clearFinished: () => void;
  move: (id: string, toIndex: number) => void;
  select: (id: string, mode?: "single" | "toggle" | "range") => void;
  selectAll: () => void;
  clearSelection: () => void;
  setProfile: (ids: string[], profileId: string) => void;
  editOverride: (ids: string[], patch: (p: Profile) => void) => void;
  resetOverride: (ids: string[]) => void;
  setOptions: (id: string, patch: Partial<JobOptions>) => void;
  start: (ids?: string[]) => Promise<void>;
  requeue: (ids: string[]) => void;
  cancel: (id: string) => void;
  stopAll: () => void;
  togglePause: () => void;
  setLogJob: (id: string | null) => void;
  handleEvent: (ev: EngineEvent) => void;
  sampleJob: (id: string) => Promise<void>;
  setExtras: (id: string, profileIds: string[]) => void;
  whenDone: WhenDone;
  setWhenDone: (w: WhenDone) => void;
  countdown: { action: WhenDone; seconds: number; failed: number } | null;
  cancelCountdown: () => void;
}

export type WhenDone = "nothing" | "quit" | "sleep" | "shutdown";

let seq = 0;
const newId = () => `j${Date.now().toString(36)}${(seq++).toString(36)}`;
let addedCounter = 0;

function pool(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T,>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const probePool = pool(4);
const thumbPool = pool(2);

export function effectiveProfile(job: Job): Profile | undefined {
  return job.override ?? useProfileStore.getState().byId(job.profileId) ?? useProfileStore.getState().byId("builtin.mp4-h264");
}

const DEFAULT_OPTIONS: JobOptions = { trimStart: null, trimEnd: null, burnTrack: 0, extraSubs: [], skipExternalSubs: false, detectedCrop: null, cropChecked: false };

export const useQueueStore = create<QueueState>((set, get) => {
  const patchJob = (id: string, patch: Partial<Job> | ((j: Job) => Partial<Job>)) =>
    set({
      jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...(typeof patch === "function" ? patch(j) : patch) } : j)),
    });

  const probe = (job: Job) =>
    probePool(async () => {
      try {
        const media = await api.probeFile(job.path);
        patchJob(job.id, (j) => (j.status === "probing" ? { media, status: "ready" } : { media }));
        if (get().jobs.find((j) => j.id === job.id)?.autoStart) {
          patchJob(job.id, { autoStart: false });
          window.setTimeout(() => get().start([job.id]), 400);
        }
        if (media.video) {
          thumbPool(() => api.thumbnail(job.path, media.duration))
            .then((thumb) => patchJob(job.id, { thumb }))
            .catch(() => patchJob(job.id, { thumb: null }));
        } else {
          patchJob(job.id, { thumb: null });
        }
      } catch (e) {
        patchJob(job.id, { status: "invalid", probeError: errorOf(e).detail, thumb: null });
      }
    });

  return {
    jobs: [],
    selected: [],
    anchor: null,
    running: false,
    paused: false,
    logJobId: null,
    whenDone: "nothing",
    countdown: null,
    setWhenDone: (w) => set({ whenDone: w }),
    cancelCountdown: () => {
      window.clearInterval(countdownTimer);
      set({ countdown: null });
    },

    add: async (paths, restored) => {
      if (!paths.length) return;
      if (!useHwStore.getState().ffmpeg) {
        toast("warn", t("queue.needFfmpeg"));
        return;
      }
      let expanded;
      try {
        expanded = await api.expandPaths(paths);
      } catch (e) {
        toast("err", errorOf(e).detail);
        return;
      }
      const have = new Set(get().jobs.map((j) => j.path));
      const fresh = expanded.filter((e) => !have.has(e.path));
      const skipped = expanded.length - fresh.length;
      if (!fresh.length) {
        if (!restored) toast("info", expanded.length ? t("queue.alreadyAdded") : t("queue.nothingFound"));
        return;
      }
      const profileId = useSettingsStore.getState().defaultProfileId;
      const jobs: Job[] = fresh.map((e) => {
        const r = restored?.get(e.path);
        return {
          id: newId(),
          added: addedCounter++,
          path: e.path,
          root: r ? r.root : e.root,
          name: fileName(e.path),
          status: "probing",
          profileId: r && useProfileStore.getState().byId(r.profileId) ? r.profileId : profileId,
          override: r?.override ?? null,
          options: { ...DEFAULT_OPTIONS, ...(r?.options ?? {}) },
          extras: (r?.extras ?? []).filter((id) => useProfileStore.getState().byId(id)).map((profileId) => ({ profileId })),
          autoStart: r?.autoStart,
        };
      });
      set({ jobs: [...get().jobs, ...jobs] });
      if (skipped && !restored) toast("info", t("queue.skippedDuplicates", { count: skipped }));
      jobs.forEach(probe);
    },

    remove: (ids) => {
      const drop = new Set(ids);
      for (const j of get().jobs) if (drop.has(j.id) && ACTIVE.includes(j.status)) api.cancelJob(j.id).catch(() => {});
      set({
        jobs: get().jobs.filter((j) => !drop.has(j.id)),
        selected: get().selected.filter((id) => !drop.has(id)),
        logJobId: drop.has(get().logJobId ?? "") ? null : get().logJobId,
      });
    },

    clear: () => {
      if (get().running) api.cancelAll().catch(() => {});
      set({ jobs: [], selected: [], anchor: null, logJobId: null });
    },

    clearFinished: () => {
      const keep = get().jobs.filter((j) => !FINAL.includes(j.status) || j.extras.some((x) => x.status && ACTIVE.includes(x.status)));
      const ids = new Set(keep.map((j) => j.id));
      set({ jobs: keep, selected: get().selected.filter((id) => ids.has(id)) });
    },

    move: (id, toIndex) => {
      const jobs = [...get().jobs];
      const from = jobs.findIndex((j) => j.id === id);
      if (from < 0) return;
      const [j] = jobs.splice(from, 1);
      jobs.splice(Math.max(0, Math.min(toIndex, jobs.length)), 0, j);
      set({ jobs });
    },

    select: (id, mode = "single") => {
      const { selected, anchor, jobs } = get();
      if (mode === "toggle") {
        set({ selected: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], anchor: id });
      } else if (mode === "range" && anchor) {
        const a = jobs.findIndex((j) => j.id === anchor);
        const b = jobs.findIndex((j) => j.id === id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        set({ selected: jobs.slice(lo, hi + 1).map((j) => j.id) });
      } else {
        set({ selected: [id], anchor: id });
      }
    },

    selectAll: () => set({ selected: get().jobs.map((j) => j.id) }),
    clearSelection: () => set({ selected: [], anchor: null }),

    setProfile: (ids, profileId) => {
      const s = new Set(ids);
      set({ jobs: get().jobs.map((j) => (s.has(j.id) && !ACTIVE.includes(j.status) ? { ...j, profileId, override: null } : j)) });
    },

    editOverride: (ids, patch) => {
      const s = new Set(ids);
      set({
        jobs: get().jobs.map((j) => {
          if (!s.has(j.id) || ACTIVE.includes(j.status)) return j;
          const base = effectiveProfile(j);
          if (!base) return j;
          const next = structuredClone(base);
          patch(next);
          return { ...j, override: next };
        }),
      });
    },

    resetOverride: (ids) => {
      const s = new Set(ids);
      set({ jobs: get().jobs.map((j) => (s.has(j.id) ? { ...j, override: null } : j)) });
    },

    setOptions: (id, patch) => patchJob(id, (j) => ({ options: { ...j.options, ...patch } })),

    start: async (ids) => {
      const want = ids ? new Set(ids) : null;
      const jobs = get().jobs.filter((j) => j.status === "ready" && j.media && (!want || want.has(j.id)));
      if (!jobs.length) {
        toast("info", t("queue.nothingToStart"));
        return;
      }
      const settings = useSettingsStore.getState();
      const inputs = jobs.flatMap(toInputs);
      if (!(await enoughSpace(jobs))) return;
      try {
        const results = await api.startJobs(inputs, settings.naming, {
          hwDecode: settings.hwDecode,
          parallel: settings.parallel,
          keepDates: settings.keepDates,
          original: settings.originalAction,
          lowPriority: settings.lowPriority,
        });
        const byId = new Map(results.map((r) => [r.id, r]));
        set({
          running: true,
          jobs: get().jobs.map((j) => {
            const r = byId.get(j.id);
            if (!r) return j;
            const extras = j.extras.map((x, i): ExtraOutput => {
              const er = byId.get(extraId(j.id, i));
              if (!er) return x;
              return { ...x, preview: er, status: er.error ? "failed" : er.nameStatus === "skipped" ? "skipped" : "queued", progress: undefined, outcome: undefined };
            });
            j = { ...j, extras };
            if (r.error) return { ...j, preview: r, status: "failed", error: t(`error.${r.error}`) };
            if (r.nameStatus === "skipped") return { ...j, preview: r, status: "skipped" };
            if (j.status !== "ready") return { ...j, preview: r };
            return { ...j, preview: r, status: "queued", progress: undefined, outcome: undefined, fellBackReason: undefined, error: undefined };
          }),
        });
        if (!results.some((r) => !r.error && r.nameStatus !== "skipped") && !get().jobs.some((j) => ACTIVE.includes(j.status))) {
          set({ running: false });
        }
      } catch (e) {
        const err = errorOf(e);
        toast("err", t(`error.${err.code}`) === `error.${err.code}` ? err.detail : t(`error.${err.code}`));
      }
    },

    requeue: (ids) => {
      const s = new Set(ids);
      set({
        jobs: get().jobs.map((j) =>
          s.has(j.id) && FINAL.includes(j.status) && j.media
            ? { ...j, status: "ready", progress: undefined, outcome: undefined, error: undefined, fellBackReason: undefined, pass: undefined, extras: j.extras.map((x) => ({ profileId: x.profileId })) }
            : j,
        ),
      });
    },

    cancel: (id) => {
      api.cancelJob(id).catch(() => {});
      get().jobs.find((j) => j.id === id)?.extras.forEach((_, i) => api.cancelJob(extraId(id, i)).catch(() => {}));
    },
    setExtras: (id, extras) => patchJob(id, (j) => ({ extras: extras.map((profileId) => j.extras.find((x) => x.profileId === profileId) ?? { profileId }) })),

    stopAll: () => {
      api.cancelAll().catch(() => {});
      set({ paused: false });
    },

    togglePause: () => {
      const paused = !get().paused;
      api.setPaused(paused).catch(() => {});
      set({ paused });
    },

    setLogJob: (id) => set({ logJobId: id }),

    sampleJob: async (id) => {
      const job = get().jobs.find((j) => j.id === id);
      const input = job && toInput(job);
      if (!job || !input || job.sampling) return;
      patchJob(id, { sampling: true });
      try {
        const r = await api.previewJob(input, useSettingsStore.getState().hwDecode);
        patchJob(id, { sample: { ...r, key: settingsKey(job) }, sampling: false });
        openPath(r.file).catch(() => {});
      } catch (e) {
        patchJob(id, { sampling: false });
        toast("err", t("preview.failed", { error: errorOf(e).detail }));
      }
    },

    handleEvent: (ev) => {
      if ("id" in ev && ev.id.includes(EXTRA_SEP)) {
        const [parent, idx] = ev.id.split(EXTRA_SEP);
        const i = Number(idx);
        const patchExtra = (patch: (x: ExtraOutput) => ExtraOutput) =>
          patchJob(parent, (j) => ({ extras: j.extras.map((x, k) => (k === i ? patch(x) : x)) }));
        if (ev.type === "started") patchExtra((x) => ({ ...x, status: "running" }));
        else if (ev.type === "progress") patchExtra((x) => ({ ...x, progress: { percent: ev.percent, fps: ev.fps, speed: ev.speed, eta: ev.eta, size: ev.size } }));
        else if (ev.type === "finished")
          patchExtra((x) => ({ ...x, outcome: ev.outcome, status: ev.outcome.kind === "done" ? "done" : ev.outcome.kind === "failed" ? "failed" : "cancelled" }));
        return;
      }
      switch (ev.type) {
        case "started":
          patchJob(ev.id, { status: "running", pass: { pass: ev.pass, passes: ev.passes, fallback: ev.fallback } });
          break;
        case "progress":
          patchJob(ev.id, { progress: { percent: ev.percent, fps: ev.fps, speed: ev.speed, eta: ev.eta, size: ev.size } });
          break;
        case "fellBack":
          patchJob(ev.id, { fellBackReason: ev.reason });
          break;
        case "finished": {
          const status: JobStatus = ev.outcome.kind === "done" ? "done" : ev.outcome.kind === "failed" ? "failed" : "cancelled";
          patchJob(ev.id, (j) => ({
            status,
            outcome: ev.outcome,
            elapsed: ev.elapsed,
            error: ev.outcome.kind === "failed" ? ev.outcome.error : undefined,
            progress: ev.outcome.kind === "done" ? { ...(j.progress ?? { fps: 0, speed: 0, eta: 0, size: 0 }), percent: 100, eta: 0 } : j.progress,
          }));
          break;
        }
        case "idle":
          set({ running: false, paused: false });
          onQueueIdle(ev.done, ev.failed, ev.cancelled);
          break;
      }
    },
  };
});

export function settingsKey(j: Job): string {
  const { detectedCrop: _d, cropChecked: _c, ...options } = j.options;
  return JSON.stringify([effectiveProfile(j), options]);
}

export function sizeEstimate(j: Job): { bytes: number; measured: boolean } | null {
  const extras = j.extras.reduce((a, x) => a + (x.preview?.estimate ?? 0), 0);
  if (j.sample && j.sample.key === settingsKey(j)) return { bytes: j.sample.estimate + extras, measured: j.extras.length === 0 };
  const e = j.preview?.estimate;
  return e != null ? { bytes: e + extras, measured: false } : null;
}

export function toInputs(j: Job): JobInput[] {
  const main = toInput(j);
  if (!main) return [];
  const extras = j.extras.flatMap((x, i) => {
    const profile = useProfileStore.getState().byId(x.profileId);
    return profile ? [{ ...main, id: extraId(j.id, i), profile }] : [];
  });
  return [main, ...extras];
}

export function toInput(j: Job): JobInput | null {
  const profile = effectiveProfile(j);
  if (!profile || !j.media) return null;
  return { id: j.id, input: j.path, root: j.root, profile, media: j.media, options: j.options };
}

async function enoughSpace(jobs: Job[]): Promise<boolean> {
  const needs = jobs
    .map((j) => ({ dir: j.preview ? dirName(j.preview.output) : dirName(j.path), bytes: Math.round((sizeEstimate(j)?.bytes ?? j.media?.size ?? 0) * 1.1) }))
    .filter((n) => n.bytes > 0);
  try {
    const short = await api.checkSpace(needs);
    if (!short.length) return true;
    const lines = short.map((x) => t("space.line", { dir: x.dir, needed: formatBytes(x.needed), free: formatBytes(x.free) })).join("\n");
    return await ask(`${t("space.text")}\n\n${lines}`, { title: t("space.title"), kind: "warning", okLabel: t("space.startAnyway"), cancelLabel: t("common.cancel") });
  } catch {
    return true;
  }
}

let countdownTimer = 0;

function startCountdown(action: WhenDone, failed: number) {
  if (action === "nothing") return;
  window.clearInterval(countdownTimer);
  useQueueStore.setState({ countdown: { action, seconds: action === "quit" ? 10 : 60, failed } });
  countdownTimer = window.setInterval(() => {
    const c = useQueueStore.getState().countdown;
    if (!c) return window.clearInterval(countdownTimer);
    if (c.seconds <= 1) {
      window.clearInterval(countdownTimer);
      useQueueStore.setState({ countdown: null });
      runWhenDone(c.action);
    } else {
      useQueueStore.setState({ countdown: { ...c, seconds: c.seconds - 1 } });
    }
  }, 1000);
}

export function runWhenDone(action: WhenDone) {
  window.clearInterval(countdownTimer);
  useQueueStore.setState({ countdown: null, whenDone: "nothing" });
  if (action === "quit") getCurrentWindow().destroy().catch(() => {});
  else if (action === "sleep" || action === "shutdown") api.powerAction(action).catch((e) => toast("err", errorOf(e).detail));
}

function chime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.11);
      g.gain.linearRampToValueAtTime(0.12, now + i * 0.11 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.11);
      o.stop(now + i * 0.11 + 0.55);
    });
    window.setTimeout(() => ctx.close(), 1200);
  } catch {
  }
}

async function notifySystem(body: string) {
  try {
    if (document.hasFocus()) return;
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (ok) sendNotification({ title: "ZVideoConverter", body });
  } catch {
  }
}

function onQueueIdle(done: number, failed: number, cancelled: number) {
  const s = useSettingsStore.getState();
  if (done + failed === 0) return;
  if (s.soundWhenDone) chime();
  const text = failed ? t("queue.finishedWithErrors", { done, failed }) : t("queue.finished", { count: done });
  toast(failed ? "warn" : "ok", text);
  notifySystem(text);
  void cancelled;
  const when = useQueueStore.getState().whenDone;
  if (when !== "nothing" && done + failed > 0) startCountdown(when, failed);
  if (s.openFolderWhenDone && done) {
    const last = [...useQueueStore.getState().jobs].reverse().find((j) => j.outcome?.kind === "done");
    if (last?.outcome?.kind === "done") revealItemInDir(last.outcome.output).catch(() => {});
  }
}

let previewTimer = 0;
let lastSignature = "";

function signature(): string {
  const { jobs } = useQueueStore.getState();
  const relevant = jobs
    .filter((j) => (j.status === "ready" || j.status === "invalid") && j.media)
    .map((j) => [j.id, j.path, j.profileId, j.override, j.options, j.extras.map((x) => x.profileId)]);
  const profiles = useProfileStore.getState().profiles;
  const s = useSettingsStore.getState();
  return JSON.stringify([relevant, profiles, s.naming, !!useHwStore.getState().hw]);
}

async function refreshPreview() {
  const sig = signature();
  if (sig === lastSignature) return;
  lastSignature = sig;
  const jobs = useQueueStore.getState().jobs.filter((j) => j.status === "ready" && j.media);
  if (!jobs.length) return;
  const inputs = jobs.flatMap(toInputs);
  try {
    const previews = await api.previewJobs(inputs, useSettingsStore.getState().naming);
    const byId = new Map(previews.map((p) => [p.id, p]));
    useQueueStore.setState({
      jobs: useQueueStore.getState().jobs.map((j) =>
        byId.has(j.id) && j.status === "ready"
          ? { ...j, preview: byId.get(j.id), extras: j.extras.map((x, i) => ({ ...x, preview: byId.get(extraId(j.id, i)) ?? x.preview })) }
          : j,
      ),
    });
  } catch {
    lastSignature = "";
  }
}

function schedulePreview() {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(refreshPreview, 120);
}

let sessionTimer = 0;
let lastSession = "";
let sessionReady = false;

function saveSession() {
  if (!sessionReady) return;
  const entries: SessionEntry[] = useQueueStore
    .getState()
    .jobs.filter((j) => !FINAL.includes(j.status))
    .map((j) => ({
      path: j.path,
      root: j.root,
      profileId: j.profileId,
      override: j.override,
      options: j.options,
      output: j.preview?.output ?? null,
      extras: j.extras.map((x) => x.profileId),
    }));
  const data = JSON.stringify({ version: 1, jobs: entries });
  if (data === lastSession) return;
  lastSession = data;
  api.saveSession(data).catch(() => {});
}

export async function restoreSession() {
  let entries: SessionEntry[] = [];
  try {
    const raw = await api.loadSession();
    if (raw) entries = (JSON.parse(raw).jobs ?? []) as SessionEntry[];
  } catch {
    entries = [];
  }
  sessionReady = true;
  if (!entries.length) return;
  if (!useProfileStore.getState().loaded) await useProfileStore.getState().load();
  const outputs = entries.map((e) => e.output).filter((o): o is string => !!o);
  if (outputs.length) api.removePartials(outputs).catch(() => {});
  await useQueueStore.getState().add(
    entries.map((e) => e.path),
    new Map(entries.map((e) => [e.path, e])),
  );
  const count = useQueueStore.getState().jobs.length;
  if (count) {
    toast("info", t("session.restored", { count }), { label: t("session.clear"), run: () => useQueueStore.getState().clear() });
  }
}

let lastBar = "";
function updateTaskbar() {
  const { jobs, running, paused } = useQueueStore.getState();
  const run = jobs.filter((j) => ACTIVE.includes(j.status) || (FINAL.includes(j.status) && j.outcome));
  let progress: number | null = null;
  let error = false;
  if (running && run.length) {
    const total = run.reduce((a, j) => a + (FINAL.includes(j.status) ? 100 : j.status === "running" ? j.progress?.percent ?? 0 : 0), 0);
    progress = Math.round(total / run.length) / 100;
    error = run.some((j) => j.status === "failed");
  }
  const key = `${progress}:${paused}:${error}`;
  if (key === lastBar) return;
  lastBar = key;
  invoke("set_taskbar_progress", { progress, paused, error }).catch(() => {});
}

function syncWatchFolders() {
  const folders = useSettingsStore.getState().watchFolders.filter((f) => f.enabled);
  api
    .setWatchFolders(folders.map((f) => ({ id: f.id, path: f.path })))
    .then((failed) => {
      for (const id of failed) {
        const f = folders.find((x) => x.id === id);
        if (f) toast("warn", t("watch.failed", { path: f.path }));
      }
    })
    .catch(() => {});
}

export function initQueue() {
  useQueueStore.subscribe(schedulePreview);
  useQueueStore.subscribe(updateTaskbar);
  useQueueStore.subscribe(() => {
    window.clearTimeout(sessionTimer);
    sessionTimer = window.setTimeout(saveSession, 800);
  });
  useProfileStore.subscribe(schedulePreview);
  useSettingsStore.subscribe(schedulePreview);
  useHwStore.subscribe(schedulePreview);
  const engine = listen<EngineEvent>(ENGINE_EVENT, (e) => useQueueStore.getState().handleEvent(e.payload));
  const opened = listen<string[]>(OPEN_EVENT, (e) => useQueueStore.getState().add(e.payload));
  const watched = listen<{ folderId: string; path: string }>(WATCH_EVENT, (e) => {
    const folder = useSettingsStore.getState().watchFolders.find((f) => f.id === e.payload.folderId && f.enabled);
    if (!folder) return;
    const entry: SessionEntry = { path: e.payload.path, root: folder.path, profileId: folder.profileId, override: null, options: DEFAULT_OPTIONS, output: null, autoStart: true };
    useQueueStore.getState().add([e.payload.path], new Map([[e.payload.path, entry]]));
    toast("info", t("watch.found", { name: fileName(e.payload.path) }));
  });
  syncWatchFolders();
  let lastWatch = JSON.stringify(useSettingsStore.getState().watchFolders);
  useSettingsStore.subscribe((s) => {
    const now = JSON.stringify(s.watchFolders);
    if (now !== lastWatch) {
      lastWatch = now;
      syncWatchFolders();
    }
  });
  return Promise.all([engine, opened, watched]).then((fns) => () => fns.forEach((f) => f()));
}
