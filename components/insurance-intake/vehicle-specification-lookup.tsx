"use client";
import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@claritylabs-inc/ui/components/select";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { typeStyle } from "@/lib/typography";

type Result=FunctionReturnType<typeof api.actions.intakeVehicleSpecifications.lookup>;
const cache=new Map<string,Promise<Result>>();
export function VehicleSpecificationLookup({requestId,coverageIndex,vehicleIndex,identity,field,value,onChange,onPrefill}:{requestId:Id<"procurementRequests">;coverageIndex:number;vehicleIndex:number;identity:{year:string;make:string;model:string};field:"gross_vehicle_weight"|"seats";value:string;onChange:(value:string)=>void;onPrefill:(value:string)=>void}) {
  const lookup=useAction(api.actions.intakeVehicleSpecifications.lookup);
  const [result,setResult]=useState<{key:string;data:Result}>();
  const current=useRef({value,onPrefill});
  useEffect(()=>{current.current={value,onPrefill};},[value,onPrefill]);
  const identityReady=/^\d{4}$/.test(identity.year.trim()) && !!identity.make.trim() && !!identity.model.trim();
  const key=JSON.stringify([requestId,coverageIndex,vehicleIndex,identity.year.trim(),identity.make.trim(),identity.model.trim()]);
  useEffect(()=>{
    if(!identityReady || current.current.value.trim())return;
    let active=true;
    let task=cache.get(key);
    if(!task){task=lookup({requestId,coverageIndex,vehicleIndex});cache.set(key,task);}
    void task.then(data=>{
      if(!active)return;
      setResult({key,data});
      const records=data.specifications.filter(row=>row.field===field&&row.appliesToAllVariants);
      const values=[...new Set(records.map(row=>row.field==="seats"?String(row.value):`${row.value} ${row.unit}`))];
      if(values.length===1&&!current.current.value.trim())current.current.onPrefill(values[0]);
    }).catch(()=>{/* Unavailable lookups leave ordinary manual entry unchanged. */});
    return ()=>{active=false;};
  },[key,identityReady,requestId,coverageIndex,vehicleIndex,lookup,field]);
  const records=(result?.key===key ? result.data.specifications : []).filter(row=>row.field===field);
  const selectionKey=`${key}:${field}`;
  const [selection,setSelection]=useState<{key:string;index:string}>();
  const selected=selection?.key===selectionKey ? selection.index : undefined;
  if(!records.length)return null;
  return <div className="space-y-3">
    {records.length>0&&<Field><FieldLabel className={typeStyle("body.root")}>Manufacturer specifications</FieldLabel>
      <Select value={selected} onValueChange={index=>{if(index===null)return;const row=records[Number(index)];if(!row)return;setSelection({key:selectionKey,index});onChange(row.field==="seats"?String(row.value):`${row.value} ${row.unit}`);}}>
        <SelectTrigger className="h-12" aria-label="Choose vehicle configuration"><SelectValue placeholder="Confirm your vehicle configuration">{selected !== undefined && records[Number(selected)] ? `${records[Number(selected)].variant} — ${records[Number(selected)].value.toLocaleString("en-US")} ${records[Number(selected)].unit}` : undefined}</SelectValue></SelectTrigger>
        <SelectContent>{records.map((row,index)=><SelectItem key={`${row.variant}:${row.value}:${index}`} value={String(index)}>{row.variant} — {row.value.toLocaleString("en-US")} {row.unit}</SelectItem>)}</SelectContent>
      </Select>
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>{field==="seats"?"Factory seating includes the driver. Confirm any optional seating package or modifications.":"Match the trim and drivetrain. The rating on the vehicle’s door label takes precedence."}</p>
      <div className={typeStyle("body.default")}>{[...new Set(records.map(row=>row.sourceUrl))].map(url=><a key={url} href={url} target="_blank" rel="noreferrer" className="mr-3 underline">Manufacturer source</a>)}</div>
    </Field>}
  </div>;
}
