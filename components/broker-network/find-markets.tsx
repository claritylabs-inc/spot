"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useAction, useMutation, useQuery } from "convex/react";
import dayjs from "dayjs";
import { Loader2, Search } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  USPS_STATE_CODES,
  USPS_STATE_NAMES,
} from "@/convex/lib/brokerProfileValidation";
import { COVERAGE_OPTIONS } from "@/lib/insurance-intake-details";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { SuggestionSources } from "@/components/procurement/information/suggestion";
import { useFollowedState } from "@/hooks/use-followed-state";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import { Input } from "@claritylabs-inc/ui/components/input";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { SearchableMultiSelect } from "@claritylabs-inc/ui/components/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";

type Discovery = FunctionReturnType<typeof api.providerDiscovery.list>[number];
type Candidate = FunctionReturnType<
  typeof api.providerDiscovery.candidates
>["candidates"][number];

/** Review actions are atomic and capped at 50 candidates. */
const MAX_REVIEW = 50;
// Mirrors the backend's limits in convex/lib/providerDiscovery.ts.
const MAX_LINES = 10;
const MAX_STATES = 20;
const MAX_INDUSTRY = 80;
const MATCH_LIMITS = ["10", "25", "50"];
const DEFAULT_MATCH_LIMIT = "25";

const lineOptions = COVERAGE_OPTIONS.filter(
  (option) => option.id !== "unknown" && option.id !== "other",
).map((option) => ({ value: option.label, label: option.label }));
const stateOptions = USPS_STATE_CODES.map((code) => ({
  value: code,
  label: `${USPS_STATE_NAMES[code]} (${code})`,
})).sort((a, b) => a.label.localeCompare(b.label));
const MAX_CONDITION_SOURCES = 2;

const humanize = (code: string) => code.replaceAll("_", " ");
const sentence = (code: string) =>
  humanize(code).replace(/^./, (first) => first.toUpperCase());
const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Candidate URLs are public web content: link only http(s). */
function webUrl(value: string | undefined) {
  try {
    const url = value ? new URL(value) : null;
    return url && (url.protocol === "https:" || url.protocol === "http:")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4 hover:text-foreground"
    >
      {children}
    </a>
  );
}

const isActive = (discovery: Discovery) =>
  discovery.status === "pending" || discovery.status === "running";

function criteriaText(criteria: Discovery["criteria"]) {
  return [
    criteria.lines.join(", "),
    criteria.states.join(", "),
    ...(criteria.industry ? [criteria.industry] : []),
  ].join(" · ");
}

function DiscoveryStatus({ discovery }: { discovery: Discovery }) {
  return isActive(discovery) ? (
    <StatusTag indicator="progress" tone="info">
      {discovery.status === "pending" ? "Queued" : "Searching"}
    </StatusTag>
  ) : discovery.status === "completed" ? (
    <StatusTag indicator="complete" tone="success">
      {plural(discovery.candidateCount ?? 0, "candidate")}
    </StatusTag>
  ) : (
    <StatusTag indicator="error" tone="danger">
      {discovery.status === "cancelled"
        ? "Cancelled"
        : `Failed${discovery.error ? `: ${discovery.error}` : ""}`}
    </StatusTag>
  );
}

