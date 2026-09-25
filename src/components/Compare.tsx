import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useT } from "../lib/i18n";
import { api, errorOf } from "../lib/tauri";
import { formatTimestamp } from "../lib/format";
import { toast } from "../store/useToastStore";
import type { Job } from "../store/useQueueStore";
import { Loader2 } from "./icons";
import { Modal } from "./ui";

interface CompareRequest {
  title: string;
  source: string;
  sourceAt: number;
  output: string;
  outputAt: number;
}

export const useCompareStore = create<{ req: CompareRequest | null; open: (r: CompareRequest) => void; close: () => void }>((set) => ({
  req: null,
  open: (req) => set({ req }),
  close: () => set({ req: null }),
}));

export function compareFinished(job: Job, output: string) {
  const start = job.options.trimStart ?? 0;
  const end = job.options.trimEnd ?? job.media?.duration ?? start + 10;
  const mid = (end - start) / 2;
  useCompareStore.getState().open({ title: job.name, source: job.path, sourceAt: start + mid, output, outputAt: mid });
}

export function comparePreview(job: Job, file: string, start: number, seconds: number) {
  useCompareStore.getState().open({ title: job.name, source: job.path, sourceAt: start + seconds / 2, output: file, outputAt: seconds / 2 });
}

export function CompareView() {
  const t = useT();
  const { req, close } = useCompareStore();
  const [frames, setFrames] = useState<{ before: string; after: string } | null>(null);
  const [shown, setShown] = useState<CompareRequest | null>(null);
  if (req && req !== shown) setShown(req);
  const [split, setSplit] = useState(50);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFrames(null);
    setSplit(50);
    if (!req) return;
    let alive = true;
    api
      .compareFrames(req.source, req.sourceAt, req.output, req.outputAt)
      .then((f) => alive && setFrames(f))
      .catch((e) => {
        toast("err", errorOf(e).detail);
        close();
      });
    return () => {
      alive = false;
    };
  }, [req, close]);

  const drag = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setSplit(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <Modal open={!!req} onClose={close} title={t("compare.title", { name: shown?.title ?? "" })} width={1100}>
      <div className="p-4">
        {!frames || !shown ? (
          <div className="h-[420px] grid place-items-center" style={{ color: "var(--text-3)" }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <>
            <div
              ref={box}
              className="relative select-none overflow-hidden rounded-[4px] cursor-ew-resize"
              style={{ background: "#000" }}
              onMouseDown={(e) => {
                drag(e.clientX);
                const move = (ev: MouseEvent) => drag(ev.clientX);
                const up = () => {
                  window.removeEventListener("mousemove", move);
                  window.removeEventListener("mouseup", up);
                };
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
              }}
            >
              <img src={frames.after} alt="" draggable={false} className="block w-full h-auto" />
              <img
                src={frames.before}
                alt=""
                draggable={false}
                className="absolute inset-0 w-full h-full object-contain"
                style={{ clipPath: `inset(0 ${100 - split}% 0 0)`, background: "#000" }}
              />
              <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 pointer-events-none" style={{ left: `${split}%`, background: "var(--accent)" }}>
                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-7 rounded-[2px]" style={{ background: "var(--accent)" }} />
              </div>
              <span className="absolute left-3 top-3 tag !bg-black/70 !border-transparent !text-white">{t("compare.before")}</span>
              <span className="absolute right-3 top-3 tag !bg-black/70 !border-transparent !text-white">{t("compare.after")}</span>
            </div>
            <div className="flex justify-between text-[11.5px] mt-2" style={{ color: "var(--text-3)" }}>
              <span>{t("compare.hint")}</span>
              <span className="mono">{formatTimestamp(shown.sourceAt)}</span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
