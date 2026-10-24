import dayjs from "dayjs";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getMarkdownDocument } from "../markdownDocuments";
import { policyLobCodes, lobLabel } from "./linesOfBusiness";
import { OPERATOR_AGENT_INTENTS } from "./operatorAgentIntentRegistry";
import type {
  CollectEntitySuggestionCandidates,
  OperatorSuggestionCandidate,
  OperatorSuggestionPageContext,
} from "./operatorSuggestionTypes";
import { isNonInsuranceDocument } from "./policyDocumentGate";
import { readWikiDocument } from "./orgWikiDocument";

const MAX_CANDIDATES = 8;
const MAX_LABEL = 60;
const MAX_FOCUS = 500;
const RENEWAL_WINDOW_DAYS = 60;
const MAX_RENEWAL_CANDIDATES = 2;
const NO_REPLY_DAYS = 3;
const POLICY_SCAN = 200;
const REQUEST_SCAN = 50;
const FILE_SCAN = 25;
const FILE_ATTACHMENT_CHECKS = 8;
const CHECK_SCAN = 50;
const REQUIREMENT_LOOKUPS = 10;

const OPEN_REQUEST_STATUSES: ReadonlySet<Doc<"procurementRequests">["status"]> =
  new Set([
    "submitted",
    "gathering_information",
    "marketing",
    "proposal_review",
    "binding",
  ]);
const OPEN_INFORMATION_STATUSES: ReadonlySet<
  Doc<"procurementInformationRequirements">["status"]
> = new Set(["needs_information", "clarification_needed", "operator_work"]);
const PROPOSAL_STATUSES: ReadonlySet<Doc<"procurementProposals">["status"]> =
  new Set(["review_ready", "reviewed", "selected"]);
const COMPLIANCE_ISSUE_STATUSES: ReadonlySet<
  Doc<"complianceChecks">["status"]
> = new Set(["not_met", "expired", "expiring_soon"]);

const REQUEST_STAGE_LABELS: Record<
  Doc<"procurementRequests">["status"],
  { urgency: number; phrase: string }
> = {
  draft: { urgency: 0, phrase: "is a draft" },
  submitted: { urgency: 0.6, phrase: "is awaiting kickoff" },
  gathering_information: { urgency: 0.7, phrase: "still needs information" },
  marketing: { urgency: 0.5, phrase: "is out to market" },
  proposal_review: { urgency: 0.8, phrase: "has proposals to review" },
  binding: { urgency: 0.75, phrase: "is in binding" },
  completed: { urgency: 0, phrase: "is complete" },
  cancelled: { urgency: 0, phrase: "is cancelled" },
};

type Policy = Doc<"policies">;
type Request = Doc<"procurementRequests">;
type Scope = {
  ctx: QueryCtx;
  now: number;
  page: OperatorSuggestionPageContext;
  entityId: string;
};
type CandidateInput = Pick<
  OperatorSuggestionCandidate,
  "intentId" | "label" | "focus" | "urgency" | "evidence"
> & { signal: string };

