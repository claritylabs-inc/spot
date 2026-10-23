"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@claritylabs-inc/ui/components/input-group";
import { cn } from "@/lib/utils";

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  className?: string;
};

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: SearchFieldProps) {
  return (
    <InputGroup className={cn("w-full", className)}>
      <InputGroupAddon>
        <Search className="size-3.5" />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </InputGroup>
  );
}

/** Tabs on the left; search and trailing controls right-aligned opposite them. */
export function ListToolbar({
  tabs,
  search,
  actions,
}: {
  tabs: ReactNode;
  search: SearchFieldProps;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        <div className="w-56">
          <SearchField {...search} />
        </div>
        {actions}
      </div>
    </div>
  );
}
