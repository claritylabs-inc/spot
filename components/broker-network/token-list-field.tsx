"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";

export function TokenListField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const additions = raw
      .trim()
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(Boolean)
      .filter((item) => !value.includes(item));
    if (additions.length) onChange([...value, ...additions]);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={`flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-popover p-1.5 focus-within:border-border-focus focus-within:ring-1 focus-within:ring-input ${disabled ? "opacity-50" : ""}`}
    >
      {value.map((item) => (
        <span
          key={item}
          className={`inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-foreground ${typeStyle("caption.default")}`}
        >
          {item}
          <PillButton
            type="button"
            variant="destructive"
            iconOnly
            label={`Remove ${item}`}
            className="-mr-1"
            disabled={disabled}
            onClick={() => onChange(value.filter((entry) => entry !== item))}
            size="compact"
          >
            <X className="size-3" />
          </PillButton>
        </span>
      ))}
      <Input
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => add(draft)}
        placeholder={value.length ? "Add another" : placeholder}
        aria-label={ariaLabel}
        className="h-7 min-w-24 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
