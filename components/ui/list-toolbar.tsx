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
 * A list's toolbar: search first, then the inline filter chips and Filters
 * menu on the left; the selected view's action buttons right-aligned. View
 * tabs are navigation, not a filter: page tabs render in the shell top bar and
 * inline tabs get their own row above the toolbar, never between search and
 * filters. Filter definitions own their values; `followKey` keeps open filter
 * popovers followed.
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
   * `inline` renders view tabs in a row above the toolbar. `navbar` is for
   * page-level tabs (`PageTabsRail`) that render in the shell top bar.
   */
  tabsPlacement?: "inline" | "navbar";
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
      leading={
        search ? (
          <div className="w-full sm:w-56">
            <SearchField {...search} />
          </div>
        ) : undefined
      }
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
      trailing={actions ? (
        <div data-slot="list-toolbar-actions" className="contents">
          {actions}
        </div>
      ) : undefined}
    />
  );
  if (!tabs) return filterBar;
  return tabsPlacement === "navbar" ? (
    <>
      {tabs}
      {filterBar}
    </>
  ) : (
    <div className="flex flex-col gap-3">
      {tabs}
      {filterBar}
    </div>
  );
}
