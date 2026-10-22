"use client";
import { useContext, useRef, type ReactNode } from "react";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { InlineFieldsContext } from "@/components/ui/inline-fields";
import { Check } from "lucide-react";
import { Button } from "@claritylabs-inc/ui/components/button";
import { typeStyle } from "@/lib/typography";

export const INTAKE_UNSURE = "I'm not sure";
export function IntakeUnknownChoice({ label, checked, onChange, disabled = false, stretch = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; stretch?: boolean; alignTop?: boolean }) {
  return <Button type="button" variant="outline"
    className={`${stretch ? "h-auto min-h-12 self-stretch" : "h-12"} w-full gap-2 whitespace-nowrap bg-popover px-4 dark:bg-popover hover:bg-accent/50 dark:hover:bg-accent/50 ${checked ? "border-primary text-foreground" : "text-muted-foreground hover:text-foreground"} ${typeStyle("control.input")}`} disabled={disabled}
    aria-label={`${label}: ${INTAKE_UNSURE}`} aria-pressed={checked} onClick={()=>onChange(!checked)}>
    {checked && <Check aria-hidden="true"/>}
    {INTAKE_UNSURE}
  </Button>;
}

/** The unknown action has its own space; it never overlaps a field or calendar. */
export function IntakeUnknownRow({label,value,onChange,children,enabled = true,disabled = false,placement = "beside"}: {
  label:string; value:string; onChange:(value:string)=>void; children:ReactNode; enabled?:boolean; disabled?:boolean; placement?:"beside"|"below";
}) {
  const previous = useRef("");
  const checked = value === INTAKE_UNSURE;
  const below = placement === "below";
  const inline = useContext(InlineFieldsContext);
  if (!enabled) return children;
  // Operator rows: the coverage-limit checkbox pattern, offered only while empty.
  if (inline)
    return <div className="flex min-h-9 min-w-0 items-center gap-3">
      {!checked && <div className="min-w-0 flex-1">{children}</div>}
      {(checked || !value.trim()) && <label className={`flex h-9 shrink-0 items-center gap-2 px-3 ${typeStyle("body.default")}`}>
        <Checkbox aria-label={`${label}: ${INTAKE_UNSURE}`} checked={checked} disabled={disabled}
          onCheckedChange={next=>{
            if(next){previous.current=value;onChange(INTAKE_UNSURE);}else onChange(previous.current);
          }}/>
        {INTAKE_UNSURE}
      </label>}
    </div>;
  return <div className="relative flex min-h-12 min-w-0 flex-col items-stretch gap-3">
    <div aria-hidden={checked || undefined} inert={checked} className={`min-w-0 overflow-hidden transition-opacity duration-200 motion-reduce:transition-none ${below ? checked ? "hidden" : "" : `sm:mr-[calc(9rem+0.75rem)] ${checked ? "max-sm:hidden" : ""}`}`} style={{opacity:checked?0:1}}>
      {!checked && children}
    </div>
    <div className={`flex w-full min-w-0 items-stretch transition-[width] duration-200 motion-reduce:transition-none ${below ? "" : `sm:absolute sm:inset-y-0 sm:right-0 ${checked ? "sm:w-full" : "sm:w-36"}`}`}>
      <IntakeUnknownChoice stretch label={label} checked={checked} disabled={disabled} onChange={next=>{
        if(next){previous.current=value;onChange(INTAKE_UNSURE);}else onChange(previous.current);
      }}/>
    </div>
  </div>;
}
