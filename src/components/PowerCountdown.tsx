import { AnimatePresence, motion } from "motion/react";
import { useT } from "../lib/i18n";
import { runWhenDone, useQueueStore } from "../store/useQueueStore";

export function PowerCountdown() {
  const t = useT();
  const c = useQueueStore((s) => s.countdown);
  const cancel = useQueueStore((s) => s.cancelCountdown);
  return (
    <AnimatePresence>
      {c && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center"
          style={{ background: "rgba(8,8,9,.66)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="w-[380px] rounded-[8px] p-6 text-center" style={{ background: "var(--pane)", border: "1px solid var(--line-strong)", boxShadow: "var(--shadow)" }}>
            <div className="mono text-[56px] leading-none" style={{ color: "var(--accent)" }}>{c.seconds}</div>
            <div className="text-[14px] font-medium mt-3">{t(`when.countdown.${c.action}`, { seconds: c.seconds })}</div>
            {c.failed > 0 && (
              <div className="text-[12px] mt-2" style={{ color: "var(--warn)" }}>{t("when.failedNote", { count: c.failed })}</div>
            )}
            <div className="flex justify-center gap-2 mt-5">
              <button className="btn !h-9 !px-5" autoFocus onClick={cancel}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary !h-9 !px-5" onClick={() => runWhenDone(c.action)}>
                {t("when.now")}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
