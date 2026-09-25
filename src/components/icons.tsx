import type { CSSProperties, ReactNode } from "react";

export interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  fill?: string;
  strokeWidth?: number;
}

function make(body: (fill?: string) => ReactNode, solid = false) {
  return function Icon({ size = 16, className, style, fill, strokeWidth = 1.5 }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill={solid ? "currentColor" : "none"}
        stroke={solid ? "none" : "currentColor"}
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="miter"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        {body(fill)}
      </svg>
    );
  };
}

const dot = (x: number, y: number, s = 1.6) => <rect x={x - s / 2} y={y - s / 2} width={s} height={s} fill="currentColor" stroke="none" />;
const folder = "M1.75 3.75h4.5l1.5 1.5h6.5v7.5H1.75z";
const page = "M3.25 1.75h6l3.5 3.5v9h-9.5z M9.25 1.75v3.5h3.5";

export const Plus = make(() => <path d="M8 3v10M3 8h10" />);
export const Minus = make(() => <path d="M3.5 8h9" />);
export const X = make(() => <path d="M4 4l8 8M12 4l-8 8" />);
export const Check = make(() => <path d="M3 8.5l3.25 3.25L13 5" />);
export const ChevronDown = make(() => <path d="M4 6l4 4 4-4" />);
export const ChevronRight = make(() => <path d="M6 4l4 4-4 4" />);
export const PanelRight = make(() => <path d="M2.25 2.75h11.5v10.5H2.25zM10 2.75v10.5" />);
export const ArrowRight = make(() => <path d="M2.75 8h10M9 4.25L12.75 8 9 11.75" />);
export const ArrowLeft = make(() => <path d="M13.25 8h-10M7 4.25L3.25 8 7 11.75" />);
export const Compass = make(() => <><circle cx="8" cy="8" r="6.25" /><path d="M10.5 5.5l-1.5 3.5-3.5 1.5 1.5-3.5z" /></>);
export const MoreHorizontal = make(() => <>{dot(3.5, 8)}{dot(8, 8)}{dot(12.5, 8)}</>);
export const GripVertical = make(() => <>{dot(6, 4)}{dot(10, 4)}{dot(6, 8)}{dot(10, 8)}{dot(6, 12)}{dot(10, 12)}</>);
export const Search = make(() => <path d="M7 2.75a4.25 4.25 0 1 0 0 8.5a4.25 4.25 0 1 0 0-8.5zM10.25 10.25l3.5 3.5" />);
export const Copy = make(() => <path d="M5.25 5.25h8v8h-8zM2.75 10.5V2.75h7.75" />);
export const Pencil = make(() => <path d="M10.5 2.5l3 3-8 8H2.5v-3zM8.75 4.25l3 3" />);
export const Trash2 = make(() => <path d="M2.5 4.25h11M6 4.25V2.25h4v2M3.75 4.25l.75 9.5h7l.75-9.5M6.75 7v4M9.25 7v4" />);
export const Undo2 = make(() => <path d="M5.5 3.5L2.5 6.5l3 3M2.75 6.5h6.75a3.5 3.5 0 0 1 0 7H6" />);
export const RotateCcw = make(() => <path d="M2.75 2.75v3.5h3.5M3.2 6.1A5.25 5.25 0 1 1 3.4 10.5" />);
export const RefreshCw = make(() => <path d="M13.25 2.75v3.5h-3.5M2.75 13.25v-3.5h3.5M12.8 6.1A5.25 5.25 0 0 0 3.5 5M3.2 9.9A5.25 5.25 0 0 0 12.5 11" />);
export const Save = make(() => <path d="M2.25 2.25h9l2.5 2.5v9h-11.5zM5 2.25v3.5h5.5v-3.5M4.75 13.75v-4.5h6.5v4.5" />);
export const Download = make(() => <path d="M8 1.75v8M4.75 6.75L8 10l3.25-3.25M2.25 10.5v3.25h11.5V10.5" />);
export const Upload = make(() => <path d="M8 10V2M4.75 5.25L8 2l3.25 3.25M2.25 10.5v3.25h11.5V10.5" />);
export const ArrowDownToLine = make(() => <path d="M8 1.75v8.5M4.25 6.75L8 10.5l3.75-3.75M2.5 13.75h11" />);
export const ArrowUpToLine = make(() => <path d="M8 14.25v-8.5M4.25 9.25L8 5.5l3.75 3.75M2.5 2.25h11" />);
export const CornerDownLeft = make(() => <path d="M13.25 2.75v6.5h-10M5.75 6.5L3 9.25 5.75 12" />);
export const Braces = make(() => (
  <path d="M5.75 2.25H5c-1 0-1.5.5-1.5 1.5v2.5L2 8l1.5 1.75v2.5c0 1 .5 1.5 1.5 1.5h.75M10.25 2.25H11c1 0 1.5.5 1.5 1.5v2.5L14 8l-1.5 1.75v2.5c0 1-.5 1.5-1.5 1.5h-.75" />
));
export const Eraser = make(() => <path d="M9.25 2.5l4.25 4.25-6.25 6.5H4.5L2.5 11.25zM5.75 6l4.25 4.25M9 13.25h5" />);
export const CheckCheck = make(() => <path d="M2.25 2.25h11.5v11.5H2.25zM5 8.25l2 2L11 6" />);

