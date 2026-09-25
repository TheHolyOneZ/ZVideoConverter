import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { ArrowLeft, ArrowRight, FilePlus2, Loader2, X } from "./icons";
import { Logo } from "./Logo";
import { useT, type TKey } from "../lib/i18n";
import { api, errorOf } from "../lib/tauri";
import { FAMILY_LABELS } from "../lib/format";
import { gpuShortName, useHwStore } from "../store/useHwStore";
import { useQueueStore } from "../store/useQueueStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { toast } from "../store/useToastStore";

type Placement = "right" | "left" | "top" | "bottom";

interface TourStep {
  target: string;
  title: TKey;
  text: TKey;
  placement: Placement;
  action?: "samples";
}

const STEPS: TourStep[] = [
  { target: "files", title: "tour.files.title", text: "tour.files.text", placement: "right", action: "samples" },
  { target: "outname", title: "tour.name.title", text: "tour.name.text", placement: "bottom" },
  { target: "profiles", title: "tour.profiles.title", text: "tour.profiles.text", placement: "right" },
  { target: "settings", title: "tour.settings.title", text: "tour.settings.text", placement: "left" },
  { target: "gpu", title: "tour.gpu.title", text: "tour.gpu.text", placement: "bottom" },
  { target: "output", title: "tour.output.title", text: "tour.output.text", placement: "top" },
  { target: "summary", title: "tour.summary.title", text: "tour.summary.text", placement: "top" },
  { target: "convert", title: "tour.convert.title", text: "tour.convert.text", placement: "top" },
];

interface TourState {
  welcome: boolean;
  active: boolean;
  samples: string[];
  showWelcome: () => void;
  start: () => void;
  end: () => void;
}

export const useTour = create<TourState>((set, get) => ({
  welcome: false,
  active: false,
  samples: [],
  showWelcome: () => set({ welcome: true }),
  start: () => {
    useSettingsStore.getState().set({ inspectorCollapsed: false });
    set({ welcome: false, active: true });
  },
  end: () => {
    set({ welcome: false, active: false });
    useSettingsStore.getState().set({ onboarded: true });
    const samples = get().samples;
    if (!samples.length) return;
    const q = useQueueStore.getState();
    const jobs = q.jobs.filter((j) => samples.includes(j.path));
    const untouched = jobs.every((j) => j.status === "ready" || j.status === "probing" || j.status === "invalid");
    if (untouched) {
      q.remove(jobs.map((j) => j.id));
      api.removeSamples().catch(() => {});
    }
    set({ samples: [] });
  },
}));

export const startTour = () => useTour.getState().start();

export function Onboarding() {
  const welcome = useTour((s) => s.welcome);
  const active = useTour((s) => s.active);
  if (welcome) return <Welcome />;
  if (active) return <Tour />;
  return null;
}

function Welcome() {
  const t = useT();
  const { start, end } = useTour();
  const { ffmpeg, hw } = useHwStore();
  const go = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    go.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      end();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [end]);

  let status = t("hw.checking");
  if (ffmpeg === null) status = t("welcome.noFfmpeg");
  else if (hw) {
    const gpu = hw.gpus.find((g) => g.vendor !== "other") ?? hw.gpus[0];
    const family = hw.encoders.find((e) => e.working && e.family !== "cpu")?.family;
    status = family && gpu ? t("welcome.gpuReady", { gpu: gpuShortName(gpu.name), api: FAMILY_LABELS[family] }) : t("welcome.cpuReady");
  }

  return (
    <>
      <div className="tour-dim" />
      <div className="fixed inset-0 z-[152] flex items-center justify-center p-6 pointer-events-none">
        <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="tour-card !static pointer-events-auto" style={{ width: 440, padding: 28 }}>
          <div className="tour-body flex flex-col items-center text-center">
            <Logo size={72} />
            <h1 id="welcome-title" className="text-[20px] font-medium mt-4 leading-tight">
              {t("welcome.title")}
            </h1>
            <p className="text-[13.5px] mt-2 leading-relaxed" style={{ color: "var(--text-2)" }}>
              {t("welcome.text")}
            </p>
            <div className="flex flex-col gap-2 w-full mt-6">
              <button ref={go} className="btn btn-primary !h-10 w-full justify-center !text-[13.5px]" onClick={start}>
                {t("welcome.tour")}
              </button>
              <button className="btn btn-ghost !h-9 w-full justify-center" onClick={end}>
                {t("welcome.skip")}
              </button>
            </div>
            <div className="flex items-center gap-2 mt-5 text-[11.5px] mono" style={{ color: "var(--text-3)" }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: ffmpeg === null ? "var(--warn)" : hw ? "var(--ok)" : "var(--text-3)" }} />
              {status}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 5;
const CARD_W = 340;
const GAP = 14;

function find(target: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)];
  return all.find((el) => el.getClientRects().length > 0) ?? null;
}

function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = Math.max(2, r.top - PAD);
  const left = Math.max(2, r.left - PAD);
  return {
    top,
    left,
    width: Math.min(vw - 2, r.right + PAD) - left,
    height: Math.min(vh - 2, r.bottom + PAD) - top,
  };
}

