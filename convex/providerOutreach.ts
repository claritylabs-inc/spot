import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { CoverageId } from "../lib/insurance-intake-details";
import {
  assertExternalBrokerIdentity,
  isSpotOwnedBrokerIdentity,
} from "./lib/brokerProfileValidation";
import { requireCompanyRequest } from "./lib/companyRequest";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";
import {
  normalizeProcurementEmail,
  normalizeProcurementSubject,
  uniqueProcurementEmails,
} from "./lib/procurement";
import {
  classifyProvider,
  needAcceptedCodes,
  requestApplicationDetails,
  requestMatchContext,
  selectRecipient,
  type OutreachPlace,
  type ProviderFit,
  type ProviderFitReason,
  type RequestMatchBanner,
  type RequestMatchContext,
} from "./lib/providerOutreachMatch";
import {
  MAX_LAUNCH_PROVIDERS,
  CADENCE_PENDING_TIMEOUT_MS,
  DELIVERY_RETRY_WINDOW_MS,
  IMPERSONATION_DEFER_MS,
  INBOX_EVENT_GIVE_UP_MS,
  INBOX_EVENT_LEASE_MS,
  INBOX_EVENT_MAPPING_WINDOW_MS,
  INBOX_EVENT_RETRY_MS,
  LAUNCH_STAGGER_MS,
  MAX_CONTACTS_PER_PROVIDER,
  MAX_PANEL_PROVIDERS,
  MAX_PANEL_SEQUENCES,
  MAX_STEP_ATTEMPTS,
  REPLY_CHECK_TIMEOUT_MS,
  STEP_LEASE_MS,
  THREAD_WAIT_LIMIT_MS,
  cadencePicksValidator,
  inboxAttachmentValidator,
  inboxEmailValidator,
  inboxEventTypeValidator,
  inboxRecordValidator,
  outreachCadenceSourceValidator,
  outreachCadenceValidator,
  replyClassificationValidator,
  stepDraftValidator,
  stepFailureValidator,
  stepFinishOutcomeValidator,
  type InboxEmail,
  type InboxRecord,
  type OutreachCadenceInput,
  type OutreachCadenceSource,
  type StepDraft,
} from "./lib/providerOutreachValidators";
import {
  MAX_OUTREACH_FOLLOW_UPS,
  OUTREACH_DEFAULT_CADENCE,
  addBusinessDays,
  buildOutreachSchedule,
  recomputeScheduleAfterSend,
} from "./lib/providerOutreachSchedule";
import { getClientPortalUrl } from "./lib/domains";
import {
  createProcurementOutreachByOperator,
  insertProcurementEmailFileItems,
  requireDirectOperatorWrite,
  storeProcurementEmailAttachments,
} from "./procurementRequests";
import { mintPacketLinkForOperator, previewBrokerPacket } from "./procurementPacket";

type Ctx = QueryCtx | MutationCtx;
type Sequence = Doc<"procurementOutreachSequences">;
type Step = Doc<"procurementOutreachSteps">;
type SequenceStatus = Sequence["status"];

const LIVE_SEQUENCE_STATUSES: readonly SequenceStatus[] = ["active", "reply_check"];
const SEQUENCE_STATUSES: readonly SequenceStatus[] = [
  "active",
  "reply_check",
  "responded",
  "completed",
  "stopped",
  "failed",
];
const MAX_STEPS_PER_SEQUENCE = 10;
const SHORT_TEXT = 500;

function isLive(status: SequenceStatus) {
  return LIVE_SEQUENCE_STATUSES.includes(status);
}
function shorten(value: string, max = SHORT_TEXT) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function stepDone(step: Pick<Step, "status">) {
  return step.status === "sent" || step.status === "captured";
}

// ---------------------------------------------------------------------------
// Request, matching and candidates
// ---------------------------------------------------------------------------

async function loadCompanyRequest(ctx: Ctx, requestId: Id<"procurementRequests">) {
  const request = await ctx.db.get(requestId);
  requireCompanyRequest(request);
  const client = await ctx.db.get(request.clientOrgId);
  if (!client || client.deletedAt !== undefined || client.type !== "client")
    throw new Error("Client organization not found");
  return { request, client };
}

function closedReason(request: Doc<"procurementRequests">) {
  if (request.deletedAt) return "request_deleted" as const;
  if (request.status === "cancelled") return "request_cancelled" as const;
  if (request.status === "completed") return "request_completed" as const;
  return null;
}

function matchFor(
  request: Doc<"procurementRequests">,
  client: Doc<"organizations">,
): RequestMatchContext {
  return requestMatchContext(requestApplicationDetails(request, client));
}

/** Stable text for a request's cadence-relevant facts; a change re-runs the suggestion. */
function cadenceFingerprint(
  request: Doc<"procurementRequests">,
  match: RequestMatchContext,
) {
  return JSON.stringify([
    match.needs.needs.map((need) => need.coverage).sort(),
    match.needs.unevaluated.slice().sort(),
    request.targetEffectiveDate ?? null,
    match.geography.places
      .map((place) => `${place.country}:${place.region ?? ""}`)
      .sort(),
  ]);
}

type RecipientView = {
  contactId: Id<"brokerContacts"> | null;
  email: string;
  name: string | null;
  role: Doc<"brokerContacts">["role"] | null;
  source: "outreach" | "contact";
};
type ProviderEvaluation = {
  org: Doc<"organizations">;
  profile: Doc<"brokerProfiles"> | null;
  fit: ProviderFit;
  recipient: RecipientView | null;
  skipReason: "no_contact_email" | "spot_owned_contact" | null;
};

async function loadProfile(ctx: Ctx, brokerOrgId: Id<"organizations">) {
  return await ctx.db
    .query("brokerProfiles")
    .withIndex("broker", (q) => q.eq("brokerOrgId", brokerOrgId))
    .first();
}

/** Alive, external provider organization; otherwise null. */
function eligibleProviderOrg(org: Doc<"organizations"> | null) {
  if (!org || org.deletedAt !== undefined || org.type !== "broker") return null;
  return isSpotOwnedBrokerIdentity(org) ? null : org;
}

async function evaluateProvider(
  ctx: Ctx,
  org: Doc<"organizations">,
  match: RequestMatchContext,
  outreach: Doc<"procurementBrokerOutreaches"> | null,
  withContacts: boolean,
): Promise<ProviderEvaluation> {
  const profile = await loadProfile(ctx, org._id);
  const fit = classifyProvider(profile, match.geography, match.needs);
  if (!withContacts || fit.verdict === "excluded")
    return { org, profile, fit, recipient: null, skipReason: null };
  const contacts = await ctx.db
    .query("brokerContacts")
    .withIndex("by_brokerOrgId_and_deletedAt", (q) =>
      q.eq("brokerOrgId", org._id).eq("deletedAt", undefined),
    )
    .take(MAX_CONTACTS_PER_PROVIDER);
  const selection = selectRecipient(
    contacts,
    needAcceptedCodes(match.needs.needs),
    outreach,
    org,
  );
  if (!selection.ok)
    return { org, profile, fit, recipient: null, skipReason: selection.reason };
  // Matching returns a plain string; resolve it back to the typed document id.
  const contact = contacts.find((row) => row._id === selection.recipient.contactId);
  return {
    org,
    profile,
    fit,
    recipient: {
      contactId: contact?._id ?? null,
      email: selection.recipient.email,
      name: selection.recipient.name ?? null,
      role: selection.recipient.role ?? null,
      source: selection.recipient.source,
    },
    skipReason: null,
  };
}

/** The persisted recipient shape: no source/role, no undefined fields. */
function storedRecipient(recipient: RecipientView): Sequence["recipient"] {
  return {
    ...(recipient.contactId ? { contactId: recipient.contactId } : {}),
    email: recipient.email,
    ...(recipient.name ? { name: recipient.name } : {}),
  };
}

type LaunchBlock =
  | "excluded"
  | "unknown_fit_requires_explicit_selection"
  | "sequence_exists"
  | "outreach_status_progressed"
  | "no_contact_email"
  | "spot_owned_contact";

function launchBlock(args: {
  evaluation: ProviderEvaluation;
  outreach: Doc<"procurementBrokerOutreaches"> | null;
  hasLiveSequence: boolean;
  matchedOnly: boolean;
}): LaunchBlock | null {
  const { verdict } = args.evaluation.fit;
  if (verdict === "excluded") return "excluded";
  if (verdict === "unknown" && args.matchedOnly)
    return "unknown_fit_requires_explicit_selection";
  if (args.hasLiveSequence) return "sequence_exists";
  if (
    args.outreach &&
    args.outreach.status !== "observed" &&
    args.outreach.status !== "request_sent"
  )
    return "outreach_status_progressed";
  return args.evaluation.skipReason;
}

