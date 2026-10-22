"use client";
import { useContext } from "react";
import { InlineFieldsContext } from "@/components/ui/inline-fields";
import { typeStyle } from "@/lib/typography";
import { parseWorkJurisdictions, type WorkJurisdiction } from "@/lib/intake-jurisdictions";
import { JurisdictionFields, jurisdictionParts } from "./driver-jurisdiction";
import { INTAKE_UNSURE } from "./unknown-choice";
import { RemoveButton } from "@/components/ui/remove-button";
import { PillButton } from "@/components/ui/pill-button";

export function WorkJurisdictionsInput({value,onChange,defaultCountry}: {value:string;onChange:(value:string)=>void;defaultCountry?:string}) {
  const parsed = parseWorkJurisdictions(value);
  const locations = parsed?.locations.length ? parsed.locations : [{country:"",region:""}];
  const legacy = parsed?.legacy ?? (value && value!==INTAKE_UNSURE && !parsed ? value : undefined);
  const save = (next: WorkJurisdiction[]) => onChange(JSON.stringify({version:"work-jurisdictions-v1",locations:next,...(legacy?{legacy}:{})}));
  const inline = useContext(InlineFieldsContext);
  if (inline) return <div className="space-y-1 py-1">
    {legacy && <p className={`px-3 text-muted-foreground ${typeStyle("body.default")}`}>Previous answer: {legacy}</p>}
    <ul className="space-y-1">{locations.map((location,index)=><li key={index} aria-label={`Work location ${index+1}`} className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1"><JurisdictionFields defaultCountry={defaultCountry} countryLabel={`Work location ${index+1} country`} regionLabel={`Work location ${index+1} state or province`} value={[location.region,location.country].filter(Boolean).join(", ")} onChange={next=>save(locations.map((row,i)=>i===index?jurisdictionParts(next):row))}/></div>
      {locations.length>1 && <RemoveButton label={`Remove work location ${index+1}`} onClick={()=>save(locations.filter((_,i)=>i!==index))}/>}
    </li>)}</ul>
    {locations.length<30 && <PillButton variant="secondary" onClick={()=>save([...locations,{country:"",region:""}])}>Add state or province</PillButton>}
  </div>;
  return <div className="space-y-6">
    <p className={`text-muted-foreground ${typeStyle("body.root")}`}>Select where your employees physically work, including employees who work from home. Add each state or province separately.</p>
    {legacy && <p className={typeStyle("body.root")}>Previous answer: {legacy}</p>}
    {locations.map((location,index)=><section key={index} className="space-y-4" aria-label={`Work location ${index+1}`}>
      <div className="flex items-center gap-3"><h2 className={typeStyle("heading.item")}>Work location {index+1}</h2>{locations.length>1 && <RemoveButton label={`Remove work location ${index+1}`} onClick={()=>save(locations.filter((_,i)=>i!==index))}/>}</div>
      <div className="[&_button]:min-h-12 [&_input]:h-12"><JurisdictionFields defaultCountry={defaultCountry} countryLabel={`Work location ${index+1} country`} regionLabel={`Work location ${index+1} state or province`} value={[location.region,location.country].filter(Boolean).join(", ")} onChange={next=>save(locations.map((row,i)=>i===index?jurisdictionParts(next):row))}/></div>
    </section>)}
    <div className="flex flex-wrap items-center justify-between gap-4">{locations.length<30 && <PillButton variant="secondary" onClick={()=>save([...locations,{country:"",region:""}])}>Add state or province</PillButton>}</div>
  </div>;
}