export const Play = make(() => <path d="M4 2.25v11.5L13.5 8z" />, true);
export const Pause = make(() => <path d="M3.5 2.5h3.25v11H3.5zM9.25 2.5h3.25v11H9.25z" />, true);
export const Square = make(() => <path d="M3 3h10v10H3z" />, true);
export const Zap = make(() => (
  <path d="M1.5 3.5h7v9h-7zM8.5 8H14.5M12 5.5L14.5 8 12 10.5M4 6l2.25 2L4 10" />
));

export const FolderOpen = make(() => <path d={`${folder}M9 8.5h3M10.5 7l1.5 1.5-1.5 1.5`} />);
export const FolderPlus = make(() => <path d={`${folder}M8 7v4M6 9h4`} />);
export const FolderInput = make(() => <path d={folder} />);
export const FolderSearch = make(() => <path d={`${folder}M5.5 9h.01M8 9h.01M10.5 9h.01`} />);
export const FilePlus2 = make(() => <path d={`${page}M8 7.75v4.5M5.75 10h4.5`} />);
export const FileVideo = make(() => <path d={`${page}M6.5 7.5v4.5L10.25 9.75z`} />);
export const ScrollText = make(() => <path d="M1.75 2.75h12.5v10.5H1.75zM4.25 6l2 2-2 2M7.75 10.5h4" />);

export const Film = make(() => (
  <>
    <path d="M2.75 1.75h10.5v12.5H2.75zM5.25 1.75v12.5M10.75 1.75v12.5" />
    {dot(4, 4.5, 1.1)}
    {dot(4, 8, 1.1)}
    {dot(4, 11.5, 1.1)}
    {dot(12, 4.5, 1.1)}
    {dot(12, 8, 1.1)}
    {dot(12, 11.5, 1.1)}
  </>
));
export const Clapperboard = make(() => <path d="M2.25 6.5h11.5v7.25H2.25zM2.25 6.5l.75-3.75 10.5-.5.25 4.25M6.25 2.6L5 6.5M10 2.4L8.75 6.5" />);
export const Music = make(() => (
  <path d="M6 12V3.25l7.5-1.5v8.75M6 12a1.75 1.75 0 1 1-3.5 0a1.75 1.75 0 1 1 3.5 0zM13.5 10.5a1.75 1.75 0 1 1-3.5 0a1.75 1.75 0 1 1 3.5 0z" />
));
export const Image = make(() => <path d="M1.75 2.75h12.5v10.5H1.75zM1.75 11l3.5-3.5 3 3 2-2 4 4" />);
export const Subtitles = make(() => <path d="M1.75 2.75h12.5v10.5H1.75zM4 9.75h3.5M9.5 9.75h2.5M4 7.25h8" />);
export const Layers = make(() => <path d="M8 2L14 5.25 8 8.5 2 5.25zM2 8.25l6 3.25 6-3.25M2 11.25l6 3.25 6-3.25" />);

