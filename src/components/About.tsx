import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Code, Compass, ExternalLink, Gamepad, Globe, Layers, Scale, User } from "./icons";
import { useT } from "../lib/i18n";
import { useHwStore } from "../store/useHwStore";
import { Logo } from "./Logo";
import { Modal } from "./ui";
import { startTour } from "./Onboarding";

export const LINKS = {
  website: "https://zsync.eu/zvideoconverter/",
  source: "https://github.com/TheHolyOneZ/ZVideoConverter",
  issues: "https://github.com/TheHolyOneZ/ZVideoConverter/issues",
  author: "https://github.com/TheHolyOneZ",
  projects: "https://zsync.eu/",
  zlogic: "https://zlogic.eu/",
  license: "https://www.gnu.org/licenses/gpl-3.0.html",
};

export function About({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const app = useHwStore((s) => s.app);
  const ffmpeg = useHwStore((s) => s.ffmpeg);
  const update = useHwStore((s) => s.update);
  return (
    <Modal open={open} onClose={onClose} title={t("about.title")} width={500}>
      <div className="px-6 pt-6 pb-5">
        <div className="flex items-center gap-4">
          <Logo size={64} />
          <div className="min-w-0">
            <div className="text-[19px] font-medium leading-tight">ZVideoConverter</div>
            <div className="text-[12px] mono mt-1" style={{ color: "var(--text-3)" }}>
              v{app?.version ?? "…"} · {app?.platform ?? ""} · GPL-3.0
            </div>
            <div className="text-[12.5px] mt-1.5" style={{ color: "var(--text-2)" }}>
              {t("about.by")} <span style={{ color: "var(--text)" }}>TheHolyOneZ</span>
            </div>
          </div>
        </div>

        {update && (
          <button
            className="mt-4 w-full flex items-center gap-3 p-3 rounded-[6px] text-left"
            style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}
            onClick={() => openUrl(update.url || LINKS.website).catch(() => {})}
          >
            <span className="flex-1">
              <span className="block text-[12.5px] font-medium">{t("update.available", { version: update.version })}</span>
              {update.notes && <span className="block text-[11.5px] mt-0.5" style={{ color: "var(--text-2)" }}>{update.notes}</span>}
            </span>
            <ExternalLink size={14} style={{ color: "var(--accent)" }} />
          </button>
        )}

        <p className="text-[12.5px] leading-relaxed mt-4 mb-0" style={{ color: "var(--text-2)" }}>
          {t("about.tagline")}
        </p>

        <div className="label-quiet mt-5 mb-1.5">{t("about.links")}</div>
        <div className="flex flex-col rounded-[6px] overflow-hidden" style={{ border: "1px solid var(--line)" }}>
          <LinkRow icon={<Globe size={15} />} label={t("about.website")} url={LINKS.website} />
          <LinkRow icon={<Code size={15} />} label={t("about.source")} url={LINKS.source} />
          <LinkRow icon={<User size={15} />} label={t("about.author")} url={LINKS.author} />
          <LinkRow icon={<Layers size={15} />} label={t("about.projects")} url={LINKS.projects} />
          <LinkRow icon={<Gamepad size={15} />} label={t("about.zlogic")} url={LINKS.zlogic} />
          <LinkRow icon={<Scale size={15} />} label={t("about.license")} url={LINKS.license} last />
        </div>

        <div className="flex items-center gap-3 mt-4">
          <div className="text-[11.5px] leading-relaxed flex-1" style={{ color: "var(--text-3)" }}>
            {t("about.ffmpeg", { version: ffmpeg?.version ?? "–" })}
          </div>
          <button className="btn btn-sm shrink-0" onClick={startTour}>
            <Compass size={13} />
            {t("tour.take")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LinkRow({ icon, label, url, last }: { icon: ReactNode; label: string; url: string; last?: boolean }) {
  return (
    <button
      className="group flex items-center gap-3 h-10 px-3 text-left hover:bg-[var(--hover)]"
      style={{ background: "transparent", border: "none", borderBottom: last ? "none" : "1px solid var(--line)" }}
      onClick={() => openUrl(url).catch(() => {})}
      title={url}
    >
      <span style={{ color: "var(--text-3)" }}>{icon}</span>
      <span className="text-[12.5px] w-[150px] shrink-0">{label}</span>
      <span className="mono text-[11.5px] truncate flex-1" style={{ color: "var(--text-3)" }}>
        {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
      </span>
      <span className="opacity-0 group-hover:opacity-100" style={{ color: "var(--accent)" }}>
        <ExternalLink size={13} />
      </span>
    </button>
  );
}