async function sequencesForOutreach(ctx: Ctx, outreachId: Id<"procurementBrokerOutreaches">) {
  return await ctx.db
    .query("procurementOutreachSequences")
    .withIndex("by_outreachId", (q) => q.eq("outreachId", outreachId))
    .take(50);
}
function blocksRelaunch(status: SequenceStatus) {
  return status === "active" || status === "reply_check" || status === "responded";
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

type PlaceView = { country: string; region?: string };
function placeView(place: OutreachPlace): PlaceView {
  return place.region
    ? { country: place.country, region: place.region }
    : { country: place.country };
}

export type ProviderCandidateView = {
  brokerOrgId: Id<"organizations">;
  name: string;
  website: string | null;
  networkStatus: Doc<"brokerProfiles">["networkStatus"] | null;
  verdict: ProviderFit["verdict"];
  partial: boolean;
  reasons: ProviderFitReason[];
  lines: { covered: CoverageId[]; missing: CoverageId[] };
  geography: { serviced: PlaceView[]; unserviced: PlaceView[] };
  recipient: RecipientView | null;
  skipReason: ProviderEvaluation["skipReason"];
  launchBlock: LaunchBlock | null;
  outreach: {
    outreachId: Id<"procurementBrokerOutreaches">;
    status: Doc<"procurementBrokerOutreaches">["status"];
    sentAt: number | null;
    contactEmail: string | null;
  } | null;
  sequenceId: Id<"procurementOutreachSequences"> | null;
};

export type SequenceStepView = {
  stepId: Id<"procurementOutreachSteps">;
  index: number;
  kind: Step["kind"];
  isFinal: boolean;
  dueAt: number;
  status: Step["status"];
  attempts: number;
  sentAt: number | null;
  error: string | null;
};
export type SequenceView = {
  sequenceId: Id<"procurementOutreachSequences">;
  outreachId: Id<"procurementBrokerOutreaches">;
  brokerOrgId: Id<"organizations">;
  status: SequenceStatus;
  stopReason: string | null;
  recipient: Sequence["recipient"];
  cadence: Sequence["cadence"];
  cadenceSource: Sequence["cadenceSource"];
  senderUserId: Id<"users">;
  inboxId: string | null;
  resendThreadId: string | null;
  procurementEmailThreadId: Id<"procurementEmailThreads"> | null;
  replyPending: boolean;
  respondedAt: number | null;
  nextDueAt: number | null;
  createdAt: number;
  updatedAt: number;
  steps: SequenceStepView[];
};

function sequenceView(sequence: Sequence, steps: Step[]): SequenceView {
  const next = isLive(sequence.status)
    ? steps.find((step) => step.status === "scheduled" || step.status === "sending")
    : undefined;
  return {
    sequenceId: sequence._id,
    outreachId: sequence.outreachId,
    brokerOrgId: sequence.brokerOrgId,
    status: sequence.status,
    stopReason: sequence.stopReason ?? null,
    recipient: sequence.recipient,
    cadence: sequence.cadence,
    cadenceSource: sequence.cadenceSource,
    senderUserId: sequence.senderUserId,
    inboxId: sequence.inboxId ?? null,
    resendThreadId: sequence.resendThreadId ?? null,
    procurementEmailThreadId: sequence.procurementEmailThreadId ?? null,
    replyPending: sequence.status === "reply_check",
    respondedAt: sequence.respondedAt ?? null,
    nextDueAt: next?.dueAt ?? null,
    createdAt: sequence.createdAt,
    updatedAt: sequence.updatedAt,
    steps: steps.map((step) => ({
      stepId: step._id,
      index: step.index,
      kind: step.kind,
      isFinal: step.isFinal,
      dueAt: step.dueAt,
      status: step.status,
      attempts: step.attempts,
      sentAt: step.sentAt ?? null,
      error: step.error ?? null,
    })),
  };
}

async function requestSequences(ctx: Ctx, requestId: Id<"procurementRequests">) {
  const perStatus = Math.ceil(MAX_PANEL_SEQUENCES / 2);
  const groups = await Promise.all(
    SEQUENCE_STATUSES.map((status) =>
      ctx.db
        .query("procurementOutreachSequences")
        .withIndex("by_requestId_and_status", (q) =>
          q.eq("requestId", requestId).eq("status", status),
        )
        .order("desc")
        .take(perStatus + 1),
    ),
  );
  const bounded = groups.some((rows) => rows.length > perStatus);
  const rows = groups
    .flatMap((group) => group.slice(0, perStatus))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PANEL_SEQUENCES);
  return { rows, bounded: bounded || groups.flat().length > MAX_PANEL_SEQUENCES };
}

function cadenceView(
  row: Doc<"procurementOutreachCadences"> | null,
  fingerprint: string,
) {
  return row
    ? {
        cadenceId: row._id,
        status: row.status,
        current: row.fingerprint === fingerprint,
        picks: row.picks ?? null,
        updatedAt: row.updatedAt,
      }
    : null;
}

export type ProviderOutreachPanel = {
  request: {
    requestId: Id<"procurementRequests">;
    title: string;
    status: Doc<"procurementRequests">["status"];
    targetEffectiveDate: string | null;
    closedReason: ReturnType<typeof closedReason>;
    canLaunch: boolean;
  };
  geography: {
    places: PlaceView[];
    primary: PlaceView | null;
    fromRegistration: boolean;
  };
  needs: {
    lines: { coverage: CoverageId; label: string }[];
    unevaluated: CoverageId[];
  };
  banners: RequestMatchBanner[];
  cadence: ReturnType<typeof cadenceView>;
  defaultCadence: OutreachCadenceInput;
  candidates: {
    matched: ProviderCandidateView[];
    unknown: ProviderCandidateView[];
    excluded: ProviderCandidateView[];
  };
  providersBounded: boolean;
  sequences: SequenceView[];
  sequencesBounded: boolean;
};

/** Reads the matching, cadence and sequence state for a request. Caller authorizes the operator. */
export async function getProviderOutreachPanel(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
): Promise<ProviderOutreachPanel | null> {
  let loaded: Awaited<ReturnType<typeof loadCompanyRequest>>;
  try {
    loaded = await loadCompanyRequest(ctx, requestId);
  } catch {
    return null;
  }
  const { request, client } = loaded;
  const match = matchFor(request, client);
  const [orgs, outreaches, cadenceRow, sequences] = await Promise.all([
    ctx.db
      .query("organizations")
      .withIndex("deletion_type", (q) => q.eq("deletedAt", undefined).eq("type", "broker"))
      .take(MAX_PANEL_PROVIDERS + 1),
    ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .take(MAX_PANEL_PROVIDERS),
    ctx.db
      .query("procurementOutreachCadences")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .first(),
    requestSequences(ctx, requestId),
  ]);
  const outreachByBroker = new Map<Id<"organizations">, Doc<"procurementBrokerOutreaches">>();
  for (const outreach of outreaches)
    if (outreach.brokerOrgId && !outreachByBroker.has(outreach.brokerOrgId))
      outreachByBroker.set(outreach.brokerOrgId, outreach);

  const stepsBySequence = new Map<Id<"procurementOutreachSequences">, Step[]>();
  await Promise.all(
    sequences.rows.map(async (sequence) =>
      stepsBySequence.set(
        sequence._id,
        await ctx.db
          .query("procurementOutreachSteps")
          .withIndex("by_sequenceId_and_index", (q) => q.eq("sequenceId", sequence._id))
          .take(MAX_STEPS_PER_SEQUENCE),
      ),
    ),
  );
  const latestByOutreach = new Map<Id<"procurementBrokerOutreaches">, Sequence>();
  for (const sequence of sequences.rows) {
    const known = latestByOutreach.get(sequence.outreachId);
    // A live or handed-off sequence outranks a newer finished one.
    if (
      !known ||
      (blocksRelaunch(sequence.status) && !blocksRelaunch(known.status)) ||
      (blocksRelaunch(sequence.status) === blocksRelaunch(known.status) &&
        sequence.createdAt > known.createdAt)
    )
      latestByOutreach.set(sequence.outreachId, sequence);
  }

  const candidates: ProviderCandidateView[] = [];
  for (const org of orgs.slice(0, MAX_PANEL_PROVIDERS)) {
    if (!eligibleProviderOrg(org)) continue;
    const outreach = outreachByBroker.get(org._id) ?? null;
    const evaluation = await evaluateProvider(ctx, org, match, outreach, true);
    const sequence = outreach ? (latestByOutreach.get(outreach._id) ?? null) : null;
    candidates.push({
      brokerOrgId: org._id,
      name: org.name,
      website: org.website ?? null,
      networkStatus: evaluation.profile?.networkStatus ?? null,
      verdict: evaluation.fit.verdict,
      partial: evaluation.fit.partial,
      reasons: evaluation.fit.reasons,
      lines: {
        covered: evaluation.fit.lines.covered.map((need) => need.coverage),
        missing: evaluation.fit.lines.missing.map((need) => need.coverage),
      },
      geography: {
        serviced: evaluation.fit.geography.serviced.map(placeView),
        unserviced: evaluation.fit.geography.unserviced.map(placeView),
      },
      recipient: evaluation.recipient,
      skipReason: evaluation.skipReason,
      launchBlock: launchBlock({
        evaluation,
        outreach,
        hasLiveSequence: !!sequence && blocksRelaunch(sequence.status),
        matchedOnly: false,
      }),
      outreach: outreach
        ? {
            outreachId: outreach._id,
            status: outreach.status,
            sentAt: outreach.sentAt ?? null,
            contactEmail: outreach.contactEmail ?? null,
          }
        : null,
      sequenceId: sequence?._id ?? null,
    });
  }
  candidates.sort(
    (a, b) => Number(a.partial) - Number(b.partial) || a.name.localeCompare(b.name),
  );
  const reason = closedReason(request);
  return {
    request: {
      requestId: request._id,
      title: request.title,
      status: request.status,
      targetEffectiveDate: request.targetEffectiveDate ?? null,
      closedReason: reason,
      canLaunch: reason === null,
    },
    geography: {
      places: match.geography.places.map(placeView),
      primary: match.geography.primary ? placeView(match.geography.primary) : null,
      fromRegistration: match.geography.fromRegistration,
    },
    needs: {
      lines: match.needs.needs.map((need) => ({
        coverage: need.coverage,
        label: need.label,
      })),
      unevaluated: match.needs.unevaluated,
    },
    banners: match.banners,
    cadence: cadenceView(cadenceRow, cadenceFingerprint(request, match)),
    defaultCadence: { ...OUTREACH_DEFAULT_CADENCE },
    candidates: {
      matched: candidates.filter((row) => row.verdict === "matched"),
      unknown: candidates.filter((row) => row.verdict === "unknown"),
      excluded: candidates.filter((row) => row.verdict === "excluded"),
    },
    providersBounded: orgs.length > MAX_PANEL_PROVIDERS,
    sequences: sequences.rows.map((sequence) =>
      sequenceView(sequence, stepsBySequence.get(sequence._id) ?? []),
    ),
    sequencesBounded: sequences.bounded,
  };
}

export const getPanel = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }): Promise<ProviderOutreachPanel | null> => {
    await requireOperator(ctx);
    return await getProviderOutreachPanel(ctx, requestId);
  },
});

// ---------------------------------------------------------------------------
// Sequence terminal states
// ---------------------------------------------------------------------------

/**
 * Moves a sequence to a terminal or handed-off status and cancels its
 * unfinished steps (`scheduled` and `sending`). A cancelled `sending` step is
 * final: its lease token is gone, so a late worker cannot record it.
 */
