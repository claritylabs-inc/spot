"use client";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { InputGroup, InputGroupAddon, InputGroupText } from "@claritylabs-inc/ui/components/input-group";
import { CurrencySelect } from "@/components/ui/currency-select";
import { DateField } from "@claritylabs-inc/ui/components/date-field";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { typeStyle } from "@/lib/typography";
import { newPayrollGroup, parsePayrollAnswer, PAYROLL_PERIODS, type PayrollGroup, type PayrollPage } from "@/lib/intake-payroll";
import { IntakeValueInput, IntakeRadioChoices } from "./details-fields";
import { VehicleUnitInput } from "./vehicle-unit-input";
import { INTAKE_UNSURE } from "./unknown-choice";

export function PayrollInput({value, page = {field:"names", groupIndex:0}, onChange}: {value: string; page?: PayrollPage; onChange: (value: string) => void}) {
  const parsed = parsePayrollAnswer(value);
  const groups = parsed?.groups.length ? parsed.groups : [newPayrollGroup()];
  const legacy = parsed?.legacy ?? (value && value !== INTAKE_UNSURE && !parsed ? value : undefined);
  const save = (next: PayrollGroup[]) => onChange(JSON.stringify({version:"payroll-v1", groups:next, ...(legacy ? {legacy} : {})}));
  const update = (index: number, patch: Partial<PayrollGroup>) => save(groups.map((row,i) => i === index ? {...row,...patch} : row));
  const index = page.groupIndex;
  const row = groups[index] ?? newPayrollGroup();
  return <div className="space-y-6">
    {page.field === "names" ? <>
      <p className={`text-muted-foreground ${typeStyle("body.root")}`}>Group employees who do similar work. We’ll ask about each group’s payroll next.</p>
      {legacy && <p className={typeStyle("body.default")}>Previous answer: {legacy}</p>}
      {groups.map((group,i) => <Field key={i}>
        <FieldLabel className={typeStyle("body.root")} htmlFor={`payroll-employees-${i}`}>Employee group {i+1}</FieldLabel>
        <div className="flex items-center gap-3"><Input id={`payroll-employees-${i}`} className="h-12" placeholder="e.g. Company Drivers or Management Team" value={group.employees} maxLength={120} onChange={event=>update(i,{employees:event.target.value})}/>
        {groups.length>1 && <RemoveButton label={`Remove employee group ${i+1}`} onClick={()=>save(groups.filter((_,j)=>j!==i))}/>}</div>
      </Field>)}
      {groups.length<6 && <PillButton size="large" variant="secondary" onClick={()=>save([...groups,newPayrollGroup()])}>Add employee group</PillButton>}
    </> : page.field === "headcount" ? <VehicleUnitInput id={`payroll-count-${index}`} label={`${row.employees} employee count`} field="count" allowUnknown={false} value={row.headcount===INTAKE_UNSURE ? "" : row.headcount} onChange={headcount=>update(index,{headcount})}/>
    : page.field === "period" ? <IntakeRadioChoices label={`${row.employees} payroll period`} choices={[...new Set([...PAYROLL_PERIODS, ...(row.period ? [row.period] : [])])].filter(period=>period!==INTAKE_UNSURE)} value={row.period} onChange={period=>update(index,{period,...(period!==row.period?{start:"",end:""}:{})})}/>
    : page.field === "dates" ? <div className="grid gap-4 sm:grid-cols-2"><DateField id={`payroll-start-${index}`} label="Period start" value={row.start} onChange={start=>update(index,{start})}/><DateField id={`payroll-end-${index}`} label="Period end" value={row.end} onChange={end=>update(index,{end})}/></div>
    : <>
      <Field><FieldLabel className={typeStyle("body.root")}>Currency</FieldLabel><CurrencySelect value={row.currency} onChange={currency=>update(index,{currency})} ariaLabel={`${row.employees} payroll currency`}/></Field>
      <Field><FieldLabel className={typeStyle("body.root")} htmlFor={`payroll-amount-${index}`}>Total pay for all employees in this group</FieldLabel><InputGroup className="h-12"><InputGroupAddon><InputGroupText className={typeStyle("control.input")}>{row.currency}</InputGroupText></InputGroupAddon><IntakeValueInput id={`payroll-amount-${index}`} label={`${row.employees} total payroll`} value={row.amount===INTAKE_UNSURE?"":row.amount} placeholder="Enter total payroll" onValueChange={amount=>update(index,{amount:amount.replaceAll(",", "").slice(0,24)})}/></InputGroup></Field>
    </>}
  </div>;
}
