"use client";
import { typeStyle } from "@/lib/typography";
import { parseWorkJurisdictions, type WorkJurisdiction } from "@/lib/intake-jurisdictions";
import { JurisdictionFields, jurisdictionParts } from "./driver-jurisdiction";
import { IntakeUnknownChoice, INTAKE_UNSURE } from "./unknown-choice";
import { RemoveButton } from "@/components/ui/remove-button";
import { PillButton } from "@/components/ui/pill-button";

export function WorkJurisdictionsInput({value,onChange}: {value:string;onChange:(value:string)=>void}) {
  const parsed = parseWorkJurisdictions(value);
  const locations = parsed?.locations.length ? parsed.locations : [{country:"",region:""}];
  const legacy = parsed?.legacy ?? (value && value!==INTAKE_UNSURE && !parsed ? value : undefined);
  const save = (next: WorkJurisdiction[]) => onChange(JSON.stringify({version:"work-jurisdictions-v1",locations:next,...(legacy?{legacy}:{})}));
  return <div className="space-y-6">
    <p className={`text-muted-foreground ${typeStyle("body.root")}`}>Select where your employees physically work, including employees who work from home. Add each state or province separately.</p>
    {legacy && <p className={typeStyle("body.root")}>Previous answer: {legacy}</p>}
    {locations.map((location,index)=><section key={index} className="space-y-4" aria-label={`Work location ${index+1}`}>
      <div className="flex items-center gap-3"><h2 className={typeStyle("heading.item")}>Work location {index+1}</h2>{locations.length>1 && <RemoveButton label={`Remove work location ${index+1}`} onClick={()=>save(locations.filter((_,i)=>i!==index))}/>}</div>
      <div className="[&_button]:min-h-12 [&_input]:h-12"><JurisdictionFields countryLabel={`Work location ${index+1} country`} regionLabel={`Work location ${index+1} state or province`} allowUnknown value={[location.region,location.country].filter(Boolean).join(", ")} onChange={next=>save(locations.map((row,i)=>i===index?jurisdictionParts(next):row))}/></div>
    </section>)}
    <div className="flex flex-wrap items-center justify-between gap-4">{locations.length<30 && <PillButton variant="secondary" onClick={()=>save([...locations,{country:"",region:""}])}>Add state or province</PillButton>}<IntakeUnknownChoice label="Work locations" checked={false} onChange={checked=>onChange(checked?INTAKE_UNSURE:"")}/></div>
  </div>;
}