function fit(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function possessive(name: string) {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Joins names while the whole phrase stays within `room` characters. */
function nameList(names: string[], room: number) {
  const shown: string[] = [];
  for (const name of names) {
    const remaining = names.length - shown.length - 1;
    const next =
      [...shown, name].join(", ") + (remaining > 0 ? ` +${remaining}` : "");
    if (shown.length > 0 && next.length > room) break;
    shown.push(name);
  }
  const hidden = names.length - shown.length;
  return shown.join(", ") + (hidden > 0 ? ` +${hidden}` : "");
}

/**
 * The context the intent runs in. Client section pages reuse the same client
 * under `operator_client` when the intent isn't offered on the section itself.
 */
function contextFor(
  intentId: string,
  page: OperatorSuggestionPageContext,
): OperatorSuggestionPageContext | undefined {
  const pageTypes = OPERATOR_AGENT_INTENTS.find(
    (intent) => intent.id === intentId,
  )?.pageTypes;
  if (!pageTypes) return undefined;
  if (pageTypes.includes(page.pageType)) return page;
  if (
    page.pageType.startsWith("operator_client_") &&
    pageTypes.includes("operator_client")
  ) {
    return { pageType: "operator_client", entityId: page.entityId };
  }
  return undefined;
}

function build(
  scope: Scope,
  input: CandidateInput,
): OperatorSuggestionCandidate | null {
  const pageContext = contextFor(input.intentId, scope.page);
  if (!pageContext) return null;
  return {
    key: `${scope.page.pageType}:${scope.entityId}:${input.signal}`,
    intentId: input.intentId,
    label: fit(input.label, MAX_LABEL),
    focus: fit(input.focus, MAX_FOCUS),
    pageContext,
    urgency: Math.min(1, Math.max(0, input.urgency)),
    source: "page",
    evidence: input.evidence,
  };
}

async function loadClient(ctx: QueryCtx, entityId: string) {
  const orgId = ctx.db.normalizeId("organizations", entityId);
  const org = orgId ? await ctx.db.get(orgId) : null;
  return org && org.deletedAt === undefined && org.type === "client"
    ? org
    : null;
}

async function loadActivePolicies(ctx: QueryCtx, orgId: Id<"organizations">) {
  const policies = await ctx.db
    .query("policies")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .take(POLICY_SCAN);
  return policies.filter((policy) => !policy.deletedAt && !policy.dismissed);
}

async function loadOpenRequests(ctx: QueryCtx, orgId: Id<"organizations">) {
  const requests = await ctx.db
    .query("procurementRequests")
    .withIndex("organization", (q) => q.eq("clientOrgId", orgId))
    .order("desc")
    .take(REQUEST_SCAN);
  return requests.filter(
    (request) =>
      !request.deletedAt &&
      request.intakeAnswers?.intakeGoal !== "savings" &&
      OPEN_REQUEST_STATUSES.has(request.status),
  );
}

function policyName(policy: Policy) {
  const lines = policyLobCodes(policy)
    .filter((code) => code !== "UN")
    .map(lobLabel);
  return lines[0] ?? policy.security ?? policy.carrier ?? "Policy";
}

function policyReference(policy: Policy) {
  return [
    policy.security ?? policy.carrier,
    policy.policyNumber ? `#${policy.policyNumber}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function pendingReviewQuestions(policy: Policy) {
  const questions = (policy.extractionReview as { questions?: unknown } | null)
    ?.questions;
  if (!Array.isArray(questions)) return [];
  return (questions as Array<Record<string, unknown>>).filter(
    (question) =>
      typeof question.id === "string" &&
      question.status !== "confirmed" &&
      question.status !== "dismissed",
  );
}

function extractionFailed(policy: Policy) {
  return (
    policy.pipelineStatus === "error" &&
    !isNonInsuranceDocument(policy.pipelineError)
  );
}

function extractionFinal(policy: Policy) {
  const stage = policy.extractionDataStage;
  return policy.pipelineStatus === "complete"
    ? !stage || stage === "final"
    : !policy.pipelineStatus && stage === "final";
}

function daysUntilExpiration(policy: Policy, now: number) {
  if (policy.policyTermType === "continuous") return null;
  const expiration = dayjs(policy.expirationDate);
  if (!expiration.isValid()) return null;
  return expiration.startOf("day").diff(dayjs(now).startOf("day"), "day");
}

function policyInForce(policy: Policy, now: number) {
  const today = dayjs(now).startOf("day");
  const effective = dayjs(policy.effectiveDate);
  if (effective.isValid() && effective.startOf("day").isAfter(today)) {
    return false;
  }
  const days = daysUntilExpiration(policy, now);
  return days === null || days >= 0;
}

function renewalPhrase(days: number) {
  if (days <= 0) return "renews today";
  if (days === 1) return "renews tomorrow";
  return `renews in ${days} days`;
}

function requestStageSummary(request: Request) {
  return `${request.title} (${request.status.replaceAll("_", " ")})`;
}

// ── Client page and its wiki section ───────────────────────────────────────

async function clientStateCandidates(scope: Scope) {
  const { ctx, now, page } = scope;
  const org = await loadClient(ctx, scope.entityId);
  if (!org) return [];
  const onWiki = page.pageType === "operator_client_wiki";
  const [policies, openRequests, wikiDocument] = await Promise.all([
    loadActivePolicies(ctx, org._id),
    loadOpenRequests(ctx, org._id),
    getMarkdownDocument(ctx, { orgId: org._id, kind: "company_wiki" }),
  ]);
  const candidates: Array<OperatorSuggestionCandidate | null> = [];

  const replacedPolicyIds = new Set(
    openRequests.flatMap((request) =>
      request.replacingPolicyId ? [request.replacingPolicyId] : [],
    ),
  );
  const renewing = policies
    .flatMap((policy) => {
      const days = daysUntilExpiration(policy, now);
      return days !== null &&
        days >= 0 &&
        days <= RENEWAL_WINDOW_DAYS &&
        !replacedPolicyIds.has(policy._id)
        ? [{ policy, days }]
        : [];
    })
    .sort((a, b) => a.days - b.days);
  for (const { policy, days } of renewing.slice(0, MAX_RENEWAL_CANDIDATES)) {
    candidates.push(
      build(scope, {
        signal: `renewal:${policy._id}`,
        intentId: "start_procurement",
        label: `${policyName(policy)} ${renewalPhrase(days)}`,
        focus: `${org.name}: ${policyReference(policy)} expires ${policy.expirationDate} (${days} days). ${renewing.length} polic${renewing.length === 1 ? "y renews" : "ies renew"} within ${RENEWAL_WINDOW_DAYS} days and no open placement replaces ${renewing.length === 1 ? "it" : "them"}. Start the renewal placement for policyId ${policy._id}.`,
        urgency: 0.5 + 0.45 * (1 - days / RENEWAL_WINDOW_DAYS),
        evidence: {
          policyId: policy._id,
          daysUntilExpiration: days,
          renewingPolicies: renewing.length,
        },
      }),
    );
  }

  if (openRequests.length > 0) {
    const urgent = openRequests.some(
      (request) =>
        request.status === "proposal_review" || request.status === "binding",
    );
    candidates.push(
      build(scope, {
        signal: "open_procurement",
        intentId: "review_client",
        label: `${plural(openRequests.length, "open placement")} in progress`,
        focus: `${org.name} has ${plural(openRequests.length, "open procurement request")}: ${openRequests
          .slice(0, 5)
          .map(requestStageSummary)
          .join("; ")}. Include the state of each placement in the review.`,
        urgency: urgent ? 0.6 : 0.4,
        evidence: {
          openRequests: openRequests.length,
          proposalReviewOrBinding: urgent,
        },
      }),
    );
  }

  const hasProfile = Boolean(
    org.intakeBusinessProfile ||
    org.profileFacts?.operationsDescription ||
    org.companyResearch,
  );
  if (!hasProfile) {
    candidates.push(
      build(scope, {
        signal: "missing_profile",
        intentId: "update_client",
        label: `Complete ${possessive(org.name)} business profile`,
        focus: `${org.name} has no business profile: no submitted application, operations description, or company research is on record. Research public facts and fill the profile.`,
        urgency: 0.5,
        evidence: {
          hasBusinessProfile: false,
          hasWebsite: Boolean(org.website),
        },
      }),
    );
  }

  const wiki = readWikiDocument(wikiDocument?.markdown ?? "");
  const wikiEmpty = wiki.body.trim().length === 0;
  const pendingProposals = Object.keys(wiki.metadata.proposals ?? {}).length;
  if (wikiEmpty) {
    candidates.push(
      build(scope, {
        signal: "empty_wiki",
        intentId: onWiki ? "review_client_knowledge" : "update_client",
        label: `${possessive(org.name)} company wiki is empty`,
        focus: `${org.name} has no company wiki content yet. Build it from the profile, policies, and public research.`,
        urgency: 0.45,
        evidence: { wikiEmpty: true, hasBusinessProfile: hasProfile },
      }),
    );
  } else if (onWiki && pendingProposals > 0) {
    candidates.push(
      build(scope, {
        signal: "wiki_proposals",
        intentId: "review_client_knowledge",
        label: `${plural(pendingProposals, "wiki suggestion")} to review`,
        focus: `${possessive(org.name)} company wiki has ${plural(pendingProposals, "pending source-grounded suggestion")} waiting for review.`,
        urgency: 0.55,
        evidence: { pendingWikiProposals: pendingProposals },
      }),
    );
  }

  if (page.pageType === "operator_client") {
    candidates.push(
      build(scope, {
        signal: "baseline",
        intentId: "review_client",
        label: `Review ${org.name}`,
        focus: `Review ${org.name}'s current state.`,
        urgency: 0.2,
        evidence: {
          activePolicies: policies.length,
          openRequests: openRequests.length,
        },
      }),
    );
  }
  return candidates;
}

