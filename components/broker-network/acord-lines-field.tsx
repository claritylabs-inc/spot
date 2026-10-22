"use client";

import { Badge } from "@claritylabs-inc/ui/components/badge";
import { SearchableMultiSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { RemoveButton } from "@/components/ui/remove-button";
import {
  ACORD_LOB_LABELS,
  PROVIDER_ACORD_LOB_CODES,
} from "@/convex/lib/linesOfBusiness";
import { typeStyle } from "@/lib/typography";

const options = PROVIDER_ACORD_LOB_CODES.map((value) => ({
  value,
  label: `${ACORD_LOB_LABELS[value]} (${value})`,
})).sort((a, b) => a.label.localeCompare(b.label));

export function AcordLinesField({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const selected = options.filter((option) => value.includes(option.value));
  return (
    <div data-inline-multiline className="space-y-2 py-1">
      <SearchableMultiSelect
        typographyRole="control.menu"
        options={options}
        value={value}
        onChange={(next) => onChange([...next].sort())}
        ariaLabel="ACORD lines"
        placeholder="Select coverage lines"
        selectionDisplay="count"
        disabled={disabled}
      />
      {selected.length ? (
        <ul
          aria-label="Selected coverage lines"
          className="flex flex-wrap gap-2 px-3 pb-1"
        >
          {selected.map((option) => (
            <li key={option.value} className="min-w-0 max-w-full">
              <Badge
                variant="outline"
                className={`h-auto max-w-full gap-1 whitespace-normal py-1 pr-1 ${typeStyle("caption.default")}`}
              >
                <span>{option.label}</span>
                <RemoveButton
                  label={`Remove ${option.label}`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(value.filter((code) => code !== option.value))
                  }
                />
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p
          className={`px-3 pb-1 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          Coverage lines not yet recorded.
        </p>
      )}
    </div>
  );
}
