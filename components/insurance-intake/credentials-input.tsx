"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@claritylabs-inc/ui/components/input";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { typeStyle } from "@/lib/typography";

const MAX_ROWS = 15;
const MAX_LENGTH = 120;

/** Newline-delimited items retain the existing request-owned answer contract. */
export function CredentialsInput({ value, onChange }: { value:string; onChange:(value:string)=>void }) {
  const rows = value.split("\n");
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusRow = useRef<number | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (focusRow.current === null) return;
    inputs.current[focusRow.current]?.focus();
    focusRow.current = null;
  }, [value]);
  function update(next: string[], focus?: number) {
    setPasteError(null);
    if (focus !== undefined) focusRow.current = focus;
    onChange(next.join("\n"));
  }
  return <div className="space-y-4">
    <ol aria-label="Licenses, certifications, and professional qualifications" className="space-y-3">
      {rows.map((row,index)=><li key={index} className="flex items-center gap-3">
        <Input ref={element => { inputs.current[index] = element; }} aria-label={`Qualification ${index+1}`} placeholder="License, certification, or qualification" className="h-12 min-w-0 flex-1"
          value={row} maxLength={MAX_LENGTH} onChange={event=>update(rows.map((item,i)=>i===index?event.target.value:item))}
          onPaste={event => {
            const lines = event.clipboardData.getData("text").split(/\r\n|\r|\n/).filter(line => line.trim());
            if (lines.length < 2) return;
            event.preventDefault();
            const start = event.currentTarget.selectionStart ?? row.length;
            const end = event.currentTarget.selectionEnd ?? start;
            const inserted = [...lines];
            inserted[0] = row.slice(0, start) + inserted[0];
            inserted[inserted.length - 1] += row.slice(end);
            if (rows.length - 1 + inserted.length > MAX_ROWS) {
              setPasteError("You can add up to 15 qualifications. Paste a smaller list.");
              return;
            }
            if (inserted.some(line => line.length > MAX_LENGTH)) {
              setPasteError("Keep each qualification to 120 characters or fewer.");
              return;
            }
            update([...rows.slice(0, index), ...inserted, ...rows.slice(index + 1)], index + inserted.length - 1);
          }}/>
        <RemoveButton label={`Remove qualification ${index+1}`} disabled={rows.length===1 && !row}
          onClick={()=>update(rows.length===1?[""]:rows.filter((_,i)=>i!==index), Math.max(0, Math.min(index, rows.length - 2)))}/>
      </li>)}
    </ol>
    {pasteError && <p role="alert" className={`text-destructive ${typeStyle("body.root")}`}>{pasteError}</p>}
    <PillButton type="button" variant="secondary" size="large" disabled={rows.length>=MAX_ROWS} onClick={()=>update([...rows, ""], rows.length)}>
      <Plus aria-hidden="true" className="size-4"/>Add qualification
    </PillButton>
  </div>;
}