// ── Policies section ───────────────────────────────────────────────────────

async function clientPoliciesCandidates(scope: Scope) {
  const org = await loadClient(scope.ctx, scope.entityId);
  if (!org) return [];
  const policies = await loadActivePolicies(scope.ctx, org._id);
  const flagged = policies.flatMap((policy) => {
    const failed = extractionFailed(policy);
    const questions = pendingReviewQuestions(policy).length;
    return failed || questions > 0 ? [{ policy, failed, questions }] : [];
  });
  if (flagged.length === 0) return [];
  const failedCount = flagged.filter((item) => item.failed).length;
  const questionCount = flagged.reduce((sum, item) => sum + item.questions, 0);
  const details = flagged
    .slice(0, 5)
    .map(
      ({ policy, failed, questions }) =>
        `${policyReference(policy) || policyName(policy)} (${[
          failed ? "extraction failed" : undefined,
          questions > 0 ? plural(questions, "uncertain value") : undefined,
        ]
          .filter(Boolean)
          .join(", ")})`,
    );
  return [
    build(scope, {
      signal: "policy_issues",
      intentId: "investigate_policy",
      label: `${plural(flagged.length, "policy", "policies")} ${flagged.length === 1 ? "has" : "have"} unreviewed issues`,
      focus: `${org.name}: ${flagged.length} of ${policies.length} active policies have unreviewed extraction issues: ${details.join("; ")}.`,
      urgency: failedCount > 0 ? 0.8 : 0.65,
      evidence: {
        flaggedPolicies: flagged.length,
        failedExtractions: failedCount,
        uncertainValues: questionCount,
      },
    }),
  ];
}

