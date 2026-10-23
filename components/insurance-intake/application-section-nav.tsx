"use client";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import {
  ArrowLeft,
  Briefcase,
  ChevronDown,
  Building2,
  CircleHelp,
  FileText,
  HardHat,
  History,
  ListPlus,
  Lock,
  Mail,
  MessageSquareMore,
  NotebookText,
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
  MENU_ITEM_INACTIVE_SUBTLE,
  SidebarNavItem,
  SidebarTooltipProvider,
} from "@claritylabs-inc/ui/components/app-shell/app-sidebar/nav-item";
import { ScrollArea } from "@claritylabs-inc/ui/components/scroll-area";
import { AppShell } from "@/components/app-shell";
import { SidebarHeader } from "@/components/app-sidebar/sidebar-header";
import { useFollowedState } from "@/hooks/use-followed-state";
import { typeStyle } from "@/lib/typography";
import type { IntakeAnswers } from "@/lib/insurance-intake";
import {
  coverageRequestLabel,
  type CoverageId,
  type IntakeDetails,
} from "@/lib/insurance-intake-details";
import { intakeFollowupAnswerRows } from "@/lib/intake-application";
import { cn } from "@/lib/utils";

export type SectionMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  count?: number;
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
  const followups = intakeFollowupAnswerRows(answers, details);
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
        })),
        ...((["limitsNote", "scopeNote", "additionalNote"] as const).some(
          (key) => details[key]?.trim(),
        )
          ? [
              {
                key: OTHER_COVERAGE_SECTION,
                label: "Coverage notes",
                icon: ListPlus,
              },
            ]
          : []),
        ...(editable &&
        details.coverages.length < Object.keys(COVERAGE_ICONS).length
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

export const PROVIDER_ICONS = {
  notes: NotebookText,
  providers: Users,
  email: Mail,
} as const;

/**
 * Page-level menu that replaces the shell's sidebar while mounted, built from
 * the app sidebar primitives so header, back link, items and footer match the
 * menu it replaces; narrow screens get a grouped select above the content.
 */
export function SectionMenu({
  label,
  brand,
  back,
  groups,
  active,
  onChange,
  onRemove,
  footer,
}: {
  label: string;
  brand: { name: string; icon: ReactNode };
  /** Leading back entry, like the primary menu's "Clients" link. */
  back: { label: string; href: string };
  groups: SectionMenuGroup[];
  active: string;
  onChange: (key: string) => void;
  onRemove?: (key: string) => void;
  footer?: (collapsed: boolean) => ReactNode;
}) {
  const remove = (key: string) => (event: MouseEvent | KeyboardEvent) => {
    if ("key" in event && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onRemove?.(key);
  };
  // Groups start expanded; the group holding the active section always shows.
  const [collapsedGroups, setCollapsedGroups] = useFollowedState<string[]>(
    `section-menu:${label}:collapsed`,
    [],
  );
  const toggleGroup = (groupLabel: string) =>
    setCollapsedGroups((current) =>
      current.includes(groupLabel)
        ? current.filter((entry) => entry !== groupLabel)
        : [...current, groupLabel],
    );
  const groupId = (groupLabel: string) =>
    `section-menu-${label}-${groupLabel}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const renderNav = (collapsed: boolean) => (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      <SidebarNavItem
        label={back.label}
        icon={ArrowLeft}
        href={back.href}
        collapsed={collapsed}
      />
      {groups.map((group) => {
        const holdsActive = group.items.some((entry) => entry.key === active);
        const expanded =
          collapsed || holdsActive || !collapsedGroups.includes(group.label);
        return (
          <div key={group.label}>
            {collapsed ? (
              <div className="pt-4 pb-1" />
            ) : (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={groupId(group.label)}
                disabled={holdsActive}
                onClick={() => toggleGroup(group.label)}
                className={cn(
                  "flex w-full items-center gap-1 px-3 pt-5 pb-1.5 text-left text-muted-foreground/50 transition-colors enabled:hover:text-muted-foreground",
                  typeStyle("caption.medium"),
                )}
              >
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-3 shrink-0 transition-transform duration-150",
                    !expanded && "-rotate-90",
                  )}
                />
              </button>
            )}
            {expanded ? (
              <div id={groupId(group.label)} className="flex flex-col gap-0.5">
                {group.items.map((entry) => (
                  <SidebarNavItem
                    key={entry.key}
                    label={entry.label}
                    icon={entry.icon}
                    active={entry.key === active}
                    collapsed={collapsed}
                    onClick={() => onChange(entry.key)}
                    className={cn(
                      "group",
                      entry.subtle && MENU_ITEM_INACTIVE_SUBTLE,
                    )}
                    trailing={
                      collapsed ? undefined : (
                        <>
                          {entry.count !== undefined && (
                            <span className="text-muted-foreground/60">
                              {entry.count}
                            </span>
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
                      )
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
  const current = groups
    .flatMap((group) => group.items)
    .find((entry) => entry.key === active);
  return (
    <AppShell
      sidebar={({ collapsed, onToggleCollapse }) => {
        const footerNode = footer?.(collapsed);
        return (
          <SidebarTooltipProvider>
            <div aria-label={label} className="flex h-full min-h-0 flex-col">
              <SidebarHeader
                collapsed={collapsed}
                initials=""
                headerOrgName={brand.name}
                icon={brand.icon}
                onToggleCollapse={onToggleCollapse}
              />
              {/* Mirrors AppSidebarContent, with collapsible group headers. */}
              <div className="flex min-h-0 w-full flex-1 flex-col">
                <ScrollArea className="min-h-0 flex-1">
                  {renderNav(collapsed)}
                </ScrollArea>
                {footerNode ? (
                  <div className="shrink-0 border-t border-border p-2">
                    {footerNode}
                  </div>
                ) : null}
              </div>
            </div>
          </SidebarTooltipProvider>
        );
      }}
    >
      <div className="mb-5 lg:hidden">
        <Select
          value={active}
          onValueChange={(value) => value && onChange(String(value))}
        >
          <SelectTrigger
            aria-label={label}
            className="w-full border border-input"
          >
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
    </AppShell>
  );
}
