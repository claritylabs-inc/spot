"use client";

import { ThemeModeSelector as SharedThemeModeSelector } from "@claritylabs-inc/ui/components/theme-mode-selector";
import { useTheme } from "@/hooks/use-theme";

export function ThemeModeSelector({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <SharedThemeModeSelector
      value={theme}
      onChange={setTheme}
      variant="options"
      className={className}
    />
  );
}
