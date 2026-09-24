import { create } from "zustand";
import { api, errorOf, type Profile } from "../lib/tauri";
import { t, tMaybe } from "../lib/i18n";
import { toast } from "./useToastStore";

interface ProfileState {
  profiles: Profile[];
  loaded: boolean;
  editingId: string | null;
  saving: "idle" | "saving" | "saved" | "error";
  load: () => Promise<void>;
  byId: (id: string) => Profile | undefined;
  update: (id: string, patch: (p: Profile) => void) => void;
  create: (base?: Profile) => Promise<Profile | null>;
  duplicate: (id: string) => Promise<Profile | null>;
  remove: (id: string) => Promise<void>;
  toggleFavourite: (id: string) => void;
  reorder: (ids: string[]) => void;
  setEditing: (id: string | null) => void;
  replace: (p: Profile) => void;
}

const timers = new Map<string, number>();

export function profileName(p: Profile): string {
  return p.builtin ? tMaybe(`profile.${p.id.slice(8)}.name`) ?? p.name : p.name;
}

export function profileDescription(p: Profile): string {
  return p.builtin ? tMaybe(`profile.${p.id.slice(8)}.desc`) ?? p.description : p.description;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  loaded: false,
  editingId: null,
  saving: "idle",

  load: async () => {
    try {
      set({ profiles: withBuiltinFavourites(await api.listProfiles()), loaded: true });
    } catch (e) {
      toast("err", errorOf(e).detail);
    }
  },

  byId: (id) => get().profiles.find((p) => p.id === id),

  replace: (p) => set({ profiles: get().profiles.map((x) => (x.id === p.id ? p : x)) }),

  update: (id, patch) => {
    const cur = get().byId(id);
    if (!cur || cur.builtin) return;
    const next = structuredClone(cur);
    patch(next);
    get().replace(next);
    set({ saving: "saving" });
    window.clearTimeout(timers.get(id));
    timers.set(
      id,
      window.setTimeout(async () => {
        try {
          const saved = await api.saveProfile(get().byId(id) ?? next);
          get().replace(saved);
          set({ saving: "saved" });
        } catch (e) {
          set({ saving: "error" });
          toast("err", t("profiles.saveFailed", { error: errorOf(e).detail }));
        }
      }, 350),
    );
  },

  create: async (base) => {
    const src = base ?? get().byId("builtin.mp4-h264");
    if (!src) return null;
    const draft: Profile = { ...structuredClone(src), id: "", builtin: false, favourite: false, description: "", name: t("profiles.newName") };
    try {
      const saved = await api.saveProfile(draft);
      set({ profiles: [...get().profiles, saved], editingId: saved.id });
      return saved;
    } catch (e) {
      toast("err", errorOf(e).detail);
      return null;
    }
  },

  duplicate: async (id) => {
    const src = get().byId(id);
    if (!src) return null;
    try {
      const saved = await api.duplicateProfile(id, t("profiles.copyName", { name: profileName(src) }));
      set({ profiles: [...get().profiles, saved], editingId: saved.id });
      return saved;
    } catch (e) {
      toast("err", errorOf(e).detail);
      return null;
    }
  },

  remove: async (id) => {
    const p = get().byId(id);
    if (!p || p.builtin) return;
    try {
      await api.deleteProfile(id);
      set({ profiles: get().profiles.filter((x) => x.id !== id), editingId: get().editingId === id ? null : get().editingId });
      toast("info", t("profiles.deleted", { name: p.name }), {
        label: t("common.undo"),
        run: async () => {
          const back = await api.saveProfile(p);
          set({ profiles: [...get().profiles, back].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.order - b.order) });
        },
      });
    } catch (e) {
      toast("err", errorOf(e).detail);
    }
  },

  toggleFavourite: (id) => {
    const p = get().byId(id);
    if (!p) return;
    if (p.builtin) {
      const favs = builtinFavourites();
      const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
      }
      get().replace({ ...p, favourite: next.includes(id) });
    } else {
      get().update(id, (x) => {
        x.favourite = !x.favourite;
      });
    }
  },

  reorder: (ids) => {
    const order = new Map(ids.map((id, i) => [id, i]));
    set({
      profiles: get().profiles.map((p) => (order.has(p.id) ? { ...p, order: order.get(p.id)! } : p)),
    });
    api.reorderProfiles(ids).catch((e) => toast("err", errorOf(e).detail));
  },

  setEditing: (id) => set({ editingId: id, saving: "idle" }),
}));

const FAV_KEY = "zvc.builtinFavourites";

function builtinFavourites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function withBuiltinFavourites(list: Profile[]): Profile[] {
  const favs = builtinFavourites();
  return list.map((p) => (p.builtin ? { ...p, favourite: favs.includes(p.id) } : p));
}
