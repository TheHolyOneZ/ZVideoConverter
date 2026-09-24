import { useEffect, useRef, useState } from "react";
import logo from "../assets/logo.png";
import { useT } from "../lib/i18n";

const BEAT = 500;
const COUNT_END = 3 * BEAT;
const FLASH_END = COUNT_END + 110;
const LOGO_END = FLASH_END + 520;
const HOLD_MAX = 8000;
const FADE = 320;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

interface Props {
  ready: boolean;
  onDone: () => void;
}

export function Splash({ ready, onDone }: Props) {
  const t = useT();
  const [reduced] = useState(reducedMotion);
  const [now, setNow] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const start = useRef(performance.now());
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const leavingRef = useRef(false);

  const leave = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    window.setTimeout(onDone, FADE);
  };

  useEffect(() => {
    let raf = 0;
    const end = reduced ? 400 : LOGO_END;
    const tick = () => {
      const t = performance.now() - start.current;
      setNow(t);
      if ((t >= end && readyRef.current) || t >= HOLD_MAX) leave();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const skip = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      leave();
    };
    window.addEventListener("keydown", skip, true);
    window.addEventListener("pointerdown", skip, true);
    return () => {
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("pointerdown", skip, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waiting = now > (reduced ? 900 : LOGO_END + 250) && !ready;

  return (
    <div
      className={`zs-root${leaving ? " zs-leaving" : ""}`}
      style={{ transitionDuration: `${FADE}ms` }}
      role="img"
      aria-label={t("app.name")}
    >
      {reduced ? (
        <LogoFrame t={now} fadeIn={400} waiting={waiting} />
      ) : (
        <>
          <Sprockets side="left" />
          <Gate t={now} waiting={waiting} />
          <Sprockets side="right" />
        </>
      )}
      <span className="zs-skip">{t("intro.skip")}</span>
    </div>
  );
}

function Gate({ t, waiting }: { t: number; waiting: boolean }) {
  const step = Math.floor(t / 70);
  const wx = ((step * 7919) % 3) - 1;
  const wy = ((step * 104729) % 3) - 1;
  return (
    <div className="zs-gate">
      <div className="zs-frame" style={{ transform: `translate(${wx}px, ${wy}px)` }}>
        {t < COUNT_END ? <Leader t={t} /> : <LogoFrame t={t - FLASH_END} fadeIn={260} waiting={waiting} />}
        {t >= COUNT_END - 40 && t < FLASH_END + 90 && <div className="zs-flash" style={{ opacity: flash(t) }} />}
      </div>
      <Dust t={t} />
      <div className="zs-grain" style={{ backgroundPosition: `${(step * 37) % 200}px ${(step * 91) % 200}px` }} />
      <div className="zs-flicker" />
      <div className="zs-vignette" />
    </div>
  );
}

function flash(t: number) {
  if (t < COUNT_END) return (t - (COUNT_END - 40)) / 40;
  if (t < FLASH_END) return 1;
  return Math.max(0, 1 - (t - FLASH_END) / 90);
}

function Leader({ t }: { t: number }) {
  const n = 3 - Math.floor(t / BEAT);
  const a = ((t % BEAT) / BEAT) * Math.PI * 2;
  const R = 1400;
  const x = Math.sin(a) * R;
  const y = -Math.cos(a) * R;
  const wedge = `M0 0 L0 ${-R} A${R} ${R} 0 ${a > Math.PI ? 1 : 0} 1 ${x.toFixed(1)} ${y.toFixed(1)} Z`;
  return (
    <svg className="zs-leader" viewBox="-800 -450 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect x="-800" y="-450" width="1600" height="900" fill="#26241F" />
      <path d={wedge} fill="#FF5B2E" fillOpacity="0.62" />
      <line x1="-800" y1="0" x2="800" y2="0" stroke="#ECE9E3" strokeOpacity="0.55" strokeWidth="3" />
      <line x1="0" y1="-450" x2="0" y2="450" stroke="#ECE9E3" strokeOpacity="0.55" strokeWidth="3" />
      <circle r="300" fill="none" stroke="#ECE9E3" strokeOpacity="0.9" strokeWidth="7" />
      <circle r="352" fill="none" stroke="#ECE9E3" strokeOpacity="0.9" strokeWidth="7" />
      <text
        x="0"
        y="0"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ECE9E3"
        style={{ font: "600 400px 'IBM Plex Sans', sans-serif" }}
      >
        {n}
      </text>
    </svg>
  );
}

function LogoFrame({ t, fadeIn, waiting }: { t: number; fadeIn: number; waiting: boolean }) {
  const tr = useT();
  const k = Math.min(1, Math.max(0, t / fadeIn));
  const name = Math.min(1, Math.max(0, (t - fadeIn * 0.5) / fadeIn));
  return (
    <div className="zs-logo">
      <img src={logo} alt="" draggable={false} style={{ opacity: k, transform: `scale(${0.94 + 0.06 * k})` }} />
      <div className="zs-name" style={{ opacity: name, transform: `translateY(${(1 - name) * 6}px)` }}>
        ZVideo<span>Converter</span>
      </div>
      <div className="zs-wait" style={{ opacity: waiting ? 1 : 0 }}>
        {tr("hw.checking")}
      </div>
    </div>
  );
}

function Dust({ t }: { t: number }) {
  const seed = Math.floor(t / 85);
  const specks = [];
  for (let i = 0; i < 4; i++) {
    const r = rand(seed * 13 + i);
    if (r > 0.55) continue;
    specks.push(
      <circle key={i} cx={rand(seed * 31 + i) * 1600} cy={rand(seed * 17 + i * 3) * 900} r={2 + rand(seed + i * 7) * 5} fill="#0B0A09" fillOpacity="0.8" />,
    );
  }
  const scratch = rand(Math.floor(t / 400) + 99) < 0.6;
  const sx = 200 + rand(Math.floor(t / 400) + 5) * 1200 + (rand(seed + 2) - 0.5) * 6;
  return (
    <svg className="zs-dust" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden>
      {specks}
      {scratch && <line x1={sx} y1="0" x2={sx + 4} y2="900" stroke="#F4F0E6" strokeOpacity="0.22" strokeWidth="1.6" />}
    </svg>
  );
}

function rand(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function Sprockets({ side }: { side: "left" | "right" }) {
  return <div className={`zs-sprockets zs-${side}`} aria-hidden />;
}
