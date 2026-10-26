"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import {
  FilterBar,
  type FilterDefinition,
} from "@claritylabs-inc/ui/components/filter-bar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@claritylabs-inc/ui/components/input-group";
import { useFollowedState } from "@/hooks/use-followed-state";
import { cn } from "@/lib/utils";

export type { FilterDefinition };

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

/**
 * A list's toolbar: view tabs, inline filter chips and the Filters menu on the
 * left; search and trailing controls right-aligned. Filter definitions own
 * their values; `followKey` keeps open filter popovers followed.
 */
export function ListToolbar({
  tabs,
  filters = [],
  followKey,
  onClearFilters,
  search,
  actions,
  tabsPlacement = "inline",
}: {
  tabs?: ReactNode;
  /**
   * `inline` keeps view tabs as the first chip in the filter row. `above`
   * renders them as a page-level folder rail (`PageTabs`) before the row.
   */
  tabsPlacement?: "inline" | "above";
  filters?: FilterDefinition[];
  followKey: string;
  /** One batched clear, for filters stored together (e.g. in the URL). */
  onClearFilters?: () => void;
  search?: SearchFieldProps;
  actions?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useFollowedState(
    `${followKey}:filters-open`,
    false,
  );
  const [pane, setPane] = useFollowedState<string | null>(
    `${followKey}:filters-pane`,
    null,
  );
  const [openChip, setOpenChip] = useFollowedState<string | null>(
    `${followKey}:filter-chip`,
    null,
  );
  const filterBar = (
    <FilterBar
      leading={tabsPlacement === "inline" ? tabs : undefined}
      filters={filters}
      onClearAll={onClearFilters}
      menu={{
        open: menuOpen,
        onOpenChange: setMenuOpen,
        pane,
        onPaneChange: setPane,
      }}
      chip={(id) => ({
        open: openChip === id,
        onOpenChange: (open) => setOpenChip(open ? id : null),
      })}
      trailing={
        search || actions ? (
          <>
            {search ? (
              <div className="w-56">
                <SearchField {...search} />
              </div>
            ) : null}
            {actions}
          </>
        ) : null
      }
    />
  );
  return tabsPlacement === "above" ? (
    <>
      {tabs}
      {filterBar}
    </>
  ) : (
    filterBar
  );
}