// ── Procurement section ────────────────────────────────────────────────────

async function clientProcurementCandidates(scope: Scope) {
  const org = await loadClient(scope.ctx, scope.entityId);
  if (!org) return [];
  const openRequests = await loadOpenRequests(scope.ctx, org._id);
  if (openRequests.length === 0) {
    return [
      build(scope, {
        signal: "no_open_requests",
        intentId: "start_procurement",
        label: `Start a placement for ${org.name}`,
        focus: `${org.name} has no open procurement requests.`,
        urgency: 0.3,
        evidence: { openRequests: 0 },
      }),
    ];
  }
  return openRequests
    .map((request) => ({
      request,
      stage: REQUEST_STAGE_LABELS[request.status],
    }))
    .sort((a, b) => b.stage.urgency - a.stage.urgency)
    .slice(0, 3)
    .map(({ request, stage }) =>
      build(scope, {
        signal: `request:${request._id}`,
        intentId: "review_procurement",
        label: `${request.title} ${stage.phrase}`,
        focus: `${org.name}: procurement request "${request.title}" (procurementRequestId ${request._id}) is in ${request.status.replaceAll("_", " ")}, last updated ${dayjs(request.updatedAt).format("YYYY-MM-DD")}. Review this request.`,
        urgency: stage.urgency,
        evidence: {
          procurementRequestId: request._id,
          status: request.status,
          openRequests: openRequests.length,
        },
      }),
    );
}

// ── A single procurement request ───────────────────────────────────────────

