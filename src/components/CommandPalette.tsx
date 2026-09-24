import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Search } from "./icons";
import { useT } from "../lib/i18n";

export interface PaletteAction {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  hint?: string;
  run: () => void;
}

export function CommandPalette({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: PaletteAction[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return actions;
    const words = s.split(/\s+/);
    return actions.filter((a) => words.every((w) => `${a.label} ${a.group}`.toLowerCase().includes(w)));
  }, [q, actions]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (a: PaletteAction | undefined) => {
    if (!a) return;
    onClose();
    requestAnimationFrame(() => a.run());
  };

  let lastGroup = "";
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex justify-center pt-[12vh]"
          style={{ background: "rgba(3,5,9,0.5)", backdropFilter: "blur(2px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          onMouseDown={onClose}
        >
          <motion.div
            className="menu !p-0 w-[560px] max-w-[92vw] h-fit max-h-[62vh] flex flex-col overflow-hidden"
            initial={{ y: -8, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            transition={{ duration: 0.14 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 px-4 h-12 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
              <Search size={16} style={{ color: "var(--text-3)" }} />
              <input
                ref={inputRef}
                className="flex-1 bg-transparent outline-none text-[14px]"
                placeholder={t("palette.placeholder")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, filtered.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    run(filtered[active]);
                  } else if (e.key === "Escape") {
                    onClose();
                  }
                }}
              />
              <span className="kbd">Esc</span>
            </div>
            <div ref={listRef} className="overflow-y-auto p-1.5">
              {filtered.length === 0 && <div className="text-[12.5px] p-4 text-center" style={{ color: "var(--text-3)" }}>{t("palette.nothing")}</div>}
              {filtered.map((a, i) => {
                const header = a.group !== lastGroup ? a.group : null;
                lastGroup = a.group;
                return (
                  <div key={a.id}>
                    {header && <div className="label !text-[10px] px-2.5 pt-2.5 pb-1">{header}</div>}
                    <button
                      data-i={i}
                      className="menu-item !h-9"
                      data-active={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => run(a)}
                    >
                      {a.icon}
                      <span className="flex-1 truncate">{a.label}</span>
                      {a.hint && <span className="kbd">{a.hint}</span>}
                      {i === active && <CornerDownLeft size={13} style={{ color: "var(--text-3)" }} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
