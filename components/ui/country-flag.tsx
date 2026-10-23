import flags from "react-phone-number-input/flags";
import type { Country } from "react-phone-number-input";

/** A small country flag for option lists; renders nothing for unknown codes. */
export function CountryFlag({ code, label }: { code: string; label: string }) {
  const Flag = flags[code as Country];
  if (!Flag) return null;
  return (
    <span className="flex h-3 w-4 shrink-0 overflow-hidden rounded-xs">
      <Flag title={label} />
    </span>
  );
}
