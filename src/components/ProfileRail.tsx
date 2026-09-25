import { useMemo, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
  ChevronRight,
  Clapperboard,
  Copy,
  Download,
  Film,
  GripVertical,
  Image,
  MoreHorizontal,
  Music,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
} from "./icons";
import { useT } from "../lib/i18n";
import { api, errorOf, type Profile } from "../lib/tauri";
import { codecLabel } from "../lib/format";
import { profileName, useProfileStore } from "../store/useProfileStore";
import { useQueueStore } from "../store/useQueueStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { toast } from "../store/useToastStore";
import { MenuButton, type MenuEntry } from "./ui";

export function profileIcon(p: Profile, size = 15) {
  if (p.container === "gif") return <Image size={size} />;
  if (["mp3", "m4a", "flac", "opus", "ogg", "wav"].includes(p.container)) return <Music size={size} />;
  if (p.video.mode === "copy") return <Clapperboard size={size} />;
  return <Film size={size} />;
}

export function profileSummary(p: Profile): string {
  const parts = [p.container.toUpperCase()];
  const audioOnly = ["mp3", "m4a", "flac", "opus", "ogg", "wav"].includes(p.container);
  if (p.container === "gif") parts.push(`${p.gif.width}px · ${p.gif.fps} fps`);
  else if (audioOnly) parts.push(p.audio.codec === "flac" || p.audio.codec === "pcm" || p.audio.codec === "alac" ? codecLabel(p.audio.codec) : `${codecLabel(p.audio.codec)} ${p.audio.bitrateKbps}k`);
  else if (p.video.mode === "copy") parts.push("copy");
  else parts.push(codecLabel(p.video.codec) + (p.video.tenBit ? " 10-bit" : ""));
  return parts.join(" · ");
}

