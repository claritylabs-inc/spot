"use client";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { InputGroup, InputGroupAddon, InputGroupText } from "@claritylabs-inc/ui/components/input-group";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@claritylabs-inc/ui/components/select";
import { DateField } from "@claritylabs-inc/ui/components/date-field";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { typeStyle } from "@/lib/typography";
import { newPayrollGroup, parsePayrollAnswer, PAYROLL_CURRENCIES, PAYROLL_PERIODS, type PayrollGroup } from "@/lib/intake-payroll";
import { IntakeValueInput, IntakeRadioChoices } from "./details-fields";
import { VehicleUnitInput } from "./vehicle-unit-input";
import { IntakeUnknownChoice, INTAKE_UNSURE } from "./unknown-choice";
export function PayrollInput({value, onChange}: {value: string; onChange: (value: string) => void}) {
  const parsed = parsePayrollAnswer(value);
  const groups = parsed?.groups.length ? parsed.groups : [newPayrollGroup()];
  const legacy = parsed?.legacy ?? (value && value !== INTAKE_UNSURE && !parsed ? value : undefined);
  const save = (next: PayrollGroup[]) => onChange(JSON.stringify({version:"payroll-v1", groups:next, ...(legacy ? {legacy} : {})}));
  const update = (index: number, patch: Partial<PayrollGroup>) => save(groups.map((row,i) => i === index ? {...row,...patch} : row));
  return <div className="space-y-6 [&_[data-slot=field-label]]:text-base">
    <p className={`text-muted-foreground ${typeStyle("body.root")}`}>Group employees who do similar work.</p>
    {legacy && <p className={typeStyle("body.default")}>Previous answer: {legacy}</p>}
    {groups.map((row,index) => <section key={index} className="space-y-6 rounded-xl border border-border p-5" aria-label={`Payroll group ${index+1}`}>
      <div className="flex items-center gap-3"><h2 className={typeStyle("heading.item")}>Employee group {index+1}</h2>{groups.length>1 && <RemoveButton label={`Remove payroll group ${index+1}`} onClick={() => save(groups.filter((_,i)=>i!==index))}/>}</div>
      <Field><FieldLabel className={typeStyle("body.root")} htmlFor={`payroll-employees-${index}`}>Which employees does this cover?</FieldLabel><Input id={`payroll-employees-${index}`} className="h-12" placeholder="e.g. office staff, warehouse employees, or all employees" value={row.employees} maxLength={120} onChange={e=>update(index,{employees:e.target.value})}/></Field>
      <Field><FieldLabel className={typeStyle("body.root")} htmlFor={`payroll-count-${index}`}>Number of employees (optional)</FieldLabel><VehicleUnitInput id={`payroll-count-${index}`} label={`Group ${index+1} employee count`} field="count" value={row.headcount} onChange={headcount=>update(index,{headcount})}/></Field>
      <Field><FieldLabel className={typeStyle("body.root")}>Payroll period</FieldLabel><IntakeRadioChoices label={`Group ${index+1} payroll period`} choices={[...new Set([...PAYROLL_PERIODS, ...(row.period ? [row.period] : [])])]} value={row.period} onChange={period=>update(index,{period,start:"",end:""})}/></Field>
      {row.period === "Custom dates" && <div className="grid gap-4 sm:grid-cols-2"><DateField id={`payroll-start-${index}`} label="Period start" value={row.start} onChange={start=>update(index,{start})}/><DateField id={`payroll-end-${index}`} label="Period end" value={row.end} onChange={end=>update(index,{end})}/></div>}
      <Field><FieldLabel className={typeStyle("body.root")}>Currency</FieldLabel><Select value={row.currency} onValueChange={currency=>update(index,{currency:currency??"USD"})}><SelectTrigger className="h-12" aria-label={`Group ${index+1} payroll currency`}><SelectValue>{row.currency}</SelectValue></SelectTrigger><SelectContent>{PAYROLL_CURRENCIES.map(currency=><SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field>
      <Field><FieldLabel className={typeStyle("body.root")} htmlFor={`payroll-amount-${index}`}>Total payroll for this group and period</FieldLabel><div className="relative"><InputGroup className={`h-12 ${!row.amount ? "[&_input]:pr-40" : ""}`}><InputGroupAddon><InputGroupText>{row.currency}</InputGroupText></InputGroupAddon>{row.amount!==INTAKE_UNSURE && <IntakeValueInput id={`payroll-amount-${index}`} label={`Group ${index+1} total payroll`} value={row.amount} placeholder="Enter total payroll" onValueChange={amount=>update(index,{amount:amount.replaceAll(",", "").slice(0,24)})}/>}</InputGroup>{(!row.amount || row.amount===INTAKE_UNSURE) && <div className="absolute right-4 top-2"><IntakeUnknownChoice label={`Group ${index+1} total payroll`} checked={row.amount===INTAKE_UNSURE} onChange={checked=>update(index,{amount:checked?INTAKE_UNSURE:""})}/></div>}</div></Field>
    </section>)}
    {groups.length<6 && <PillButton variant="secondary" onClick={()=>save([...groups,newPayrollGroup()])}>Add employee group</PillButton>}
    {(!value.trim() || !!parsed) && <IntakeUnknownChoice label="Payroll details" checked={false} onChange={checked=>onChange(checked?INTAKE_UNSURE:"")}/>}
  </div>;
}