export const Gpu = make(() => (
  <path d="M1.5 4.25h11.75v6.5H1.5zM3.5 10.75v2M13.25 5.5h1.5v4h-1.5M9.5 5.75a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 1 1 0-3.5zM4 6.5h2.5M4 8.5h2.5" />
));
export const Cpu = make(() => (
  <path d="M4.25 4.25h7.5v7.5h-7.5zM6.5 6.5h3v3h-3zM6.25 1.5v2.75M9.75 1.5v2.75M6.25 11.75v2.75M9.75 11.75v2.75M1.5 6.25h2.75M1.5 9.75h2.75M11.75 6.25h2.75M11.75 9.75h2.75" />
));
export const Gauge = Gpu;
export const Cog = make(() => (
  <path d="M12.9 7.01L14.54 7.14L14.54 8.86L12.9 8.99L12.17 10.76L13.23 12.02L12.02 13.23L10.76 12.17L8.99 12.9L8.86 14.54L7.14 14.54L7.01 12.9L5.24 12.17L3.98 13.23L2.77 12.02L3.83 10.76L3.1 8.99L1.46 8.86L1.46 7.14L3.1 7.01L3.83 5.24L2.77 3.98L3.98 2.77L5.24 3.83L7.01 3.1L7.14 1.46L8.86 1.46L8.99 3.1L10.76 3.83L12.02 2.77L13.23 3.98L12.17 5.24ZM8 6a2 2 0 1 0 0 4a2 2 0 1 0 0-4z" strokeWidth={1.25} />
));
export const Settings = Cog;
export const SlidersHorizontal = make(() => <path d="M2 4.5h12M2 11.5h12M5.5 3v3M10.5 10v3" />);
export const Command = make(() => <path d="M1.75 3.75h12.5v8.5H1.75zM4 6.5h.5M6.5 6.5h.5M9 6.5h.5M11.5 6.5h.5M5 9.5h6" />);
export const Globe = make(() => (
  <path d="M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5zM1.75 8h12.5M8 1.75c-2.25 2.5-2.25 10 0 12.5M8 1.75c2.25 2.5 2.25 10 0 12.5" />
));
export const Sun = make(() => (
  <path d="M8 5.25a2.75 2.75 0 1 0 0 5.5a2.75 2.75 0 1 0 0-5.5zM12.6 8L14.4 8M11.25 11.25L12.53 12.53M8 12.6L8 14.4M4.75 11.25L3.47 12.53M3.4 8L1.6 8M4.75 4.75L3.47 3.47M8 3.4L8 1.6M11.25 4.75L12.53 3.47" />
));
export const Moon = make(() => <path d="M13.5 9.75A6 6 0 0 1 6.25 2.5a6 6 0 1 0 7.25 7.25z" />);
export const Lock = make(() => <path d="M3 7.25h10v6.5H3zM5.25 7.25V5a2.75 2.75 0 0 1 5.5 0v2.25" />);
export const Star = make((fill) => (
  <path d="M8 2L9.65 6.13L14.09 6.42L10.66 9.27L11.76 13.58L8 11.2L4.24 13.58L5.34 9.27L1.91 6.42L6.35 6.13Z" fill={fill ?? "none"} />
));
export const Heart = make(() => <path d="M8 13.5L2.5 8a3 3 0 0 1 5.5-3.5A3 3 0 0 1 13.5 8z" />);
export const Scale = make(() => <path d="M8 2v11.5M4.5 13.75h7M2.5 4.25h11M2.5 4.25L1 9h3zM13.5 4.25L12 9h3z" />);
export const ShieldCheck = make(() => <path d="M8 1.75l5.25 2v4c0 3-2.25 5.25-5.25 6.5-3-1.25-5.25-3.5-5.25-6.5v-4zM5.5 8l1.75 1.75L10.75 6.25" />);

export const SortIcon = make(() => <path d="M4.5 2.5v11M2 11l2.5 2.5L7 11M9 4h5M9 7.5h3.5M9 11h2" />);
export const Eye = make(() => <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4a2 2 0 1 0 0-4z" />);
export const Code = make(() => <path d="M5.25 4.5L1.75 8l3.5 3.5M10.75 4.5L14.25 8l-3.5 3.5M9.25 2.75l-2.5 10.5" />);
export const Gamepad = make(() => (
  <path d="M4.5 4.5h7a3.25 3.25 0 0 1 3.25 3.25v1.5A2.25 2.25 0 0 1 12.5 11.5c-1 0-1.5-.5-2-1.25H5.5C5 11 4.5 11.5 3.5 11.5a2.25 2.25 0 0 1-2.25-2.25v-1.5A3.25 3.25 0 0 1 4.5 4.5zM4.75 6.75v2M3.75 7.75h2M10.5 7h.01M12 8.5h.01" />
));
export const User = make(() => <path d="M8 2.25a2.75 2.75 0 1 0 0 5.5a2.75 2.75 0 1 0 0-5.5zM2.75 13.75c.5-2.5 2.5-4 5.25-4s4.75 1.5 5.25 4" />);
export const ExternalLink = make(() => <path d="M9.5 2.25h4.25V6.5M13.5 2.5L7.5 8.5M11.75 9.5v4.25H2.25V4.25H6.5" />);

export const Info = make(() => <path d="M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5zM8 7.25v4M8 4.75v.25" />);
export const CheckCircle2 = make(() => <path d="M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5zM5.25 8.25l1.75 1.75 3.75-4" />);
export const XCircle = make(() => <path d="M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5zM5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />);
export const AlertTriangle = make(() => <path d="M8 2l6.25 11.25H1.75zM8 6.5v3.25M8 11.25v.25" />);
export const CircleSlash = make(() => <path d="M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5zM3.6 12.4l8.8-8.8" />);
export const Loader2 = make(() => <path d="M8 2a6 6 0 1 0 6 6" />);