async function terminalizeSequence(
  ctx: MutationCtx,
  sequence: Sequence,
  args: {
    status: "stopped" | "failed" | "responded" | "completed";
    reason: string;
    now: number;
    keepStepId?: Id<"procurementOutreachSteps">;
  },
) {
  const steps = await ctx.db
    .query("procurementOutreachSteps")
    .withIndex("by_sequenceId_and_index", (q) => q.eq("sequenceId", sequence._id))
    .take(MAX_STEPS_PER_SEQUENCE);
  let cancelled = 0;
  for (const step of steps) {
    if (step._id === args.keepStepId) continue;
    if (step.status !== "scheduled" && step.status !== "sending") continue;
    await ctx.db.patch(step._id, {
      status: "cancelled",
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: args.now,
    });
    cancelled += 1;
  }
  await ctx.db.patch(sequence._id, {
    status: args.status,
    stopReason: shorten(args.reason, 200),
    pendingReplyEmailId: undefined,
    replyCheckStartedAt: undefined,
    ...(args.status === "responded" ? { respondedAt: args.now } : {}),
    updatedAt: args.now,
  });
  return cancelled;
}

export async function stopProviderOutreachByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId?: Id<"procurementRequests">;
    sequenceId: Id<"procurementOutreachSequences">;
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const sequence = await ctx.db.get(args.sequenceId);
  if (!sequence || (args.requestId && sequence.requestId !== args.requestId))
    throw new Error("Outreach sequence not found");
  const { request } = await loadCompanyRequest(ctx, sequence.requestId);
  if (!isLive(sequence.status))
    return { sequenceId: sequence._id, status: sequence.status, cancelledStepCount: 0, stopped: false };
  const now = dayjs().valueOf();
  const cancelledStepCount = await terminalizeSequence(ctx, sequence, {
    status: "stopped",
    reason: "operator_stopped",
    now,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Stopped provider outreach sequence on ${request.title}`,
    metadata: {
      domain: "procurement",
      operation: "stop_provider_outreach",
      requestId: request._id,
      outreachId: sequence.outreachId,
      sequenceId: sequence._id,
      cancelledStepCount,
    },
  });
  return { sequenceId: sequence._id, status: "stopped" as const, cancelledStepCount, stopped: true };
}

export const stop = mutation({
  args: { sequenceId: v.id("procurementOutreachSequences") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await stopProviderOutreachByOperator(ctx, {
      operatorUserId: operator.userId,
      sequenceId: args.sequenceId,
    });
  },
});

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

export type LaunchSkipReason =
  | LaunchBlock
  | "provider_not_found"
  | "duplicate_selection";
export type ProviderOutreachLaunchResult = {
  launched: {
    brokerOrgId: Id<"organizations">;
    brokerName: string;
    outreachId: Id<"procurementBrokerOutreaches">;
    sequenceId: Id<"procurementOutreachSequences">;
    packetLinkId: Id<"procurementPacketLinks">;
    stepCount: number;
    droppedFollowUps: number;
  }[];
  skipped: {
    brokerOrgId: Id<"organizations">;
    brokerName: string | null;
    reason: LaunchSkipReason;
    detail: ProviderFitReason[];
  }[];
};

function validatedCadence(cadence: OutreachCadenceInput): OutreachCadenceInput {
  if (
    !Number.isInteger(cadence.followUpCount) ||
    cadence.followUpCount < 0 ||
    cadence.followUpCount > MAX_OUTREACH_FOLLOW_UPS
  )
    throw new Error(`Follow-ups must be 0 to ${MAX_OUTREACH_FOLLOW_UPS}`);
  if (
    !Number.isInteger(cadence.intervalBusinessDays) ||
    cadence.intervalBusinessDays < 1 ||
    cadence.intervalBusinessDays > 14
  )
    throw new Error("Interval must be 1 to 14 business days");
  return {
    followUpCount: cadence.followUpCount,
    intervalBusinessDays: cadence.intervalBusinessDays,
    style: cadence.style,
  };
}

export async function launchProviderOutreachByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    brokerOrgIds: Id<"organizations">[];
    cadence: OutreachCadenceInput;
    cadenceSource: OutreachCadenceSource;
    /** Send-all: unknown-fit providers are skipped even when named. */
    matchedOnly?: boolean;
  },
): Promise<ProviderOutreachLaunchResult> {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const brokerOrgIds = [...new Set(args.brokerOrgIds)];
  if (!brokerOrgIds.length || brokerOrgIds.length > MAX_LAUNCH_PROVIDERS)
    throw new Error(`Select one to ${MAX_LAUNCH_PROVIDERS} providers`);
  const cadence = validatedCadence(args.cadence);
  const { request, client } = await loadCompanyRequest(ctx, args.requestId);
  const closed = closedReason(request);
  if (closed) throw new Error("Procurement request is closed");
  const match = matchFor(request, client);
  const now = dayjs().valueOf();
  const result: ProviderOutreachLaunchResult = { launched: [], skipped: [] };
  const seen = new Set<Id<"organizations">>();

  for (const requestedId of args.brokerOrgIds) {
    if (seen.has(requestedId)) {
      result.skipped.push({
        brokerOrgId: requestedId,
        brokerName: null,
        reason: "duplicate_selection",
        detail: [],
      });
      continue;
    }
    seen.add(requestedId);
    const org = eligibleProviderOrg(await ctx.db.get(requestedId));
    if (!org) {
      result.skipped.push({
        brokerOrgId: requestedId,
        brokerName: null,
        reason: "provider_not_found",
        detail: [],
      });
      continue;
    }
    const outreach =
      (
        await ctx.db
          .query("procurementBrokerOutreaches")
          .withIndex("request_broker", (q) =>
            q.eq("requestId", request._id).eq("brokerOrgId", org._id),
          )
          .take(1)
      )[0] ?? null;
    const sequences = outreach ? await sequencesForOutreach(ctx, outreach._id) : [];
    const evaluation = await evaluateProvider(ctx, org, match, outreach, true);
    const blocked = launchBlock({
      evaluation,
      outreach,
      hasLiveSequence: sequences.some((row) => blocksRelaunch(row.status)),
      matchedOnly: args.matchedOnly === true,
    });
    if (blocked || !evaluation.recipient) {
      result.skipped.push({
        brokerOrgId: org._id,
        brokerName: org.name,
        reason: blocked ?? "no_contact_email",
        detail: evaluation.fit.reasons,
      });
      continue;
    }
    // Defensive: a recipient must always clear the external-identity gate.
    assertExternalBrokerIdentity({ ...org, email: evaluation.recipient.email });

    const recipient = evaluation.recipient;
    let outreachId: Id<"procurementBrokerOutreaches">;
    if (outreach) {
      outreachId = outreach._id;
      await ctx.db.patch(outreach._id, {
        status: "request_sent",
        contactEmail: recipient.email,
        ...(recipient.name && !outreach.contactName ? { contactName: recipient.name } : {}),
        updatedByUserId: args.operatorUserId,
        updatedAt: now,
      });
    } else {
      ({ outreachId } = await createProcurementOutreachByOperator(ctx, {
        operatorUserId: args.operatorUserId,
        requestId: request._id,
        brokerOrgId: org._id,
        contactEmail: recipient.email,
        contactName: recipient.name ?? undefined,
        status: "request_sent",
        deferSentAt: true,
        source: "operator",
      }));
    }
    const link = await mintPacketLinkForOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: request._id,
      outreachId,
      recipientLabel: org.name,
      recipientEmail: recipient.email,
    });
    const schedule = buildOutreachSchedule({
      launchAt: now,
      cadence,
      limits: { effectiveDate: request.targetEffectiveDate },
    });
    const sequenceId = await ctx.db.insert("procurementOutreachSequences", {
      requestId: request._id,
      clientOrgId: request.clientOrgId,
      outreachId,
      brokerOrgId: org._id,
      recipient: storedRecipient(recipient),
      senderUserId: args.operatorUserId,
      packetLinkId: link.id,
      cadence,
      cadenceSource: args.cadenceSource,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const stepIds: Id<"procurementOutreachSteps">[] = [];
    for (const step of schedule.steps)
      stepIds.push(
        await ctx.db.insert("procurementOutreachSteps", {
          sequenceId,
          index: step.index,
          kind: step.kind,
          isFinal: step.isFinal,
          dueAt: step.dueAt,
          status: "scheduled",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        }),
      );
    await ctx.scheduler.runAfter(
      result.launched.length * LAUNCH_STAGGER_MS,
      internal.actions.providerOutreach.sendStep,
      { stepId: stepIds[0] },
    );
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: request.clientOrgId,
      summary: `Launched provider outreach to ${org.name} for ${request.title}`,
      metadata: {
        domain: "procurement",
        operation: "launch_provider_outreach",
        requestId: request._id,
        outreachId,
        sequenceId,
        brokerOrgId: org._id,
        packetLinkId: link.id,
        verdict: evaluation.fit.verdict,
        partial: evaluation.fit.partial,
        recipientDomain: recipient.email.split("@")[1] ?? null,
        recipientContactId: recipient.contactId,
        cadence,
        cadenceSource: args.cadenceSource,
        stepCount: schedule.steps.length,
      },
    });
    result.launched.push({
      brokerOrgId: org._id,
      brokerName: org.name,
      outreachId,
      sequenceId,
      packetLinkId: link.id,
      stepCount: schedule.steps.length,
      droppedFollowUps: schedule.droppedFollowUps,
    });
  }
  return result;
}

export const launch = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    brokerOrgIds: v.array(v.id("organizations")),
    cadence: outreachCadenceValidator,
    cadenceSource: outreachCadenceSourceValidator,
    matchedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ProviderOutreachLaunchResult> => {
    const operator = await requireOperator(ctx);
    return await launchProviderOutreachByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});

// ---------------------------------------------------------------------------
// Cadence suggestion
// ---------------------------------------------------------------------------

export const requestCadenceSuggestion = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    const { request, client } = await loadCompanyRequest(ctx, requestId);
    if (closedReason(request)) throw new Error("Procurement request is closed");
    const fingerprint = cadenceFingerprint(request, matchFor(request, client));
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("procurementOutreachCadences")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .first();
    // The suggestion for these facts already exists, is running, or failed:
    // a router outcome is never replayed for an unchanged fingerprint.
    if (existing?.fingerprint === fingerprint)
      return { cadenceId: existing._id, status: existing.status, scheduled: false };
    let cadenceId: Id<"procurementOutreachCadences">;
    if (existing) {
      cadenceId = existing._id;
      await ctx.db.patch(existing._id, {
        fingerprint,
        status: "pending",
        picks: undefined,
        updatedAt: now,
      });
    } else {
      cadenceId = await ctx.db.insert("procurementOutreachCadences", {
        requestId,
        fingerprint,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.suggestCadence, {
      cadenceId,
    });
    return { cadenceId, status: "pending" as const, scheduled: true };
  },
});

/** Facts for the Jev cadence call; null when the row is stale or no longer pending. */
export const getCadenceInputInternal = internalQuery({
  args: { cadenceId: v.id("procurementOutreachCadences") },
  handler: async (ctx, { cadenceId }) => {
    const row = await ctx.db.get(cadenceId);
    if (!row || row.status !== "pending") return null;
    let loaded: Awaited<ReturnType<typeof loadCompanyRequest>>;
    try {
      loaded = await loadCompanyRequest(ctx, row.requestId);
    } catch {
      return null;
    }
    const { request, client } = loaded;
    const match = matchFor(request, client);
    if (cadenceFingerprint(request, match) !== row.fingerprint) return null;
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("deletion_type", (q) => q.eq("deletedAt", undefined).eq("type", "broker"))
      .take(MAX_PANEL_PROVIDERS);
    let matchedCount = 0;
    for (const org of orgs) {
      if (!eligibleProviderOrg(org)) continue;
      const evaluation = await evaluateProvider(ctx, org, match, null, false);
      if (evaluation.fit.verdict === "matched") matchedCount += 1;
    }
    const packet = await previewBrokerPacket(ctx, { requestId: request._id });
    const effective = request.targetEffectiveDate
      ? dayjs(request.targetEffectiveDate)
      : null;
    return {
      cadenceId: row._id,
      requestId: request._id,
      fingerprint: row.fingerprint,
      title: request.title,
      lines: match.needs.needs.map((need) => need.label),
      unevaluatedLines: match.needs.unevaluated,
      effectiveDate: request.targetEffectiveDate ?? null,
      daysRemaining:
        effective?.isValid() ? effective.startOf("day").diff(dayjs().startOf("day"), "day") : null,
      places: match.geography.places.map(placeView),
      packetFileCount: packet.files.length,
      matchedCount,
      isRenewal: !!request.replacingPolicyId,
    };
  },
});

/** Stores the suggestion only if the row is still pending for the same fingerprint. */
export const finishCadenceInternal = internalMutation({
  args: {
    cadenceId: v.id("procurementOutreachCadences"),
    fingerprint: v.string(),
    picks: cadencePicksValidator,
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.cadenceId);
    if (!row || row.status !== "pending" || row.fingerprint !== args.fingerprint)
      return { applied: false as const };
    await ctx.db.patch(row._id, {
      status: "ready",
      picks: args.picks,
      updatedAt: dayjs().valueOf(),
    });
    return { applied: true as const };
  },
});

export const failCadenceInternal = internalMutation({
  args: { cadenceId: v.id("procurementOutreachCadences"), fingerprint: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.cadenceId);
    if (!row || row.status !== "pending" || row.fingerprint !== args.fingerprint)
      return { applied: false as const };
    await ctx.db.patch(row._id, { status: "failed", updatedAt: dayjs().valueOf() });
    return { applied: true as const };
  },
});

// ---------------------------------------------------------------------------
// Step world checks, claim and fenced transitions
// ---------------------------------------------------------------------------

type StepWorld = {
  request: Doc<"procurementRequests">;
  client: Doc<"organizations">;
  outreach: Doc<"procurementBrokerOutreaches">;
  broker: Doc<"organizations">;
  link: Doc<"procurementPacketLinks"> & { token: string };
  sender: Doc<"users"> | null;
  previous: Step | null;
};
type WorldCheck =
  | { kind: "ok"; world: StepWorld }
  | { kind: "stop"; reason: string }
  | { kind: "skip"; reason: string }
  | { kind: "defer"; reason: string; runAt: number };

/**
 * The single revalidation used at claim and again immediately before the
 * network send. It never writes.
 */
async function checkStepWorld(
  ctx: Ctx,
  step: Step,
  sequence: Sequence,
  now: number,
): Promise<WorldCheck> {
  if (sequence.status !== "active")
    return { kind: "skip", reason: `sequence_${sequence.status}` };
  const request = await ctx.db.get(sequence.requestId);
  if (!request) return { kind: "stop", reason: "request_deleted" };
  const requestClosed = closedReason(request);
  if (requestClosed) return { kind: "stop", reason: requestClosed };
  if (request.intakeAnswers?.intakeGoal === "savings" || request.clientOrgId !== sequence.clientOrgId)
    return { kind: "stop", reason: "request_unavailable" };
  const client = await ctx.db.get(sequence.clientOrgId);
  if (!client || client.deletedAt !== undefined || client.type !== "client")
    return { kind: "stop", reason: "client_unavailable" };
  const outreach = await ctx.db.get(sequence.outreachId);
  if (!outreach || outreach.requestId !== request._id)
    return { kind: "stop", reason: "outreach_removed" };
  if (outreach.status !== "request_sent")
    return { kind: "stop", reason: "outreach_status_changed" };
  const proposal = await ctx.db
    .query("procurementProposals")
    .withIndex("outreach", (q) => q.eq("outreachId", outreach._id))
    .first();
  if (proposal) return { kind: "stop", reason: "proposal_filed" };

  const broker = eligibleProviderOrg(await ctx.db.get(sequence.brokerOrgId));
  if (!broker || outreach.brokerOrgId !== broker._id)
    return { kind: "stop", reason: "provider_unavailable" };
  const profile = await loadProfile(ctx, broker._id);
  if (profile?.networkStatus === "blacklisted" || profile?.networkStatus === "inactive")
    return { kind: "stop", reason: "provider_ineligible" };
  try {
    assertExternalBrokerIdentity({ ...broker, email: sequence.recipient.email });
  } catch {
    return { kind: "stop", reason: "recipient_ineligible" };
  }
  // The first email re-checks fit; follow-ups only the hard exclusions above.
  if (step.index === 0) {
    const match = matchFor(request, client);
    if (classifyProvider(profile, match.geography, match.needs).verdict === "excluded")
      return { kind: "stop", reason: "no_longer_matched" };
  }

  const link = await ctx.db.get(sequence.packetLinkId);
  if (
    !link ||
    link.requestId !== request._id ||
    link.outreachId !== outreach._id ||
    link.revokedAt !== undefined ||
    (link.expiresAt !== undefined && link.expiresAt <= now) ||
    !link.token
  )
    return { kind: "stop", reason: "packet_link_unavailable" };

  const profileRow = await ctx.db
    .query("operatorProfiles")
    .withIndex("user", (q) => q.eq("userId", sequence.senderUserId))
    .first();
  if (profileRow?.status !== "active") return { kind: "stop", reason: "sender_inactive" };
  const impersonating = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (q) =>
      q.eq("operatorUserId", sequence.senderUserId).eq("status", "active"),
    )
    .first();
  if (impersonating)
    return {
      kind: "defer",
      reason: "sender_impersonating",
      runAt: now + IMPERSONATION_DEFER_MS,
    };

  let previous: Step | null = null;
  if (step.index > 0) {
    previous = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_sequenceId_and_index", (q) =>
        q.eq("sequenceId", sequence._id).eq("index", step.index - 1),
      )
      .unique();
    // Never overtake an unsent predecessor (initial or earlier follow-up).
    if (!previous || !stepDone(previous))
      return { kind: "skip", reason: "predecessor_pending" };
  }
  return {
    kind: "ok",
    world: {
      request,
      client,
      outreach,
      broker,
      link: { ...link, token: link.token },
      sender: await ctx.db.get(sequence.senderUserId),
      previous,
    },
  };
}

async function inboxForUser(ctx: Ctx, userId: Id<"users">): Promise<InboxRecord | null> {
  const row = await ctx.db
    .query("operatorOutreachInboxes")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return row
    ? {
        inboxId: row.inboxId,
        emailAddress: row.emailAddress,
        fromName: row.fromName,
        labelIds: row.labelIds,
      }
    : null;
}

export type ClaimStepResult =
  | {
      status: "claimed";
      leaseToken: string;
      leaseUntil: number;
      /** The lease of an earlier attempt expired: its outcome is unknown. Reuse the saved draft, draft id and idempotency keys. */
      recovered: boolean;
      /** A real (non-captured) predecessor was sent: the reply needs `resendThreadId` and `lastOutboundEmailId`. */
      threadRequired: boolean;
      step: {
        stepId: Id<"procurementOutreachSteps">;
        index: number;
        kind: Step["kind"];
        isFinal: boolean;
        dueAt: number;
        attempts: number;
        firstAttemptAt: number;
        draft: StepDraft | null;
        generationStartedAt: number | null;
        resendDraftId: string | null;
      };
      sequence: {
        sequenceId: Id<"procurementOutreachSequences">;
        requestId: Id<"procurementRequests">;
        outreachId: Id<"procurementBrokerOutreaches">;
        brokerOrgId: Id<"organizations">;
        recipient: Sequence["recipient"];
        cadence: Sequence["cadence"];
        resendThreadId: string | null;
        lastOutboundEmailId: string | null;
      };
      sender: { userId: Id<"users">; name: string | null; email: string | null };
      inbox: InboxRecord | null;
      request: {
        title: string;
        clientName: string;
        targetEffectiveDate: string | null;
        isRenewal: boolean;
      };
      broker: { name: string };
      packet: { linkId: Id<"procurementPacketLinks">; url: string; fileCount: number };
      priorSteps: { index: number; kind: Step["kind"]; sentAt: number | null; subject: string | null }[];
    }
  | { status: "skipped"; reason: string }
  | { status: "deferred"; reason: string; runAt: number }
  | { status: "terminated"; reason: string };

async function recordDeliveryAttempt(
  ctx: MutationCtx,
  args: {
    sequence: Sequence;
    step: Step;
    status: "sent" | "failed" | "blocked";
    now: number;
    resendEmailId?: string;
    error?: string;
  },
) {
  await ctx.db.insert("emailDeliveryAttempts", {
    orgId: args.sequence.clientOrgId,
    source: "procurement_outreach",
    provider: "resend",
    deliveryMode: process.env.EMAIL_DELIVERY_MODE,
    status: args.status,
    recipientEmail: args.sequence.recipient.email,
    subject: args.step.draft?.subject,
    resendEmailId: args.resendEmailId,
    error: args.error ? shorten(args.error) : undefined,
    startedAt: args.step.firstAttemptAt ?? args.now,
    completedAt: args.now,
  });
}

/** Fails the sequence: the step (if any) is `failed`, every other unfinished step cancelled. */
async function failSequence(
  ctx: MutationCtx,
  sequence: Sequence,
  step: Step | null,
  reason: string,
  now: number,
  message?: string,
) {
  if (step)
    await ctx.db.patch(step._id, {
      status: "failed",
      error: shorten(message ?? reason),
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
  await terminalizeSequence(ctx, sequence, {
    status: "failed",
    reason,
    now,
    keepStepId: step?._id,
  });
}

export const claimStepInternal = internalMutation({
  args: { stepId: v.id("procurementOutreachSteps") },
  handler: async (ctx, { stepId }): Promise<ClaimStepResult> => {
    const now = dayjs().valueOf();
    const step = await ctx.db.get(stepId);
    if (!step) return { status: "skipped", reason: "step_missing" };
    if (step.status === "sending" && (step.leaseUntil ?? 0) > now)
      return { status: "skipped", reason: "leased" };
    if (step.status !== "scheduled" && step.status !== "sending")
      return { status: "skipped", reason: `step_${step.status}` };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { status: "skipped", reason: "sequence_missing" };
    const recovered = step.status === "sending";

    const check = await checkStepWorld(ctx, step, sequence, now);
    if (check.kind === "skip") {
      // A finished sequence leaves nothing to resume; clear an orphaned send.
      if (recovered && !isLive(sequence.status))
        await ctx.db.patch(step._id, {
          status: "cancelled",
          error: "stopped_while_sending",
          leaseToken: undefined,
          leaseUntil: undefined,
          updatedAt: now,
        });
      return { status: "skipped", reason: check.reason };
    }
    if (check.kind === "stop") {
      await terminalizeSequence(ctx, sequence, {
        status: "stopped",
        reason: check.reason,
        now,
      });
      return { status: "terminated", reason: check.reason };
    }
    if (check.kind === "defer") {
      await ctx.db.patch(step._id, {
        status: "scheduled",
        dueAt: Math.max(step.dueAt, check.runAt),
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAt(check.runAt, internal.actions.providerOutreach.sendStep, {
        stepId: step._id,
      });
      return { status: "deferred", reason: check.reason, runAt: check.runAt };
    }
    if (step.dueAt > now + 1000)
      return { status: "skipped", reason: "not_due" };

    if (step.attempts >= MAX_STEP_ATTEMPTS) {
      await failSequence(ctx, sequence, step, "max_attempts", now);
      return { status: "terminated", reason: "max_attempts" };
    }
    // A repeat attempt can only reuse an idempotency key inside the provider window.
    if (step.attempts > 0 && now - (step.firstAttemptAt ?? now) > DELIVERY_RETRY_WINDOW_MS) {
      await failSequence(ctx, sequence, step, "delivery_unknown", now);
      return { status: "terminated", reason: "delivery_unknown" };
    }

    const { world } = check;
    const leaseToken = crypto.randomUUID();
    const leaseUntil = now + STEP_LEASE_MS;
    const firstAttemptAt = step.firstAttemptAt ?? now;
    await ctx.db.patch(step._id, {
      status: "sending",
      attempts: step.attempts + 1,
      leaseToken,
      leaseUntil,
      firstAttemptAt,
      error: undefined,
      updatedAt: now,
    });
    const earlier = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_sequenceId_and_index", (q) => q.eq("sequenceId", sequence._id))
      .take(MAX_STEPS_PER_SEQUENCE);
    return {
      status: "claimed",
      leaseToken,
      leaseUntil,
      recovered,
      threadRequired: step.kind === "follow_up" && world.previous?.status === "sent",
      step: {
        stepId: step._id,
        index: step.index,
        kind: step.kind,
        isFinal: step.isFinal,
        dueAt: step.dueAt,
        attempts: step.attempts + 1,
        firstAttemptAt,
        draft: step.draft ?? null,
        generationStartedAt: step.generationStartedAt ?? null,
        resendDraftId: step.resendDraftId ?? null,
      },
      sequence: {
        sequenceId: sequence._id,
        requestId: sequence.requestId,
        outreachId: sequence.outreachId,
        brokerOrgId: sequence.brokerOrgId,
        recipient: sequence.recipient,
        cadence: sequence.cadence,
        resendThreadId: sequence.resendThreadId ?? null,
        lastOutboundEmailId: sequence.lastOutboundEmailId ?? null,
      },
      sender: {
        userId: sequence.senderUserId,
        name: world.sender?.name ?? null,
        email: world.sender?.email ?? null,
      },
      inbox: await inboxForUser(ctx, sequence.senderUserId),
      request: {
        title: world.request.title,
        clientName: world.client.name,
        targetEffectiveDate: world.request.targetEffectiveDate ?? null,
        isRenewal: !!world.request.replacingPolicyId,
      },
      broker: { name: world.broker.name },
      packet: {
        linkId: world.link._id,
        url: `${getClientPortalUrl()}/share/packet/${world.link.token}`,
        fileCount: world.link.artifactSnapshot?.length ?? 0,
      },
      priorSteps: earlier
        .filter((row) => row.index < step.index)
        .map((row) => ({
          index: row.index,
          kind: row.kind,
          sentAt: row.sentAt ?? null,
          subject: row.draft?.subject ?? null,
        })),
    };
  },
});

/** The step if this worker still holds its lease; stale workers get null. */
async function fencedStep(
  ctx: MutationCtx,
  stepId: Id<"procurementOutreachSteps">,
  leaseToken: string,
  now: number,
  options: { allowExpired?: boolean } = {},
) {
  const step = await ctx.db.get(stepId);
  if (
    !step ||
    step.status !== "sending" ||
    step.leaseToken !== leaseToken ||
    (!options.allowExpired && (step.leaseUntil ?? 0) <= now)
  )
    return null;
  return step;
}

/**
 * Checkpoint immediately before the network send: re-runs the claim checks and
 * extends the lease. On failure the sequence is already stopped (or the step
 * deferred) and the worker must not send.
 */
export const beginSendInternal = internalMutation({
  args: { stepId: v.id("procurementOutreachSteps"), leaseToken: v.string() },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { ok: false as const, reason: "stale_lease" };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { ok: false as const, reason: "sequence_missing" };
    const check = await checkStepWorld(ctx, step, sequence, now);
    if (check.kind === "ok") {
      const leaseUntil = now + STEP_LEASE_MS;
      await ctx.db.patch(step._id, { leaseUntil, updatedAt: now });
      return { ok: true as const, leaseUntil };
    }
    if (check.kind === "stop") {
      await terminalizeSequence(ctx, sequence, { status: "stopped", reason: check.reason, now });
      return { ok: false as const, reason: check.reason };
    }
    if (check.kind === "defer") {
      await ctx.db.patch(step._id, {
        status: "scheduled",
        dueAt: Math.max(step.dueAt, check.runAt),
        attempts: Math.max(0, step.attempts - 1),
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAt(check.runAt, internal.actions.providerOutreach.sendStep, {
        stepId: step._id,
      });
      return { ok: false as const, reason: check.reason };
    }
    // Held (reply check) or terminal: release the claim so the step is not orphaned.
    await ctx.db.patch(step._id, {
      status: isLive(sequence.status) ? "scheduled" : "cancelled",
      attempts: Math.max(0, step.attempts - 1),
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    return { ok: false as const, reason: check.reason };
  },
});

/**
 * Decides how the draft is obtained and persists the decision before any model
 * call. `generate` is returned at most once per step: a later attempt after an
 * unknown generation outcome gets `template_only` and never replays inference.
 */
export const prepareDraftInternal = internalMutation({
  args: { stepId: v.id("procurementOutreachSteps"), leaseToken: v.string() },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { mode: "stale" as const };
    if (step.draft) return { mode: "saved" as const, draft: step.draft };
    if (step.generationStartedAt !== undefined) return { mode: "template_only" as const };
    await ctx.db.patch(step._id, { generationStartedAt: now, updatedAt: now });
    return { mode: "generate" as const };
  },
});

/** First writer wins: a saved draft is never replaced, so retries resend identical content. */
export const saveDraftInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    draft: stepDraftValidator,
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { stored: false as const };
    if (step.draft) return { stored: true as const, draft: step.draft };
    await ctx.db.patch(step._id, { draft: args.draft, updatedAt: now });
    return { stored: true as const, draft: args.draft };
  },
});

export const recordDraftIdInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    resendDraftId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { stored: false as const };
    await ctx.db.patch(step._id, {
      resendDraftId: step.resendDraftId ?? args.resendDraftId,
      updatedAt: now,
    });
    return { stored: true as const };
  },
});

/** Records the operator's inbox (idempotent per user) and attaches it to the sequence. */
export const recordInboxInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    inbox: inboxRecordValidator,
  },
  handler: async (ctx, args): Promise<{ stored: boolean; inbox: InboxRecord | null }> => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { stored: false, inbox: null };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { stored: false, inbox: null };
    const existing = await ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_userId", (q) => q.eq("userId", sequence.senderUserId))
      .first();
    if (!existing) {
      const taken = await ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inbox.inboxId))
        .first();
      if (taken) return { stored: false, inbox: null };
      await ctx.db.insert("operatorOutreachInboxes", {
        userId: sequence.senderUserId,
        ...args.inbox,
        createdAt: now,
      });
    }
    const stored = existing
      ? {
          inboxId: existing.inboxId,
          emailAddress: existing.emailAddress,
          fromName: existing.fromName,
          labelIds: existing.labelIds,
        }
      : args.inbox;
    if (sequence.inboxId === undefined)
      await ctx.db.patch(sequence._id, { inboxId: stored.inboxId, updatedAt: now });
    return { stored: true, inbox: stored };
  },
});

/**
 * Re-times unfinished steps from `anchorAt` and schedules the first. Kept steps
 * get fresh due times and `isFinal`; steps past the cutoff are cancelled. With
 * nothing left the sequence is `completed` (handed to the operator).
 */
async function scheduleRemainingSteps(
  ctx: MutationCtx,
  sequence: Sequence,
  request: Doc<"procurementRequests"> | null,
  args: { anchorAt: number; now: number; notBefore?: number },
) {
  const steps = await ctx.db
    .query("procurementOutreachSteps")
    .withIndex("by_sequenceId_and_index", (q) => q.eq("sequenceId", sequence._id))
    .take(MAX_STEPS_PER_SEQUENCE);
  const remaining = steps.filter((step) => step.status === "scheduled");
  if (!remaining.length) {
    await terminalizeSequence(ctx, sequence, {
      status: "completed",
      reason: "sequence_finished",
      now: args.now,
    });
    return { completed: true as const, nextStepId: null, nextDueAt: null };
  }
  const schedule = recomputeScheduleAfterSend({
    sentAt: args.anchorAt,
    launchedAt: sequence.createdAt,
    nextIndex: remaining[0].index,
    remaining: remaining.length,
    intervalBusinessDays: sequence.cadence.intervalBusinessDays,
    limits: { effectiveDate: request?.targetEffectiveDate },
    notBefore: args.notBefore,
  });
  const kept = new Map(schedule.steps.map((planned) => [planned.index, planned]));
  let first: { stepId: Id<"procurementOutreachSteps">; dueAt: number } | null = null;
  for (const step of remaining) {
    const planned = kept.get(step.index);
    if (!planned) {
      await ctx.db.patch(step._id, { status: "cancelled", updatedAt: args.now });
      continue;
    }
    await ctx.db.patch(step._id, {
      dueAt: planned.dueAt,
      isFinal: planned.isFinal,
      updatedAt: args.now,
    });
    first ??= { stepId: step._id, dueAt: planned.dueAt };
  }
  if (!first) {
    await terminalizeSequence(ctx, sequence, {
      status: "completed",
      reason: "sequence_finished",
      now: args.now,
    });
    return { completed: true as const, nextStepId: null, nextDueAt: null };
  }
  await ctx.scheduler.runAt(first.dueAt, internal.actions.providerOutreach.sendStep, {
    stepId: first.stepId,
  });
  return { completed: false as const, nextStepId: first.stepId, nextDueAt: first.dueAt };
}

export const finishStepInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    outcome: stepFinishOutcomeValidator,
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now, {
      allowExpired: true,
    });
    if (!step) return { applied: false as const, reason: "stale_lease" };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { applied: false as const, reason: "sequence_missing" };
    const { outcome } = args;
    await ctx.db.patch(step._id, {
      status: outcome.kind === "sent" ? "sent" : "captured",
      ...(outcome.kind === "sent"
        ? {
            sentAt: now,
            resendEmailId: outcome.resendEmailId,
            ...(outcome.resendDraftId ? { resendDraftId: outcome.resendDraftId } : {}),
          }
        : {}),
      error: undefined,
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    if (outcome.kind === "sent") {
      await ctx.db.patch(sequence._id, {
        lastOutboundEmailId: outcome.resendEmailId,
        ...(outcome.resendThreadId && !sequence.resendThreadId
          ? { resendThreadId: outcome.resendThreadId }
          : {}),
        updatedAt: now,
      });
      await recordDeliveryAttempt(ctx, {
        sequence,
        step,
        status: "sent",
        now,
        resendEmailId: outcome.resendEmailId,
      });
      if (step.index === 0) {
        // Same effect as procurementPacket.recordDeliveryInternal, applied to the real send.
        const link = await ctx.db.get(sequence.packetLinkId);
        if (link)
          await ctx.db.patch(link._id, {
            deliveryStatus: "sent",
            deliveryError: undefined,
            sentAt: now,
            updatedAt: now,
          });
        const outreach = await ctx.db.get(sequence.outreachId);
        if (outreach)
          await ctx.db.patch(outreach._id, {
            sentAt: now,
            ...(link ? { packetRevisionAtIssue: link.packetRevisionAtIssue } : {}),
            updatedByUserId: sequence.senderUserId,
            updatedAt: now,
          });
        await writeOperatorAudit(ctx, {
          operatorUserId: sequence.senderUserId,
          type: "setup_write",
          targetOrgId: sequence.clientOrgId,
          summary: "Sent provider packet by automated outreach",
          metadata: {
            domain: "procurement",
            operation: "send_packet",
            requestId: sequence.requestId,
            outreachId: sequence.outreachId,
            linkId: sequence.packetLinkId,
            sequenceId: sequence._id,
            status: "sent",
          },
        });
      }
    }
    if (sequence.status !== "active")
      return { applied: true as const, sequenceStatus: sequence.status, nextStepId: null, nextDueAt: null };
    const request = await ctx.db.get(sequence.requestId);
    const next = await scheduleRemainingSteps(ctx, sequence, request, {
      anchorAt: now,
      now,
    });
    return {
      applied: true as const,
      sequenceStatus: next.completed ? ("completed" as const) : sequence.status,
      nextStepId: next.nextStepId,
      nextDueAt: next.nextDueAt,
    };
  },
});

function retryDelayMs(attempts: number, retryAfterMs?: number) {
  const backoff = Math.min(15 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1));
  return Math.max(backoff, Math.min(retryAfterMs ?? 0, 60 * 60 * 1000));
}

export const failStepInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    failure: stepFailureValidator,
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now, {
      allowExpired: true,
    });
    if (!step) return { applied: false as const, reason: "stale_lease" };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { applied: false as const, reason: "sequence_missing" };
    const message = shorten(args.failure.message);
    if (!isLive(sequence.status)) {
      await ctx.db.patch(step._id, {
        status: "cancelled",
        error: message,
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      return { applied: true as const, outcome: "cancelled" as const };
    }
    const retryable = args.failure.kind === "transient" || args.failure.kind === "unknown";
    if (retryable) {
      const outOfWindow = now - (step.firstAttemptAt ?? now) > DELIVERY_RETRY_WINDOW_MS;
      if (step.attempts >= MAX_STEP_ATTEMPTS || outOfWindow) {
        const reason =
          args.failure.kind === "unknown" || outOfWindow ? "delivery_unknown" : "max_attempts";
        await recordDeliveryAttempt(ctx, { sequence, step, status: "failed", now, error: message });
        await failSequence(ctx, sequence, step, reason, now, message);
        return { applied: true as const, outcome: "failed" as const, reason };
      }
      const runAt = now + retryDelayMs(step.attempts, args.failure.retryAfterMs);
      await ctx.db.patch(step._id, {
        status: "scheduled",
        dueAt: Math.max(step.dueAt, runAt),
        error: message,
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAt(runAt, internal.actions.providerOutreach.sendStep, {
        stepId: step._id,
      });
      return { applied: true as const, outcome: "retry" as const, runAt };
    }
    const reason = args.failure.kind === "blocked" ? "delivery_blocked" : "permanent_error";
    await recordDeliveryAttempt(ctx, {
      sequence,
      step,
      status: args.failure.kind === "blocked" ? "blocked" : "failed",
      now,
      error: message,
    });
    await failSequence(ctx, sequence, step, reason, now, message);
    return { applied: true as const, outcome: "failed" as const, reason };
  },
});

/**
 * Returns a claimed step to `scheduled` without spending an attempt, e.g. when a
 * follow-up must wait for the first email's thread id. Gives up after a bound.
 */
export const releaseStepInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    reason: v.literal("awaiting_thread"),
    delayMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now, {
      allowExpired: true,
    });
    if (!step) return { applied: false as const, reason: "stale_lease" };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { applied: false as const, reason: "sequence_missing" };
    if (!isLive(sequence.status)) {
      await ctx.db.patch(step._id, {
        status: "cancelled",
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      return { applied: true as const, outcome: "cancelled" as const };
    }
    const previous = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_sequenceId_and_index", (q) =>
        q.eq("sequenceId", sequence._id).eq("index", Math.max(0, step.index - 1)),
      )
      .unique();
    const waitingSince = previous?.sentAt ?? previous?.updatedAt ?? step.createdAt;
    if (now - waitingSince > THREAD_WAIT_LIMIT_MS) {
      await failSequence(ctx, sequence, step, "thread_unavailable", now);
      return { applied: true as const, outcome: "failed" as const };
    }
    const runAt = now + Math.max(15_000, Math.min(args.delayMs ?? 60_000, 10 * 60_000));
    await ctx.db.patch(step._id, {
      status: "scheduled",
      dueAt: Math.max(step.dueAt, runAt),
      attempts: Math.max(0, step.attempts - 1),
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(runAt, internal.actions.providerOutreach.sendStep, {
      stepId: step._id,
    });
    return { applied: true as const, outcome: "released" as const, runAt };
  },
});

// ---------------------------------------------------------------------------
// Inbox webhook events (durable) and message mirroring
// ---------------------------------------------------------------------------

/** Persists a verified webhook event once and schedules `handleInboxEvent`. */
export const recordInboxEventInternal = internalMutation({
  args: {
    emailId: v.string(),
    eventType: inboxEventTypeValidator,
    inboxId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const known = await ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inboxId))
      .first();
    // The Resend webhook is account-wide; only inboxes Spot created matter.
    if (!known) return { recorded: false as const, reason: "unknown_inbox" as const };
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("providerOutreachWebhookEvents")
      .withIndex("by_emailId_and_eventType", (q) =>
        q.eq("emailId", args.emailId).eq("eventType", args.eventType),
      )
      .first();
    if (existing) {
      if (existing.status === "failed") {
        await ctx.db.patch(existing._id, {
          status: "pending",
          error: undefined,
          leaseToken: undefined,
          leaseUntil: undefined,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.handleInboxEvent, {
          eventId: existing._id,
        });
      }
      return { recorded: true as const, eventId: existing._id, duplicate: true as const };
    }
    const eventId = await ctx.db.insert("providerOutreachWebhookEvents", {
      emailId: args.emailId,
      eventType: args.eventType,
      inboxId: args.inboxId,
      threadId: args.threadId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.handleInboxEvent, {
      eventId,
    });
    return { recorded: true as const, eventId, duplicate: false as const };
  },
});

type InboxEventRoute =
  | {
      kind: "sequence";
      sequenceId: Id<"procurementOutreachSequences">;
      stepId: Id<"procurementOutreachSteps"> | null;
      requestId: Id<"procurementRequests">;
      outreachId: Id<"procurementBrokerOutreaches">;
      sequenceStatus: SequenceStatus;
      recipientEmail: string;
      resendThreadId: string | null;
      senderUserId: Id<"users">;
    }
  | { kind: "unmatched" };

export type ClaimInboxEventResult =
  | { status: "skipped"; reason: string }
  | { status: "retry_scheduled"; runAt: number }
  | {
      status: "claimed";
      leaseToken: string;
      event: {
        eventId: Id<"providerOutreachWebhookEvents">;
        emailId: string;
        eventType: "inbox.email.received" | "inbox.email.sent";
        inboxId: string;
        threadId: string;
      };
      route: InboxEventRoute;
      inbox: InboxRecord | null;
    };

async function routeInboxEvent(
  ctx: Ctx,
  event: Doc<"providerOutreachWebhookEvents">,
): Promise<InboxEventRoute> {
  let step: Step | null = null;
  let sequence: Sequence | null = null;
  if (event.eventType === "inbox.email.sent") {
    step = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_resendEmailId", (q) => q.eq("resendEmailId", event.emailId))
      .first();
    if (step) sequence = await ctx.db.get(step.sequenceId);
  }
  if (!sequence)
    sequence = await ctx.db
      .query("procurementOutreachSequences")
      .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", event.threadId))
      .first();
  if (!sequence) return { kind: "unmatched" };
  return {
    kind: "sequence",
    sequenceId: sequence._id,
    stepId: step?._id ?? null,
    requestId: sequence.requestId,
    outreachId: sequence.outreachId,
    sequenceStatus: sequence.status,
    recipientEmail: sequence.recipient.email,
    resendThreadId: sequence.resendThreadId ?? null,
    senderUserId: sequence.senderUserId,
  };
}

/**
 * Leases a webhook event and resolves its sequence. Until the outbound
 * email/thread mapping exists the claim reschedules itself (bounded); after the
 * window an unmapped event is returned as `unmatched` so the action can label
 * it for the operator.
 */
export const claimInboxEventInternal = internalMutation({
  args: { eventId: v.id("providerOutreachWebhookEvents") },
  handler: async (ctx, { eventId }): Promise<ClaimInboxEventResult> => {
    const now = dayjs().valueOf();
    const event = await ctx.db.get(eventId);
    if (!event) return { status: "skipped", reason: "event_missing" };
    if (event.status === "completed" || event.status === "failed")
      return { status: "skipped", reason: `event_${event.status}` };
    if (event.status === "processing" && (event.leaseUntil ?? 0) > now)
      return { status: "skipped", reason: "leased" };
    if (now - event.createdAt > INBOX_EVENT_GIVE_UP_MS) {
      await ctx.db.patch(event._id, {
        status: "failed",
        error: "event_expired",
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      return { status: "skipped", reason: "event_expired" };
    }
    const route = await routeInboxEvent(ctx, event);
    if (route.kind === "unmatched" && now - event.createdAt < INBOX_EVENT_MAPPING_WINDOW_MS) {
      const runAt = now + INBOX_EVENT_RETRY_MS;
      await ctx.db.patch(event._id, {
        status: "pending",
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAt(runAt, internal.actions.providerOutreach.handleInboxEvent, {
        eventId: event._id,
      });
      return { status: "retry_scheduled", runAt };
    }
    const leaseToken = crypto.randomUUID();
    await ctx.db.patch(event._id, {
      status: "processing",
      leaseToken,
      leaseUntil: now + INBOX_EVENT_LEASE_MS,
      updatedAt: now,
    });
    const operatorInbox = await ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", event.inboxId))
      .first();
    return {
      status: "claimed",
      leaseToken,
      event: {
        eventId: event._id,
        emailId: event.emailId,
        eventType:
          event.eventType === "inbox.email.sent" ? "inbox.email.sent" : "inbox.email.received",
        inboxId: event.inboxId,
        threadId: event.threadId,
      },
      route,
      inbox: operatorInbox
        ? {
            inboxId: operatorInbox.inboxId,
            emailAddress: operatorInbox.emailAddress,
            fromName: operatorInbox.fromName,
            labelIds: operatorInbox.labelIds,
          }
        : null,
    };
  },
});

async function fencedEvent(
  ctx: MutationCtx,
  eventId: Id<"providerOutreachWebhookEvents">,
  leaseToken: string,
  now: number,
) {
  const event = await ctx.db.get(eventId);
  if (!event || event.status !== "processing" || event.leaseToken !== leaseToken || (event.leaseUntil ?? 0) <= now)
    return null;
  return event;
}

async function finishEvent(
  ctx: MutationCtx,
  event: Doc<"providerOutreachWebhookEvents">,
  now: number,
  error?: string,
) {
  await ctx.db.patch(event._id, {
    status: error ? "failed" : "completed",
    error: error ? shorten(error) : undefined,
    leaseToken: undefined,
    leaseUntil: undefined,
    updatedAt: now,
  });
}

/** Completes (or fails) an event that needs no state change, e.g. an unmatched event. */
export const completeInboxEventInternal = internalMutation({
  args: {
    eventId: v.id("providerOutreachWebhookEvents"),
    leaseToken: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const event = await fencedEvent(ctx, args.eventId, args.leaseToken, now);
    if (!event) return { applied: false as const };
    await finishEvent(ctx, event, now, args.error);
    return { applied: true as const };
  },
});

/** Returns an event whose handling failed transiently to `pending` for recovery. */
export const releaseInboxEventInternal = internalMutation({
  args: {
    eventId: v.id("providerOutreachWebhookEvents"),
    leaseToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const event = await fencedEvent(ctx, args.eventId, args.leaseToken, now);
    if (!event) return { applied: false as const };
    await ctx.db.patch(event._id, {
      status: "pending",
      error: shorten(args.error),
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    return { applied: true as const };
  },
});

/**
 * Idempotent mirror of one inbox email into the request's Email view. The row
 * is keyed by `resendInboxEmailId`; a repeat only deletes the extra uploads.
 */
async function mirrorInboxEmail(
  ctx: MutationCtx,
  args: {
    sequence: Sequence;
    request: Doc<"procurementRequests">;
    email: InboxEmail;
    attachments: { fileId: Id<"_storage">; filename: string; contentType: string; size: number }[];
    resendThreadId: string;
    inbound: boolean;
    now: number;
  },
) {
  const { sequence, request, email } = args;
  const duplicate = await ctx.db
    .query("procurementEmailMessages")
    .withIndex("by_resendInboxEmailId", (q) =>
      q.eq("resendInboxEmailId", email.resendInboxEmailId),
    )
    .first();
  if (duplicate) {
    await Promise.all(args.attachments.map((file) => ctx.storage.delete(file.fileId)));
    return { duplicate: true as const, threadId: duplicate.threadId, messageId: duplicate._id };
  }
  const subject = email.subject.trim().slice(0, 500) || "(no subject)";
  const participants = uniqueProcurementEmails([
    sequence.recipient.email,
    email.fromEmail,
    ...email.toAddresses,
    ...email.ccAddresses,
  ]);
  let thread: Doc<"procurementEmailThreads"> | null = sequence.procurementEmailThreadId
    ? await ctx.db.get(sequence.procurementEmailThreadId)
    : null;
  if (thread?.deletedAt) thread = null;
  thread ??= await ctx.db
    .query("procurementEmailThreads")
    .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", args.resendThreadId))
    .first();
  if (thread?.deletedAt) thread = null;
  let threadId: Id<"procurementEmailThreads">;
  if (thread) {
    threadId = thread._id;
    await ctx.db.patch(thread._id, {
      participantEmails: uniqueProcurementEmails([...thread.participantEmails, ...participants]),
      latestMessageAt: Math.max(thread.latestMessageAt, email.occurredAt),
      messageCount: thread.messageCount + 1,
      ...(args.inbound ? { archivedAt: undefined, archivedByUserId: undefined } : {}),
      updatedAt: args.now,
    });
  } else {
    threadId = await ctx.db.insert("procurementEmailThreads", {
      outreachId: sequence.outreachId,
      resendThreadId: args.resendThreadId,
      clientOrgId: sequence.clientOrgId,
      addressedRequestId: request._id,
      requestId: request._id,
      normalizedSubject: normalizeProcurementSubject(subject),
      subject,
      category: "broker",
      categorySource: "auto",
      categoryReason: "provider outreach",
      participantEmails: participants,
      latestMessageAt: email.occurredAt,
      messageCount: 1,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
  if (sequence.procurementEmailThreadId !== threadId)
    await ctx.db.patch(sequence._id, { procurementEmailThreadId: threadId, updatedAt: args.now });
  const clientFileIds = args.attachments.length
    ? await storeProcurementEmailAttachments(ctx, {
        clientOrgId: sequence.clientOrgId,
        attachments: args.attachments,
        subject,
      })
    : [];
  const messageId = await ctx.db.insert("procurementEmailMessages", {
    resendInboxEmailId: email.resendInboxEmailId,
    threadId,
    clientOrgId: sequence.clientOrgId,
    addressedRequestId: request._id,
    messageId: email.messageId?.slice(0, 500),
    inReplyTo: email.inReplyTo?.slice(0, 500),
    references: email.references.map((value) => value.slice(0, 500)).slice(0, 50),
    subject,
    fromName: email.fromName?.slice(0, 300),
    fromEmail: normalizeProcurementEmail(email.fromEmail),
    toAddresses: uniqueProcurementEmails(email.toAddresses),
    ccAddresses: uniqueProcurementEmails(email.ccAddresses),
    bccAddresses: uniqueProcurementEmails(email.bccAddresses),
    currentText: email.text.slice(0, 120_000),
    bodyHtml: email.html?.slice(0, 180_000),
    clientFileIds,
    receivedAt: email.occurredAt,
    createdAt: args.now,
  });
  await insertProcurementEmailFileItems(ctx, {
    requestId: request._id,
    clientOrgId: sequence.clientOrgId,
    emailMessageId: messageId,
    clientFileIds,
    now: args.now,
  });
  return { duplicate: false as const, threadId, messageId };
}

/** Request for mirroring; null when it can no longer hold mirrored mail. */
async function mirrorableRequest(ctx: Ctx, sequence: Sequence) {
  const request = await ctx.db.get(sequence.requestId);
  if (!request || request.deletedAt || !request.clientOrgId) return null;
  return request;
}

/** `inbox.email.sent`: records the thread id and mirrors the outbound email (API or dashboard). */
export const applySentInboxEmailInternal = internalMutation({
  args: {
    eventId: v.id("providerOutreachWebhookEvents"),
    leaseToken: v.string(),
    sequenceId: v.id("procurementOutreachSequences"),
    email: inboxEmailValidator,
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const event = await fencedEvent(ctx, args.eventId, args.leaseToken, now);
    if (!event) return { applied: false as const, reason: "stale_lease" };
    const sequence = await ctx.db.get(args.sequenceId);
    if (!sequence) {
      await finishEvent(ctx, event, now, "sequence_missing");
      return { applied: false as const, reason: "sequence_missing" };
    }
    if (!sequence.resendThreadId)
      await ctx.db.patch(sequence._id, { resendThreadId: event.threadId, updatedAt: now });
    const request = await mirrorableRequest(ctx, sequence);
    const mirrored = request
      ? await mirrorInboxEmail(ctx, {
          sequence: { ...sequence, resendThreadId: sequence.resendThreadId ?? event.threadId },
          request,
          email: args.email,
          attachments: [],
          resendThreadId: event.threadId,
          inbound: false,
          now,
        })
      : null;
    await finishEvent(ctx, event, now);
    return { applied: true as const, duplicate: mirrored?.duplicate ?? false };
  },
});

function isLiveOrHandoffTarget(status: SequenceStatus) {
  return status === "active" || status === "reply_check";
}

/**
 * `inbox.email.received`: mirrors the reply and attachments, then moves the
 * sequence. A reply sets `reply_check` in this same transaction, which blocks
 * every send before the body is classified; a bounce stops the sequence.
 */
export const applyInboundInboxEmailInternal = internalMutation({
  args: {
    eventId: v.id("providerOutreachWebhookEvents"),
    leaseToken: v.string(),
    sequenceId: v.id("procurementOutreachSequences"),
    email: inboxEmailValidator,
    /** Uploaded attachment bytes; empty while Resend exposes no byte download. */
    attachments: v.optional(v.array(inboxAttachmentValidator)),
    classification: v.union(v.literal("reply"), v.literal("bounce")),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const attachments = args.attachments ?? [];
    const event = await fencedEvent(ctx, args.eventId, args.leaseToken, now);
    if (!event) {
      await Promise.all(attachments.map((file) => ctx.storage.delete(file.fileId)));
      return { applied: false as const, reason: "stale_lease" };
    }
    const sequence = await ctx.db.get(args.sequenceId);
    if (!sequence) {
      await Promise.all(attachments.map((file) => ctx.storage.delete(file.fileId)));
      await finishEvent(ctx, event, now, "sequence_missing");
      return { applied: false as const, reason: "sequence_missing" };
    }
    const request = await mirrorableRequest(ctx, sequence);
    const mirrored = request
      ? await mirrorInboxEmail(ctx, {
          sequence,
          request,
          email: args.email,
          attachments,
          resendThreadId: event.threadId,
          inbound: true,
          now,
        })
      : null;
    if (!request)
      await Promise.all(attachments.map((file) => ctx.storage.delete(file.fileId)));
    // A redelivered email already moved the sequence; mirroring was the only effect left.
    if (mirrored?.duplicate) {
      await finishEvent(ctx, event, now);
      return {
        applied: true as const,
        duplicate: true as const,
        sequenceStatus: sequence.status,
        needsReplyLabel: false,
        classifyScheduled: false,
      };
    }
    const emailId = args.email.resendInboxEmailId;
    let status: SequenceStatus = sequence.status;
    let classifyScheduled = false;
    if (args.classification === "bounce") {
      if (isLiveOrHandoffTarget(sequence.status)) {
        await terminalizeSequence(ctx, sequence, { status: "stopped", reason: "bounced", now });
        status = "stopped";
      }
    } else if (isLiveOrHandoffTarget(sequence.status)) {
      await ctx.db.patch(sequence._id, {
        status: "reply_check",
        pendingReplyEmailId: emailId,
        replyCheckStartedAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.classifyReply, {
        sequenceId: sequence._id,
        emailId,
      });
      status = "reply_check";
      classifyScheduled = true;
    } else if (sequence.status === "completed") {
      // Final step already sent: nothing to resume, hand straight to the operator.
      await ctx.db.patch(sequence._id, { status: "responded", respondedAt: now, updatedAt: now });
      status = "responded";
    }
    await finishEvent(ctx, event, now);
    return {
      applied: true as const,
      duplicate: false as const,
      sequenceStatus: status,
      // Bounces are handled; any other reply that no automation owns needs the operator.
      needsReplyLabel:
        args.classification === "reply" &&
        (status === "responded" || status === "stopped" || status === "failed"),
      classifyScheduled,
    };
  },
});

// ---------------------------------------------------------------------------
// Reply classification
// ---------------------------------------------------------------------------

/** The reply to classify; null when it is no longer the pending one (stale). */
export const getReplyContextInternal = internalQuery({
  args: { sequenceId: v.id("procurementOutreachSequences"), emailId: v.string() },
  handler: async (ctx, args) => {
    const sequence = await ctx.db.get(args.sequenceId);
    if (
      !sequence ||
      sequence.status !== "reply_check" ||
      sequence.pendingReplyEmailId !== args.emailId
    )
      return null;
    const message = await ctx.db
      .query("procurementEmailMessages")
      .withIndex("by_resendInboxEmailId", (q) => q.eq("resendInboxEmailId", args.emailId))
      .first();
    const request = await ctx.db.get(sequence.requestId);
    return {
      sequenceId: sequence._id,
      emailId: args.emailId,
      inboxId: sequence.inboxId ?? null,
      resendThreadId: sequence.resendThreadId ?? null,
      recipientEmail: sequence.recipient.email,
      requestTitle: request?.title ?? null,
      message: message
        ? {
            subject: message.subject,
            fromEmail: message.fromEmail,
            fromName: message.fromName ?? null,
            text: message.currentText.slice(0, 20_000),
            receivedAt: message.receivedAt,
          }
        : null,
    };
  },
});

/**
 * Applies the Jev outcome, but only if `emailId` is still the pending reply: a
 * newer reply replaced it, or the check already resolved, then nothing changes.
 */
export const applyReplyClassificationInternal = internalMutation({
  args: {
    sequenceId: v.id("procurementOutreachSequences"),
    emailId: v.string(),
    outcome: replyClassificationValidator,
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const sequence = await ctx.db.get(args.sequenceId);
    if (
      !sequence ||
      sequence.status !== "reply_check" ||
      sequence.pendingReplyEmailId !== args.emailId
    )
      return { applied: false as const, reason: "stale_reply_check" };
    if (args.outcome.kind === "unmonitored") {
      await terminalizeSequence(ctx, sequence, {
        status: "stopped",
        reason: "recipient_unmonitored",
        now,
      });
      return { applied: true as const, sequenceStatus: "stopped" as const, needsReplyLabel: true };
    }
    if (args.outcome.kind === "needs_reply") {
      await terminalizeSequence(ctx, sequence, {
        status: "responded",
        reason: "provider_replied",
        now,
      });
      return { applied: true as const, sequenceStatus: "responded" as const, needsReplyLabel: true };
    }
    const steps = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_sequenceId_and_index", (q) => q.eq("sequenceId", sequence._id))
      .take(MAX_STEPS_PER_SEQUENCE);
    const lastSentAt = Math.max(
      sequence.createdAt,
      ...steps.flatMap((step) => (step.sentAt ? [step.sentAt] : [])),
    );
    await ctx.db.patch(sequence._id, {
      status: "active",
      pendingReplyEmailId: undefined,
      replyCheckStartedAt: undefined,
      updatedAt: now,
    });
    const next = await scheduleRemainingSteps(
      ctx,
      { ...sequence, status: "active" },
      await ctx.db.get(sequence.requestId),
      { anchorAt: lastSentAt, now, notBefore: addBusinessDays(now, 1) },
    );
    return {
      applied: true as const,
      sequenceStatus: next.completed ? ("completed" as const) : ("active" as const),
      needsReplyLabel: false,
    };
  },
});

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

const RECOVERY_SCAN = 200;
const RECOVERY_DISPATCH = 50;

export const recoverInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = dayjs().valueOf();
    let dispatched = 0;

    // Due scheduled steps. Scan wider than the dispatch limit: a held
    // (reply_check) or out-of-order step must not starve the rest.
    const due = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_status_and_dueAt", (q) => q.eq("status", "scheduled").lte("dueAt", now))
      .take(RECOVERY_SCAN);
    for (const step of due) {
      if (dispatched >= RECOVERY_DISPATCH) break;
      const sequence = await ctx.db.get(step.sequenceId);
      if (!sequence) continue;
      if (sequence.status !== "active") {
        if (!isLive(sequence.status))
          await ctx.db.patch(step._id, { status: "cancelled", updatedAt: now });
        continue;
      }
      if (step.index > 0) {
        const previous = await ctx.db
          .query("procurementOutreachSteps")
          .withIndex("by_sequenceId_and_index", (q) =>
            q.eq("sequenceId", sequence._id).eq("index", step.index - 1),
          )
          .unique();
        // Neither skip ahead of, nor overtake, an unfinished predecessor.
        if (!previous || !stepDone(previous)) continue;
      }
      await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.sendStep, {
        stepId: step._id,
      });
      dispatched += 1;
    }

    // Expired leases: the earlier attempt's outcome is unknown; claim reuses its draft and keys.
    const expired = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_status_and_leaseUntil", (q) => q.eq("status", "sending").lte("leaseUntil", now))
      .take(RECOVERY_DISPATCH);
    for (const step of expired) {
      await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.sendStep, {
        stepId: step._id,
      });
      dispatched += 1;
    }

    // A reply check that never resolved becomes a manual handoff.
    const checking = await ctx.db
      .query("procurementOutreachSequences")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "reply_check").lte("updatedAt", now - REPLY_CHECK_TIMEOUT_MS),
      )
      .take(RECOVERY_DISPATCH);
    for (const sequence of checking)
      await terminalizeSequence(ctx, sequence, {
        status: "responded",
        reason: "reply_check_timeout",
        now,
      });

    // Cadence suggestions stuck pending are failed, never replayed.
    const pendingCadences = await ctx.db
      .query("procurementOutreachCadences")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "pending").lte("updatedAt", now - CADENCE_PENDING_TIMEOUT_MS),
      )
      .take(RECOVERY_DISPATCH);
    for (const row of pendingCadences)
      await ctx.db.patch(row._id, { status: "failed", updatedAt: now });

    // Webhook events waiting to be (re)handled.
    const events = await ctx.db
      .query("providerOutreachWebhookEvents")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "pending").lte("updatedAt", now - 60_000),
      )
      .take(RECOVERY_DISPATCH);
    const stuckEvents = await ctx.db
      .query("providerOutreachWebhookEvents")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "processing").lte("updatedAt", now - INBOX_EVENT_LEASE_MS),
      )
      .take(RECOVERY_DISPATCH);
    for (const event of [...events, ...stuckEvents])
      await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.handleInboxEvent, {
        eventId: event._id,
      });

    return {
      steps: dispatched,
      replyChecksTimedOut: checking.length,
      cadencesFailed: pendingCadences.length,
      events: events.length + stuckEvents.length,
    };
  },
});
