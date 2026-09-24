import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  FileVideo,
  Film,
  Layers,
  Loader2,
  Lock,
  Music,
  Plus,
  Save,
  SlidersHorizontal,
  Subtitles,
  Search,
  Undo2,
  X,
} from "./icons";
import { useT } from "../lib/i18n";
import { api, errorOf, type AudioCodec, type Container, type Crop, type EncoderPref, type Fit, type Profile, type RateControl, type Resolution, type VideoCodec } from "../lib/tauri";
import { COMMON_LANGUAGES, languageName, normalizeLang, subtitleSources } from "../lib/lang";
import { codecLabel, FAMILY_LABELS, fileName, formatBytes, formatDuration, formatTimestamp, parseTimestamp } from "../lib/format";
import { profileDescription, profileName, useProfileStore } from "../store/useProfileStore";
import { ACTIVE, effectiveProfile, settingsKey, useQueueStore, type Job } from "../store/useQueueStore";
import { openPath } from "@tauri-apps/plugin-opener";
import { comparePreview } from "./Compare";
import { useHwStore } from "../store/useHwStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { toast } from "../store/useToastStore";
import { MenuButton, NumberField, Popover, Row, Select, Seg, Switch } from "./ui";
import { profileIcon } from "./ProfileRail";

const VIDEO_CONTAINERS: Container[] = ["mp4", "mkv", "webm", "mov", "avi", "ts", "gif"];
const AUDIO_CONTAINERS: Container[] = ["mp3", "m4a", "flac", "opus", "ogg", "wav"];
const AUDIO_ONLY = new Set<Container>(AUDIO_CONTAINERS);

const VIDEO_CODECS: Record<Container, VideoCodec[]> = {
  mp4: ["h264", "hevc", "av1", "vp9", "mpeg4", "prores"],
  mov: ["h264", "hevc", "av1", "vp9", "mpeg4", "prores"],
  mkv: ["h264", "hevc", "av1", "vp9", "mpeg4", "prores"],
  webm: ["vp9", "av1"],
  avi: ["h264", "mpeg4"],
  ts: ["h264", "hevc"],
  gif: ["gif"],
  mp3: [], m4a: [], flac: [], opus: [], ogg: [], wav: [],
};
const AUDIO_CODECS: Record<Container, AudioCodec[]> = {
  mp4: ["aac", "mp3", "ac3", "opus", "flac", "alac"],
  mov: ["aac", "mp3", "ac3", "opus", "flac", "alac"],
  mkv: ["aac", "mp3", "ac3", "opus", "flac", "vorbis", "pcm", "alac"],
  webm: ["opus", "vorbis"],
  avi: ["mp3", "ac3", "pcm"],
  ts: ["aac", "mp3", "ac3"],
  gif: [],
  mp3: ["mp3"],
  m4a: ["aac", "alac"],
  flac: ["flac"],
  opus: ["opus"],
  ogg: ["vorbis", "opus", "flac"],
  wav: ["pcm"],
};

type ManualCrop = Extract<Crop, { kind: "manual" }>;

type Tab = "video" | "audio" | "subs" | "output" | "file";

