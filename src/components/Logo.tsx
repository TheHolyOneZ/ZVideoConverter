import logo from "../assets/logo.png";

export function Logo({ size = 22 }: { size?: number }) {
  return <img src={logo} width={size} height={size} alt="" draggable={false} style={{ flexShrink: 0, display: "block" }} />;
}
