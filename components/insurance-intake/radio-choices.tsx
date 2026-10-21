"use client";
import { useContext } from "react";
import { InlineFieldsContext } from "@/components/ui/inline-fields";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import { Button } from "@claritylabs-inc/ui/components/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@claritylabs-inc/ui/components/select";
import { typeStyle } from "@/lib/typography";

export function IntakeRadioChoices({
  label,
  choices,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  choices: readonly string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const inlineFields = useContext(InlineFieldsContext);
  if (inlineFields)
    return (
      <Select
        value={value || null}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(String(next));
        }}
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue placeholder="Not provided">
            {value || undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice} value={choice}>
              {choice}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  return (
    <RadioGroup
      aria-label={label}
      value={value || null}
      onValueChange={(next) => onChange(next ?? "")}
      disabled={disabled}
      className="grid gap-3"
    >
      {choices.map((choice) => (
        <Radio.Root
          key={choice}
          value={choice}
          nativeButton
          render={<Button variant={value === choice ? "default" : "outline"} />}
          className={`min-h-16 w-full justify-center px-5 py-4 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground ${typeStyle("body.root")}`}
        >
          {choice}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