export function Inspector() {
  const t = useT();
  const editingId = useProfileStore((s) => s.editingId);
  const setEditing = useProfileStore((s) => s.setEditing);
  const profiles = useProfileStore((s) => s.profiles);
  const saving = useProfileStore((s) => s.saving);
  const updateProfile = useProfileStore((s) => s.update);
  const duplicate = useProfileStore((s) => s.duplicate);
  const defaultId = useSettingsStore((s) => s.defaultProfileId);
  const jobs = useQueueStore((s) => s.jobs);
  const selectedIds = useQueueStore((s) => s.selected);
  const { editOverride, resetOverride } = useQueueStore();

  const selectedJobs = useMemo(() => {
    const s = new Set(selectedIds);
    return jobs.filter((j) => s.has(j.id));
  }, [jobs, selectedIds]);

  const [view, setView] = useState<"files" | "profile">("files");
  useEffect(() => setView("files"), [selectedIds]);
  const mode: "files" | "profile" = selectedJobs.length > 0 && !editingId && view === "files" ? "files" : "profile";
  const profileId = editingId ?? (selectedJobs.length ? selectedJobs[0].profileId : defaultId);
  const profile = mode === "profile" ? profiles.find((p) => p.id === profileId) ?? profiles[0] : effectiveProfile(selectedJobs[0]);
  const [tab, setTab] = useState<Tab>("video");
  useEffect(() => {
    if (tab === "file" && (mode !== "files" || selectedJobs.length !== 1)) setTab("video");
  }, [mode, selectedJobs.length, tab]);

  if (!profile) return <aside className="pane" />;

  const locked = mode === "files" && selectedJobs.some((j) => ACTIVE.includes(j.status));
  const readOnly = (mode === "profile" && profile.builtin) || locked;
  const edit = (fn: (p: Profile) => void) => {
    if (readOnly) return;
    if (mode === "profile") updateProfile(profile.id, fn);
    else editOverride(selectedJobs.map((j) => j.id), fn);
  };
  const overridden = mode === "files" && selectedJobs.some((j) => j.override);
  const mixed = mode === "files" && new Set(selectedJobs.map((j) => JSON.stringify(effectiveProfile(j)))).size > 1;

  const saveAsProfile = async () => {
    const created = await useProfileStore.getState().create({ ...profile, name: t("profiles.fromFile", { name: profileName(profile) }) });
    if (created) {
      useQueueStore.getState().setProfile(selectedJobs.map((j) => j.id), created.id);
      toast("ok", t("profiles.created", { name: created.name }));
    }
  };

  const tabs: { id: Tab; label: string; icon: ReactNode; hidden?: boolean }[] = [
    { id: "video", label: t("inspector.video"), icon: <Film size={13} /> },
    { id: "audio", label: t("inspector.audio"), icon: <Music size={13} /> },
    { id: "subs", label: t("inspector.subs"), icon: <Subtitles size={13} />, hidden: AUDIO_ONLY.has(profile.container) || profile.container === "gif" },
    { id: "output", label: t("inspector.output"), icon: <SlidersHorizontal size={13} /> },
    { id: "file", label: t("inspector.file"), icon: <FileVideo size={13} />, hidden: !(mode === "files" && selectedJobs.length === 1) },
  ];

  return (
    <aside className="pane flex flex-col min-h-0 overflow-hidden" data-tour="settings">
      <div className="pane-head">
        <span className="label flex-1">{t("inspector.head")}</span>
        {selectedJobs.length > 0 && !editingId && (
          <Seg
            value={mode}
            onChange={(v) => setView(v)}
            options={[
              { value: "files", label: t("inspector.switchFiles", { count: selectedJobs.length }), title: t("inspector.switchFilesHint") },
              { value: "profile", label: t("inspector.switchProfile"), title: t("inspector.switchProfileHint") },
            ]}
          />
        )}
        {editingId && (
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
            <Check size={13} />
            {t("inspector.doneEditing")}
          </button>
        )}
      </div>
      <div className="px-4 pt-3 pb-3 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
        {mode === "profile" ? (
          <div>
            {profile.builtin ? (
              <div className="text-[15px] font-medium truncate">{profileName(profile)}</div>
            ) : (
              <input
                className="field !h-8 !text-[14px] font-medium"
                value={profile.name}
                onChange={(e) => edit((p) => void (p.name = e.target.value))}
                aria-label={t("profiles.name")}
              />
            )}
            <div className="text-[12px] mt-1 leading-snug" style={{ color: "var(--text-3)" }}>
              {profileDescription(profile) || t("inspector.noDescription")}
            </div>
            {profile.builtin ? (
              <div className="flex items-center gap-2 mt-2.5 p-2 pl-2.5 rounded-[5px] text-[12px]" style={{ background: "var(--hover)", color: "var(--text-2)" }}>
                <Lock size={13} className="shrink-0" />
                <span className="flex-1 leading-snug">{t("inspector.builtinReadOnly")}</span>
                <button className="btn btn-outline-accent btn-sm" onClick={() => duplicate(profile.id)}>
                  <Copy size={12} />
                  {t("profiles.duplicateToEdit")}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-2 text-[11.5px]" style={{ color: saving === "error" ? "var(--err)" : "var(--text-3)" }}>
                {saving === "saving" ? t("inspector.saving") : saving === "error" ? t("inspector.saveError") : <><Check size={12} style={{ color: "var(--ok)" }} /> {t("inspector.autosave")}</>}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-[13.5px] font-medium truncate" title={selectedJobs.map((j) => j.name).join("\n")}>
              {selectedJobs.length === 1 ? selectedJobs[0].name : t("inspector.manyFiles", { count: selectedJobs.length })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {locked ? (
                <span className="tag tag-warn"><Lock size={11} /> {t("inspector.lockedRunning")}</span>
              ) : overridden ? (
                <>
                  <span className="tag" style={{ color: "var(--info)", borderColor: "var(--info)" }}>{t("inspector.customSettings")}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => resetOverride(selectedJobs.map((j) => j.id))}>
                    <Undo2 size={12} />
                    {t("inspector.resetToProfile")}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={saveAsProfile}>
                    <Save size={12} />
                    {t("inspector.saveAsProfile")}
                  </button>
                </>
              ) : (
                <span className="text-[11.5px] leading-snug" style={{ color: "var(--text-3)" }}>
                  {t("inspector.overrideHint", { name: profileName(profile), count: selectedJobs.length })}
                </span>
              )}
              {mixed && <span className="tag tag-warn">{t("inspector.mixed")}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="flex px-2 shrink-0" role="tablist" style={{ borderBottom: "1px solid var(--line)" }}>
        {tabs.filter((x) => !x.hidden).map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            title={x.label}
            className="flex items-center justify-center gap-1.5 h-9 px-2.5 text-[12px] font-medium min-w-0"
            style={{
              background: "transparent",
              color: tab === x.id ? "var(--text)" : "var(--text-3)",
              boxShadow: tab === x.id ? "inset 0 -2px 0 var(--accent)" : undefined,
              border: "none",
              flex: tab === x.id ? "0 0 auto" : "0 1 auto",
            }}
            onClick={() => setTab(x.id)}
          >
            <span className="shrink-0">{x.icon}</span>
            {(tab === x.id || tabs.filter((y) => !y.hidden).length <= 4) && <span className="truncate">{x.label}</span>}
          </button>
        ))}
      </div>

      <div className={clsx("flex-1 overflow-y-auto px-4 pb-6 pt-1", readOnly && "readonly")} style={readOnly ? { opacity: 0.94 } : undefined}>
        <Warnings profile={profile} />
        <fieldset disabled={readOnly} className="contents">
          {tab === "video" && <VideoTab p={profile} edit={edit} />}
          {tab === "audio" && <AudioTab p={profile} edit={edit} />}
          {tab === "subs" && <SubsTab p={profile} edit={edit} job={mode === "files" && selectedJobs.length === 1 ? selectedJobs[0] : undefined} />}
          {tab === "output" && <OutputTab p={profile} edit={edit} />}
          {tab === "file" && selectedJobs.length === 1 && <FileTab job={selectedJobs[0]} />}
        </fieldset>
      </div>
    </aside>
  );
}

type Edit = (fn: (p: Profile) => void) => void;

function Section({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={clsx(!first && "mt-4 pt-3")} style={!first ? { borderTop: "1px solid var(--line)" } : undefined}>
      <div className="label mb-1 mt-2">{title}</div>
      {children}
    </div>
  );
}

function Chips<T extends string>({ value, options, onChange, render, badge }: { value: T; options: T[]; onChange: (v: T) => void; render?: (v: T) => string; badge?: (v: T) => ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" className="tile" aria-pressed={o === value} onClick={() => onChange(o)}>
          {render ? render(o) : o.toUpperCase()}
          {badge?.(o)}
        </button>
      ))}
    </div>
  );
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--text-2)", background: "none", border: "none", padding: 0 }} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }} />
        {label}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