export function ProfileRail() {
  const t = useT();
  const { profiles, editingId, setEditing, create, duplicate, remove, toggleFavourite, reorder, load } = useProfileStore();
  const defaultId = useSettingsStore((s) => s.defaultProfileId);
  const setSettings = useSettingsStore((s) => s.set);
  const selected = useQueueStore((s) => s.selected);
  const jobs = useQueueStore((s) => s.jobs);
  const setProfile = useQueueStore((s) => s.setProfile);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const match = (p: Profile) => !q || profileName(p).toLowerCase().includes(q) || profileSummary(p).toLowerCase().includes(q);
  const favourites = profiles.filter((p) => p.favourite && match(p));
  const custom = profiles.filter((p) => !p.builtin && match(p));
  const builtins = profiles.filter((p) => p.builtin && match(p));

  const usedBySelection = useMemo(() => {
    const s = new Set(selected);
    return new Set(jobs.filter((j) => s.has(j.id)).map((j) => (j.override ? "" : j.profileId)));
  }, [jobs, selected]);

  const apply = (p: Profile) => {
    setSettings({ defaultProfileId: p.id });
    if (selected.length) {
      setProfile(selected, p.id);
      toast("ok", t("profiles.applied", { count: selected.length, name: profileName(p) }));
    }
    if (editingId && editingId !== p.id) setEditing(null);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = profiles.filter((p) => !p.builtin).map((p) => p.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    reorder(next);
  };

  const importProfile = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Profile", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const p = await api.importProfile(path);
      await load();
      setEditing(p.id);
      toast("ok", t("profiles.imported", { name: p.name }));
    } catch (e) {
      toast("err", t("profiles.importFailed", { error: errorOf(e).detail }));
    }
  };

  const menuFor = (p: Profile): MenuEntry[] => [
    { label: p.builtin ? t("profiles.duplicateToEdit") : t("profiles.edit"), icon: <Pencil size={14} />, onSelect: () => (p.builtin ? duplicate(p.id) : setEditing(p.id)) },
    ...(p.builtin ? [] : [{ label: t("profiles.duplicate"), icon: <Copy size={14} />, onSelect: () => duplicate(p.id) }]),
    { label: p.favourite ? t("profiles.unfavourite") : t("profiles.favourite"), icon: <Star size={14} />, onSelect: () => toggleFavourite(p.id) },
    {
      label: t("profiles.export"),
      icon: <Upload size={14} />,
      onSelect: async () => {
        const path = await saveDialog({ defaultPath: `${profileName(p)}.zvc-profile.json`, filters: [{ name: "Profile", extensions: ["json"] }] });
        if (!path) return;
        try {
          await api.exportProfile(p.id, path);
          toast("ok", t("profiles.exported"));
        } catch (e) {
          toast("err", errorOf(e).detail);
        }
      },
    },
    ...(p.builtin ? [] : ["sep" as const, { label: t("profiles.delete"), icon: <Trash2 size={14} />, danger: true, onSelect: () => remove(p.id) }]),
  ];

  const row = (p: Profile, sortable = false) => (
    <ProfileRow
      key={(sortable ? "s-" : "") + p.id}
      p={p}
      sortable={sortable}
      active={p.id === defaultId}
      editing={p.id === editingId}
      marked={usedBySelection.has(p.id)}
      onClick={() => apply(p)}
      onEdit={() => (p.builtin ? duplicate(p.id) : setEditing(p.id))}
      onStar={() => toggleFavourite(p.id)}
      menu={menuFor(p)}
    />
  );

  return (
    <aside className="pane flex flex-col min-h-0 overflow-hidden" data-tour="profiles">
      <div className="pane-head">
        <span className="step">2</span>
        <span className="label flex-1">{t("steps.profile")}</span>
        <button className="btn btn-ghost btn-sm btn-icon" title={t("profiles.import")} aria-label={t("profiles.import")} onClick={importProfile}>
          <Download size={14} />
        </button>
        <button className="btn btn-outline-accent btn-sm" onClick={() => create(useProfileStore.getState().byId(defaultId))} title={t("profiles.newHint")}>
          <Plus size={14} />
          {t("profiles.new")}
        </button>
      </div>
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
          <input className="field pl-8" placeholder={t("profiles.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="text-[11px] mt-2 px-0.5 leading-snug" style={{ color: "var(--text-3)" }}>
          {selected.length ? t("profiles.hintSelection", { count: selected.length }) : t("profiles.hintDefault")}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {favourites.length > 0 && (
          <Group id="favourites" count={favourites.length} open={!!q} label={t("profiles.favourites")}>{favourites.map((p) => row(p))}</Group>
        )}
        <Group id="mine" count={custom.length} open={!!q} label={t("profiles.mine")}>
          {custom.length === 0 ? (
            <div className="text-[11.5px] px-2.5 py-2 leading-relaxed" style={{ color: "var(--text-3)" }}>
              {q ? t("profiles.noMatch") : t("profiles.mineEmpty")}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={custom.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                {custom.map((p) => row(p, !q))}
              </SortableContext>
            </DndContext>
          )}
        </Group>
        <Group id="builtin" count={builtins.length} open={!!q} label={t("profiles.builtin")}>{builtins.map((p) => row(p))}</Group>
      </div>
    </aside>
  );
}

function Group({ id, label, count, open, children }: { id: string; label: string; count: number; open?: boolean; children: React.ReactNode }) {
  const collapsed = useSettingsStore((s) => s.collapsedGroups.includes(id));
  const shut = collapsed && !open;
  const toggle = () => {
    const cur = useSettingsStore.getState().collapsedGroups;
    useSettingsStore.getState().set({ collapsedGroups: cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id] });
  };
  return (
    <div className="mt-2">
      <button
        type="button"
        className="label-quiet w-full flex items-center gap-1 px-1.5 pt-2 pb-1.5 text-left"
        style={{ background: "none", border: "none", cursor: "pointer" }}
        aria-expanded={!shut}
        onClick={toggle}
      >
        <ChevronRight size={12} style={{ transform: shut ? undefined : "rotate(90deg)", transition: "transform .15s" }} />
        <span className="flex-1">{label}</span>
        <span className="mono tnum" style={{ opacity: 0.7 }}>{count}</span>
      </button>
      {!shut && <div className="flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

function ProfileRow({
  p,
  sortable,
  active,
  editing,
  marked,
  onClick,
  onEdit,
  onStar,
  menu,
}: {
  p: Profile;
  sortable: boolean;
  active: boolean;
  editing: boolean;
  marked: boolean;
  onClick: () => void;
  onEdit: () => void;
  onStar: () => void;
  menu: MenuEntry[];
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id, disabled: !sortable });
  return (
    <div
      {...attributes}
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 5 : undefined,
        background: editing || active ? "var(--selected)" : undefined,
        boxShadow: editing ? "inset 0 0 0 1px var(--accent-line)" : undefined,
      }}
      className={clsx("group relative flex items-center gap-2.5 rounded-[4px] pl-3 pr-1 h-[44px] cursor-pointer", !active && !editing && "hover:bg-[var(--hover)]")}
      onClick={onClick}
      onDoubleClick={onEdit}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      title={p.builtin ? t("profiles.rowHintBuiltin") : t("profiles.rowHint")}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
        if (e.key === "F2") onEdit();
      }}
    >
      {active && <span className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: "var(--accent)" }} />}
      <span className="shrink-0" style={{ color: active ? "var(--accent)" : "var(--text-3)" }}>
        {profileIcon(p, 16)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium truncate flex items-center gap-1.5">
          <span className="truncate">{profileName(p)}</span>
          {active && <span className="label-quiet !text-[9.5px] shrink-0" style={{ color: "var(--accent)" }}>{t("profiles.defaultTag")}</span>}
          {marked && <span className="w-1.5 h-1.5 rounded-[2px] shrink-0" style={{ background: "var(--info)" }} title={t("profiles.usedBySelection")} />}
        </div>
        <div className="text-[10.5px] mono truncate mt-px" style={{ color: "var(--text-3)" }}>
          {profileSummary(p)}
        </div>
      </div>
      {sortable && (
        <span className="hidden group-hover:inline-flex opacity-60 cursor-grab shrink-0" style={{ color: "var(--text-3)" }} {...listeners} onClick={(e) => e.stopPropagation()} aria-label={t("profiles.drag")}>
          <GripVertical size={13} />
        </span>
      )}
      <button
        className="btn btn-ghost btn-sm btn-icon shrink-0 !hidden group-hover:!inline-flex"
        title={p.builtin ? t("profiles.duplicateToEdit") : t("profiles.edit")}
        aria-label={p.builtin ? t("profiles.duplicateToEdit") : t("profiles.edit")}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        {p.builtin ? <Copy size={13} /> : <Pencil size={13} />}
      </button>
      <button
        className={clsx("btn btn-ghost btn-sm btn-icon shrink-0", !p.favourite && "!hidden group-hover:!inline-flex")}
        style={p.favourite ? { color: "var(--warn)" } : undefined}
        title={p.favourite ? t("profiles.unfavourite") : t("profiles.favourite")}
        aria-label={p.favourite ? t("profiles.unfavourite") : t("profiles.favourite")}
        onClick={(e) => {
          e.stopPropagation();
          onStar();
        }}
      >
        <Star size={13} fill={p.favourite ? "currentColor" : "none"} />
      </button>
      <span className="hidden group-hover:inline-flex focus-within:inline-flex shrink-0" onClick={(e) => e.stopPropagation()}>
        <MenuButton items={menu} title={t("common.more")} align="right">
          <MoreHorizontal size={14} />
        </MenuButton>
      </span>
    </div>
  );
}
