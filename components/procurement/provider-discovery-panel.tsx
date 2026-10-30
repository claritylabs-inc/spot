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
import { PillButton } from "@/components/ui/pill-button";
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
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { SuggestionSources } from "./information/suggestion";

type Discovery = NonNullable<
  FunctionReturnType<typeof api.providerDiscovery.listForRequest>
>;
type Candidate = Discovery["candidates"][number];

/** Review actions are atomic and capped at 50 candidates. */
const MAX_REVIEW = 50;
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

function DiscoveryStatus({ discovery }: { discovery: Discovery["discovery"] }) {
  if (!discovery) return null;
  const finished = discovery.completedAt
    ? ` ${dayjs(discovery.completedAt).format("MMM D, h:mm A")}`
    : "";
  return discovery.status === "pending" || discovery.status === "running" ? (
    <StatusTag indicator="progress" tone="info">
      {discovery.status === "pending" ? "Queued" : "Searching"}
    </StatusTag>
  ) : discovery.status === "completed" ? (
    <StatusTag indicator="complete" tone="success">
      {`${plural(discovery.candidateCount ?? 0, "candidate")} found${finished}`}
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
              <Badge variant="outline">{humanize(candidate.providerType)}</Badge>
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
                  <dd className="min-w-0 break-words">{candidate.linesOffered}</dd>
                </>
              ) : null}
              {candidate.statesServed ? (
                <>
                  <dt className="text-muted-foreground">States</dt>
                  <dd className="min-w-0 break-words">{candidate.statesServed}</dd>
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
            <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
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
          <span className={`text-muted-foreground ${typeStyle("body.default")}`}>
            In network
          </span>
        )}
      </div>
    </li>
  );
}

/** Finds new markets from public sources and reviews what comes back. */
export function ProviderDiscoveryPanel({
  requestId,
  lines,
  states,
}: {
  requestId: Id<"procurementRequests">;
  /** What the search will look for, from the request's coverages and locations. */
  lines: string[];
  states: string[];
}) {
  const data = useQuery(api.providerDiscovery.listForRequest, { requestId });
  const start = useAction(api.actions.providerDiscovery.start);
  const review = useMutation(api.providerDiscovery.review);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useState<Id<"providerDiscoveryCandidates">[]>(
    [],
  );
  const [attachToRequest, setAttachToRequest] = useState(false);

  const discovery = data?.discovery ?? null;
  const running = discovery?.status === "pending" || discovery?.status === "running";
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
  const canSearch = lines.length > 0 && states.length > 0;

  async function confirmStart() {
    setStarting(true);
    try {
      await start({ requestId });
      setConfirming(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not start the search"),
      );
    } finally {
      setStarting(false);
    }
  }

  async function reviewCandidates(
    ids: Id<"providerDiscoveryCandidates">[],
    action: "add" | "dismiss",
  ) {
    setReviewing(true);
    try {
      await review({
        items: ids.map((candidateId) => ({ candidateId, action })),
        ...(action === "add" && attachToRequest ? { attachToRequest } : {}),
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
    <section aria-label="Find markets" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={typeStyle("heading.item")}>Find markets</h2>
            <DiscoveryStatus discovery={discovery} />
          </div>
          <p
            className={`max-w-prose text-muted-foreground ${typeStyle("body.default")}`}
          >
            Search public sources for carriers, MGAs and wholesalers that match
            this request&apos;s lines and states.
          </p>
        </div>
        <PillButton
          type="button"
          variant="secondary"
          size="compact"
          disabled={running || data === undefined}
          title={running ? "A search is already running" : undefined}
          onClick={() => setConfirming(true)}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Search className="size-3.5" />
          )}
          Find markets
        </PillButton>
      </div>

      {data === undefined ? (
        <OperationalPanel as="div" className="space-y-3 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-full max-w-md" />
        </OperationalPanel>
      ) : candidates.length ? (
        <>
          <div
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${typeStyle("body.default")}`}
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
            {pendingIds.length ? (
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={attachToRequest}
                  disabled={reviewing}
                  onCheckedChange={(value) => setAttachToRequest(value === true)}
                />
                <span className="text-muted-foreground">
                  Also track on this request
                </span>
              </label>
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
          {running
            ? "Searching public sources. This can take several minutes; candidates appear here when it finishes."
            : discovery?.status === "completed"
              ? "The search found no new markets."
              : "No markets found yet."}
        </OperationalPanel>
      )}

      <Dialog
        open={confirming}
        onOpenChange={(next) => !starting && setConfirming(next)}
      >
        <DialogContent showCloseButton={!starting}>
          <DialogHeader>
            <DialogTitle>Find markets for this request</DialogTitle>
            <DialogDescription>
              This is a paid search of public sources. Only the lines and
              states below are shared, not the client&apos;s name or details.
              Nothing is added to your network until you review it.
            </DialogDescription>
          </DialogHeader>
          <dl className={`space-y-2 ${typeStyle("body.default")}`}>
            <div>
              <dt className="text-muted-foreground">Lines</dt>
              <dd>{lines.length ? lines.join(", ") : "None found on this request"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">States</dt>
              <dd>{states.length ? states.join(", ") : "None found on this request"}</dd>
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
              disabled={starting || !canSearch}
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
