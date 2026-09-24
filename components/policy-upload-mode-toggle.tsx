"use client";

import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
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
      <div className={`text-muted-foreground ${typeStyle("caption.medium")}`}>
        Import as
      </div>
      <Tabs
        value={value}
        onValueChange={(next) => {
          if (!disabled) onChange(next as PolicyUploadMode);
        }}
        className={cn("shrink-0", disabled && "pointer-events-none opacity-50")}
      >
        <TabsList variant="pill" aria-label="Import files as">
          <TabsTrigger value="combined" disabled={disabled}>
            One policy
          </TabsTrigger>
          <TabsTrigger value="separate" disabled={disabled}>
            Separate policies
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
