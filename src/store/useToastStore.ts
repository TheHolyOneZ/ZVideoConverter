import { create } from "zustand";

export type ToastKind = "info" | "ok" | "warn" | "err";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">, ms?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, ms = 4200) => {
    const id = seq++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    window.setTimeout(() => get().dismiss(id), t.action ? Math.max(ms, 7000) : ms);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = (kind: ToastKind, text: string, action?: Toast["action"]) =>
  useToastStore.getState().push({ kind, text, action });