async function procurementRequestCandidates(scope: Scope) {
  const { ctx, now } = scope;
  const requestId = ctx.db.normalizeId("procurementRequests", scope.entityId);
  const request = requestId ? await ctx.db.get(requestId) : null;
  if (
    !request ||
    request.deletedAt ||
    request.intakeAnswers?.intakeGoal === "savings" ||
    !request.clientOrgId ||
    !OPEN_REQUEST_STATUSES.has(request.status)
  ) {
    return [];
  }
  const client = await ctx.db.get(request.clientOrgId);
  if (!client || client.deletedAt !== undefined || client.type !== "client") {
    return [];
  }
  const [proposals, outreaches, information] = await Promise.all([
    ctx.db
      .query("procurementProposals")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .order("desc")
      .take(20),
    ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .order("desc")
      .take(30),
    ctx.db
      .query("procurementInformationRequirements")
      .withIndex("by_requestId", (q) => q.eq("requestId", request._id))
      .take(50),
  ]);
  const providerName = new Map(
    outreaches.map((outreach) => [outreach._id, outreach.brokerName]),
  );
  const candidates: Array<OperatorSuggestionCandidate | null> = [];
  const summary = requestStageSummary(request);

  const received = proposals.filter(
    (proposal) =>
      !proposal.archivedAt && PROPOSAL_STATUSES.has(proposal.status),
  );
  if (received.length > 0) {
    const names = [
      ...new Set(
        received.map(
          (proposal) => providerName.get(proposal.outreachId) ?? "A provider",
        ),
      ),
    ];
    const unreviewed = received.filter(
      (proposal) => proposal.status === "review_ready",
    ).length;
    candidates.push(
      build(scope, {
        signal: "proposals",
        intentId: "review_procurement",
        label:
          names.length > 1
            ? `Compare ${nameList(names, MAX_LABEL - "Compare ".length)}`
            : `Review ${possessive(names[0])} proposal`,
        focus: `${summary}: ${plural(received.length, "proposal")} received from ${names.join(", ")}; ${unreviewed} awaiting review. Compare the proposals and recommend the best next step.`,
        urgency: unreviewed > 0 ? 0.85 : 0.6,
        evidence: {
          proposals: received.length,
          awaitingReview: unreviewed,
          providers: names.length,
        },
      }),
    );
  }

  const openInformation = information.filter((requirement) =>
    OPEN_INFORMATION_STATUSES.has(requirement.status),
  );
  if (openInformation.length > 0) {
    const clarifications = openInformation.filter(
      (requirement) => requirement.status === "clarification_needed",
    ).length;
    const operatorWork = openInformation.filter(
      (requirement) => requirement.status === "operator_work",
    ).length;
    candidates.push(
      build(scope, {
        signal: "information_gaps",
        intentId: "review_procurement",
        label: `${plural(openInformation.length, "information request")} still open`,
        focus: `${summary}: ${plural(openInformation.length, "packet information requirement")} unresolved (${openInformation.length - clarifications - operatorWork} missing, ${clarifications} needing clarification, ${operatorWork} awaiting operator work). Identify what is blocking the packet.`,
        urgency: 0.65,
        evidence: {
          openRequirements: openInformation.length,
          needingClarification: clarifications,
          awaitingOperator: operatorWork,
        },
      }),
    );
  }

  const silent = outreaches
    .flatMap((outreach) => {
      if (outreach.status !== "request_sent" || outreach.sentAt === undefined) {
        return [];
      }
      const days = dayjs(now).diff(dayjs(outreach.sentAt), "day");
      return days >= NO_REPLY_DAYS ? [{ name: outreach.brokerName, days }] : [];
    })
    .sort((a, b) => b.days - a.days);
  if (silent.length > 0) {
    const oldest = silent[0]!;
    candidates.push(
      build(scope, {
        signal: "awaiting_replies",
        intentId: "review_procurement",
        label:
          silent.length === 1
            ? `${oldest.name} hasn't replied in ${oldest.days} days`
            : `${silent.length} providers haven't replied in ${NO_REPLY_DAYS}+ days`,
        focus: `${summary}: no reply yet from ${silent
          .map((item) => `${item.name} (${item.days} days)`)
          .join(", ")}. Check outreach status and recommend follow-up.`,
        urgency: 0.55 + (0.2 * Math.min(oldest.days, 14)) / 14,
        evidence: {
          silentProviders: silent.length,
          longestSilenceDays: oldest.days,
        },
      }),
    );
  }
  return candidates;
}