function Warnings({ profile }: { profile: Profile }) {
  const t = useT();
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const h = window.setTimeout(() => {
      api.profileWarnings(profile).then((w) => alive && setWarnings(w.map((x) => x.code))).catch(() => {});
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [profile]);
  if (!warnings.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {warnings.map((w) => (
        <div key={w} className="flex items-start gap-2 p-2.5 rounded-[5px] text-[12px] leading-snug" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
          <AlertTriangle size={14} className="shrink-0 mt-px" />
          {t(`warn.${w}`)}
        </div>
      ))}
    </div>
  );
}

const QUALITY_MARKS = [
  { at: 30, key: "quality.small" },
  { at: 50, key: "quality.share" },
  { at: 70, key: "quality.good" },
  { at: 85, key: "quality.high" },
  { at: 95, key: "quality.archive" },
];

function qualityLabel(v: number) {
  let key = "quality.tiny";
  for (const m of QUALITY_MARKS) if (v >= m.at) key = m.key;
  return key;
}

function VideoTab({ p, edit }: { p: Profile; edit: Edit }) {
  const t = useT();
  const hw = useHwStore((s) => s.hw);
  const audioOnly = AUDIO_ONLY.has(p.container);
  const gif = p.container === "gif";
  const working = (codec: VideoCodec) => hw?.encoders.filter((e) => e.codec === codec && e.working) ?? [];
  const families = [...new Set(working(p.video.codec).map((e) => e.family))];

  const setContainer = (c: Container) =>
    edit((x) => {
      x.container = c;
      const vc = VIDEO_CODECS[c];
      if (vc.length && !vc.includes(x.video.codec)) x.video.codec = vc[0];
      const ac = AUDIO_CODECS[c];
      if (ac.length && !ac.includes(x.audio.codec)) x.audio.codec = ac[0];
      if (AUDIO_ONLY.has(c)) {
        x.video.mode = "off";
        if (x.audio.mode === "off") x.audio.mode = "encode";
      } else if (x.video.mode === "off") x.video.mode = "encode";
      if (c === "gif") x.audio.mode = "off";
    });

  const resolved = (() => {
    if (!hw || audioOnly || p.video.mode !== "encode") return null;
    const codec = gif ? "gif" : p.video.codec;
    const order: EncoderPref[] = p.video.encoder === "auto" ? ["nvenc", "amf", "vaapi", "qsv"] : p.video.encoder === "cpu" ? [] : [p.video.encoder];
    for (const f of order) {
      const e = hw.encoders.find((x) => x.codec === codec && x.family === f && x.working);
      if (e) return e.name;
    }
    return { h264: "libx264", hevc: "libx265", av1: hw.cpuEncoders.includes("libsvtav1") ? "libsvtav1" : "libaom-av1", vp9: "libvpx-vp9", mpeg4: "mpeg4", prores: "prores_ks", gif: "gif" }[codec];
  })();

  return (
    <>
      <Section title={t("video.format")} first>
        <div className="text-[11px] mb-1.5 mt-1" style={{ color: "var(--text-3)" }}>{t("video.videoFormats")}</div>
        <Chips value={p.container} options={VIDEO_CONTAINERS} onChange={setContainer} />
        <div className="text-[11px] mb-1.5 mt-3" style={{ color: "var(--text-3)" }}>{t("video.audioFormats")}</div>
        <Chips value={p.container} options={AUDIO_CONTAINERS} onChange={setContainer} />
      </Section>

      {audioOnly ? (
        <div className="mt-4 p-3 rounded-[5px] text-[12px] leading-relaxed" style={{ background: "var(--hover)", color: "var(--text-2)" }}>
          {t("video.audioOnlyHint")}
        </div>
      ) : gif ? (
        <Section title={t("video.gif")}>
          <Row label={t("video.gifWidth")} hint={t("video.gifWidthHint")}>
            <NumberField value={p.gif.width} min={16} max={3840} suffix="px" onChange={(v) => edit((x) => void (x.gif.width = v ?? 480))} />
          </Row>
          <Row label={t("video.gifFps")}>
            <NumberField value={p.gif.fps} min={1} max={60} suffix="fps" onChange={(v) => edit((x) => void (x.gif.fps = v ?? 15))} />
          </Row>
        </Section>
      ) : (
        <>
          <Section title={t("video.stream")}>
            <div className="mt-1.5">
              <Seg
                full
                value={p.video.mode}
                onChange={(m) => edit((x) => void (x.video.mode = m))}
                options={[
                  { value: "encode", label: t("mode.encode") },
                  { value: "copy", label: t("mode.copy"), title: t("mode.copyHint") },
                  { value: "off", label: t("mode.off") },
                ]}
              />
            </div>
          </Section>

          {p.video.mode === "encode" && (
            <>
              <Section title={t("video.codec")}>
                <div className="mt-1.5">
                  <Chips
                    value={p.video.codec}
                    options={VIDEO_CODECS[p.container]}
                    onChange={(c) => edit((x) => void (x.video.codec = c))}
                    render={(c) => codecLabel(c)}
                    badge={(c) =>
                      working(c).length ? (
                        <span className="absolute top-[3px] right-[3px] w-[5px] h-[5px]" style={{ background: "var(--ok)" }} title={t("video.gpuAvailable")} />
                      ) : null
                    }
                  />
                  {VIDEO_CODECS[p.container].some((c) => working(c).length) && (
                    <div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: "var(--text-3)" }}>
                      <span className="w-[5px] h-[5px]" style={{ background: "var(--ok)" }} />
                      {t("video.gpuLegend")}
                    </div>
                  )}
                </div>
                <Row label={t("video.encoder")} hint={resolved ? t("video.resolvesTo", { name: resolved }) : undefined} stack>
                  <Seg
                    full
                    value={p.video.encoder}
                    onChange={(e) => edit((x) => void (x.video.encoder = e))}
                    options={[
                      { value: "auto", label: t("encoder.auto"), title: t("encoder.autoHint") },
                      ...(["nvenc", "amf", "vaapi", "qsv"] as const)
                        .filter((f) => families.includes(f) || p.video.encoder === f)
                        .map((f) => ({ value: f, label: FAMILY_LABELS[f], disabled: !families.includes(f) })),
                      { value: "cpu", label: "CPU", title: t("encoder.cpuHint") },
                    ]}
                  />
                </Row>
              </Section>

              <Section title={t("video.quality")}>
                <div className="mt-1.5">
                  <Seg
                    full
                    value={p.video.rate.kind}
                    onChange={(k) =>
                      edit((x) => {
                        x.video.rate = (
                          k === "quality" ? { kind: k, value: 70 } : k === "cq" ? { kind: k, value: 22, maxKbps: null } : k === "bitrate" ? { kind: k, kbps: 6000, cbr: false } : { kind: k, mib: 500 }
                        ) as RateControl;
                      })
                    }
                    options={[
                      { value: "quality", label: t("rate.quality") },
                      { value: "cq", label: "CQ", title: t("rate.cqTitle") },
                      { value: "bitrate", label: t("rate.bitrate") },
                      { value: "targetSize", label: t("rate.size") },
                    ]}
                  />
                </div>
                {p.video.rate.kind === "quality" && <QualitySlider value={p.video.rate.value} onChange={(v) => edit((x) => void (x.video.rate = { kind: "quality", value: v }))} />}
                {p.video.rate.kind === "cq" && <CqControl rate={p.video.rate} onChange={(r) => edit((x) => void (x.video.rate = r))} />}
                {p.video.rate.kind === "bitrate" && (
                  <>
                    <div className="mt-2.5">
                      <Seg
                        full
                        value={p.video.rate.cbr ? "cbr" : "vbr"}
                        onChange={(m) => edit((x) => void (x.video.rate = { kind: "bitrate", kbps: (x.video.rate as { kbps: number }).kbps, cbr: m === "cbr" }))}
                        options={[
                          { value: "vbr", label: t("rate.vbr"), title: t("rate.vbrHint") },
                          { value: "cbr", label: t("rate.cbr"), title: t("rate.cbrHint") },
                        ]}
                      />
                    </div>
                    <Row label={t("rate.bitrate")} hint={t(p.video.rate.cbr ? "rate.cbrHint" : "rate.bitrateHint")}>
                      <NumberField
                        value={p.video.rate.kbps}
                        min={100}
                        max={200000}
                        suffix="kb/s"
                        width={120}
                        onChange={(v) => edit((x) => void (x.video.rate = { kind: "bitrate", kbps: v ?? 6000, cbr: (x.video.rate as { cbr?: boolean }).cbr ?? false }))}
                      />
                    </Row>
                  </>
                )}
                {p.video.rate.kind === "targetSize" && (
                  <Row label={t("rate.size")} hint={t("rate.sizeHint")}>
                    <NumberField value={p.video.rate.mib} min={1} max={1000000} suffix="MB" width={120} onChange={(v) => edit((x) => void (x.video.rate = { kind: "targetSize", mib: v ?? 500 }))} />
                  </Row>
                )}
                <Row label={t("video.speed")} hint={t(`speed.${p.video.speed}Hint`)} stack>
                  <Seg
                    full
                    value={p.video.speed}
                    onChange={(s) => edit((x) => void (x.video.speed = s))}
                    options={(["fastest", "fast", "balanced", "slow", "slowest"] as const).map((s) => ({ value: s, label: t(`speed.${s}`) }))}
                  />
                </Row>
              </Section>

              <Section title={t("video.picture")}>
                <Row label={t("video.resolution")} hint={p.video.resolution.kind === "height" ? t("video.presetHint") : undefined}>
                  <ResolutionPicker value={p.video.resolution} onChange={(r) => edit((x) => void (x.video.resolution = r))} />
                </Row>
                {p.video.resolution.kind === "custom" && (
                  <div className="flex items-center gap-2 justify-end pb-1">
                    <NumberField value={p.video.resolution.width} min={2} max={16384} suffix="w" onChange={(v) => edit((x) => void (x.video.resolution = { ...(x.video.resolution as Extract<Resolution, { kind: "custom" }>), width: v ?? 1920 }))} />
                    <span style={{ color: "var(--text-3)" }}>×</span>
                    <NumberField value={p.video.resolution.height} min={2} max={16384} suffix="h" onChange={(v) => edit((x) => void (x.video.resolution = { ...(x.video.resolution as Extract<Resolution, { kind: "custom" }>), height: v ?? 1080 }))} />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      title={t("video.swapSize")}
                      aria-label={t("video.swapSize")}
                      onClick={() =>
                        edit((x) => {
                          const r = x.video.resolution as Extract<Resolution, { kind: "custom" }>;
                          x.video.resolution = { ...r, width: r.height, height: r.width };
                        })
                      }
                    >
                      ⇄
                    </button>
                  </div>
                )}
                {p.video.resolution.kind === "custom" && (
                  <Row label={t("video.fit")} hint={t(`fit.${p.video.resolution.fit ?? "pad"}Hint`)} stack>
                    <Seg
                      full
                      value={p.video.resolution.fit ?? "pad"}
                      onChange={(f: Fit) => edit((x) => void (x.video.resolution = { ...(x.video.resolution as Extract<Resolution, { kind: "custom" }>), fit: f }))}
                      options={(["pad", "crop", "stretch"] as const).map((f) => ({ value: f, label: t(`fit.${f}`) }))}
                    />
                  </Row>
                )}
                {p.video.resolution.kind === "maxEdge" && (
                  <div className="flex justify-end pb-1">
                    <NumberField value={p.video.resolution.value} min={16} max={16384} suffix="px" width={120} onChange={(v) => edit((x) => void (x.video.resolution = { kind: "maxEdge", value: v ?? 1280 }))} />
                  </div>
                )}
                <Row label={t("video.crop")} hint={p.video.crop.kind === "auto" ? t("video.cropAutoHint") : undefined}>
                  <div style={{ width: 170 }}>
                    <Select
                      value={p.video.crop.kind}
                      onChange={(k) =>
                        edit((x) => {
                          x.video.crop = k === "manual" ? { kind: "manual", top: 0, bottom: 0, left: 0, right: 0 } : ({ kind: k } as Crop);
                        })
                      }
                      options={[
                        { value: "off", label: t("video.cropOff") },
                        { value: "auto", label: t("video.cropAuto") },
                        { value: "manual", label: t("video.cropManual") },
                      ]}
                    />
                  </div>
                </Row>
                {p.video.crop.kind === "manual" && (
                  <div className="grid grid-cols-4 gap-1.5 pb-1">
                    {(["top", "bottom", "left", "right"] as const).map((side) => (
                      <label key={side} className="text-[11px]" style={{ color: "var(--text-3)" }}>
                        {t(`video.crop.${side}`)}
                        <NumberField
                          width={70}
                          min={0}
                          max={4000}
                          suffix="px"
                          value={(p.video.crop as ManualCrop)[side]}
                          onChange={(v) => edit((x) => void ((x.video.crop as ManualCrop)[side] = v ?? 0))}
                        />
                      </label>
                    ))}
                  </div>
                )}
                <Row label={t("video.fps")}>
                  <div style={{ width: 150 }}>
                    <Select
                      value={p.video.fps == null ? "keep" : String(p.video.fps)}
                      onChange={(v) => edit((x) => void (x.video.fps = v === "keep" ? null : Number(v)))}
                      options={[
                        { value: "keep", label: t("common.keepSource") },
                        ...["23.976", "24", "25", "29.97", "30", "50", "59.94", "60", "120"].map((f) => ({ value: f, label: `${f} fps` })),
                        ...(p.video.fps != null && !["23.976", "24", "25", "29.97", "30", "50", "59.94", "60", "120"].includes(String(p.video.fps)) ? [{ value: String(p.video.fps), label: `${p.video.fps} fps` }] : []),
                      ]}
                    />
                  </div>
                </Row>
              </Section>

              <Disclosure label={t("video.advanced")}>
                <Row label={t("video.tenBit")} hint={t("video.tenBitHint")}>
                  <Switch on={p.video.tenBit} onChange={(v) => edit((x) => void (x.video.tenBit = v))} />
                </Row>
                <Row label={t("video.twoPass")} hint={t("video.twoPassHint")}>
                  <Switch on={p.video.twoPass} onChange={(v) => edit((x) => void (x.video.twoPass = v))} disabled={!(p.video.rate.kind === "targetSize" || (p.video.rate.kind === "bitrate" && !p.video.rate.cbr))} />
                </Row>
                <Row label={t("video.deinterlace")} hint={t("video.deinterlaceHint")}>
                  <Switch on={p.video.deinterlace} onChange={(v) => edit((x) => void (x.video.deinterlace = v))} />
                </Row>
                <Row label={t("video.tonemap")} hint={t("video.tonemapHint")}>
                  <Switch on={p.video.tonemap} onChange={(v) => edit((x) => void (x.video.tonemap = v))} />
                </Row>
                <Row label={t("video.rotate")}>
                  <Seg
                    value={p.video.rotate}
                    onChange={(r) => edit((x) => void (x.video.rotate = r))}
                    options={[
                      { value: "none", label: "0°" },
                      { value: "cw90", label: "90°" },
                      { value: "cw180", label: "180°" },
                      { value: "cw270", label: "270°" },
                    ]}
                  />
                </Row>
                <Row label={t("video.flip")}>
                  <Switch on={p.video.flipH} onChange={(v) => edit((x) => void (x.video.flipH = v))} />
                </Row>
              </Disclosure>
            </>
          )}
        </>
      )}
    </>
  );
}

function QualitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useT();
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="pt-3 pb-1">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[12.5px] font-semibold">{t(qualityLabel(local))}</span>
        <span className="text-[18px] mono tnum leading-none" style={{ color: "var(--accent)" }}>{local}</span>
      </div>
      <input
        type="range"
        className="range"
        min={0}
        max={100}
        value={local}
        style={{ ["--v" as string]: `${local}%` }}
        aria-label={t("rate.quality")}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onChange(local)}
        onKeyUp={() => onChange(local)}
        onBlur={() => local !== value && onChange(local)}
      />
      <div className="flex justify-between text-[10.5px] mt-0.5" style={{ color: "var(--text-3)" }}>
        <span>{t("quality.smaller")}</span>
        <span>{t("quality.better")}</span>
      </div>
    </div>
  );
}

const PRESETS: [number, string][] = [
  [4320, "4320p · 8K UHD"],
  [2160, "2160p · 4K UHD"],
  [1440, "1440p · QHD"],
  [1080, "1080p · Full HD"],
  [720, "720p · HD"],
  [576, "576p · PAL"],
  [540, "540p · qHD"],
  [480, "480p · SD"],
  [360, "360p"],
];

function cqBand(v: number) {
  if (v < 18) return "cq.nearLossless";
  if (v <= 20) return "cq.high";
  if (v <= 23) return "cq.good";
  if (v <= 26) return "cq.compressed";
  return "cq.small";
}

