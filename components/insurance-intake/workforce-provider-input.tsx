"use client";
import { useContext } from "react";
import { Input } from "@claritylabs-inc/ui/components/input";
import { InlineFieldsContext } from "@/components/ui/inline-fields";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { typeStyle } from "@/lib/typography";
import { parseWorkforceProvider, workforceProviderComplete } from "@/lib/intake-workforce-provider";

export function WorkforceProviderInput({value,onChange,provider}:{value:string;onChange:(value:string)=>void;provider:"PEO"|"Staffing agency"}) {
  const parsed=parseWorkforceProvider(value);
  const row=parsed??{version:"workforce-provider-v1" as const,name:"",website:"",...(value && value!=="I'm not sure"?{legacy:value}:{})};
  const update=(patch:Partial<typeof row>)=>{const next={...row,...patch};onChange(!next.name&&!next.website&&!next.legacy?"":JSON.stringify(next));};
  const inline=useContext(InlineFieldsContext);
  if(inline)return <div className="space-y-1 py-1">
    {row.legacy&&<p className={`px-3 text-muted-foreground ${typeStyle("body.default")}`}>Previous answer: {row.legacy}</p>}
    <Input aria-label={`${provider} name`} value={row.name} maxLength={200} placeholder={`${provider} name`} onChange={event=>update({name:event.target.value})}/>
    <Input aria-label={`${provider} website`} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={row.website} maxLength={500} placeholder="Website" aria-invalid={!workforceProviderComplete(value)} onChange={event=>update({website:event.target.value})}/>
    {!workforceProviderComplete(value)&&<p role="alert" className={`px-3 text-destructive ${typeStyle("body.default")}`}>Enter a valid website or clear it.</p>}
  </div>;
  return <div className="space-y-6">
    {row.legacy&&<p className={`text-muted-foreground ${typeStyle("body.default")}`}>Previous answer: {row.legacy}</p>}
    <Field><FieldLabel className={typeStyle("body.root")} htmlFor="workforce-provider-name">{provider} name</FieldLabel><Input id="workforce-provider-name" className="h-12" value={row.name} maxLength={200} placeholder={`Enter ${provider.toLowerCase()} name`} onChange={event=>update({name:event.target.value})}/></Field>
    <Field><FieldLabel className={typeStyle("body.root")} htmlFor="workforce-provider-website">Website (optional)</FieldLabel><Input id="workforce-provider-website" className="h-12" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={row.website} maxLength={500} placeholder="https://example.com" aria-invalid={!workforceProviderComplete(value)} onChange={event=>update({website:event.target.value})}/>
    {!workforceProviderComplete(value)&&<p className={typeStyle("body.default")}>Enter a valid website or clear it to continue.</p>}</Field>
  </div>;
}