// ── A single policy ────────────────────────────────────────────────────────

async function policyCandidates(scope: Scope) {
  const { ctx, now } = scope;
  const policyId = ctx.db.normalizeId("policies", scope.entityId);
  const policy = policyId ? await ctx.db.get(policyId) : null;
  if (!policy || policy.deletedAt || policy.dismissed || !policy.orgId) {
    return [];
  }
  const org = await ctx.db.get(policy.orgId);
  if (!org || org.deletedAt !== undefined) return [];
  const candidates: Array<OperatorSuggestionCandidate | null> = [];
  const name = policyName(policy);
  const reference = policyReference(policy) || name;
  const days = daysUntilExpiration(policy, now);

  if (extractionFailed(policy)) {
    candidates.push(
      build(scope, {
        signal: "extraction_failed",
        intentId: "investigate_policy",
        label: `${name} extraction failed`,
        focus: `${reference} for ${org.name}: extraction stopped with status error${policy.pipelineError ? ` (${fit(policy.pipelineError, 160)})` : ""}. Find the cause and the safest recovery.`,
        urgency: 0.8,
        evidence: { extractionFailed: true, daysUntilExpiration: days },
      }),
    );
  }

  const questions = pendingReviewQuestions(policy);
  if (questions.length > 0) {
    const coverageNames = [
      ...new Set(
        questions.flatMap((question) =>
          typeof question.coverageName === "string"
            ? [fit(question.coverageName, 40)]
            : [],
        ),
      ),
    ].slice(0, 5);
    candidates.push(
      build(scope, {
        signal: "uncertain_values",
        intentId: "investigate_policy",
        label: `Review ${plural(questions.length, "uncertain limit")}`,
        focus: `${reference} for ${org.name}: ${plural(questions.length, "extracted value")} awaiting review${coverageNames.length > 0 ? `, covering ${coverageNames.join(", ")}` : ""}. Check each against the source document.`,
        urgency: 0.7,
        evidence: {
          pendingReviewQuestions: questions.length,
          daysUntilExpiration: days,
        },
      }),
    );
  }

  if (extractionFinal(policy) && policyInForce(policy, now)) {
    candidates.push(
      build(scope, {
        signal: "certificate",
        intentId: "prepare_certificate",
        label: `Prepare a certificate for ${name}`,
        focus: `${reference} for ${org.name} is in force${days === null ? "" : ` and expires in ${days} days`}. Prepare a certificate of insurance if one is needed.`,
        urgency: 0.25,
        evidence: { inForce: true, daysUntilExpiration: days },
      }),
    );
  }
  return candidates;
}

// ── Compliance section ─────────────────────────────────────────────────────

