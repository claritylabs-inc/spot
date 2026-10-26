import dayjs from "dayjs";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isSpotOwnedBrokerIdentity } from "./brokerProfileValidation";
import type { OperatorPerson } from "./operatorAvatar";
import type {
  CollectGlobalSuggestionCandidates,
  OperatorSuggestionCandidate,
} from "./operatorSuggestionTypes";
import { teamInboxRow } from "./teamInboxProjection";

const MAX_CANDIDATES = 12;
/** At most this many issues or threads are listed one by one; more aggregate. */
const MAX_ITEMIZED = 3;
const RENEWAL_WINDOW_DAYS = 45;
const MAX_RENEWAL_CLIENTS = 4;
const OPEN_ISSUE_WINDOW_DAYS = 14;
const NEW_PROPOSAL_WINDOW_DAYS = 7;
const STALLED_AFTER_DAYS = 7;
const STALLED_WINDOW_DAYS = 45;
const MAX_STALLED_REQUESTS = 2;
const REPLY_WINDOW_DAYS = 14;
const REPLY_GRACE_HOURS = 2;
/** Mirrors `list_extraction_issues`: an expired lease this old is stuck. */
const EXTRACTION_STUCK_AFTER_MS = 5 * 60 * 1000;
const ROUTING_SAMPLE_LIMIT = 200;
const ROUTING_DEGRADED_MIN_ERRORS = 3;
const ROUTING_DEGRADED_ERROR_RATE = 0.25;
const OPEN_REQUEST_STATUSES = new Set<Doc<"procurementRequests">["status"]>([
  "draft",
  "submitted",
  "gathering_information",
  "marketing",
  "proposal_review",
  "binding",
]);
const STALLABLE_REQUEST_STATUSES = new Set<Doc<"procurementRequests">["status"]>(
  ["submitted", "gathering_information", "marketing", "proposal_review", "binding"],
);

type Candidate = OperatorSuggestionCandidate;
type Organization = Doc<"organizations">;

