"use client";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Label } from "@claritylabs-inc/ui/components/label";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  SidebarMenuItem,
  SidebarTooltipProvider,
} from "@/components/app-sidebar/nav-item";
import { typeStyle } from "@/lib/typography";
import { OperatorSidebar } from "../operator-sidebar";
export type LogFilters = {
  orgId: string;
  status: string;
  task: string;
  model: string;
  channel: string;
  routeSource: string;
  search: string;
  hours: string;
};
export const LOG_STATUS_OPTIONS = [
  { value: "error", label: "Error" },
  { value: "incomplete", label: "Incomplete" },
  { value: "running", label: "Running" },
  { value: "complete", label: "Complete" },
  { value: "cancelled", label: "Cancelled" },
  { value: "unknown", label: "Unknown outcome" },
];
export const LOG_ROUTE_SOURCE_OPTIONS = [
  { value: "routed", label: "Routed" },
  { value: "manual", label: "Manual" },
  { value: "jev", label: "Jev" },
  { value: "fallback", label: "Fallback" },
  { value: "automatic", label: "Automatic" },
];
export const defaultFilters: LogFilters = {
  orgId: "",
  status: "",
  task: "",
  model: "",
  channel: "",
  routeSource: "",
  search: "",
  hours: "24",
};
export function LogSidebar({
  collapsed,
  onToggleCollapse,
  open,
  onOpenChange,
  filters,
  onChange,
  customRange,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: LogFilters;
  onChange: (filters: LogFilters, resetRange?: boolean) => void;
  customRange?: boolean;
}) {
  if (!open)
    return (
      <OperatorSidebar
        active="logs"
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        onOpenLogFilters={() => {
          onOpenChange(true);
          if (collapsed) onToggleCollapse();
        }}
      />
    );
  if (collapsed)
    return (
      <SidebarTooltipProvider>
        <SidebarMenuItem
          icon={SlidersHorizontal}
          label="Log filters"
          active
          collapsed
          onClick={onToggleCollapse}
        />
      </SidebarTooltipProvider>
    );
  const select = (
    key: "hours",
    label: string,
    options: [string, string][],
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={
          key === "hours" && customRange ? "custom" : filters[key] || "all"
        }
        onValueChange={(value) =>
          onChange(
            { ...filters, [key]: value === "all" ? "" : (value ?? "") },
            key === "hours",
          )
        }
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue>
            {key === "hours" && customRange
              ? "Selected interval"
              : options.find(
                  ([value]) => value === (filters[key] || "all"),
                )?.[1]}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {key === "hours" && customRange ? (
            <SelectItem value="custom" disabled>
              Selected interval
            </SelectItem>
          ) : null}
          {options.map(([value, title]) => (
            <SelectItem key={value} value={value}>
              {title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className={`flex items-center gap-2 text-muted-foreground hover:text-foreground ${typeStyle("control.button")}`}
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-auto p-4">
        {select("hours", "Time range", [
          ["0.5", "Last 30 minutes"],
          ["24", "Last 24 hours"],
          ["168", "Last 7 days"],
          ["720", "Last 30 days"],
        ])}
        {(["task", "model", "channel"] as const).map((key) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={`log-${key}`}>
              {key[0].toUpperCase() + key.slice(1)}
            </Label>
            <Input
              id={`log-${key}`}
              value={filters[key]}
              placeholder={`All ${key}s`}
              onChange={(event) =>
                onChange({ ...filters, [key]: event.target.value })
              }
            />
          </div>
        ))}
      </div>
      <div className="border-t border-border p-4">
        <PillButton
          variant="secondary"
          onClick={() => onChange(defaultFilters, true)}
        >
          Reset filters
        </PillButton>
      </div>
    </div>
  );
}