function CandidateRow({
  candidate,
  selected,
  busy,
  onSelect,
  onReview,
}: {
  candidate: Candidate;
  selected: boolean;
  busy: boolean;
  onSelect: (checked: boolean) => void;
  onReview: (action: "add" | "dismiss") => void;
}) {
  const site = webUrl(candidate.url);
  const appointment = webUrl(candidate.appointmentUrl);
  const matched = candidate.conditions.filter((condition) => condition.matched);
  const pending = candidate.status === "pending";
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Checkbox
          className="mt-1"
          aria-label={`Select ${candidate.name}`}
          checked={selected}
          disabled={!pending || busy}
          onCheckedChange={(value) => onSelect(value === true)}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`break-words ${typeStyle("body.medium")}`}>
              {candidate.name}
            </span>
            {candidate.providerType ? (
              <Badge variant="outline">
                {humanize(candidate.providerType)}
              </Badge>
            ) : null}
            <span
              className={`min-w-0 break-all text-muted-foreground ${typeStyle("caption.default")}`}
            >
              {site ? (
                <ExternalLink href={site}>{candidate.domain}</ExternalLink>
              ) : (
                candidate.domain
              )}
            </span>
          </div>
          {candidate.description ? (
            <p
              className={`line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground ${typeStyle("body.default")}`}
            >
              {candidate.description}
            </p>
          ) : null}
          {candidate.linesOffered || candidate.statesServed ? (
            <dl
              className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 ${typeStyle("caption.default")}`}
            >
              {candidate.linesOffered ? (
                <>
                  <dt className="text-muted-foreground">Lines</dt>
                  <dd className="min-w-0 break-words">
                    {candidate.linesOffered}
                  </dd>
                </>
              ) : null}
              {candidate.statesServed ? (
                <>
                  <dt className="text-muted-foreground">States</dt>
                  <dd className="min-w-0 break-words">
                    {candidate.statesServed}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {matched.length ? (
            <ul className="space-y-1.5">
              {matched.map((condition) => (
                <li
                  key={condition.name}
                  className={`min-w-0 ${typeStyle("caption.default")}`}
                >
                  <span>{sentence(condition.name)}</span>
                  {condition.value ? (
                    <span className="break-words text-muted-foreground">
                      {` · ${condition.value}`}
                    </span>
                  ) : null}
                  <SuggestionSources
                    citations={condition.citations}
                    limit={MAX_CONDITION_SOURCES}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {appointment ? (
            <p
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              <ExternalLink href={appointment}>Appointment page</ExternalLink>
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0">
        {pending ? (
          <>
            <PillButton
              type="button"
              size="compact"
              disabled={busy}
              onClick={() => onReview("add")}
            >
              Add to network
            </PillButton>
            <PillButton
              type="button"
              variant="ghost"
              size="compact"
              disabled={busy}
              onClick={() => onReview("dismiss")}
            >
              Dismiss
            </PillButton>
          </>
        ) : candidate.brokerOrgId ? (
          <Link
            href={`/operator/brokers/${candidate.brokerOrgId}`}
            className={`text-muted-foreground underline underline-offset-4 hover:text-foreground ${typeStyle("body.default")}`}
          >
            In network
          </Link>
        ) : (
          <span
            className={`text-muted-foreground ${typeStyle("body.default")}`}
          >
            In network
          </span>
        )}
      </div>
    </li>
  );
}

function SearchForm({
  active,
  loading,
}: {
  /** A discovery is pending or running; only one runs at a time. */
  active: boolean;
  loading: boolean;
}) {
  const start = useAction(api.actions.providerDiscovery.start);
  const [lines, setLines] = useFollowedState<string[]>(
    "brokers:markets:lines",
    [],
  );
  const [states, setStates] = useFollowedState<string[]>(
    "brokers:markets:states",
    [],
  );
  const [industry, setIndustry] = useFollowedState(
    "brokers:markets:industry",
    "",
  );
  const [matchLimit, setMatchLimit] = useFollowedState(
    "brokers:markets:match-limit",
    DEFAULT_MATCH_LIMIT,
  );
  const [confirming, setConfirming] = useFollowedState(
    "brokers:markets:confirming",
    false,
  );
  const [starting, setStarting] = useState(false);
  const trimmedIndustry = industry.trim();
  const tooMany =
    lines.length > MAX_LINES
      ? `Choose up to ${MAX_LINES} coverage lines`
      : states.length > MAX_STATES
        ? `Choose up to ${MAX_STATES} states`
        : null;
  const blocked = active
    ? "A search is already running"
    : !lines.length || !states.length
      ? "Choose coverage lines and states"
      : tooMany;

  async function confirmStart() {
    setStarting(true);
    try {
      await start({
        lines,
        states,
        ...(trimmedIndustry ? { industry: trimmedIndustry } : {}),
        matchLimit: Number(matchLimit),
      });
      setConfirming(false);
      toast.success("Search started");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not start the search"),
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <section aria-label="New search" className="space-y-3">
      <InlineFieldCard
        title="Search public sources"
        actions={
          <PillButton
            type="button"
            size="compact"
            disabled={loading || !!blocked}
            title={blocked ?? undefined}
            onClick={() => setConfirming(true)}
          >
            {active ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Find markets
          </PillButton>
        }
      >
        <InlineFieldRow label="Coverage lines">
          <SearchableMultiSelect
            typographyRole="control.menu"
            ariaLabel="Coverage lines"
            placeholder="Select coverage lines"
            options={lineOptions}
            value={lines}
            onChange={setLines}
          />
        </InlineFieldRow>
        <InlineFieldRow label="States">
          <SearchableMultiSelect
            typographyRole="control.menu"
            ariaLabel="States"
            placeholder="Select states"
            options={stateOptions}
            value={states}
            onChange={(next) => setStates([...next].sort())}
          />
        </InlineFieldRow>
        <InlineFieldRow label="Industry (optional)">
          <Input
            aria-label="Industry"
            placeholder="e.g. restaurants, general contractors"
            maxLength={MAX_INDUSTRY}
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
          />
        </InlineFieldRow>
        <InlineFieldRow label="Markets to find">
          <Select
            value={matchLimit}
            onValueChange={(next) => next && setMatchLimit(String(next))}
          >
            <SelectTrigger className="w-full pl-3" aria-label="Markets to find">
              <SelectValue>{`Up to ${matchLimit}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MATCH_LIMITS.map((limit) => (
                <SelectItem key={limit} value={limit}>
                  {`Up to ${limit}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InlineFieldRow>
      </InlineFieldCard>
      {tooMany ? (
        <p className={`text-destructive ${typeStyle("caption.default")}`}>
          {tooMany}.
        </p>
      ) : null}

      <Dialog
        open={confirming}
        onOpenChange={(next) => !starting && setConfirming(next)}
      >
        <DialogContent showCloseButton={!starting}>
          <DialogHeader>
            <DialogTitle>Find new markets</DialogTitle>
            <DialogDescription>
              This is a paid search of public sources. Only the criteria below
              are sent, never client or request details. Existing network
              providers are excluded, and nothing is added to your network until
              you review it.
            </DialogDescription>
          </DialogHeader>
          <dl className={`space-y-2 ${typeStyle("body.default")}`}>
            <div>
              <dt className="text-muted-foreground">Coverage lines</dt>
              <dd>{lines.join(", ")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">States</dt>
              <dd>{states.join(", ")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Industry</dt>
              <dd>{trimmedIndustry || "Not specified"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Markets to find</dt>
              <dd>{`Up to ${matchLimit}`}</dd>
            </div>
          </dl>
          <DialogFooter>
            <PillButton
              type="button"
              variant="secondary"
              disabled={starting}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              type="button"
              disabled={starting || !!blocked}
              onClick={() => void confirmStart()}
            >
              {starting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {starting ? "Starting…" : "Start search"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SearchHistory({
  discoveries,
  selectedId,
  onSelect,
}: {
  discoveries: Discovery[];
  selectedId: Id<"providerDiscoveries"> | null;
  onSelect: (id: Id<"providerDiscoveries">) => void;
}) {
  return (
    <section aria-label="Recent searches" className="min-w-0 space-y-2">
      <h2 className={typeStyle("heading.item")}>Recent searches</h2>
      <OperationalPanel as="div" className="p-0">
        <ul className="divide-y">
          {discoveries.map((discovery) => {
            const selected = discovery.discoveryId === selectedId;
            return (
              <li key={discovery.discoveryId}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  className={`flex w-full min-w-0 flex-col gap-1.5 px-4 py-3 text-left hover:bg-muted ${selected ? "bg-muted" : ""}`}
                  onClick={() => onSelect(discovery.discoveryId)}
                >
                  <span
                    className={`line-clamp-2 break-words ${typeStyle("body.medium")}`}
                  >
                    {criteriaText(discovery.criteria)}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <DiscoveryStatus discovery={discovery} />
                    <span
                      className={`text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      {dayjs(discovery.createdAt).format("MMM D, h:mm A")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </OperationalPanel>
    </section>
  );
}

function DiscoveryCandidates({ discovery }: { discovery: Discovery }) {
  const data = useQuery(api.providerDiscovery.candidates, {
    discoveryId: discovery.discoveryId,
  });
  const review = useMutation(api.providerDiscovery.review);
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useFollowedState<
    Id<"providerDiscoveryCandidates">[]
  >(`brokers:markets:${discovery.discoveryId}:selected`, []);

  const candidates = (data?.candidates ?? []).filter(
    (candidate) => candidate.status !== "dismissed",
  );
  const pendingIds = candidates
    .filter((candidate) => candidate.status === "pending")
    .map((candidate) => candidate.candidateId);
  // Rows leave the list once reviewed; only count what is still pending.
  const selectedIds = pendingIds.filter((id) => selected.includes(id));
  const allSelected =
    pendingIds.length > 0 && selectedIds.length === pendingIds.length;
  const dismissed = (data?.candidates.length ?? 0) - candidates.length;

  async function reviewCandidates(
    ids: Id<"providerDiscoveryCandidates">[],
    action: "add" | "dismiss",
  ) {
    setReviewing(true);
    try {
      await review({
        items: ids.map((candidateId) => ({ candidateId, action })),
      });
      setSelected((current) => current.filter((id) => !ids.includes(id)));
      toast.success(
        action === "add"
          ? `Added ${plural(ids.length, "provider")} to your network`
          : `Dismissed ${plural(ids.length, "candidate")}`,
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not save your review"),
      );
    } finally {
      setReviewing(false);
    }
  }

  return (
    <section aria-label="Candidates" className="min-w-0 space-y-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={typeStyle("heading.item")}>Candidates</h2>
          <DiscoveryStatus discovery={discovery} />
        </div>
        <p
          className={`break-words text-muted-foreground ${typeStyle("body.default")}`}
        >
          {criteriaText(discovery.criteria)}
          {discovery.status === "failed" && discovery.error
            ? ` · ${discovery.error}`
            : ""}
        </p>
      </div>

      {data === undefined ? (
        <OperationalPanel as="div" className="space-y-3 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-full max-w-md" />
        </OperationalPanel>
      ) : candidates.length ? (
        <>
          <div
            className={`flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2 ${typeStyle("body.default")}`}
          >
            {pendingIds.length ? (
              <label className="flex items-center gap-2">
                <Checkbox
                  aria-label="Select all candidates"
                  checked={allSelected}
                  indeterminate={selectedIds.length > 0 && !allSelected}
                  disabled={reviewing}
                  onCheckedChange={(value) =>
                    setSelected(value === true ? pendingIds : [])
                  }
                />
                <span className="text-muted-foreground">
                  {selectedIds.length
                    ? `${selectedIds.length} selected`
                    : "Select all"}
                </span>
              </label>
            ) : null}
            {selectedIds.length ? (
              <>
                <PillButton
                  type="button"
                  size="compact"
                  disabled={reviewing || selectedIds.length > MAX_REVIEW}
                  title={
                    selectedIds.length > MAX_REVIEW
                      ? `Select up to ${MAX_REVIEW} candidates`
                      : undefined
                  }
                  onClick={() => void reviewCandidates(selectedIds, "add")}
                >
                  Add to network
                </PillButton>
                <PillButton
                  type="button"
                  variant="secondary"
                  size="compact"
                  disabled={reviewing || selectedIds.length > MAX_REVIEW}
                  onClick={() => void reviewCandidates(selectedIds, "dismiss")}
                >
                  Dismiss
                </PillButton>
              </>
            ) : null}
            {dismissed ? (
              <span className="text-muted-foreground">
                {`${dismissed} dismissed`}
              </span>
            ) : null}
          </div>
          <OperationalPanel as="div" className="p-0">
            <ul className="divide-y">
              {candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.candidateId}
                  candidate={candidate}
                  selected={selectedIds.includes(candidate.candidateId)}
                  busy={reviewing}
                  onSelect={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [...current, candidate.candidateId]
                        : current.filter((id) => id !== candidate.candidateId),
                    )
                  }
                  onReview={(action) =>
                    void reviewCandidates([candidate.candidateId], action)
                  }
                />
              ))}
            </ul>
          </OperationalPanel>
        </>
      ) : (
        <OperationalPanel
          as="div"
          className={`p-4 text-center text-muted-foreground ${typeStyle("body.default")}`}
        >
          {isActive(discovery)
            ? "Searching public sources. This can take several minutes; candidates appear here when it finishes."
            : discovery.status === "completed"
              ? dismissed
                ? "Every candidate from this search was dismissed."
                : "This search found no new markets."
              : "This search returned no candidates."}
        </OperationalPanel>
      )}
    </section>
  );
}

