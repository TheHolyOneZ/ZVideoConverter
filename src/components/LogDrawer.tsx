import { AnimatePresence, motion } from "motion/react";
import { ScrollText, X } from "./icons";
import { useT } from "../lib/i18n";
import { useQueueStore } from "../store/useQueueStore";
import { CommandBox } from "./Inspector";

export function LogDrawer() {
  const t = useT();
  const id = useQueueStore((s) => s.logJobId);
  const job = useQueueStore((s) => s.jobs.find((j) => j.id === s.logJobId));
  const close = () => useQueueStore.getState().setLogJob(null);
  const log = job?.outcome?.kind === "failed" ? job.outcome.log : "";
  return (
    <AnimatePresence>
      {id && job && (
        <motion.div
          className="fixed left-1/2 bottom-[112px] z-30 menu !p-0 w-[min(880px,calc(100vw-48px))] flex flex-col max-h-[55vh]"
          style={{ x: "-50%" }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18 }}
        >
          <div className="flex items-center gap-2 px-4 h-11 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
            <ScrollText size={15} style={{ color: "var(--accent)" }} />
            <span className="text-[13px] font-medium truncate flex-1">{t("log.title", { name: job.name })}</span>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={close} aria-label={t("common.close")}>
              <X size={14} />
            </button>
          </div>
          <div className="overflow-y-auto p-4 flex flex-col gap-3">
            {job.fellBackReason && (
              <div className="text-[12px] p-2.5 rounded-[5px]" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
                {t("queue.fellBack", { reason: job.fellBackReason })}
              </div>
            )}
            <div>
              <div className="label mb-1">{t("log.command")}</div>
              {job.preview?.command ? <CommandBox text={job.preview.command} /> : <div className="text-[12px]" style={{ color: "var(--text-3)" }}>{t("log.noCommand")}</div>}
            </div>
            <div>
              <div className="label mb-1">{t("log.output")}</div>
              {log ? <CommandBox text={log} /> : <div className="text-[12px]" style={{ color: "var(--text-3)" }}>{job.status === "done" ? t("log.clean") : t("log.empty")}</div>}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
