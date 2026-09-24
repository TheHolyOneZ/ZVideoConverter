import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowDownToLine } from "./icons";
import { useT } from "../lib/i18n";
import { useQueueStore } from "../store/useQueueStore";
import { Viewfinder } from "./Queue";

export function DropOverlay() {
  const t = useT();
  const [over, setOver] = useState(false);
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") setOver(true);
      else if (p.type === "leave") setOver(false);
      else if (p.type === "drop") {
        setOver(false);
        if (p.paths.length) useQueueStore.getState().add(p.paths);
      }
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);
  if (!over) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none" style={{ background: "rgba(10,10,11,.82)" }}>
      <Viewfinder size="large">
        <ArrowDownToLine size={34} style={{ color: "var(--accent)" }} />
        <div className="text-[18px] font-medium mt-4">{t("drop.title")}</div>
        <div className="text-[12.5px] mt-1" style={{ color: "var(--text-2)" }}>{t("drop.text")}</div>
      </Viewfinder>
    </div>
  );
}
