"use client";
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  Briefcase,
  Building2,
  CircleHelp,
  FileText,
  HardHat,
  History,
  ListPlus,
  Lock,
  Mail,
  MessageSquareMore,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Shield,
  Truck,
  Umbrella,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  AppSidebarContent,
  type AppSidebarSection,
} from "@claritylabs-inc/ui/components/app-shell/app-sidebar";
import {
  MENU_ITEM_INACTIVE_SUBTLE,
  SidebarNavItem,
  SidebarTooltipProvider,
} from "@claritylabs-inc/ui/components/app-shell/app-sidebar/nav-item";
import {
  AppShellPortal,
  useOptionalAppShellSlots,
} from "@/components/app-shell-slots";
import type { IntakeAnswers } from "@/lib/insurance-intake";
import {
  coverageRequestLabel,
  type CoverageId,
  type IntakeDetails,
} from "@/lib/insurance-intake-details";
import {
  intakeCoverageAnswerRows,
  visibleIntakeFollowups,
} from "@/lib/intake-application";
import { intakeCatalogCoverage } from "@/lib/intake-acord-questions";
import { cn } from "@/lib/utils";

export type SectionMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  attention?: boolean;
  removable?: boolean;
  subtle?: boolean;
};
export type SectionMenuGroup = { label: string; items: SectionMenuItem[] };

export const coverageSectionKey = (coverage: CoverageId) =>
  `coverage:${coverage}`;
export const OTHER_COVERAGE_SECTION = "coverage:other-details";
export const ADD_COVERAGE_SECTION = "coverage:add";

export const COVERAGE_ICONS: Record<CoverageId, LucideIcon> = {
  general_liability: Shield,
  property: Building2,
  workers_compensation: HardHat,
  commercial_auto: Truck,
  professional_liability: Briefcase,
  cyber: Lock,
  umbrella: Umbrella,
  other: FileText,
  unknown: CircleHelp,
};

/** Application facts, then requested coverages with an add entry. */
export function applicationSectionGroups(
  answers: IntakeAnswers,
  details: IntakeDetails,
  { editable }: { editable: boolean },
): SectionMenuGroup[] {
  const coverageIds = details.coverages.map((line) => line.coverage);
  const coverageAnswers = intakeCoverageAnswerRows(answers, details);
  const unanswered = (row: (typeof coverageAnswers)[number]) =>
    !row.answer.trim() && !row.skipped;
  const unowned = coverageAnswers.some(
    (row) => !intakeCatalogCoverage(row, coverageIds),
  );
  const followups = visibleIntakeFollowups(details, "additional");
  return [
    {
      label: "Application",
      items: [
        { key: "Contact details", label: "Contact details", icon: UserRound },
        { key: "Request details", label: "Request details", icon: FileText },
        { key: "Insurance history", label: "Insurance history", icon: History },
        ...(followups.length
          ? [
              {
                key: "Follow-up answers",
                label: "Follow-up answers",
                icon: MessageSquareMore,
                count: followups.length,
                attention: followups.some(unanswered),
              },
            ]
          : []),
      ],
    },
    {
      label: "Coverage requested",
      items: [
        ...details.coverages.map((line) => ({
          key: coverageSectionKey(line.coverage),
          label: coverageRequestLabel(line),
          icon: COVERAGE_ICONS[line.coverage],
          removable: editable,
          attention: coverageAnswers.some(
            (row) =>
              intakeCatalogCoverage(row, coverageIds) === line.coverage &&
              unanswered(row),
          ),
        })),
        ...(unowned ||
        (["limitsNote", "scopeNote", "additionalNote"] as const).some((key) =>
          details[key]?.trim(),
        )
          ? [
              {
                key: OTHER_COVERAGE_SECTION,
                label: "Other coverage details",
                icon: ListPlus,
              },
            ]
          : []),
        ...(editable && details.coverages.length < Object.keys(COVERAGE_ICONS).length
          ? [
              {
                key: ADD_COVERAGE_SECTION,
                label: "Add coverage",
                icon: Plus,
                subtle: true,
              },
            ]
          : []),
      ],
    },
  ];
}

export const PROVIDER_ICONS = { providers: Users, email: Mail } as const;

const COLLAPSED_KEY = "spot:section-menu-collapsed";

/**
 * Page-level menu in the shell's secondary column, built from the app sidebar
 * primitives so icons, spacing and collapse match; narrow screens get a
 * grouped select above the content.
 */
export function SectionMenu({
  label,
  groups,
  active,
  onChange,
  onRemove,
}: {
  label: string;
  groups: SectionMenuGroup[];
  active: string;
  onChange: (key: string) => void;
  onRemove?: (key: string) => void;
}) {
  const inShell = useOptionalAppShellSlots();
  // The menu only renders client-side through the shell portal.
  const [collapsed, setCollapsed] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const toggle = () =>
    setCollapsed((value) => {
      localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
      return !value;
    });
  const remove =
    (key: string) => (event: MouseEvent | KeyboardEvent) => {
      if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      onRemove?.(key);
    };
  const sections: AppSidebarSection[] = groups.map((group) => ({
    key: group.label,
    label: group.label,
    // AppSidebarNav keys items by label; labels are unique within the menu.
    items: group.items.map((entry) => ({
      label: entry.label,
      icon: entry.icon,
      active: entry.key === active,
      onClick: () => onChange(entry.key),
      className: cn("group", entry.subtle && MENU_ITEM_INACTIVE_SUBTLE),
      trailing: collapsed ? undefined : (
        <>
          {entry.count !== undefined && (
            <span className="text-muted-foreground/60">{entry.count}</span>
          )}
          {entry.attention && (
            <span
              aria-label="Has unanswered questions"
              className="size-1.5 shrink-0 rounded-full bg-amber-500"
            />
          )}
          {entry.removable && onRemove && (
            // Same affordance as the former thread archive action.
            <span
              role="button"
              tabIndex={0}
              aria-label={`Remove ${entry.label}`}
              onClick={remove(entry.key)}
              onKeyDown={remove(entry.key)}
              className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/30 opacity-0 transition-[background-color,color,opacity] duration-100 group-hover:opacity-100 hover:bg-foreground/6 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <X className="size-3" />
            </span>
          )}
        </>
      ),
    })),
  }));
  const current = groups
    .flatMap((group) => group.items)
    .find((entry) => entry.key === active);
  const menu = (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col transition-[width] duration-150 ease-out",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <SidebarTooltipProvider>
        <div aria-label={label} className="flex min-h-0 flex-1 flex-col">
          <AppSidebarContent
            collapsed={collapsed}
            sections={sections}
            footer={
              <SidebarNavItem
                label={collapsed ? "Expand menu" : "Collapse menu"}
                icon={collapsed ? PanelLeftOpen : PanelLeftClose}
                collapsed={collapsed}
                className={MENU_ITEM_INACTIVE_SUBTLE}
                onClick={toggle}
              />
            }
          />
        </div>
      </SidebarTooltipProvider>
    </div>
  );
  return (
    <>
      {inShell ? (
        <AppShellPortal slot="secondaryNav">{menu}</AppShellPortal>
      ) : null}
      <div className="mb-5 lg:hidden">
        <Select
          value={active}
          onValueChange={(value) => value && onChange(String(value))}
        >
          <SelectTrigger aria-label={label} className="w-full border border-input">
            <SelectValue>{current?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
