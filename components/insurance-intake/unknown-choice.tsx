"use client";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { typeStyle } from "@/lib/typography";

export const INTAKE_UNSURE = "I'm not sure";
export function IntakeUnknownChoice({ label, checked, onChange, alignTop = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; alignTop?: boolean }) {
  return <label className={`flex ${alignTop ? "min-h-6" : "min-h-8"} cursor-pointer items-center gap-2 whitespace-nowrap ${typeStyle("body.default")}`}>
    <Checkbox aria-label={`${label}: ${INTAKE_UNSURE}`} checked={checked} onCheckedChange={checked => onChange(!!checked)} />
    {INTAKE_UNSURE}
  </label>;
}