function CqControl({ rate, onChange }: { rate: Extract<RateControl, { kind: "cq" }>; onChange: (r: RateControl) => void }) {
  const t = useT();
  const capped = rate.maxKbps != null;
  const band = [
    { value: "high", pick: 19, test: (v: number) => v >= 18 && v <= 20, label: "18–20" },
    { value: "good", pick: 22, test: (v: number) => v >= 21 && v <= 23, label: "21–23" },
    { value: "compressed", pick: 25, test: (v: number) => v >= 24 && v <= 26, label: "24–26" },
  ];
  const current = band.find((b) => b.test(rate.value))?.value ?? "";
  return (
    <>
      <Row label={t("rate.cqValue")} hint={t(cqBand(rate.value))}>
        <NumberField value={rate.value} min={0} max={51} width={90} onChange={(v) => onChange({ ...rate, value: v ?? 22 })} />
      </Row>
      <div className="pb-1">
        <Seg
          full
          value={current}
          onChange={(b) => onChange({ ...rate, value: band.find((x) => x.value === b)!.pick })}
          options={band.map((b) => ({ value: b.value, label: b.label, title: t(`cq.${b.value}`) }))}
        />
        <div className="text-[11px] mt-1.5 leading-snug" style={{ color: "var(--text-3)" }}>
          {t("rate.cqHint")}
        </div>
      </div>
      <Row label={t("rate.ceiling")} hint={t("rate.ceilingHint")}>
        <Switch on={capped} onChange={(on) => onChange({ ...rate, maxKbps: on ? 8000 : null })} />
      </Row>
      {capped && (
        <Row label={t("rate.maxBitrate")}>
          <NumberField value={rate.maxKbps ?? 8000} min={100} max={500000} suffix="kb/s" width={120} onChange={(v) => onChange({ ...rate, maxKbps: v ?? 8000 })} />
        </Row>
      )}
    </>
  );
}

function ResolutionPicker({ value, onChange }: { value: Resolution; onChange: (r: Resolution) => void }) {
  const t = useT();
  const key = value.kind === "height" ? `h${value.value}` : value.kind;
  return (
    <div style={{ width: 170 }}>
      <Select
        value={key}
        onChange={(k) => {
          if (k === "keep") onChange({ kind: "keep" });
          else if (k === "maxEdge") onChange({ kind: "maxEdge", value: 1280 });
          else if (k === "custom") onChange({ kind: "custom", width: 1920, height: 1080 });
          else onChange({ kind: "height", value: Number(k.slice(1)) });
        }}
        options={[
          { value: "keep", label: t("common.keepSource") },
          ...PRESETS.map(([h, label]) => ({ value: `h${h}`, label })),
          ...(value.kind === "height" && !PRESETS.some(([h]) => h === value.value) ? [{ value: key, label: `${value.value}p` }] : []),
          { value: "maxEdge", label: t("video.maxEdge") },
          { value: "custom", label: t("video.customSize") },
        ]}
      />
    </div>
  );
}

