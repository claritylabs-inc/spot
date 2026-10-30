"use client";

import { SettingsSwitch } from "@/components/settings/settings-switch";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

export type PolicyUploadMode = "combined" | "separate";

interface PolicyUploadModeToggleProps {
  value: PolicyUploadMode;
  onChange: (value: PolicyUploadMode) => void;
  disabled?: boolean;
  className?: string;
}

export function PolicyUploadModeToggle({
  value,
  onChange,
  disabled = false,
  className,
}: PolicyUploadModeToggleProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className={`text-foreground ${typeStyle("body.default")}`}>
        Combine into one policy
      </div>
      <SettingsSwitch
        checked={value === "combined"}
        onCheckedChange={() => onChange(value === "combined" ? "separate" : "combined")}
        label="Combine files into one policy"
        disabled={disabled}
      />
    </div>
  );
}