function clip(text: string, max: number) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function plural(count: number, noun: string, pluralNoun = `${noun}s`) {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

function possessive(name: string) {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function isoTime(timestamp: number) {
  return dayjs(timestamp).toISOString();
}

/** Minutes below an hour, otherwise hours, rounded up. */
function span(since: number, now: number) {
  const minutes = Math.max(1, Math.ceil(dayjs(now).diff(since, "minute", true)));
  return minutes < 60
    ? { value: minutes, unit: "minute", short: "m" }
    : { value: Math.ceil(minutes / 60), unit: "hour", short: "h" };
}

/** "in the last 40 minutes" / "in the last hour" / "in the last 5 hours". */
function withinPhrase(since: number, now: number) {
  const { value, unit } = span(since, now);
  return value === 1 ? `in the last ${unit}` : `in the last ${value} ${unit}s`;
}

/** "40m" / "5h", for labels that state two windows. */
function shortSpan(since: number, now: number) {
  const { value, short } = span(since, now);
  return `${value}${short}`;
}

/** "3 hours" / "2 days", for how long something has waited. */
function agePhrase(since: number, now: number) {
  const days = dayjs(now).diff(since, "day");
  if (days >= 1) return plural(days, "day");
  return plural(Math.max(1, dayjs(now).diff(since, "hour")), "hour");
}

function renewalPhrase(days: number) {
  if (days === 0) return "renews today";
  if (days === 1) return "renews tomorrow";
  return `renews in ${days} days`;
}

function policyName(policy: Doc<"policies">) {
  return (
    policy.policyNumber ||
    policy.linesOfBusiness[0] ||
    policy.fileName ||
    "policy"
  );
}

/** Live, non-test, non-archived, non-Spot organizations, read once each. */
function organizationReader(ctx: QueryCtx) {
  const cache = new Map<Id<"organizations">, Promise<Organization | null>>();
  return (orgId: Id<"organizations"> | undefined | null) => {
    if (!orgId) return Promise.resolve(null);
    let pending = cache.get(orgId);
    if (!pending) {
      pending = ctx.db.get(orgId).then((org) =>
        org &&
        org.deletedAt === undefined &&
        !org.smokeMarker &&
        org.clientAccessStatus !== "archived" &&
        !isSpotOwnedBrokerIdentity(org)
          ? org
          : null,
      );
      cache.set(orgId, pending);
    }
    return pending;
  };
}

type ReadOrganization = ReturnType<typeof organizationReader>;
type InboxRow = NonNullable<Awaited<ReturnType<typeof teamInboxRow>>>;

function isLivePolicy(policy: Doc<"policies"> | null): policy is Doc<"policies"> {
  return (
    !!policy &&
    policy.deletedAt === undefined &&
    !policy.dismissed &&
    !policy.isDemo &&
    !!policy.orgId
  );
}

async function liveCompanyRequest(
  readOrganization: ReadOrganization,
  request: Doc<"procurementRequests"> | null,
) {
  if (
    !request ||
    request.deletedAt !== undefined ||
    !request.clientOrgId ||
    request.intakeAnswers?.intakeGoal === "savings"
  )
    return null;
  const client = await readOrganization(request.clientOrgId);
  return client?.type === "client" ? { request, client } : null;
}

type PolicyIssue = {
  policy: Doc<"policies">;
  organization: Organization;
  status: "error" | "stuck";
  error?: string;
  updatedAt: number;
};

/**
 * Policies whose newest extraction run failed or stalled within the issue
 * window, newest first, plus failed runs in the last 24 hours (`recentErrors`).
 */
async function readPolicyExtractionIssues(
  ctx: QueryCtx,
  readOrganization: ReadOrganization,
  now: number,
) {
  const issueSince = dayjs(now).subtract(OPEN_ISSUE_WINDOW_DAYS, "day").valueOf();
  const recentSince = dayjs(now).subtract(24, "hour").valueOf();
  const [errorRuns, runningRuns] = await Promise.all([
    ctx.db
      .query("policyExtractionRuns")
      .withIndex("status_updated", (q) =>
        q
          .eq("pipelineStatus", "error")
          .gt("updatedAt", issueSince)
          .lte("updatedAt", now),
      )
      .order("desc")
      .take(40),
    ctx.db
      .query("policyExtractionRuns")
      // A stuck run's expired lease means it has not been written for at
      // least the stuck threshold, so healthy runs' frequent checkpoint writes
      // stay outside this range.
      .withIndex("status_updated", (q) =>
        q
          .eq("pipelineStatus", "running")
          .lte("updatedAt", now - EXTRACTION_STUCK_AFTER_MS),
      )
      .order("desc")
      .take(20),
  ]);
  const stuckRuns = runningRuns.filter((run) => {
    const lease = (run.pipelineCheckpoint as { lease?: { expiresAt?: number } } | undefined)
      ?.lease;
    return (
      lease?.expiresAt !== undefined &&
      now - lease.expiresAt > EXTRACTION_STUCK_AFTER_MS
    );
  });
  const runs = [
    ...errorRuns.map((run) => ({ run, status: "error" as const })),
    ...stuckRuns.map((run) => ({ run, status: "stuck" as const })),
  ].sort((left, right) => right.run.updatedAt - left.run.updatedAt);

  const issues: PolicyIssue[] = [];
  const recentErrors: number[] = [];
  const seen = new Set<Id<"policies">>();
  for (const { run, status } of runs) {
    if (seen.has(run.policyId)) continue;
    seen.add(run.policyId);
    const policy = await ctx.db.get(run.policyId);
    if (!isLivePolicy(policy)) continue;
    const organization = await readOrganization(policy.orgId);
    if (!organization) continue;
    if (status === "error" && run.updatedAt >= recentSince) {
      recentErrors.push(run.updatedAt);
    }
    // A later retry that completed or is running supersedes the failed run.
    if (status === "error" && policy.pipelineStatus !== "error") continue;
    issues.push({
      policy,
      organization,
      status,
      error: run.pipelineError,
      updatedAt: run.updatedAt,
    });
  }
  return { issues, recentErrors };
}

/**
 * Proposals whose extraction failed in the last 24 hours. Archived or withdrawn
 * proposals and cancelled jobs are not failures worth naming.
 */
async function readRecentProposalExtractionErrors(
  ctx: QueryCtx,
  readOrganization: ReadOrganization,
  now: number,
) {
  const since = dayjs(now).subtract(24, "hour").valueOf();
  const jobs = await ctx.db
    .query("procurementProposalExtractionJobs")
    .withIndex("status", (q) =>
      q.eq("status", "failed").gt("updatedAt", since).lte("updatedAt", now),
    )
    .order("desc")
    .take(20);
  const failures: number[] = [];
  const seen = new Set<Id<"procurementProposals">>();
  for (const job of jobs) {
    if (job.cancelledAt || seen.has(job.proposalId)) continue;
    seen.add(job.proposalId);
    const proposal = await ctx.db.get(job.proposalId);
    if (!proposal || proposal.status === "archived" || proposal.status === "withdrawn")
      continue;
    if (await readOrganization(job.clientOrgId)) failures.push(job.updatedAt);
  }
  return failures;
}

/**
 * Routed model calls in the hour before `now`. There is no status index, so a
 * full page covers less than the hour; `coveredSince` is the oldest call read
 * and every count is stated for that span only.
 */
async function readRoutingFailures(ctx: QueryCtx, now: number) {
  const hourAgo = dayjs(now).subtract(1, "hour").valueOf();
  const calls = await ctx.db
    .query("modelRoutingEvents")
    .withIndex("kind_time", (q) =>
      q.eq("kind", "call").gt("timestamp", hourAgo).lte("timestamp", now),
    )
    .order("desc")
    .take(ROUTING_SAMPLE_LIMIT);
  const failures = calls.filter(
    (call) => call.status === "error" || call.status === "unknown",
  );
  return {
    failures: failures.length,
    calls: calls.length,
    coveredSince:
      calls.length === ROUTING_SAMPLE_LIMIT ? calls[calls.length - 1].timestamp : hourAgo,
    tasks: [...new Set(failures.map((call) => call.task))],
    degraded:
      failures.length >= ROUTING_DEGRADED_MIN_ERRORS &&
      failures.length / calls.length >= ROUTING_DEGRADED_ERROR_RATE,
  };
}

async function systemHealthCandidate(
  ctx: QueryCtx,
  readOrganization: ReadOrganization,
  routing: Awaited<ReturnType<typeof readRoutingFailures>>,
  now: number,
): Promise<Candidate | null> {
  const [connections, bindings, emailAccounts] = await Promise.all([
    ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("reconcile_schedule", (q) => q.eq("status", "active"))
      .take(100),
    // Mirrors `get_channel_health`; bindings have no status-first index.
    ctx.db.query("slackChannelBindings").take(100),
    ctx.db
      .query("connectedEmailAccounts")
      .withIndex("status", (q) => q.eq("status", "error"))
      .take(10),
  ]);
  const liveOwner = async <T extends { clientOrgId: Id<"organizations"> }>(
    rows: T[],
  ) => {
    const owners = await Promise.all(rows.map((row) => readOrganization(row.clientOrgId)));
    return owners.filter((owner): owner is Organization => owner !== null);
  };
  const degradedConnections = await liveOwner(
    connections.filter((connection) => connection.healthStatus === "degraded"),
  );
  const degradedBindings = await liveOwner(
    bindings.filter(
      (binding) =>
        binding.status === "unavailable" ||
        (binding.status === "active" && binding.healthStatus === "degraded"),
    ),
  );
  const failingEmail = (
    await Promise.all(emailAccounts.map((account) => readOrganization(account.orgId)))
  ).filter((owner): owner is Organization => owner !== null);

  const slackCount = degradedConnections.length + degradedBindings.length;
  const problems = [
    slackCount > 0 ? plural(slackCount, "Slack connection") : null,
    failingEmail.length > 0 ? plural(failingEmail.length, "email account") : null,
    routing.degraded ? "model routing" : null,
  ].filter((problem): problem is string => problem !== null);
  if (problems.length === 0) return null;

  const slackOwners = [...new Set([...degradedConnections, ...degradedBindings].map((org) => org.name))];
  const emailOwners = [...new Set(failingEmail.map((org) => org.name))];
  let label: string;
  if (problems.length > 1) {
    label = `${problems.length} integrations need attention`;
  } else if (routing.degraded) {
    label = `Model routing failing (${routing.failures} errors ${withinPhrase(routing.coveredSince, now)})`;
  } else if (slackCount > 0) {
    label =
      slackOwners.length === 1
        ? `${clip(slackOwners[0], 32)} Slack connection degraded`
        : `${plural(slackCount, "Slack connection")} degraded`;
  } else {
    label =
      emailOwners.length === 1
        ? `${clip(emailOwners[0], 32)} email account failing`
        : `${plural(failingEmail.length, "email account")} failing`;
  }
  const facts = [
    slackCount > 0
      ? `Degraded or unavailable Slack: ${degradedConnections.length} workspace connections, ${degradedBindings.length} channel bindings (${slackOwners.slice(0, 5).join(", ")}).`
      : null,
    failingEmail.length > 0
      ? `Connected email accounts in error: ${failingEmail.length} (${emailOwners.slice(0, 5).join(", ")}).`
      : null,
    routing.degraded
      ? `Model routing: ${routing.failures} of ${routing.calls} calls since ${isoTime(routing.coveredSince)} errored or ended unknown.`
      : null,
  ].filter((fact): fact is string => fact !== null);
  return {
    key: "system_health",
    intentId: "check_system_health",
    label: clip(label, 60),
    focus: clip(facts.join(" "), 500),
    urgency: 0.9,
    source: "live",
    evidence: {
      degradedSlackConnections: degradedConnections.length,
      degradedSlackBindings: degradedBindings.length,
      failingEmailAccounts: failingEmail.length,
      routingDegraded: routing.degraded,
    },
  };
}

function recentFailuresCandidate(
  policyErrors: number[],
  proposalErrors: number[],
  routing: Awaited<ReturnType<typeof readRoutingFailures>>,
  now: number,
): Candidate | null {
  const extractionCount = policyErrors.length + proposalErrors.length;
  const routingCount = routing.failures;
  const total = extractionCount + routingCount;
  if (total === 0) return null;
  // Extraction counts span from the earliest failure read; routing counts only
  // the window actually read.
  const earliestExtraction = Math.min(...policyErrors, ...proposalErrors);
  const label =
    routingCount === 0
      ? `${plural(extractionCount, "extraction")} failed ${withinPhrase(earliestExtraction, now)}`
      : extractionCount === 0
        ? `${plural(routingCount, "model call")} failed ${withinPhrase(routing.coveredSince, now)}`
        : `${plural(extractionCount, "extraction failure")} in ${shortSpan(earliestExtraction, now)}, ${plural(routingCount, "model error")} in ${shortSpan(routing.coveredSince, now)}`;
  const facts = [
    extractionCount > 0
      ? `Extraction failures in the last 24 hours: ${policyErrors.length} policy, ${proposalErrors.length} proposal; earliest at ${isoTime(earliestExtraction)}.`
      : null,
    routingCount > 0
      ? `Model calls: ${routingCount} of ${routing.calls} since ${isoTime(routing.coveredSince)} errored or ended unknown; tasks ${routing.tasks.slice(0, 5).join(", ")}.`
      : null,
  ].filter((fact): fact is string => fact !== null);
  return {
    key: "recent_failures",
    intentId: "investigate_recent_failures",
    label: clip(label, 60),
    focus: clip(facts.join(" "), 500),
    urgency: Math.min(0.85, 0.55 + total * 0.03),
    source: "live",
    evidence: {
      extractionFailures: extractionCount,
      routingFailures: routingCount,
      hoursSinceEarliestExtraction:
        extractionCount > 0 ? dayjs(now).diff(earliestExtraction, "hour") : null,
      routingWindowMinutes: Math.ceil(dayjs(now).diff(routing.coveredSince, "minute", true)),
    },
  };
}

function policyIssueCandidates(issues: PolicyIssue[], now: number): Candidate[] {
  if (issues.length === 0) return [];
  if (issues.length <= MAX_ITEMIZED) {
    return issues.map(({ policy, organization, status, error, updatedAt }) => {
      const verb = status === "stuck" ? "extraction stalled" : "extraction failed";
      const name = clip(organization.name, 24);
      return {
        key: `extraction_issue:${policy._id}`,
        intentId: "investigate_policy",
        label: clip(`${name} ${clip(policyName(policy), 16)} ${verb}`, 60),
        focus: clip(
          [
            `Policy ${policyName(policy)} (${policy.carrier}) for ${organization.name}, policyId ${policy._id}.`,
            `Latest extraction ${status} at ${isoTime(updatedAt)}.`,
            error ? `Error: ${clip(error, 200)}` : null,
          ]
            .filter(Boolean)
            .join(" "),
          500,
        ),
        pageContext: {
          pageType: "policy",
          entityId: policy._id,
          summary: clip(`${organization.name} policy ${policyName(policy)}`, 120),
          href: `/operator/clients/${organization._id}/policies/${policy._id}`,
        },
        urgency: status === "stuck" ? 0.7 : 0.65,
        source: "live",
        evidence: {
          status,
          hoursSinceUpdate: dayjs(now).diff(updatedAt, "hour"),
          hasError: Boolean(error),
        },
      } satisfies Candidate;
    });
  }
  const stuck = issues.filter((issue) => issue.status === "stuck").length;
  const listed = issues
    .slice(0, 6)
    .map(
      ({ policy, organization, status }) =>
        `${organization.name} ${policyName(policy)} (${status}, policyId ${policy._id})`,
    );
  return [
    {
      key: "extraction_issues",
      intentId: "investigate_recent_failures",
      label: `${plural(issues.length, "policy extraction")} need review`,
      focus: clip(
        `${issues.length} policies have a failed or stalled latest extraction (${stuck} stalled) in the last ${OPEN_ISSUE_WINDOW_DAYS} days. Newest: ${listed.join("; ")}.`,
        500,
      ),
      urgency: 0.7,
      source: "live",
      evidence: {
        openIssues: issues.length,
        stalled: stuck,
        hoursSinceNewest: dayjs(now).diff(issues[0].updatedAt, "hour"),
      },
    },
  ];
}

/** One candidate per client with a policy expiring soon and no open procurement. */
async function renewalCandidates(
  ctx: QueryCtx,
  readOrganization: ReadOrganization,
  now: number,
): Promise<Candidate[]> {
  const today = dayjs(now).startOf("day");
  const windowEnd = today.add(RENEWAL_WINDOW_DAYS, "day").endOf("day");
  // No expiration index exists; annual terms expiring in the window began a
  // year earlier, and `policyYear` is the effective year.
  const years = [
    ...new Set([today.subtract(1, "year").year(), windowEnd.subtract(1, "year").year()]),
  ];
  const policies = (
    await Promise.all(
      years.map((year) =>
        ctx.db
          .query("policies")
          .withIndex("year", (q) =>
            q.eq("policyYear", year).lte("_creationTime", now),
          )
          .order("desc")
          .take(100),
      ),
    )
  ).flat();
  const soonestByClient = new Map<
    Id<"organizations">,
    { policy: Doc<"policies">; days: number; count: number }
  >();
  for (const policy of policies) {
    if (!isLivePolicy(policy) || policy.policyTermType === "continuous") continue;
    const expiration = dayjs(policy.expirationDate);
    if (
      !expiration.isValid() ||
      expiration.isBefore(today) ||
      expiration.isAfter(windowEnd)
    )
      continue;
    const days = expiration.startOf("day").diff(today, "day");
    const orgId = policy.orgId!;
    const current = soonestByClient.get(orgId);
    if (!current || days < current.days) {
      soonestByClient.set(orgId, { policy, days, count: (current?.count ?? 0) + 1 });
    } else {
      current.count += 1;
    }
  }
  const soonest = [...soonestByClient.entries()].sort(
    (left, right) => left[1].days - right[1].days,
  );
  const candidates: Candidate[] = [];
  for (const [orgId, { policy, days, count }] of soonest.slice(0, MAX_RENEWAL_CLIENTS * 2)) {
    if (candidates.length >= MAX_RENEWAL_CLIENTS) break;
    const client = await readOrganization(orgId);
    if (client?.type !== "client") continue;
    const recentRequests = await ctx.db
      .query("procurementRequests")
      .withIndex("organization", (q) => q.eq("clientOrgId", orgId))
      .order("desc")
      .take(10);
    const hasOpenProcurement = recentRequests.some(
      (request) =>
        request.deletedAt === undefined &&
        (OPEN_REQUEST_STATUSES.has(request.status) ||
          request.replacingPolicyId === policy._id),
    );
    if (hasOpenProcurement) continue;
    candidates.push({
      key: `renewal:${policy._id}`,
      intentId: "start_procurement",
      label: clip(`${clip(client.name, 36)} ${renewalPhrase(days)}`, 60),
      focus: clip(
        [
          `Policy ${policyName(policy)} (${policy.carrier}; ${policy.linesOfBusiness.join(", ") || "lines unknown"}) for ${client.name} expires ${policy.expirationDate}, in ${days} days. policyId ${policy._id}.`,
          count > 1 ? `${count} of the client's policies expire within ${RENEWAL_WINDOW_DAYS} days.` : null,
          "The client has no open procurement request.",
        ]
          .filter(Boolean)
          .join(" "),
        500,
      ),
      pageContext: {
        pageType: "operator_client",
        entityId: orgId,
        summary: clip(client.name, 120),
        href: `/operator/clients/${orgId}`,
      },
      urgency: Math.max(0.4, 0.95 - (days / RENEWAL_WINDOW_DAYS) * 0.5),
      source: "live",
      evidence: {
        daysUntilRenewal: days,
        hasOpenProcurement: false,
        expiringPolicies: count,
      },
    });
  }
  return candidates;
}

/** Proposals extracted in the last week that nobody has reviewed yet, per request. */
async function newProposalCandidates(
  ctx: QueryCtx,
  readOrganization: ReadOrganization,
  now: number,
): Promise<Candidate[]> {
  const since = dayjs(now).subtract(NEW_PROPOSAL_WINDOW_DAYS, "day").valueOf();
  const jobs = await ctx.db
    .query("procurementProposalExtractionJobs")
    .withIndex("status", (q) =>
      q.eq("status", "complete").gt("updatedAt", since).lte("updatedAt", now),
    )
    .order("desc")
    .take(25);
  const byRequest = new Map<
    Id<"procurementRequests">,
    { brokers: string[]; latestAt: number }
  >();
  const seen = new Set<Id<"procurementProposals">>();
  for (const job of jobs) {
    if (seen.has(job.proposalId)) continue;
    seen.add(job.proposalId);
    const proposal = await ctx.db.get(job.proposalId);
    if (proposal?.status !== "review_ready") continue;
    const broker = await ctx.db.get(proposal.brokerOrgId);
    const entry = byRequest.get(job.requestId) ?? { brokers: [], latestAt: job.updatedAt };
    entry.brokers.push(broker?.name ?? "Provider");
    byRequest.set(job.requestId, entry);
  }
  const candidates: Candidate[] = [];
  for (const [requestId, { brokers, latestAt }] of byRequest) {
    const live = await liveCompanyRequest(
      readOrganization,
      await ctx.db.get(requestId),
    );
    if (!live || !OPEN_REQUEST_STATUSES.has(live.request.status)) continue;
    const { request, client } = live;
    const clientName = clip(client.name, 24);
    const label =
      brokers.length === 1
        ? `${clip(brokers[0], 20)} proposal arrived on ${possessive(clientName)} request`
        : `${brokers.length} proposals ready on ${possessive(clientName)} request`;
    candidates.push({
      key: `new_proposals:${requestId}`,
      intentId: "review_procurement",
      label: clip(label, 60),
      focus: clip(
        `${plural(brokers.length, "unreviewed proposal")} from ${brokers.join(", ")} on ${possessive(client.name)} request "${request.title}" (requestId ${requestId}, status ${request.status}); latest extracted ${isoTime(latestAt)}.`,
        500,
      ),
      pageContext: {
        pageType: "procurement_request",
        entityId: requestId,
        summary: clip(`${client.name}: ${request.title}`, 120),
        href: `/operator/clients/${client._id}/procurement/${requestId}`,
      },
      urgency: Math.min(0.85, 0.7 + brokers.length * 0.05),
      source: "live",
      evidence: {
        unreviewedProposals: brokers.length,
        hoursSinceLatest: dayjs(now).diff(latestAt, "hour"),
        requestStatus: request.status,
      },
    });
  }
  return candidates;
}

/** Open requests with no request, proposal or email activity for a week. */
async function stalledRequestCandidates(
  ctx: QueryCtx,
  readOrganization: ReadOrganization,
  now: number,
  skip: Set<string>,
): Promise<Candidate[]> {
  const stalledBefore = dayjs(now).subtract(STALLED_AFTER_DAYS, "day").valueOf();
  const windowStart = dayjs(now).subtract(STALLED_WINDOW_DAYS, "day").valueOf();
  const requests = await ctx.db
    .query("procurementRequests")
    .withIndex("by_deletedAt_and_updatedAt", (q) =>
      q.eq("deletedAt", undefined).gt("updatedAt", windowStart).lt("updatedAt", stalledBefore),
    )
    .order("desc")
    .take(50);
  const candidates: Candidate[] = [];
  const open = requests.filter(
    (row) => STALLABLE_REQUEST_STATUSES.has(row.status) && !skip.has(row._id),
  );
  for (const row of open.slice(0, MAX_STALLED_REQUESTS * 2)) {
    if (candidates.length >= MAX_STALLED_REQUESTS) break;
    const live = await liveCompanyRequest(readOrganization, row);
    if (!live) continue;
    const [latestProposal, latestThread] = await Promise.all([
      ctx.db
        .query("procurementProposals")
        .withIndex("request", (q) => q.eq("requestId", row._id))
        .order("desc")
        .first(),
      ctx.db
        .query("teamEmailThreads")
        .withIndex("by_requestId_and_latestMessageAt", (q) => q.eq("requestId", row._id))
        .order("desc")
        .first(),
    ]);
    const lastActivityAt = Math.max(
      row.updatedAt,
      latestProposal?.updatedAt ?? 0,
      latestThread?.latestMessageAt ?? 0,
    );
    if (lastActivityAt >= stalledBefore) continue;
    const { request, client } = live;
    const idle = agePhrase(lastActivityAt, now);
    candidates.push({
      key: `stalled_request:${request._id}`,
      intentId: "review_procurement",
      label: clip(`${possessive(clip(client.name, 28))} request idle for ${idle}`, 60),
      focus: clip(
        `${possessive(client.name)} request "${request.title}" (requestId ${request._id}) is ${request.status.replaceAll("_", " ")} with no request, proposal or email activity since ${isoTime(lastActivityAt)}.`,
        500,
      ),
      pageContext: {
        pageType: "procurement_request",
        entityId: request._id,
        summary: clip(`${client.name}: ${request.title}`, 120),
        href: `/operator/clients/${client._id}/procurement/${request._id}`,
      },
      urgency: Math.min(0.7, 0.5 + dayjs(now).diff(lastActivityAt, "day") / 100),
      source: "live",
      evidence: {
        daysIdle: dayjs(now).diff(lastActivityAt, "day"),
        requestStatus: request.status,
        hasProposals: latestProposal !== null,
      },
    });
  }
  return candidates;
}

/** Team inbox threads whose latest inbound message is waiting for a reply. */
async function awaitingReplyCandidates(
  ctx: QueryCtx,
  operatorUserId: Id<"users">,
  readOrganization: ReadOrganization,
  now: number,
): Promise<Candidate[]> {
  const since = dayjs(now).subtract(REPLY_WINDOW_DAYS, "day").valueOf();
  const graceCutoff = dayjs(now).subtract(REPLY_GRACE_HOURS, "hour").valueOf();
  const threads = await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_archivedAt_and_latestInboundAt", (q) =>
      q
        .eq("archivedAt", undefined)
        .gt("latestInboundAt", since)
        .lte("latestInboundAt", graceCutoff),
    )
    .order("desc")
    .take(30);
  const waiting = threads.filter(
    (thread) =>
      thread.deletedAt === undefined && thread.latestDirection === "inbound",
  );
  const people = new Map<Id<"users">, OperatorPerson>();
  const rows: Array<{ row: InboxRow; inboundAt: number }> = [];
  const inspected = waiting.slice(0, MAX_ITEMIZED + 2);
  for (const thread of inspected) {
    // `teamInboxRow` owns the needs-reply rule and hides dead client/request links.
    const row = await teamInboxRow(ctx, thread, operatorUserId, people);
    if (!row?.needsReply || row.fromOperator) continue;
    if (row.client && !(await readOrganization(row.client._id))) continue;
    rows.push({ row, inboundAt: thread.latestInboundAt! });
  }
  if (rows.length === 0) return [];
  const counterpartOf = (row: InboxRow) =>
    row.fromName || row.fromEmail || "unknown sender";
  if (rows.length <= MAX_ITEMIZED) {
    return rows.map(({ row, inboundAt }) => {
      const counterpart = counterpartOf(row);
      return {
        key: `email_reply:${row._id}`,
        intentId: "reply_team_email",
        label: clip(
          `Reply owed to ${clip(counterpart, 28)}, waiting ${agePhrase(inboundAt, now)}`,
          60,
        ),
        focus: clip(
          [
            `Team inbox thread "${row.subject}" (teamEmailThreadId ${row._id}) from ${counterpart}${row.fromEmail && row.fromName ? ` <${row.fromEmail}>` : ""}, ${row.category} correspondence, ${plural(row.messageCount, "message")}.`,
            `Latest inbound at ${isoTime(inboundAt)} has no reply.`,
            row.client ? `Client: ${row.client.name}.` : null,
            row.request ? `Request: ${row.request.title}.` : null,
          ]
            .filter(Boolean)
            .join(" "),
          500,
        ),
        urgency: Math.min(0.8, 0.55 + dayjs(now).diff(inboundAt, "hour") / 240),
        source: "live",
        evidence: {
          hoursWaiting: dayjs(now).diff(inboundAt, "hour"),
          category: row.category,
          linkedToClient: row.client !== null,
          unread: row.unread,
        },
      } satisfies Candidate;
    });
  }
  const oldest = Math.min(...rows.map(({ inboundAt }) => inboundAt));
  return [
    {
      key: "email_replies",
      intentId: "reply_team_email",
      label: `${rows.length}${waiting.length > inspected.length ? "+" : ""} team emails await a reply`,
      focus: clip(
        `Team inbox threads with an unanswered inbound message, oldest from ${isoTime(oldest)}: ${rows
          .map(({ row }) => `"${row.subject}" from ${counterpartOf(row)} (teamEmailThreadId ${row._id})`)
          .join("; ")}.`,
        500,
      ),
      urgency: 0.7,
      source: "live",
      evidence: {
        threadsAwaitingReply: rows.length,
        oldestHoursWaiting: dayjs(now).diff(oldest, "hour"),
      },
    },
  ];
}

export const collectGlobalSuggestionCandidates: CollectGlobalSuggestionCandidates =
  async (ctx, { operatorUserId, now }) => {
    const readOrganization = organizationReader(ctx);
    const [policyExtraction, proposalErrors, routing, renewals, newProposals, replies] =
      await Promise.all([
        readPolicyExtractionIssues(ctx, readOrganization, now),
        readRecentProposalExtractionErrors(ctx, readOrganization, now),
        readRoutingFailures(ctx, now),
        renewalCandidates(ctx, readOrganization, now),
        newProposalCandidates(ctx, readOrganization, now),
        awaitingReplyCandidates(ctx, operatorUserId, readOrganization, now),
      ]);
    const [health, stalled] = await Promise.all([
      systemHealthCandidate(ctx, readOrganization, routing, now),
      stalledRequestCandidates(
        ctx,
        readOrganization,
        now,
        new Set(newProposals.map((candidate) => candidate.pageContext!.entityId!)),
      ),
    ]);
    const candidates = [
      health,
      recentFailuresCandidate(policyExtraction.recentErrors, proposalErrors, routing, now),
      ...policyIssueCandidates(policyExtraction.issues, now),
      ...renewals,
      ...newProposals,
      ...stalled,
      ...replies,
    ].filter((candidate): candidate is Candidate => candidate !== null);
    return candidates
      .sort((left, right) => right.urgency - left.urgency)
      .slice(0, MAX_CANDIDATES);
  };
