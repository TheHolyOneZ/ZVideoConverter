import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "./icons";
import { useToastStore } from "../store/useToastStore";

const ICON = {
  info: <Info size={15} style={{ color: "var(--info)" }} />,
  ok: <CheckCircle2 size={15} style={{ color: "var(--ok)" }} />,
  warn: <AlertTriangle size={15} style={{ color: "var(--warn)" }} />,
  err: <XCircle size={15} style={{ color: "var(--err)" }} />,
};

export function Toasts() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="fixed right-5 bottom-[118px] z-50 flex flex-col gap-2 items-end pointer-events-none" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.18 }}
            className="menu pointer-events-auto flex items-center gap-2.5 !py-2.5 !pl-3.5 !pr-2 max-w-[420px]"
          >
            {ICON[t.kind]}
            <span className="text-[12.5px] leading-snug flex-1">{t.text}</span>
            {t.action && (
              <button
                className="btn btn-outline-accent btn-sm"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