function place(hole: Rect, preferred: Placement, cardH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const room: Record<Placement, boolean> = {
    right: vw - (hole.left + hole.width) >= CARD_W + GAP * 2,
    left: hole.left >= CARD_W + GAP * 2,
    bottom: vh - (hole.top + hole.height) >= cardH + GAP * 2,
    top: hole.top >= cardH + GAP * 2,
  };
  const order: Placement[] = [preferred, "right", "left", "bottom", "top"];
  const side = order.find((p) => room[p]);
  let top: number;
  let left: number;
  switch (side) {
    case "right":
      left = hole.left + hole.width + GAP;
      top = hole.top + Math.min(40, hole.height / 2 - cardH / 2);
      break;
    case "left":
      left = hole.left - CARD_W - GAP;
      top = hole.top + Math.min(40, hole.height / 2 - cardH / 2);
      break;
    case "bottom":
      top = hole.top + hole.height + GAP;
      left = hole.left + Math.min(24, hole.width / 2 - CARD_W / 2);
      break;
    case "top":
      top = hole.top - cardH - GAP;
      left = hole.left + Math.min(24, hole.width / 2 - CARD_W / 2);
      break;
    default:
      top = hole.top + hole.height - cardH - 20;
      left = hole.left + hole.width - CARD_W - 20;
  }
  return {
    top: Math.max(12, Math.min(top, vh - cardH - 12)),
    left: Math.max(12, Math.min(left, vw - CARD_W - 12)),
  };
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el?.closest("input, textarea, [contenteditable='true']");
}

function Tour() {
  const t = useT();
  const end = useTour((s) => s.end);
  const ffmpeg = useHwStore((s) => s.ffmpeg);
  const running = useQueueStore((s) => s.running);
  const [idx, setIdx] = useState(0);
  const dir = useRef(1);
  const [hole, setHole] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(190);
  const [loading, setLoading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[idx];
  const last = idx === STEPS.length - 1;

  const go = (d: number) => {
    dir.current = d;
    const n = idx + d;
    if (n < 0) return;
    if (n >= STEPS.length) end();
    else setIdx(n);
  };

  useLayoutEffect(() => {
    let detach: (() => void) | undefined;
    const attach = (el: HTMLElement) => {
      el.scrollIntoView({ block: "nearest" });
      const update = () => {
        const r = measure(find(step.target) ?? el);
        setHole((h) => (h && h.top === r.top && h.left === r.left && h.width === r.width && h.height === r.height ? h : r));
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      window.addEventListener("resize", update);
      const poll = window.setInterval(update, 250);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", update);
        window.clearInterval(poll);
      };
    };
    const el = find(step.target);
    if (el) {
      detach = attach(el);
      return detach;
    }
    let tries = 0;
    const wait = window.setInterval(() => {
      const found = find(step.target);
      if (found) {
        window.clearInterval(wait);
        detach = attach(found);
      } else if (++tries >= 15) {
        window.clearInterval(wait);
        const n = idx + dir.current;
        if (n < 0 || n >= STEPS.length) end();
        else setIdx(n);
      }
    }, 100);
    return () => {
      window.clearInterval(wait);
      detach?.();
    };
  }, [idx, step.target, end]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [idx, loading, hole]);

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [idx]);

  useEffect(() => {
    if (last && running) end();
  }, [last, running, end]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        end();
      } else if (!isTyping(e) && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.stopPropagation();
        e.preventDefault();
        go(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const loadSamples = async () => {
    setLoading(true);
    try {
      const paths = await api.makeSamples();
      useTour.setState({ samples: paths });
      await useQueueStore.getState().add(paths);
      go(1);
    } catch (e) {
      const err = errorOf(e);
      toast("err", err.detail);
    } finally {
      setLoading(false);
    }
  };

  if (!hole) return <div className="tour-dim" />;

  const pos = place(hole, step.placement, cardH);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hasFiles = useQueueStore.getState().jobs.length > 0;

  return (
    <>
      <div className="tour-block" style={{ top: 0, left: 0, width: vw, height: hole.top }} />
      <div className="tour-block" style={{ top: hole.top + hole.height, left: 0, width: vw, height: Math.max(0, vh - hole.top - hole.height) }} />
      <div className="tour-block" style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }} />
      <div className="tour-block" style={{ top: hole.top, left: hole.left + hole.width, width: Math.max(0, vw - hole.left - hole.width), height: hole.height }} />
      <div className="tour-hole" style={hole} />

      <div ref={cardRef} className="tour-card" style={pos} role="dialog" aria-live="polite" aria-labelledby="tour-title">
        <div key={idx} className="tour-body">
          <div className="flex items-center gap-2">
            <span className="text-[11px] mono tnum" style={{ color: "var(--text-3)" }}>
              {t("tour.stepOf", { n: idx + 1, total: STEPS.length })}
            </span>
            <span className="flex-1" />
            <button className="btn btn-ghost btn-sm btn-icon -mr-1.5 -mt-1" onClick={end} title={t("tour.skip")} aria-label={t("tour.skip")}>
              <X size={14} />
            </button>
          </div>
          <h2 id="tour-title" className="text-[15px] font-medium mt-1">
            {t(step.title)}
          </h2>
          <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: "var(--text-2)" }}>
            {t(step.text)}
          </p>
          {last && (
            <p className="text-[13px] mt-2 leading-relaxed" style={{ color: "var(--text-2)" }}>
              {t("tour.finish", { keys: "Ctrl+K" })}
            </p>
          )}
          {step.action === "samples" && ffmpeg && !hasFiles && (
            <button className="btn btn-outline-accent w-full justify-center mt-3" onClick={loadSamples} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <FilePlus2 size={14} />}
              {loading ? t("tour.samplesMaking") : t("tour.samples")}
            </button>
          )}
          <div className="flex items-center gap-2 mt-4">
            <div className="tour-pips" aria-hidden>
              {STEPS.map((s, i) => (
                <i key={s.target} data-on={i <= idx ? "" : undefined} />
              ))}
            </div>
            <span className="flex-1" />
            {idx > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => go(-1)}>
                <ArrowLeft size={13} />
                {t("tour.back")}
              </button>
            )}
            <button ref={nextRef} className="btn btn-primary btn-sm" onClick={() => go(1)}>
              {last ? t("tour.done") : t("tour.next")}
              {!last && <ArrowRight size={13} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