async function clientComplianceCandidates(scope: Scope) {
  const { ctx } = scope;
  const org = await loadClient(ctx, scope.entityId);
  if (!org) return [];
  const checks = await ctx.db
    .query("complianceChecks")
    .withIndex("organization_subject", (q) =>
      q.eq("orgId", org._id).eq("subjectOrgId", org._id),
    )
    .order("desc")
    .take(CHECK_SCAN);
  const latest = new Map<
    Id<"insuranceRequirements">,
    Doc<"complianceChecks">
  >();
  for (const check of checks) {
    if (!latest.has(check.requirementId))
      latest.set(check.requirementId, check);
  }
  const issues = [...latest.values()]
    .filter((check) => COMPLIANCE_ISSUE_STATUSES.has(check.status))
    .slice(0, REQUIREMENT_LOOKUPS);
  const requirements = await Promise.all(
    issues.map((check) => ctx.db.get(check.requirementId)),
  );
  const open = issues.flatMap((check, index) => {
    const requirement = requirements[index];
    return requirement?.status === "active" && requirement.orgId === org._id
      ? [{ check, title: requirement.title }]
      : [];
  });
  const count = (status: Doc<"complianceChecks">["status"]) =>
    open.filter((item) => item.check.status === status).length;
  const notMet = count("not_met");
  const expired = count("expired");
  const expiring = count("expiring_soon");
  if (open.length === 0) return [];
  const [label, urgency] =
    notMet > 0
      ? [`${plural(notMet, "requirement")} not met`, 0.8]
      : expired > 0
        ? [`${plural(expired, "requirement")} expired`, 0.75]
        : [`${plural(expiring, "requirement")} expiring soon`, 0.6];
  return [
    build(scope, {
      signal: "requirement_gaps",
      intentId: "prepare_certificate",
      label,
      focus: `${org.name}: ${notMet} not met, ${expired} expired, ${expiring} expiring soon. ${open
        .slice(0, 5)
        .map(
          (item) =>
            `${fit(item.title, 50)} (${item.check.status.replaceAll("_", " ")})`,
        )
        .join(
          "; ",
        )}. Explain the coverage gaps and what certificate can be issued.`,
      urgency,
      evidence: { notMet, expired, expiringSoon: expiring },
    }),
  ];
}

// ── Files section ──────────────────────────────────────────────────────────

async function clientFilesCandidates(scope: Scope) {
  const { ctx } = scope;
  const org = await loadClient(ctx, scope.entityId);
  if (!org) return [];
  const files = await ctx.db
    .query("clientFiles")
    .withIndex("organization", (q) => q.eq("orgId", org._id))
    .order("desc")
    .take(FILE_SCAN);
  const unattachedToPolicy = files.filter(
    (file) => !file.policyId && !file.archivedAt && !file.deletedAt,
  );
  const checked = unattachedToPolicy.slice(0, FILE_ATTACHMENT_CHECKS);
  const requestItems = await Promise.all(
    checked.map((file) =>
      ctx.db
        .query("procurementFileItems")
        .withIndex("file", (q) => q.eq("clientFileId", file._id))
        .first(),
    ),
  );
  const loose = checked.filter(
    (_, index) => !requestItems[index] || requestItems[index]!.removedAt,
  );
  if (loose.length === 0) return [];
  return [
    build(scope, {
      signal: "unattached_files",
      intentId: "review_client_knowledge",
      label: `${plural(loose.length, "file")} not attached to a policy or request`,
      focus: `${org.name}: ${plural(loose.length, "recent client file")} not attached to any policy or procurement request: ${loose
        .slice(0, 5)
        .map((file) => fit(file.name, 40))
        .join(", ")}. Decide where each belongs and what knowledge it adds.`,
      urgency: 0.35,
      evidence: {
        unattachedFiles: loose.length,
        filesScanned: files.length,
      },
    }),
  ];
}

const COLLECTORS: Record<
  string,
  (scope: Scope) => Promise<Array<OperatorSuggestionCandidate | null>>
> = {
  operator_client: clientStateCandidates,
  operator_client_wiki: clientStateCandidates,
  operator_client_policies: clientPoliciesCandidates,
  operator_client_procurement: clientProcurementCandidates,
  operator_client_compliance: clientComplianceCandidates,
  operator_client_files: clientFilesCandidates,
  procurement_request: procurementRequestCandidates,
  policy: policyCandidates,
};

export const collectEntitySuggestionCandidates: CollectEntitySuggestionCandidates =
  async (ctx, { pageContext, now }) => {
    const collect = Object.hasOwn(COLLECTORS, pageContext.pageType)
      ? COLLECTORS[pageContext.pageType]
      : undefined;
    if (!collect || !pageContext.entityId) return [];
    const candidates = await collect({
      ctx,
      now,
      page: pageContext,
      entityId: pageContext.entityId,
    });
    return candidates
      .filter(
        (candidate): candidate is OperatorSuggestionCandidate =>
          candidate !== null,
      )
      .sort((a, b) => b.urgency - a.urgency)
      .slice(0, MAX_CANDIDATES);
  };
