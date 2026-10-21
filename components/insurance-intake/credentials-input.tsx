"use client";

import { Plus } from "lucide-react";
import { Input } from "@claritylabs-inc/ui/components/input";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";

/** Newline-delimited items retain the existing request-owned answer contract. */
export function CredentialsInput({ value, onChange }: { value:string; onChange:(value:string)=>void }) {
  const rows = value.split("\n");
  return <div className="space-y-4">
    <ol aria-label="Licenses, certifications, and professional qualifications" className="space-y-3">
      {rows.map((row,index)=><li key={index} className="flex items-center gap-3">
        <Input aria-label={`Qualification ${index+1}`} placeholder="License, certification, or qualification" className="h-12 min-w-0 flex-1"
          value={row} maxLength={120} onChange={event=>onChange(rows.map((item,i)=>i===index?event.target.value:item).join("\n"))}/>
        <RemoveButton label={`Remove qualification ${index+1}`} disabled={rows.length===1 && !row}
          onClick={()=>onChange(rows.length===1?"":rows.filter((_,i)=>i!==index).join("\n"))}/>
      </li>)}
    </ol>
    <PillButton type="button" variant="secondary" size="large" disabled={rows.length>=15} onClick={()=>onChange([...rows, ""].join("\n"))}>
      <Plus aria-hidden="true" className="size-4"/>Add qualification
    </PillButton>
  </div>;
}
