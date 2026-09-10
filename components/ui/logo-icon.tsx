import { SPOT_BLUE, SPOT_MARK_PATH } from "@/lib/spot-mark";

interface LogoIconProps {
  className?: string;
  size?: number | "1em";
  /** Retained for call-site compatibility; the canonical mark is always static. */
  static?: boolean;
}

/** Canonical Spot globe for compact, icon-only product surfaces. */
export function LogoIcon({
  className = "",
  size = 20,
}: LogoIconProps) {
  return (
    <svg
      width={size === "1em" ? undefined : size}
      height={size === "1em" ? undefined : size}
      viewBox="0 0 65 65"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={size === "1em" ? { width: "1em", height: "1em" } : undefined}
      aria-hidden="true"
    >
      <circle
        cx="32.5"
        cy="32.5"
        r="31"
        fill="none"
        stroke={SPOT_BLUE}
        strokeWidth="1.25"
      />
      <path d={SPOT_MARK_PATH} fill={SPOT_BLUE} />
    </svg>
  );
}
