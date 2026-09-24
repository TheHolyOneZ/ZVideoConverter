import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, X } from "./icons";
import clsx from "clsx";

interface PopoverProps {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
  width?: number | "anchor";
  align?: "left" | "right";
  maxHeight?: number;
  at?: { x: number; y: number } | null;
}

export function Popover({ anchor, open, onDismiss, children, width, align = "left", maxHeight = 360, at }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width?: number; up: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = ref.current;
      const h = el?.offsetHeight ?? 200;
      const w = el?.offsetWidth ?? 200;
      if (at) {
        const left = Math.min(at.x, window.innerWidth - w - 8);
        const top = at.y + h > window.innerHeight - 8 ? Math.max(8, at.y - h) : at.y;
        setPos({ left, top, up: false });
        return;
      }
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const pw = width === "anchor" ? a.width : width;
      const realW = pw ?? w;
      const up = a.bottom + h + 8 > window.innerHeight && a.top > h + 8;
      let left = align === "right" ? a.right - realW : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - realW - 8));
      setPos({ left, top: up ? a.top - h - 4 : a.bottom + 4, width: pw, up });
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, anchor, width, align, at]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      onDismiss();
    };
    const onResize = () => onDismiss();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onDismiss, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className="menu fixed z-50 overflow-y-auto"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width: pos?.width,
        maxHeight,
        opacity: pos ? 1 : 0,
        transformOrigin: pos?.up ? "bottom" : "top",
        animation: pos ? "pop-in .12s ease-out" : undefined,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect: () => void;
}
export type MenuEntry = MenuItem | "sep";

export function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  const [active, setActive] = useState(-1);
  const real = items.map((it, i) => (it === "sep" || it.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const pos = real.indexOf(active);
        const next = e.key === "ArrowDown" ? real[(pos + 1) % real.length] : real[(pos - 1 + real.length) % real.length];
        setActive(next ?? -1);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        const it = items[active];
        if (it !== "sep") {
          it.onSelect();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div role="menu">
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className="menu-item"
            data-active={i === active}
            disabled={it.disabled}
            style={it.danger ? { color: "var(--err)" } : undefined}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              it.onSelect();
              onClose();
            }}
          >
            {it.checked !== undefined ? (
              <Check size={14} style={{ opacity: it.checked ? 1 : 0, color: "var(--accent)" }} />
            ) : (
              it.icon
            )}
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="kbd">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function MenuButton({
  items,
  children,
  className,
  title,
  align = "left",
  width,
}: {
  items: MenuEntry[];
  children: ReactNode;
  className?: string;
  title?: string;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        className={className ?? "btn btn-ghost btn-sm btn-icon"}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {children}
      </button>
      <Popover anchor={ref} open={open} onDismiss={() => setOpen(false)} align={align} width={width}>
        <MenuList items={items} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}

export interface Option<T extends string | number = string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={clsx("field flex items-center gap-2 text-left", className)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        disabled={disabled}
        style={{ opacity: disabled ? 0.5 : 1 }}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const enabled = options.filter((o) => !o.disabled);
            const i = enabled.findIndex((o) => o.value === value);
            const next = enabled[(i + (e.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length];
            if (next) onChange(next.value);
          }
        }}
      >
        <span className="flex-1 truncate">{current?.label ?? "–"}</span>
        <ChevronDown size={14} style={{ color: "var(--text-3)", transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
      </button>
      <Popover anchor={ref} open={open} onDismiss={() => setOpen(false)} width="anchor">
        <MenuList
          items={options.map((o) => ({
            label: o.label,
            hint: o.hint,
            disabled: o.disabled,
            checked: o.value === value,
            onSelect: () => onChange(o.value),
          }))}
          onClose={() => setOpen(false)}
        />
      </Popover>
    </>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="switch"
      data-on={on}
      disabled={disabled}
      style={{ opacity: disabled ? 0.45 : 1 }}
      onClick={() => onChange(!on)}
    />
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
  full,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  full?: boolean;
}) {
  return (
    <div className={clsx("seg", full && "flex w-full")} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-on={o.value === value}
          title={o.title}
          disabled={o.disabled}
          className={full ? "flex-1" : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, hint, children, stack }: { label: ReactNode; hint?: ReactNode; children: ReactNode; stack?: boolean }) {
  return (
    <div className={clsx("py-2", stack ? "flex flex-col gap-1.5" : "flex items-center justify-between gap-3")}>
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold" style={{ color: "var(--text)" }}>
          {label}
        </div>
        {hint && (
          <div className="text-[11.5px] leading-snug mt-0.5" style={{ color: "var(--text-3)" }}>
            {hint}
          </div>
        )}
      </div>
      <div className={clsx(stack ? "w-full" : "shrink-0 flex items-center")}>{children}</div>
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  placeholder,
  width = 96,
  allowEmpty,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  placeholder?: string;
  width?: number;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const s = text.trim().replace(",", ".");
    if (!s) {
      if (allowEmpty) onChange(null);
      else setText(value == null ? "" : String(value));
      return;
    }
    let n = Number(s);
    if (!isFinite(n)) {
      setText(value == null ? "" : String(value));
      return;
    }
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (step >= 1) n = Math.round(n);
    setText(String(n));
    onChange(n);
  };
  return (
    <div className="relative" style={{ width }}>
      <input
        className="field tnum pr-9"
        value={text}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = (Number(text) || 0) + (e.key === "ArrowUp" ? step : -step);
            const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
            setText(String(c));
            onChange(c);
          }
        }}
      />
      {suffix && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: "var(--text-3)" }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  width = 560,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center p-6"
          style={{ background: "rgba(8,8,9,0.6)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className="flex flex-col max-h-full overflow-hidden rounded-[8px]"
            style={{ background: "var(--pane)", border: "1px solid var(--line-strong)", boxShadow: "var(--shadow)", width, maxWidth: "94vw" }}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 pl-5 pr-3 h-11 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
              {icon && <span style={{ color: "var(--accent)" }}>{icon}</span>}
              <span className="text-[13.5px] font-medium flex-1">{title}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <div className="overflow-y-auto">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-2 px-5 py-3 shrink-0" style={{ borderTop: "1px solid var(--line)" }}>
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 p-6" style={{ color: "var(--text-3)" }}>
      <div style={{ color: "var(--text-3)" }}>{icon}</div>
      <div className="text-[13px] font-semibold" style={{ color: "var(--text-2)" }}>
        {title}
      </div>
      {text && <div className="text-[12px] max-w-[260px] leading-relaxed">{text}</div>}
      {children}
    </div>
  );
}