function AudioTab({ p, edit }: { p: Profile; edit: Edit }) {
  const t = useT();
  const codecs = AUDIO_CODECS[p.container];
  const lossless = ["flac", "alac", "pcm"].includes(p.audio.codec);
  if (p.container === "gif") {
    return <div className="mt-4 p-3 rounded-[5px] text-[12px]" style={{ background: "var(--hover)", color: "var(--text-2)" }}>{t("audio.gifNone")}</div>;
  }
  return (
    <>
      <Section title={t("audio.stream")} first>
        <div className="mt-1.5">
          <Seg
            full
            value={p.audio.mode}
            onChange={(m) => edit((x) => void (x.audio.mode = m))}
            options={[
              { value: "encode", label: t("mode.encode") },
              { value: "copy", label: t("mode.copy"), title: t("mode.copyAudioHint") },
              { value: "off", label: t("mode.off"), disabled: AUDIO_ONLY.has(p.container) },
            ]}
          />
        </div>
        {p.audio.mode === "copy" && <div className="text-[11.5px] mt-2 leading-snug" style={{ color: "var(--text-3)" }}>{t("audio.copyHint")}</div>}
      </Section>
      {p.audio.mode !== "off" && (
        <>
          {p.audio.mode === "encode" && (
            <Section title={t("audio.codec")}>
              <div className="mt-1.5">
                <Chips value={p.audio.codec} options={codecs} onChange={(c) => edit((x) => void (x.audio.codec = c))} render={(c) => codecLabel(c)} />
              </div>
              {!lossless && (
                <Row label={t("audio.bitrate")}>
                  <div style={{ width: 150 }}>
                    <Select
                      value={p.audio.bitrateKbps}
                      onChange={(v) => edit((x) => void (x.audio.bitrateKbps = v))}
                      options={[64, 96, 128, 160, 192, 224, 256, 320, 384, 448, 640]
                        .concat([64, 96, 128, 160, 192, 224, 256, 320, 384, 448, 640].includes(p.audio.bitrateKbps) ? [] : [p.audio.bitrateKbps])
                        .map((k) => ({ value: k, label: `${k} kb/s` }))}
                    />
                  </div>
                </Row>
              )}
              <Row label={t("audio.channels")}>
                <Seg
                  value={p.audio.channels == null ? "keep" : String(p.audio.channels)}
                  onChange={(v) => edit((x) => void (x.audio.channels = v === "keep" ? null : Number(v)))}
                  options={[
                    { value: "keep", label: t("common.keep") },
                    { value: "1", label: t("audio.mono") },
                    { value: "2", label: t("audio.stereo") },
                    { value: "6", label: "5.1" },
                  ]}
                />
              </Row>
              <Row label={t("audio.sampleRate")}>
                <Seg
                  value={p.audio.sampleRate == null ? "keep" : String(p.audio.sampleRate)}
                  onChange={(v) => edit((x) => void (x.audio.sampleRate = v === "keep" ? null : Number(v)))}
                  options={[
                    { value: "keep", label: t("common.keep") },
                    { value: "44100", label: "44.1k" },
                    { value: "48000", label: "48k" },
                  ]}
                />
              </Row>
              <Row label={t("audio.normalize")} hint={t("audio.normalizeHint")}>
                <Switch on={p.audio.normalize} onChange={(v) => edit((x) => void (x.audio.normalize = v))} />
              </Row>
            </Section>
          )}
          {!AUDIO_ONLY.has(p.container) && (
            <Section title={t("audio.tracks")}>
              <Row label={t("audio.whichTracks")} hint={t("audio.tracksHint")}>
                <Seg
                  value={p.audio.tracks}
                  onChange={(v) => edit((x) => void (x.audio.tracks = v))}
                  options={[
                    { value: "all", label: t("audio.all") },
                    { value: "first", label: t("audio.first") },
                  ]}
                />
              </Row>
              <Row label={t("lang.keepAudio")} hint={t("lang.keepAudioHint")} stack>
                <LangInput value={p.audio.languages} onChange={(v) => edit((x) => void (x.audio.languages = v))} />
              </Row>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function SubsTab({ p, edit, job }: { p: Profile; edit: Edit; job?: Job }) {
  const t = useT();
  const setOptions = useQueueStore((s) => s.setOptions);
  const subs = job?.media ? subtitleSources(job.media, job.options) : [];
  return (
    <>
      <Section title={t("subs.mode")} first>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {(["copy", "burn", "off"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="flex items-start gap-3 p-3 rounded-[5px] text-left transition-colors"
              style={{
                background: p.subtitles === m ? "var(--accent-soft)" : "var(--input)",
                border: `1px solid ${p.subtitles === m ? "var(--accent)" : "var(--line-strong)"}`,
              }}
              onClick={() => edit((x) => void (x.subtitles = m))}
            >
              <span className="mt-0.5 w-4 h-4 rounded-[2px] shrink-0 grid place-items-center" style={{ border: `2px solid ${p.subtitles === m ? "var(--accent)" : "var(--text-3)"}` }}>
                {p.subtitles === m && <span className="w-1.5 h-1.5 rounded-[2px]" style={{ background: "var(--accent)" }} />}
              </span>
              <span>
                <span className="block text-[12.5px] font-medium" style={{ color: p.subtitles === m ? "var(--accent)" : "var(--text)" }}>{t(`subs.${m}`)}</span>
                <span className="block text-[11.5px] mt-0.5 leading-snug" style={{ color: "var(--text-3)" }}>{t(`subs.${m}Hint`)}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>
      {p.subtitles === "burn" && job && (
        <Section title={t("subs.track")}>
          {subs.length === 0 ? (
            <div className="text-[12px] mt-1" style={{ color: "var(--text-3)" }}>{t("subs.noneInFile")}</div>
          ) : (
            <div className="mt-1.5">
              <Select
                value={Math.min(job.options.burnTrack, subs.length - 1)}
                onChange={(v) => setOptions(job.id, { burnTrack: v })}
                options={subs.map((s, i) => ({
                  value: i,
                  label: [`#${i + 1}`, languageName(s.language) || "?", codecLabel(s.codec), s.file ? t("subs.fromFile", { name: fileName(s.file) }) : null]
                    .filter(Boolean)
                    .join(" · "),
                }))}
              />
            </div>
          )}
        </Section>
      )}
      {p.subtitles === "copy" && (
        <Section title={t("lang.subsTitle")}>
          <Row label={t("lang.keepSubs")} hint={t("lang.keepSubsHint")} stack>
            <LangInput value={p.subtitleLanguages} onChange={(v) => edit((x) => void (x.subtitleLanguages = v))} />
          </Row>
        </Section>
      )}
    </>
  );
}

function OutputTab({ p, edit }: { p: Profile; edit: Edit }) {
  const t = useT();
  const mp4ish = ["mp4", "mov", "m4a"].includes(p.container);
  return (
    <>
      <Section title={t("output.metadata")} first>
        <Row label={t("output.keepMetadata")} hint={t("output.keepMetadataHint")}>
          <Switch on={p.keepMetadata} onChange={(v) => edit((x) => void (x.keepMetadata = v))} />
        </Row>
        <Row label={t("output.keepChapters")}>
          <Switch on={p.keepChapters} onChange={(v) => edit((x) => void (x.keepChapters = v))} />
        </Row>
        {mp4ish && (
          <Row label={t("output.fastStart")} hint={t("output.fastStartHint")}>
            <Switch on={p.fastStart} onChange={(v) => edit((x) => void (x.fastStart = v))} />
          </Row>
        )}
      </Section>
      <Section title={t("output.expert")}>
        <Row label={t("output.extraArgs")} hint={t("output.extraArgsHint")} stack>
          <textarea
            className="field mono text-[12px]"
            rows={3}
            spellCheck={false}
            placeholder='-x265-params "aq-mode=3"'
            value={p.extraArgs}
            onChange={(e) => edit((x) => void (x.extraArgs = e.target.value))}
          />
        </Row>
      </Section>
      {!p.builtin && (
        <Section title={t("output.profileInfo")}>
          <Row label={t("profiles.description")} stack>
            <textarea className="field text-[12px]" rows={2} value={p.description} onChange={(e) => edit((x) => void (x.description = e.target.value))} />
          </Row>
        </Section>
      )}
    </>
  );
}

function TimeField({ value, onChange, placeholder, max }: { value: number | null; onChange: (v: number | null) => void; placeholder: string; max?: number | null }) {
  const [text, setText] = useState(formatTimestamp(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(formatTimestamp(value)), [value]);
  const commit = () => {
    if (!text.trim()) {
      setBad(false);
      onChange(null);
      return;
    }
    let v = parseTimestamp(text);
    if (v == null) {
      setBad(true);
      return;
    }
    if (max != null) v = Math.min(v, max);
    setBad(false);
    onChange(v);
  };
  return (
    <input
      className="field mono tnum"
      style={bad ? { borderColor: "var(--err)" } : undefined}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function FileTab({ job }: { job: Job }) {
  const t = useT();
  const setOptions = useQueueStore((s) => s.setOptions);
  const m = job.media;
  if (!m) return <div className="mt-4 text-[12px]" style={{ color: "var(--text-3)" }}>{job.probeError ?? t("status.probing")}</div>;
  const dur = m.duration;
  const start = job.options.trimStart ?? 0;
  const end = job.options.trimEnd ?? dur ?? 0;
  return (
    <>
      <Section title={t("file.trim")} first>
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          <label className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {t("file.start")}
            <TimeField value={job.options.trimStart} placeholder="0:00" max={dur} onChange={(v) => setOptions(job.id, { trimStart: v })} />
          </label>
          <label className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {t("file.end")}
            <TimeField value={job.options.trimEnd} placeholder={formatDuration(dur)} max={dur} onChange={(v) => setOptions(job.id, { trimEnd: v })} />
          </label>
        </div>
        {dur ? (
          <div className="mt-3">
            <div className="relative h-2 rounded-[2px]" style={{ background: "var(--line)" }}>
              <div className="absolute top-0 bottom-0 rounded-[2px]" style={{ left: `${(start / dur) * 100}%`, width: `${(Math.max(0, end - start) / dur) * 100}%`, background: "var(--accent)" }} />
            </div>
            <div className="flex justify-between text-[11px] mt-1 tnum" style={{ color: "var(--text-3)" }}>
              <span>{t("file.keeps", { duration: formatDuration(Math.max(0, end - start)) })}</span>
              {(job.options.trimStart != null || job.options.trimEnd != null) && (
                <button className="btn btn-ghost btn-sm !h-5 !px-1.5" onClick={() => setOptions(job.id, { trimStart: null, trimEnd: null })}>
                  {t("file.resetTrim")}
                </button>
              )}
            </div>
          </div>
        ) : null}
        <div className="text-[11px] mt-2" style={{ color: "var(--text-3)" }}>{t("file.trimHint")}</div>
      </Section>

      <Section title={t("file.streams")}>
        <div className="flex flex-col gap-1 mt-1.5 text-[12px]">
          <StreamRow icon={<Layers size={12} />} label={t("file.container")} value={`${m.format.split(",")[0]} · ${formatBytes(m.size)}${m.bitrate ? ` · ${Math.round(m.bitrate / 1000)} kb/s` : ""}`} />
          {m.video && (
            <StreamRow
              icon={<Film size={12} />}
              label={t("inspector.video")}
              value={`${codecLabel(m.video.codec)} · ${m.video.width}×${m.video.height} · ${m.video.fps ? m.video.fps.toFixed(3).replace(/\.?0+$/, "") + " fps" : ""} · ${m.video.bitDepth}-bit${m.video.hdr ? " HDR" : ""}`}
            />
          )}
          {m.audio.map((a, i) => (
            <StreamRow key={`a${i}`} icon={<Music size={12} />} label={`${t("inspector.audio")} ${i + 1}`} value={`${codecLabel(a.codec)} · ${a.channels} ch${a.language ? ` · ${a.language}` : ""}${a.title ? ` · ${a.title}` : ""}`} />
          ))}
          {m.subtitles.map((s, i) => (
            <StreamRow key={`s${i}`} icon={<Subtitles size={12} />} label={`${t("inspector.subs")} ${i + 1}`} value={`${codecLabel(s.codec)}${s.bitmap ? ` (${t("file.bitmap")})` : ""}${s.language ? ` · ${s.language}` : ""}${s.title ? ` · ${s.title}` : ""}`} />
          ))}
          {m.chapters > 0 && <StreamRow icon={<Layers size={12} />} label={t("file.chapters")} value={String(m.chapters)} />}
        </div>
      </Section>

      <Section title={t("file.subFiles")}>
        {(m.externalSubs ?? []).length > 0 && (
          <label className="flex items-center gap-2 text-[12px] mt-1.5 cursor-pointer" style={{ color: "var(--text-2)" }}>
            <input
              type="checkbox"
              checked={!job.options.skipExternalSubs}
              onChange={(e) => setOptions(job.id, { skipExternalSubs: !e.target.checked })}
              style={{ accentColor: "var(--accent)" }}
            />
            {t("file.useSubFiles", { count: m.externalSubs.length })}
          </label>
        )}
        <div className="flex flex-col gap-1 mt-1.5">
          {[...(job.options.skipExternalSubs ? [] : (m.externalSubs ?? []).map((e) => ({ path: e.path, lang: e.language, own: false }))),
            ...job.options.extraSubs.map((path) => ({ path, lang: null as string | null, own: true }))].map((x) => (
            <div key={x.path} className="flex items-center gap-2 text-[12px] py-0.5">
              <Subtitles size={12} style={{ color: "var(--text-3)" }} />
              <span className="truncate flex-1" title={x.path}>{fileName(x.path)}</span>
              {x.lang && <span className="tag">{languageName(x.lang)}</span>}
              {x.own && (
                <button
                  className="btn btn-ghost btn-sm btn-icon"
                  title={t("queue.remove")}
                  aria-label={t("queue.remove")}
                  onClick={() => setOptions(job.id, { extraSubs: job.options.extraSubs.filter((p) => p !== x.path) })}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {(m.externalSubs ?? []).length === 0 && job.options.extraSubs.length === 0 && (
            <div className="text-[12px]" style={{ color: "var(--text-3)" }}>{t("file.noSubFiles")}</div>
          )}
        </div>
        <button
          className="btn btn-sm mt-2"
          onClick={async () => {
            const picked = await openDialog({ multiple: true, filters: [{ name: t("file.subFilter"), extensions: ["srt", "ass", "ssa", "vtt"] }] });
            const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
            if (paths.length) setOptions(job.id, { extraSubs: [...new Set([...job.options.extraSubs, ...paths])] });
          }}
        >
          <Plus size={13} />
          {t("file.addSubFile")}
        </button>
      </Section>

      {m.video && <CropDetect job={job} />}

      <ExtraOutputs job={job} />

      <PreviewSection job={job} />

      {job.preview && (
        <Section title={t("file.result")}>
          <div className="text-[12px] mono break-all mt-1.5 p-2.5 rounded-[5px]" style={{ background: "var(--input)", border: "1px solid var(--line)" }}>
            {job.preview.output}
          </div>
          {job.preview.notes.map((n) => (
            <div key={n} className="flex items-start gap-2 text-[11.5px] mt-2 leading-snug" style={{ color: "var(--warn)" }}>
              <AlertTriangle size={13} className="shrink-0 mt-px" />
              {t(`note.${n}`)}
            </div>
          ))}
          {job.preview.command && (
            <Disclosure label={t("file.command")}>
              <CommandBox text={job.preview.command} />
            </Disclosure>
          )}
        </Section>
      )}
      <div className="text-[11px] mt-4 truncate" style={{ color: "var(--text-3)" }} title={job.path}>
        {fileName(job.path)}
      </div>
    </>
  );
}

function LangInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const add = (code: string) => {
    const c = normalizeLang(code);
    if (c && !value.map(normalizeLang).includes(c)) onChange([...value, c]);
  };
  const query = q.trim().toLowerCase();
  const suggestions = COMMON_LANGUAGES.filter(([c]) => !value.map(normalizeLang).includes(c)).filter(
    ([c, two]) => !query || c.startsWith(query) || two.startsWith(query) || languageName(c).toLowerCase().includes(query),
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.length === 0 && <span className="text-[12px]" style={{ color: "var(--text-3)" }}>{t("lang.all")}</span>}
      {value.map((c, i) => (
        <span key={c} className="tag !h-6 !text-[11.5px] !font-sans gap-1.5">
          {i === 0 && value.length > 1 && <span style={{ color: "var(--accent)" }}>1</span>}
          {languageName(c)}
          <button
            className="grid place-items-center"
            style={{ background: "none", border: "none", padding: 0, color: "var(--text-3)" }}
            aria-label={t("queue.remove")}
            onClick={() => onChange(value.filter((x) => x !== c))}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button ref={ref} className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>
        <Plus size={12} />
        {t("lang.add")}
      </button>
      <Popover anchor={ref} open={open} onDismiss={() => setOpen(false)} width={220} maxHeight={300}>
        <div className="p-1">
          <input
            className="field !h-7 mb-1"
            autoFocus
            placeholder={t("lang.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const first = suggestions[0]?.[0] ?? (query.length >= 2 ? query : "");
                if (first) add(first);
                setQ("");
              }
            }}
          />
          {suggestions.map(([c]) => (
            <button key={c} className="menu-item" onClick={() => { add(c); setQ(""); }}>
              <span className="flex-1">{languageName(c)}</span>
              <span className="mono text-[10.5px]" style={{ color: "var(--text-3)" }}>{c}</span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function ExtraOutputs({ job }: { job: Job }) {
  const t = useT();
  const profiles = useProfileStore((s) => s.profiles);
  const setExtras = useQueueStore((s) => s.setExtras);
  const locked = ACTIVE.includes(job.status);
  const ids = job.extras.map((x) => x.profileId);
  return (
    <Section title={t("extras.title")}>
      <div className="text-[11.5px] mt-1 leading-snug" style={{ color: "var(--text-3)" }}>{t("extras.hint")}</div>
      <div className="flex flex-col gap-1 mt-2">
        {job.extras.map((x, i) => {
          const p = profiles.find((q) => q.id === x.profileId);
          if (!p) return null;
          return (
            <div key={x.profileId} className="flex items-center gap-2 text-[12px] py-1 px-2 rounded-[4px]" style={{ background: "var(--input)", border: "1px solid var(--line)" }}>
              <span style={{ color: "var(--text-3)" }}>{profileIcon(p, 13)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate">{profileName(p)}</div>
                {x.preview && <div className="mono text-[10.5px] truncate" style={{ color: "var(--text-3)" }}>{fileName(x.preview.output)}</div>}
              </div>
              {x.status && x.status !== "ready" && (
                <span className="text-[11px] mono" style={{ color: x.status === "done" ? "var(--ok)" : x.status === "failed" ? "var(--err)" : "var(--text-2)" }}>
                  {x.status === "running" ? `${Math.round(x.progress?.percent ?? 0)}%` : t(`status.${x.status}`)}
                </span>
              )}
              <button
                className="btn btn-ghost btn-sm btn-icon"
                disabled={locked}
                title={t("queue.remove")}
                aria-label={t("queue.remove")}
                onClick={() => setExtras(job.id, ids.filter((_, k) => k !== i))}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <MenuButton
        className="btn btn-sm mt-2"
        title={t("extras.add")}
        items={profiles
          .filter((p) => !ids.includes(p.id))
          .map((p) => ({ label: profileName(p), icon: profileIcon(p, 14), disabled: locked, onSelect: () => setExtras(job.id, [...ids, p.id]) }))}
      >
        <Plus size={13} />
        {t("extras.add")}
      </MenuButton>
    </Section>
  );
}

function PreviewSection({ job }: { job: Job }) {
  const t = useT();
  const sampleJob = useQueueStore((s) => s.sampleJob);
  const sample = job.sample && job.sample.key === settingsKey(job) ? job.sample : null;
  const stale = job.sample && !sample;
  return (
    <Section title={t("preview.title")}>
      <div className="text-[11.5px] mt-1 leading-snug" style={{ color: "var(--text-3)" }}>{t("preview.hint")}</div>
      <div className="flex items-center gap-2 mt-2">
        <button className="btn btn-sm" disabled={job.sampling || ACTIVE.includes(job.status)} onClick={() => sampleJob(job.id)}>
          {job.sampling ? <Loader2 size={13} className="animate-spin" /> : <FileVideo size={13} />}
          {job.sampling ? t("preview.running") : sample ? t("preview.again") : t("preview.action")}
        </button>
        {sample && (
          <button className="btn btn-ghost btn-sm" onClick={() => openPath(sample.file).catch(() => {})}>
            {t("preview.play")}
          </button>
        )}
        {sample && job.media?.video && (
          <button className="btn btn-ghost btn-sm" onClick={() => comparePreview(job, sample.file, sample.start, sample.seconds)}>
            {t("compare.action")}
          </button>
        )}
      </div>
      {sample && (
        <div className="mt-2 text-[12px] leading-relaxed">
          <div>
            {t("preview.resultSize", { size: formatBytes(sample.size), seconds: Math.round(sample.seconds) })}
            <span style={{ color: "var(--text-3)" }}> · {sample.speed.toFixed(1)}× · {sample.encoder?.name ?? "copy"}</span>
          </div>
          <div className="font-medium">{t("preview.resultEstimate", { size: formatBytes(sample.estimate) })}</div>
          {sample.fellBack && <div style={{ color: "var(--warn)" }}>{t("status.fellBack")}</div>}
        </div>
      )}
      {stale && <div className="text-[11.5px] mt-2" style={{ color: "var(--text-3)" }}>{t("preview.stale")}</div>}
    </Section>
  );
}

function CropDetect({ job }: { job: Job }) {
  const t = useT();
  const setOptions = useQueueStore((s) => s.setOptions);
  const [busy, setBusy] = useState(false);
  const v = job.media!.video!;
  const c = job.options.detectedCrop;
  const profile = effectiveProfile(job);
  if (profile?.video.crop.kind !== "auto") return null;
  return (
    <Section title={t("video.crop")}>
      <div className="flex items-center gap-2 mt-1.5 text-[12px]">
        <span className="flex-1" style={{ color: "var(--text-2)" }}>
          {c ? t("crop.detected", { w: c.width, h: c.height, from: `${v.width}×${v.height}` }) : t("crop.notYet")}
        </span>
        <button
          className="btn btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const found = await api.detectCrop(job.path, job.media!.duration, v.width, v.height);
              setOptions(job.id, { detectedCrop: found, cropChecked: true });
              if (!found) toast("info", t("crop.none"));
            } catch (e) {
              toast("err", errorOf(e).detail);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          {t("crop.detect")}
        </button>
      </div>
    </Section>
  );
}

export function CommandBox({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="relative mt-1.5">
      <pre className="mono text-[11px] leading-relaxed whitespace-pre-wrap break-all p-2.5 pr-9 rounded-[5px] max-h-56 overflow-y-auto select-text" style={{ background: "var(--input)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
        {text}
      </pre>
      <button
        className="btn btn-ghost btn-sm btn-icon absolute top-1.5 right-1.5"
        title={t("common.copy")}
        aria-label={t("common.copy")}
        onClick={() => navigator.clipboard.writeText(text).then(() => toast("ok", t("common.copied")))}
      >
        <Copy size={13} />
      </button>
    </div>
  );
}

function StreamRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="mt-0.5" style={{ color: "var(--text-3)" }}>{icon}</span>
      <span className="w-20 shrink-0 font-semibold" style={{ color: "var(--text-2)" }}>{label}</span>
      <span className="min-w-0 break-words" style={{ color: "var(--text)" }}>{value}</span>
    </div>
  );
}