/** Network market finding: search public sources for new markets and review what comes back. */
export function FindMarkets({
  initialDiscoveryId,
}: {
  /** From a notification link; otherwise the latest search is shown. */
  initialDiscoveryId?: string | null;
}) {
  const discoveries = useQuery(api.providerDiscovery.list, {});
  const [selectedId, setSelectedId] = useFollowedState<string | null>(
    "brokers:markets:discovery",
    initialDiscoveryId ?? null,
  );
  const selected =
    discoveries?.find((discovery) => discovery.discoveryId === selectedId) ??
    discoveries?.[0] ??
    null;
  const active = discoveries?.some(isActive) ?? false;

  return (
    <div className="@container/markets space-y-6">
      <SearchForm active={active} loading={discoveries === undefined} />
      {discoveries === undefined ? (
        <OperationalPanel as="div" className="space-y-3 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-full max-w-md" />
        </OperationalPanel>
      ) : selected ? (
        <div className="grid gap-6 @4xl/markets:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <SearchHistory
            discoveries={discoveries}
            selectedId={selected.discoveryId}
            onSelect={setSelectedId}
          />
          <DiscoveryCandidates
            key={selected.discoveryId}
            discovery={selected}
          />
        </div>
      ) : (
        <OperationalPanel
          as="div"
          className={`p-6 text-center text-muted-foreground ${typeStyle("body.default")}`}
        >
          No searches yet. Choose coverage lines and states, then find markets
          that write them. Candidates arrive with cited sources for review.
        </OperationalPanel>
      )}
    </div>
  );
}
