import dayjs from "dayjs";
import { operatorInTestMode } from "./testMode";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
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
import { requireCompanyRequest, type CompanyRequest } from "./lib/companyRequest";
import { getEmailDeliveryMode } from "./lib/resend";
import { requireOperator, resolveActiveOperatorEmail, writeOperatorAudit } from "./lib/operatorIdentity";
import { normalizeProcurementEmail } from "./lib/procurement";
import {
  assertOutreachIdentity,
  outreachSenderIdentity,
  outreachSenderPanel,
  type OutreachSenderPanel,
} from "./lib/outreachIdentity";
import { isCapturedResourceId } from "./lib/resendInbox";
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
  type StepFinishOutcome,
} from "./lib/providerOutreachValidators";
import {
  MAX_OUTREACH_FOLLOW_UPS,
  OUTREACH_DEFAULT_CADENCE,
  OUTREACH_STYLES,
  addBusinessDays,
  buildOutreachSchedule,
  followUpCutoff,
  recomputeScheduleAfterSend,
} from "./lib/providerOutreachSchedule";
import { getClientPortalUrl } from "./lib/domains";
import { clientRecipientOptions } from "./lib/clientOutreach";
import {
  createProcurementOutreachByOperator,
  requireDirectOperatorWrite,
} from "./procurementRequests";
import { mirrorTeamEmail, type NewTeamThread, type TeamThread } from "./lib/teamEmailStore";
import { emitOperatorNotification } from "./lib/operatorNotify";
import { mintPacketLinkForOperator, previewBrokerPacket } from "./procurementPacket";

type Ctx = QueryCtx | MutationCtx;
/** How long a sent event with no conversation yet waits for the send that created it to be mirrored. */
const SENT_EVENT_BINDING_WAIT_MS = 30 * 1000;
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
const QUOTED_HISTORY_CHARS = 3000;
const SHORT_TEXT = 500;
/** Longest a step may wait for an impersonating sender before the sequence stops. */
const IMPERSONATION_MAX_DEFER_MS = 24 * 60 * 60 * 1000;

function isLive(status: SequenceStatus) {
  return LIVE_SEQUENCE_STATUSES.includes(status);
}
function shorten(value: string, max = SHORT_TEXT) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
function stepDone(step: Pick<Step, "status">) {
  return step.status === "sent" || step.status === "captured";
}
export function isClientSequence(sequence: Pick<Sequence, "audience">) {
  return sequence.audience === "client";
}

// ---------------------------------------------------------------------------
// Request, matching and candidates
// ---------------------------------------------------------------------------

export async function loadCompanyRequest(ctx: Ctx, requestId: Id<"procurementRequests">) {
  const request = await ctx.db.get(requestId);
  requireCompanyRequest(request);
  const client = await ctx.db.get(request.clientOrgId);
  if (!client || client.deletedAt !== undefined || client.type !== "client")
    throw new Error("Client organization not found");
  return { request, client };
}

export function closedReason(request: Doc<"procurementRequests">) {
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
  contacts: Doc<"brokerContacts">[];
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
  /** The acting operator is in test mode: only test providers are eligible. */
  testMode: boolean,
  outreach: Doc<"procurementBrokerOutreaches"> | null,
  withContacts: boolean,
  selectedContact?: Doc<"brokerContacts">,
): Promise<ProviderEvaluation> {
  const profile = await loadProfile(ctx, org._id);
  const fit = classifyProvider(
    profile,
    match.geography,
    match.needs,
    testMode,
  );
  if (!withContacts || fit.verdict === "excluded")
    return { org, profile, fit, recipient: null, skipReason: null, contacts: [] };
  const contacts = await ctx.db
    .query("brokerContacts")
    .withIndex("by_brokerOrgId_and_deletedAt", (q) =>
      q.eq("brokerOrgId", org._id).eq("deletedAt", undefined),
    )
    .take(MAX_CONTACTS_PER_PROVIDER);
  const selection = selectRecipient(
    contacts,
    needAcceptedCodes(match.needs.needs),
    selectedContact ? { contactEmail: selectedContact.email, contactName: selectedContact.name } : outreach,
    org,
  );
  if (!selection.ok)
    return { org, profile, fit, recipient: null, skipReason: selection.reason, contacts };
  // Matching returns a plain string; resolve it back to the typed document id.
  const contact = contacts.find((row) => row._id === selection.recipient.contactId);
  return {
    org,
    profile,
    fit,
    contacts,
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
  iconUrl: string | null;
  networkStatus: Doc<"brokerProfiles">["networkStatus"] | null;
  verdict: ProviderFit["verdict"];
  partial: boolean;
  reasons: ProviderFitReason[];
  lines: { covered: CoverageId[]; missing: CoverageId[] };
  geography: { serviced: PlaceView[]; unserviced: PlaceView[] };
  recipient: RecipientView | null;
  contactOptions: {
    contactId: Id<"brokerContacts">;
    name: string;
    email: string;
    context: string | null;
    lineOfBusinessCodes: string[];
  }[];
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
  audience: "provider" | "client";
  outreachId: Id<"procurementBrokerOutreaches"> | null;
  brokerOrgId: Id<"organizations"> | null;
  subject: string | null;
  status: SequenceStatus;
  stopReason: string | null;
  recipient: Sequence["recipient"];
  cadence: Sequence["cadence"];
  cadenceSource: Sequence["cadenceSource"];
  senderUserId: Id<"users">;
  inboxId: string | null;
  resendThreadId: string | null;
  teamEmailThreadId: Id<"teamEmailThreads"> | null;
  /** The sender identity this sequence was approved with. */
  identityFingerprint: string | null;
  /** Set while the next email is held for a sender identity problem or change; reapprove or fix Profile. */
  identityHold: { since: number; message: string } | null;
  replyPending: boolean;
  respondedAt: number | null;
  nextDueAt: number | null;
  createdAt: number;
  updatedAt: number;
  steps: SequenceStepView[];
};

export function sequenceView(sequence: Sequence, steps: Step[]): SequenceView {
  const next = isLive(sequence.status)
    ? steps.find((step) => step.status === "scheduled" || step.status === "sending")
    : undefined;
  return {
    sequenceId: sequence._id,
    audience: isClientSequence(sequence) ? "client" : "provider",
    outreachId: sequence.outreachId ?? null,
    brokerOrgId: sequence.brokerOrgId ?? null,
    subject: sequence.message?.subject ?? steps[0]?.draft?.subject ?? null,
    status: sequence.status,
    stopReason: sequence.stopReason ?? null,
    recipient: sequence.recipient,
    cadence: sequence.cadence,
    cadenceSource: sequence.cadenceSource,
    senderUserId: sequence.senderUserId,
    inboxId: sequence.inboxId ?? null,
    resendThreadId: sequence.resendThreadId ?? null,
    teamEmailThreadId: sequence.teamEmailThreadId ?? null,
    identityFingerprint: sequence.identityFingerprint ?? null,
    identityHold:
      next?.identityDeferredAt !== undefined
        ? { since: next.identityDeferredAt, message: next.error ?? "Waiting for your sender profile" }
        : null,
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

export async function requestSequences(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
  audience: "provider" | "client",
) {
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
    .filter((sequence) => isClientSequence(sequence) === (audience === "client"))
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
        overrides: row.overrides ?? null,
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
  operatorUserId: Id<"users">,
): Promise<ProviderOutreachPanel | null> {
  let loaded: Awaited<ReturnType<typeof loadCompanyRequest>>;
  try {
    loaded = await loadCompanyRequest(ctx, requestId);
  } catch {
    return null;
  }
  const { request, client } = loaded;
  const match = matchFor(request, client);
  const testMode = await operatorInTestMode(ctx, operatorUserId);
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
    requestSequences(ctx, requestId, "provider"),
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
    if (!sequence.outreachId) continue;
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
    const evaluation = await evaluateProvider(ctx, org, match, testMode, outreach, true);
    const sequence = outreach ? (latestByOutreach.get(outreach._id) ?? null) : null;
    candidates.push({
      brokerOrgId: org._id,
      name: org.name,
      website: org.website ?? null,
      iconUrl: org.iconStorageId ? await ctx.storage.getUrl(org.iconStorageId) : null,
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
      contactOptions: evaluation.contacts.flatMap((contact) => {
        const choice = selectRecipient([contact], needAcceptedCodes(match.needs.needs), null, org);
        return choice.ok ? [{
          contactId: contact._id,
          name: contact.name,
          email: choice.recipient.email,
          context: contact.notes ? shorten(contact.notes, 240) : null,
          lineOfBusinessCodes: contact.lineOfBusinessCodes,
        }] : [];
      }),
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
  handler: async (
    ctx,
    { requestId },
  ): Promise<(ProviderOutreachPanel & { sender: OutreachSenderPanel }) | null> => {
    const operator = await requireOperator(ctx);
    const panel = await getProviderOutreachPanel(ctx, requestId, operator.userId);
    // The From and Always CC this launch will be sent with, and the fingerprint to approve.
    return panel ? { ...panel, sender: await outreachSenderPanel(ctx, operator.userId) } : null;
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
    // A cancelled in-flight send keeps its lease token so the worker can still
    // record what actually happened (see `finishStepInternal`); nothing else
    // can use it because every other fenced mutation requires `sending`.
    await ctx.db.patch(
      step._id,
      step.status === "sending"
        ? { status: "cancelled", updatedAt: args.now }
        : { status: "cancelled", leaseToken: undefined, leaseUntil: undefined, updatedAt: args.now },
    );
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
  // One notification per transition into manual handoff; callers only reach
  // here when the status actually changes, so a duplicate webhook cannot repeat it.
  if (
    args.status === "responded" ||
    args.status === "failed" ||
    args.reason === "recipient_unmonitored" ||
    args.reason === "bounced"
  )
    await notifyManualHandoff(ctx, sequence, args.reason, args.now, args.status);
  return cancelled;
}

/** Closing an authorized form stops only its own client reminder sequence. */
export async function closeInformationFormOutreach(
  ctx: MutationCtx,
  form: Pick<
    Doc<"procurementInformationForms">,
    "_id" | "requestId" | "outreachSequenceId"
  >,
  reason: "information_form_submitted" | "information_form_cancelled",
) {
  if (!form.outreachSequenceId) return;
  const sequence = await ctx.db.get(form.outreachSequenceId);
  if (
    !sequence || !isClientSequence(sequence) ||
    sequence.requestId !== form.requestId ||
    sequence.informationFormId !== form._id || !isLive(sequence.status)
  ) return;
  await terminalizeSequence(ctx, sequence, {
    status: reason === "information_form_submitted" ? "completed" : "stopped",
    reason,
    now: dayjs().valueOf(),
  });
}

async function notifyManualHandoff(
  ctx: MutationCtx,
  sequence: Sequence,
  reason: string,
  now: number,
  status: "stopped" | "failed" | "responded" | "completed",
) {
  const client = isClientSequence(sequence);
  const relatedOrgId = sequence.brokerOrgId ?? sequence.clientOrgId;
  const [request, recipientOrg] = await Promise.all([
    ctx.db.get(sequence.requestId),
    ctx.db.get(relatedOrgId),
  ]);
  const party = recipientOrg?.name ?? (client ? "The client" : "A provider");
  // Delivery problems are not replies: say so, with the bounded reason code only.
  const needsAttention = status === "failed" || reason === "bounced";
  const title = needsAttention
    ? client
      ? "Client email needs attention"
      : "Provider outreach needs attention"
    : reason === "recipient_unmonitored"
      ? `${party} contact is unmonitored`
      : reason === "reply_check_timeout"
        ? `${party} replied; review needed`
        : `${party} replied`;
  const code = reason.replace(/[^a-z0-9_ -]/gi, "").slice(0, 80);
  const subject = request ? ` on ${request.title}` : "";
  const body = needsAttention
    ? `${client ? "Email" : "Outreach"} to ${party}${subject} ${status === "failed" ? "failed" : "stopped"} (${code}). Automated follow-ups stopped; review the ${client ? "Inbox" : "Providers tab"}.`
    : `Automated follow-ups stopped${subject}. Review the conversation in the request Inbox.`;
  // Client mail always lives in the Inbox; provider delivery problems open Providers.
  const view = needsAttention && !client ? "proposals" : "email";
  const thread = view === "email" && sequence.teamEmailThreadId
    ? await ctx.db.get(sequence.teamEmailThreadId)
    : null;
  // Scheduled, so a notification failure can never roll back the state change.
  // The explicit userId keeps this operator-private: it is neither org-wide nor
  // eligible for the client's Slack/email fan-out. Warning uses the operator's
  // existing channel preferences for a reachable handoff.
  await ctx.scheduler.runAfter(0, internal.lib.notify.notifyInternal, {
    orgId: sequence.clientOrgId,
    userId: sequence.senderUserId,
    relatedOrgId,
    type: "mailbox_attention",
    severity: "warning",
    actionType: "view_operator_procurement",
    actionPayload: {
      clientOrgId: sequence.clientOrgId,
      requestId: sequence.requestId,
      view,
      ...(thread ? { emailThreadId: thread._id } : {}),
    },
    title,
    body,
    coalesceKeyParts: needsAttention
      ? ["provider_outreach_failed", String(sequence.requestId), code]
      : ["provider_outreach_handoff", String(sequence._id)],
    nowMs: now,
  });
}

/**
 * The sender approves their current From, name and Always CC for a sequence
 * that is waiting because they changed. `expectedFingerprint` must be the
 * fingerprint of the identity shown to them (`sender.fingerprint` in the panel):
 * if it no longer matches what is current, nothing changes. Only the sequence's
 * sender may approve, and the next email is retried right away. An email that
 * was already composed under the old identity is never rewritten here: it
 * waits for the profile to match again.
 */
export async function reapproveSequenceIdentityByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    sequenceId: Id<"procurementOutreachSequences">;
    expectedFingerprint: string;
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const sequence = await ctx.db.get(args.sequenceId);
  if (!sequence || sequence.senderUserId !== args.operatorUserId)
    throw new Error("Only the sender can approve their sender identity");
  if (!isLive(sequence.status)) throw new Error("These follow-ups are no longer running");
  const identity = await assertOutreachIdentity(ctx, args.operatorUserId, args.expectedFingerprint);
  const now = dayjs().valueOf();
  const steps = await ctx.db
    .query("procurementOutreachSteps")
    .withIndex("by_sequenceId_and_index", (q) => q.eq("sequenceId", sequence._id))
    .take(MAX_STEPS_PER_SEQUENCE);
  const held = steps.find((step) => step.status === "scheduled" && step.identityDeferredAt !== undefined);
  const changedDraft = held?.draft && held.identity?.fingerprint !== identity.fingerprint;
  if (changedDraft && (held.attempts > 0 || held.resendDraftId)) {
    throw new Error("This email was already prepared under the previous sender details. Restore those details before retrying; a new email cannot replace an uncertain delivery.");
  }
  await ctx.db.patch(sequence._id, { identityFingerprint: identity.fingerprint, updatedAt: now });
  if (held) {
    await ctx.db.patch(held._id, {
      dueAt: Math.min(held.dueAt, now),
      identityDeferredAt: undefined,
      error: undefined,
      ...(changedDraft ? {
        draft: undefined,
        identity: undefined,
        generationStartedAt: held.generationStartedAt ?? now,
      } : {}),
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.sendStep, { stepId: held._id });
  }
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: sequence.clientOrgId,
    summary: "Approved the sender identity for automated outreach",
    metadata: {
      domain: "procurement",
      operation: "reapprove_outreach_identity",
      requestId: sequence.requestId,
      sequenceId: sequence._id,
    },
  });
  return { sequenceId: sequence._id, resumed: held !== undefined };
}

export const reapproveIdentity = mutation({
  args: {
    sequenceId: v.id("procurementOutreachSequences"),
    expectedFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await reapproveSequenceIdentityByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});

/**
 * Holds the claimed step because the sender must fix or approve something. Like
 * the impersonation hold: the step is retried every few minutes and the
 * sequence stops after a day. Nothing reached Resend in this attempt.
 */
export const holdStepForIdentityInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { held: false as const };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { held: false as const };
    const since = step.identityDeferredAt ?? now;
    if (now - since > IMPERSONATION_MAX_DEFER_MS) {
      await terminalizeSequence(ctx, sequence, {
        status: "stopped",
        reason: "sender_identity_deferral_exceeded",
        now,
      });
      await ctx.db.patch(step._id, { leaseToken: undefined, leaseUntil: undefined });
      return { held: true as const };
    }
    const runAt = now + IMPERSONATION_DEFER_MS;
    await ctx.db.patch(step._id, {
      status: "scheduled",
      dueAt: Math.max(step.dueAt, runAt),
      identityDeferredAt: since,
      error: shorten(args.message),
      attempts: Math.max(0, step.attempts - 1),
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(runAt, internal.actions.providerOutreach.sendStep, {
      stepId: step._id,
    });
    return { held: true as const };
  },
});

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
    summary: `Stopped ${isClientSequence(sequence) ? "client email" : "provider outreach"} sequence on ${request.title}`,
    metadata: {
      domain: "procurement",
      operation: isClientSequence(sequence) ? "stop_client_outreach" : "stop_provider_outreach",
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

/**
 * One live scoped link per outreach. A valid link for the same recipient at the
 * current packet revision is reused (the provider may already hold it); any
 * other earlier live link is revoked so stale grants do not accumulate.
 */
async function scopedPacketLink(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    request: Doc<"procurementRequests">;
    outreachId: Id<"procurementBrokerOutreaches">;
    recipientLabel: string;
    recipientEmail: string;
    now: number;
  },
) {
  const links = await ctx.db
    .query("procurementPacketLinks")
    .withIndex("outreach", (q) => q.eq("outreachId", args.outreachId))
    .take(50);
  const revision = args.request.packetRevision ?? 0;
  const live = links.filter(
    (link) =>
      link.revokedAt === undefined &&
      (link.expiresAt === undefined || link.expiresAt > args.now),
  );
  const reusable = live.find(
    (link) =>
      !!link.token &&
      link.recipientEmail === args.recipientEmail.toLowerCase() &&
      link.packetRevisionAtIssue === revision,
  );
  const revokedIds: Id<"procurementPacketLinks">[] = [];
  for (const link of live) {
    if (link._id === reusable?._id) continue;
    await ctx.db.patch(link._id, {
      revokedAt: args.now,
      revokedByUserId: args.operatorUserId,
      updatedAt: args.now,
    });
    revokedIds.push(link._id);
  }
  if (reusable) return { id: reusable._id, reused: true as const, revokedIds };
  const minted = await mintPacketLinkForOperator(ctx, {
    operatorUserId: args.operatorUserId,
    requestId: args.request._id,
    outreachId: args.outreachId,
    recipientLabel: args.recipientLabel,
    recipientEmail: args.recipientEmail,
  });
  return { id: minted.id, reused: false as const, revokedIds };
}

/**
 * Inserts an active sequence with its scheduled steps and schedules the first
 * send. The first email is due at its staggered slot, matching its scheduled
 * run, so the recovery cron cannot send it early. Shared by provider and client
 * launches; callers authorize and validate first.
 */
export async function insertOutreachSequence(
  ctx: MutationCtx,
  args: {
    request: CompanyRequest;
    sequence: Omit<
      Sequence,
      "_id" | "_creationTime" | "requestId" | "clientOrgId" | "status" | "createdAt" | "updatedAt"
    >;
    staggerMs: number;
    now: number;
    /** The fingerprint of the sender identity the operator reviewed; a mismatch refuses the launch. */
    expectedIdentityFingerprint?: string;
  },
) {
  const { request, now, staggerMs } = args;
  // The launch is bound to the sender identity (From, name, Always CC) it was reviewed with.
  const identity = await assertOutreachIdentity(
    ctx,
    args.sequence.senderUserId,
    args.expectedIdentityFingerprint,
  );
  const schedule = buildOutreachSchedule({
    launchAt: now,
    cadence: args.sequence.cadence,
    limits: { effectiveDate: request.targetEffectiveDate },
  });
  const sequenceId = await ctx.db.insert("procurementOutreachSequences", {
    ...args.sequence,
    identityFingerprint: identity.fingerprint,
    requestId: request._id,
    clientOrgId: request.clientOrgId,
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
        dueAt: step.index === 0 ? step.dueAt + staggerMs : step.dueAt,
        status: "scheduled",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
    );
  await ctx.scheduler.runAfter(staggerMs, internal.actions.providerOutreach.sendStep, {
    stepId: stepIds[0],
  });
  return { sequenceId, schedule };
}

export async function launchProviderOutreachByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    brokerOrgIds: Id<"organizations">[];
    cadence: OutreachCadenceInput;
    cadenceSource: OutreachCadenceSource;
    /** Direct UI choices are validated against the provider's current contacts. */
    selectedContacts?: { brokerOrgId: Id<"organizations">; contactId: Id<"brokerContacts"> }[];
    /** Send-all: unknown-fit providers are skipped even when named. */
    matchedOnly?: boolean;
    /** From `outreachSenderIdentity` in the reviewed preview. */
    expectedIdentityFingerprint?: string;
  },
): Promise<ProviderOutreachLaunchResult> {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  // Cap the raw input first: duplicates must not widen the loop.
  if (!args.brokerOrgIds.length || args.brokerOrgIds.length > MAX_LAUNCH_PROVIDERS)
    throw new Error(`Select one to ${MAX_LAUNCH_PROVIDERS} providers`);
  const cadence = validatedCadence(args.cadence);
  const { request, client } = await loadCompanyRequest(ctx, args.requestId);
  const closed = closedReason(request);
  if (closed) throw new Error("Procurement request is closed");
  const match = matchFor(request, client);
  const testMode = await operatorInTestMode(ctx, args.operatorUserId);
  const now = dayjs().valueOf();
  const result: ProviderOutreachLaunchResult = { launched: [], skipped: [] };
  const seen = new Set<Id<"organizations">>();
  const selectedContacts = new Map<Id<"organizations">, Doc<"brokerContacts">>();
  if ((args.selectedContacts?.length ?? 0) > args.brokerOrgIds.length)
    throw new Error("Select at most one contact per provider");
  // Validate every choice before any launch writes. A stale or foreign contact
  // never silently falls back to the provider's default recipient.
  for (const choice of args.selectedContacts ?? []) {
    if (!args.brokerOrgIds.includes(choice.brokerOrgId) || selectedContacts.has(choice.brokerOrgId))
      throw new Error("Invalid provider contact selection");
    const contact = await ctx.db.get(choice.contactId);
    if (!contact || contact.brokerOrgId !== choice.brokerOrgId || contact.deletedAt !== undefined || !contact.email)
      throw new Error("The selected contact is unavailable. Choose another contact.");
    const org = eligibleProviderOrg(await ctx.db.get(choice.brokerOrgId));
    if (!org || !selectRecipient([contact], needAcceptedCodes(match.needs.needs), null, org).ok)
      throw new Error("The selected contact cannot receive provider outreach.");
    selectedContacts.set(choice.brokerOrgId, contact);
  }

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
    const evaluation = await evaluateProvider(
      ctx,
      org,
      match,
      testMode,
      outreach,
      true,
      selectedContacts.get(org._id),
    );
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
        contactName: recipient.name ?? undefined,
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
    const link = await scopedPacketLink(ctx, {
      operatorUserId: args.operatorUserId,
      request,
      outreachId,
      recipientLabel: org.name,
      recipientEmail: recipient.email,
      now,
    });
    const { sequenceId, schedule } = await insertOutreachSequence(ctx, {
      request,
      sequence: {
        outreachId,
        brokerOrgId: org._id,
        recipient: storedRecipient(recipient),
        senderUserId: args.operatorUserId,
        packetLinkId: link.id,
        cadence,
        cadenceSource: args.cadenceSource,
      },
      staggerMs: result.launched.length * LAUNCH_STAGGER_MS,
      now,
      expectedIdentityFingerprint: args.expectedIdentityFingerprint,
    });
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
        packetLinkReused: link.reused,
        revokedPacketLinkIds: link.revokedIds,
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
    selectedContacts: v.optional(v.array(v.object({
      brokerOrgId: v.id("organizations"),
      contactId: v.id("brokerContacts"),
    }))),
    expectedIdentityFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ProviderOutreachLaunchResult> => {
    const operator = await requireOperator(ctx);
    if (!args.expectedIdentityFingerprint)
      throw new Error("Reload to review the From and CC before sending");
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
        generationStartedAt: undefined,
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

/**
 * Saves the operator's cadence choice for a request on change. A row without a
 * suggestion yet starts `failed` with an empty fingerprint, so the next
 * suggestion request still runs and keeps these overrides.
 */
export const saveCadenceOverride = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    field: v.union(
      v.literal("followUpCount"),
      v.literal("intervalBusinessDays"),
      v.literal("style"),
    ),
    value: v.union(v.number(), v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    const { request } = await loadCompanyRequest(ctx, args.requestId);
    if (closedReason(request)) throw new Error("Procurement request is closed");
    const existing = await ctx.db
      .query("procurementOutreachCadences")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .first();
    const base = existing?.overrides ?? {};
    const merged = validatedCadence({
      ...OUTREACH_DEFAULT_CADENCE,
      ...base,
      [args.field]: args.value,
    } as OutreachCadenceInput);
    if (args.field === "style" && !OUTREACH_STYLES.includes(merged.style))
      throw new Error("Unknown follow-up style");
    const overrides = { ...base, [args.field]: merged[args.field] };
    const now = dayjs().valueOf();
    if (existing) await ctx.db.patch(existing._id, { overrides, updatedAt: now });
    else
      await ctx.db.insert("procurementOutreachCadences", {
        requestId: args.requestId,
        fingerprint: "",
        status: "failed",
        overrides,
        createdAt: now,
        updatedAt: now,
      });
    return { overrides };
  },
});

/** Facts for the Jev cadence call; null when the row is stale or no longer pending. */
export const getCadenceInputInternal = internalMutation({
  args: { cadenceId: v.id("procurementOutreachCadences") },
  handler: async (ctx, { cadenceId }) => {
    const row = await ctx.db.get(cadenceId);
    // One-shot: the first caller marks inference started; any other queued
    // action for this row (old or new fingerprint) gets null and never generates.
    if (!row || row.status !== "pending" || row.generationStartedAt !== undefined)
      return null;
    let loaded: Awaited<ReturnType<typeof loadCompanyRequest>>;
    try {
      loaded = await loadCompanyRequest(ctx, row.requestId);
    } catch {
      return null;
    }
    const { request, client } = loaded;
    const match = matchFor(request, client);
    if (cadenceFingerprint(request, match) !== row.fingerprint) return null;
    await ctx.db.patch(row._id, { generationStartedAt: dayjs().valueOf() });
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("deletion_type", (q) => q.eq("deletedAt", undefined).eq("type", "broker"))
      .take(MAX_PANEL_PROVIDERS);
    let matchedCount = 0;
    for (const org of orgs) {
      if (!eligibleProviderOrg(org)) continue;
      // Cadence inference counts the market for any operator: no test mode.
      const evaluation = await evaluateProvider(ctx, org, match, false, null, false);
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

type ProviderWorld = {
  outreach: Doc<"procurementBrokerOutreaches">;
  broker: Doc<"organizations">;
  link: Doc<"procurementPacketLinks"> & { token: string };
};
type StepWorld = {
  request: Doc<"procurementRequests">;
  client: Doc<"organizations">;
  /** Null for client information requests. */
  provider: ProviderWorld | null;
  sender: Doc<"users"> | null;
  previous: Step | null;
};
type WorldCheck =
  | {
      kind: "ok";
      world: StepWorld;
      /** A saved draft was composed under a different sender identity and nothing has been attempted: recompose it. */
      refreshDraft: boolean;
    }
  | { kind: "stop"; reason: string }
  | { kind: "skip"; reason: string }
  | {
      kind: "defer";
      reason: string;
      runAt: number;
      since: number;
      message: string;
      /** Which hold this is; each keeps its own "held since" so causes stay distinct. */
      cause: "impersonation" | "identity";
    };

/** The "held since" marker for one cause of deferral; the other cause's marker is untouched. */
function deferMarkers(check: Extract<WorldCheck, { kind: "defer" }>) {
  return check.cause === "identity"
    ? { identityDeferredAt: check.since }
    : { impersonationDeferredAt: check.since };
}

/** Provider-only revalidation: outreach, proposal, provider, recipient, fit and packet link. */
async function checkProviderWorld(
  ctx: Ctx,
  step: Step,
  sequence: Sequence,
  request: Doc<"procurementRequests">,
  client: Doc<"organizations">,
  now: number,
): Promise<{ kind: "stop"; reason: string } | { kind: "ok"; world: ProviderWorld }> {
  if (!sequence.outreachId || !sequence.brokerOrgId || !sequence.packetLinkId)
    return { kind: "stop", reason: "outreach_removed" };
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
  if (!profile?.isTest && (await operatorInTestMode(ctx, sequence.senderUserId)))
    return { kind: "stop", reason: "provider_ineligible" };
  try {
    assertExternalBrokerIdentity({ ...broker, email: sequence.recipient.email });
  } catch {
    return { kind: "stop", reason: "recipient_ineligible" };
  }
  // The recipient is a snapshot: never retarget a sequence. Launch persists the
  // chosen email on the outreach, so any change or clearing there stops it, and a
  // snapshot contact must still be a live contact of this provider with that email.
  const snapshotEmail = normalizeProcurementEmail(sequence.recipient.email);
  if (normalizeProcurementEmail(outreach.contactEmail ?? "") !== snapshotEmail)
    return { kind: "stop", reason: "recipient_changed" };
  if (sequence.recipient.contactId) {
    const contact = await ctx.db.get(sequence.recipient.contactId);
    if (
      !contact ||
      contact.deletedAt !== undefined ||
      contact.brokerOrgId !== sequence.brokerOrgId ||
      normalizeProcurementEmail(contact.email ?? "") !== snapshotEmail
    )
      return { kind: "stop", reason: "recipient_changed" };
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
  return { kind: "ok", world: { outreach, broker, link: { ...link, token: link.token } } };
}

/**
 * The single revalidation used at claim and again immediately before the
 * network send. It never writes.
 */
async function checkStepWorld(
  ctx: Ctx,
  step: Step,
  sequence: Sequence,
  now: number,
  /** True when no earlier attempt of this step could have reached Resend. */
  firstAttempt: boolean,
  /** The inbox the worker is about to send from (the final checkpoint knows it; the claim does not). */
  sendingInboxId?: string,
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
  let provider: ProviderWorld | null = null;
  if (isClientSequence(sequence)) {
    if (sequence.informationFormId) {
      const form = await ctx.db.get(sequence.informationFormId);
      if (!form || form.requestId !== sequence.requestId || form.outreachSequenceId !== sequence._id || form.status === "cancelled")
        return { kind: "stop", reason: "information_form_unavailable" };
      // A new email about a submitted form may send once; reminders stop on submission.
      if (form.status === "submitted" && (step.index > 0 || sequence.createdAt < (form.submittedAt ?? 0)))
        return { kind: "stop", reason: "information_form_submitted" };
    }
    // The recipient is a snapshot: it must still be a current client contact.
    const recipients = await clientRecipientOptions(ctx, request, client._id);
    const snapshotEmail = normalizeProcurementEmail(sequence.recipient.email);
    if (!recipients.some((option) => option.email === snapshotEmail))
      return { kind: "stop", reason: "recipient_changed" };
  } else {
    const checked = await checkProviderWorld(ctx, step, sequence, request, client, now);
    if (checked.kind === "stop") return checked;
    provider = checked.world;
  }


  // Schedule-time cutoffs are re-checked at send time: a delayed follow-up must
  // never land past the effective date/deadline cutoff or the 30-day span.
  if (
    step.index > 0 &&
    dayjs
      .utc(now)
      .startOf("day")
      .isAfter(
        followUpCutoff(sequence.createdAt, { effectiveDate: request.targetEffectiveDate }),
      )
  )
    return { kind: "stop", reason: "follow_up_window_closed" };

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
  if (impersonating) {
    const since = step.impersonationDeferredAt ?? now;
    if (now - since > IMPERSONATION_MAX_DEFER_MS)
      return { kind: "stop", reason: "impersonation_deferral_exceeded" };
    return {
      kind: "defer",
      reason: "sender_impersonating",
      runAt: now + IMPERSONATION_DEFER_MS,
      since,
      message: "Sender is impersonating a client",
      cause: "impersonation",
    };
  }

  // The sender's identity (name, From, team address, Always CC) must be usable and
  // still the one this email was approved or composed with. A problem the operator can
  // fix in Profile holds the step (rechecked every few minutes, stopped after a day)
  // instead of failing the sequence.
  const hold = (reason: string, message: string): WorldCheck => {
    const since = step.identityDeferredAt ?? now;
    if (now - since > IMPERSONATION_MAX_DEFER_MS)
      return { kind: "stop", reason: "sender_identity_deferral_exceeded" };
    return {
      kind: "defer",
      reason,
      runAt: now + IMPERSONATION_DEFER_MS,
      since,
      message,
      cause: "identity",
    };
  };
  let refreshDraft = false;
  const current = await outreachSenderIdentity(ctx, sequence.senderUserId);
  if (!current.ok) return hold("sender_identity_unavailable", current.message);
  if (
    step.index === 0 &&
    sequence.identityFingerprint &&
    current.identity.fingerprint !== sequence.identityFingerprint
  )
    return hold(
      "sender_identity_changed",
      "Your sender name, team address or Always CC changed since this was approved. Review the new From and CC and approve again.",
    );
  if (
    step.identity &&
    (current.identity.fingerprint !== step.identity.fingerprint ||
      (sendingInboxId !== undefined && step.identity.inboxId !== sendingInboxId))
  ) {
    const approved = step.index === 0 && sequence.identityFingerprint !== undefined;
    // Nothing was attempted and the approval does not pin it: recompose under the new identity.
    if (firstAttempt && !step.resendDraftId && !approved) {
      refreshDraft = true;
    } else {
      // The saved email may already be on its way, or was approved as it was: it is never
      // sent under a changed identity and never replaced by a fresh send.
      return hold(
        "sender_identity_changed",
        "Your sender name, team address or Always CC changed after this email was prepared. It will send once they match again.",
      );
    }
  }

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
    // A follow-up to a captured email has no real thread: sending it live would
    // reach the provider as a standalone message with no initial email.
    if (previous.status === "captured" && getEmailDeliveryMode() !== "capture")
      return { kind: "stop", reason: "capture_lineage_live_mode" };
  }
  return {
    kind: "ok",
    refreshDraft,
    world: {
      request,
      client,
      provider,
      sender: await ctx.db.get(sequence.senderUserId),
      previous,
    },
  };
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
      /**
       * The predecessor was captured (never really sent). Only valid while
       * `EMAIL_DELIVERY_MODE=capture`; the claim already stops the sequence with
       * `capture_lineage_live_mode` otherwise. Actions must also refuse any live
       * send when this is true (defense in depth).
       */
      capturedPredecessor: boolean;
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
        audience: "provider" | "client";
        /** The operator's own first message (client information requests). */
        message: Sequence["message"] | null;
        recipient: Sequence["recipient"];
        cadence: Sequence["cadence"];
        resendThreadId: string | null;
        lastOutboundEmailId: string | null;
        /** The inbox the conversation lives in; null before the first email. */
        inboxId: string | null;
      };
      sender: { userId: Id<"users">; name: string | null; email: string | null };
      /** The last email already sent on this sequence, for the history quoted when a follow-up moves to a new inbox. */
      lastSent: { sentAt: number; text: string } | null;
      request: {
        clientOrgId: Id<"organizations">;
        coverageLines: string[];
        regions: string[];
        title: string;
        clientName: string;
        targetEffectiveDate: string | null;
        isRenewal: boolean;
      };
      /** Provider outreach only. */
      broker: { name: string } | null;
      packet: { linkId: Id<"procurementPacketLinks">; url: string; fileCount: number } | null;
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

    const check = await checkStepWorld(ctx, step, sequence, now, step.attempts === 0);
    if (check.kind === "skip") {
      // A finished sequence leaves nothing to resume; clear an orphaned send.
      if (recovered && !isLive(sequence.status))
        await ctx.db.patch(step._id, {
          status: "cancelled",
          error: "stopped_while_sending",
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
        ...deferMarkers(check),
        error: check.message,
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
    const draftRefreshed = check.refreshDraft;
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
      impersonationDeferredAt: undefined,
      identityDeferredAt: undefined,
      // Nothing was attempted under the old identity: recompose the saved draft.
      ...(draftRefreshed
        ? {
            draft: undefined,
            identity: undefined,
            generationStartedAt: step.generationStartedAt ?? now,
          }
        : {}),
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
      capturedPredecessor: world.previous?.status === "captured",
      step: {
        stepId: step._id,
        index: step.index,
        kind: step.kind,
        isFinal: step.isFinal,
        dueAt: step.dueAt,
        attempts: step.attempts + 1,
        firstAttemptAt,
        draft: draftRefreshed ? null : (step.draft ?? null),
        generationStartedAt: step.generationStartedAt ?? null,
        resendDraftId: step.resendDraftId ?? null,
      },
      sequence: {
        sequenceId: sequence._id,
        requestId: sequence.requestId,
        audience: isClientSequence(sequence) ? "client" : "provider",
        message: sequence.message ?? null,
        recipient: sequence.recipient,
        cadence: sequence.cadence,
        resendThreadId: sequence.resendThreadId ?? null,
        lastOutboundEmailId: sequence.lastOutboundEmailId ?? null,
        inboxId: sequence.inboxId ?? null,
      },
      sender: {
        userId: sequence.senderUserId,
        name: world.sender?.name ?? null,
        email: world.sender?.email ?? null,
      },
      lastSent: (() => {
        const sent = earlier
          .filter((row) => row.index < step.index && row.status === "sent" && row.draft?.text)
          .sort((a, b) => b.index - a.index)[0];
        return sent?.draft && sent.sentAt
          ? { sentAt: sent.sentAt, text: sent.draft.text.slice(0, QUOTED_HISTORY_CHARS) }
          : null;
      })(),
      request: {
        clientOrgId: sequence.clientOrgId,
        coverageLines: matchFor(world.request, world.client).needs.needs.map((need) => need.label),
        regions: matchFor(world.request, world.client).geography.places.map((place) =>
          place.region ? `${place.country}-${place.region}` : place.country),
        title: world.request.title,
        clientName: world.client.name,
        targetEffectiveDate: world.request.targetEffectiveDate ?? null,
        isRenewal: !!world.request.replacingPolicyId,
      },
      broker: world.provider ? { name: world.provider.broker.name } : null,
      packet: world.provider
        ? {
            linkId: world.provider.link._id,
            url: `${getClientPortalUrl()}/share/packet/${world.provider.link.token}`,
            fileCount: world.provider.link.artifactSnapshot?.length ?? 0,
          }
        : null,
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
 * Like `fencedStep`, but also accepts a `cancelled` step that still carries this
 * worker's lease token (a stop landed mid-send), within the provider's
 * idempotency window. Used only to record what actually happened or to drop the
 * token; it can never start new work.
 */
async function leasedStepAfterStop(
  ctx: MutationCtx,
  stepId: Id<"procurementOutreachSteps">,
  leaseToken: string,
  now: number,
) {
  const step = await ctx.db.get(stepId);
  if (!step || step.leaseToken !== leaseToken) return null;
  if (step.status === "sending") return step;
  if (step.status === "cancelled" && now - (step.firstAttemptAt ?? 0) <= DELIVERY_RETRY_WINDOW_MS)
    return step;
  return null;
}

/**
 * Checkpoint immediately before the network send: re-runs the claim checks and
 * extends the lease. On failure the sequence is already stopped (or the step
 * deferred) and the worker must not send.
 */
export const beginSendInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    /** The inbox the worker will send from; null in capture mode, where no inbox exists. */
    inboxId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { ok: false as const, reason: "stale_lease" };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { ok: false as const, reason: "sequence_missing" };
    const sendingInboxId = args.inboxId && !isCapturedResourceId(args.inboxId) ? args.inboxId : undefined;
    let check = await checkStepWorld(ctx, step, sequence, now, step.attempts === 1, sendingInboxId);
    // Last checkpoint: the inbox must still be the sender's active operator inbox.
    if (check.kind === "ok" && sendingInboxId) {
      const row = await ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", sendingInboxId))
        .first();
      if (
        !row ||
        row.kind === "agent" ||
        row.userId !== sequence.senderUserId ||
        (row.status ?? "active") !== "active"
      ) {
        const since = step.identityDeferredAt ?? now;
        check =
          now - since > IMPERSONATION_MAX_DEFER_MS
            ? { kind: "stop", reason: "sender_identity_deferral_exceeded" }
            : {
                kind: "defer",
                reason: "sender_inbox_inactive",
                runAt: now + IMPERSONATION_DEFER_MS,
                since,
                message: "Your team inbox changed while this was being sent. It will retry.",
                cause: "identity",
              };
      }
    }
    if (check.kind === "ok" && !check.refreshDraft) {
      const leaseUntil = now + STEP_LEASE_MS;
      await ctx.db.patch(step._id, {
        leaseUntil,
        impersonationDeferredAt: undefined,
        identityDeferredAt: undefined,
        updatedAt: now,
      });
      return { ok: true as const, leaseUntil };
    }
    if (check.kind === "stop") {
      await terminalizeSequence(ctx, sequence, { status: "stopped", reason: check.reason, now });
      // This worker is told not to send, so nothing remains to record: drop its token.
      await ctx.db.patch(step._id, { leaseToken: undefined, leaseUntil: undefined });
      return { ok: false as const, reason: check.reason };
    }
    if (check.kind === "ok") {
      // Nothing reached Resend: drop the draft and run the step again under the current identity.
      await ctx.db.patch(step._id, {
        status: "scheduled",
        draft: undefined,
        identity: undefined,
        generationStartedAt: step.generationStartedAt ?? now,
        attempts: Math.max(0, step.attempts - 1),
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.sendStep, {
        stepId: step._id,
      });
      return { ok: false as const, reason: "sender_identity_refresh" };
    }
    if (check.kind === "defer") {
      await ctx.db.patch(step._id, {
        status: "scheduled",
        dueAt: Math.max(step.dueAt, check.runAt),
        ...deferMarkers(check),
        error: check.message,
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
    // A draft saved before CC snapshots existed, with nothing created at Resend
    // and no earlier attempt, is recomposed from the template with the sender's
    // current identity. Once an attempt may have reached Resend it stays as saved.
    if (step.draft && step.draft.cc === undefined && !step.resendDraftId && step.attempts <= 1) {
      await ctx.db.patch(step._id, {
        draft: undefined,
        identity: undefined,
        generationStartedAt: step.generationStartedAt ?? now,
        updatedAt: now,
      });
      return { mode: "template_only" as const };
    }
    if (step.draft) return { mode: "saved" as const, draft: step.draft };
    if (step.generationStartedAt !== undefined) return { mode: "template_only" as const };
    await ctx.db.patch(step._id, { generationStartedAt: now, updatedAt: now });
    return { mode: "generate" as const };
  },
});

/**
 * First writer wins: a saved draft is never replaced, so retries resend identical
 * content. The draft is saved with the identity (fingerprint and inbox) it was
 * composed under, and only if that is still the sender's current identity.
 */
export const saveDraftInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    draft: stepDraftValidator,
    identity: v.object({ fingerprint: v.string(), inboxId: v.string() }),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { stored: false as const };
    if (step.draft) return { stored: true as const, draft: step.draft };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { stored: false as const };
    const current = await outreachSenderIdentity(ctx, sequence.senderUserId);
    if (!current.ok || current.identity.fingerprint !== args.identity.fingerprint)
      return { stored: false as const };
    await ctx.db.patch(step._id, { draft: args.draft, identity: args.identity, updatedAt: now });
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

/**
 * Binds the sequence to the sender's ACTIVE inbox (which `ensureOperatorInbox`
 * has already persisted). Only the sender's own active operator inbox is
 * accepted. A sequence already in a different inbox (the old one was retired)
 * moves only while nothing has been prepared at Resend: an initial step with no
 * draft id re-binds, a follow-up reports `rotated` so it can continue from the
 * active inbox as a new message that quotes the history (the sequence moves once
 * that send is recorded). An initial step whose draft already lives in the old
 * inbox is refused: it may already be on its way and is never re-sent elsewhere.
 */
export const recordInboxInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    inboxId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ stored: boolean; rotated: boolean; reason?: string }> => {
    const now = dayjs().valueOf();
    const step = await fencedStep(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { stored: false, rotated: false, reason: "stale_lease" };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { stored: false, rotated: false, reason: "sequence_missing" };
    const row = await ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inboxId))
      .first();
    if (
      !row ||
      row.kind === "agent" ||
      row.userId !== sequence.senderUserId ||
      (row.status ?? "active") !== "active"
    )
      return { stored: false, rotated: false, reason: "inbox_not_active_for_sender" };
    if (sequence.inboxId === args.inboxId) return { stored: true, rotated: false };
    if (sequence.inboxId === undefined) {
      await ctx.db.patch(sequence._id, { inboxId: args.inboxId, updatedAt: now });
      return { stored: true, rotated: false };
    }
    if (step.kind === "initial") {
      if (step.resendDraftId)
        return { stored: false, rotated: false, reason: "inbox_changed_after_draft" };
      await ctx.db.patch(sequence._id, { inboxId: args.inboxId, updatedAt: now });
      return { stored: true, rotated: false };
    }
    return { stored: true, rotated: true };
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

/** Facts of a real send: email id, thread, delivery ledger, and (first email) packet link and outreach. */
async function recordSentFacts(
  ctx: MutationCtx,
  args: {
    sequence: Sequence;
    step: Step;
    outcome: Extract<StepFinishOutcome, { kind: "sent" }>;
    now: number;
  },
) {
  const { sequence, step, outcome, now } = args;
  // A follow-up sent from the active inbox after the old one was retired starts a
  // new Resend thread there. The conversation moves with it; the new thread id
  // is learned from that email's `inbox.email.sent` event and bound to the same
  // team conversation.
  const targetInbox = outcome.inboxId
    ? await ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", outcome.inboxId!))
        .first()
    : null;
  const moved =
    outcome.inboxId !== undefined &&
    sequence.inboxId !== undefined &&
    sequence.inboxId !== outcome.inboxId &&
    targetInbox?.userId === sequence.senderUserId &&
    targetInbox.kind !== "agent";
  await ctx.db.patch(sequence._id, {
    lastOutboundEmailId: outcome.resendEmailId,
    ...(moved
      ? { inboxId: outcome.inboxId, resendThreadId: undefined }
      : outcome.resendThreadId && !sequence.resendThreadId
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
  if (step.index !== 0) return;
  if (isClientSequence(sequence)) {
    await writeOperatorAudit(ctx, {
      operatorUserId: sequence.senderUserId,
      type: "setup_write",
      targetOrgId: sequence.clientOrgId,
      summary: "Sent client information request",
      metadata: {
        domain: "procurement",
        operation: "send_client_outreach",
        requestId: sequence.requestId,
        sequenceId: sequence._id,
        status: "sent",
      },
    });
    return;
  }
  // Same effect as procurementPacket.recordDeliveryInternal, applied to the real send.
  const link = sequence.packetLinkId ? await ctx.db.get(sequence.packetLinkId) : null;
  if (link)
    await ctx.db.patch(link._id, {
      deliveryStatus: "sent",
      deliveryError: undefined,
      sentAt: now,
      updatedAt: now,
    });
  const outreach = sequence.outreachId ? await ctx.db.get(sequence.outreachId) : null;
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

/**
 * Records the outcome of a send. If a stop cancelled the step mid-send, the
 * worker's still-held lease token is accepted once (within the idempotency
 * window): the step stays `cancelled` and the sequence keeps its terminal
 * status, nothing is rescheduled, but a real send's email id, time, thread,
 * delivery ledger and (first email) link/outreach facts are persisted so the
 * webhook maps and the operator sees that it was delivered. A captured outcome
 * after a stop records nothing and never claims a delivery.
 */
export const finishStepInternal = internalMutation({
  args: {
    stepId: v.id("procurementOutreachSteps"),
    leaseToken: v.string(),
    outcome: stepFinishOutcomeValidator,
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const step = await leasedStepAfterStop(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { applied: false as const, reason: "stale_lease" };
    const sequence = await ctx.db.get(step.sequenceId);
    if (!sequence) return { applied: false as const, reason: "sequence_missing" };
    const { outcome } = args;
    if (step.status === "cancelled") {
      await ctx.db.patch(step._id, {
        ...(outcome.kind === "sent"
          ? {
              sentAt: now,
              resendEmailId: outcome.resendEmailId,
              ...(outcome.resendDraftId ? { resendDraftId: outcome.resendDraftId } : {}),
            }
          : {}),
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      if (outcome.kind === "sent") await recordSentFacts(ctx, { sequence, step, outcome, now });
      return {
        applied: true as const,
        recordedAfterStop: true as const,
        sequenceStatus: sequence.status,
        nextStepId: null,
        nextDueAt: null,
      };
    }
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
    if (outcome.kind === "sent") await recordSentFacts(ctx, { sequence, step, outcome, now });
    if (sequence.status !== "active")
      return {
        applied: true as const,
        recordedAfterStop: false as const,
        sequenceStatus: sequence.status,
        nextStepId: null,
        nextDueAt: null,
      };
    const request = await ctx.db.get(sequence.requestId);
    const next = await scheduleRemainingSteps(ctx, sequence, request, {
      anchorAt: now,
      now,
    });
    return {
      applied: true as const,
      recordedAfterStop: false as const,
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
    const step = await leasedStepAfterStop(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { applied: false as const, reason: "stale_lease" };
    if (step.status === "cancelled") {
      // Stopped mid-send and the send did not complete: just drop the token.
      await ctx.db.patch(step._id, { leaseToken: undefined, leaseUntil: undefined });
      return { applied: true as const, outcome: "cancelled" as const };
    }
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
    const step = await leasedStepAfterStop(ctx, args.stepId, args.leaseToken, now);
    if (!step) return { applied: false as const, reason: "stale_lease" };
    if (step.status === "cancelled") {
      // Stopped mid-send and the send did not complete: just drop the token.
      await ctx.db.patch(step._id, { leaseToken: undefined, leaseUntil: undefined });
      return { applied: true as const, outcome: "cancelled" as const };
    }
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

/**
 * Blocks sends the moment an inbound reply is known, before its body is
 * fetched. An `active` sequence becomes `reply_check` with this reply pending.
 * A second distinct reply while one is pending is never allowed to replace it
 * (a human reply could be buried under a later auto-reply that then resumes the
 * sequence): the sequence is handed to the operator as `responded`, and every
 * email stays mirrored. The same pending email again is a no-op, except that a
 * known provider time replaces the arrival-time fallback. Timestamps are only
 * recorded (clamped to now) and never decide a timeout: recovery uses `updatedAt`.
 */
async function holdForInboundReply(
  ctx: MutationCtx,
  sequence: Sequence,
  args: { emailId: string; occurredAt: number | null; fallbackAt: number; now: number },
): Promise<{ isPending: boolean; status: SequenceStatus }> {
  const observed = (at: number) => Math.min(at, args.now);
  if (sequence.status === "active") {
    await ctx.db.patch(sequence._id, {
      status: "reply_check",
      pendingReplyEmailId: args.emailId,
      replyCheckStartedAt: observed(args.occurredAt ?? args.fallbackAt),
      updatedAt: args.now,
    });
    return { isPending: true, status: "reply_check" };
  }
  if (sequence.status !== "reply_check") return { isPending: false, status: sequence.status };
  if (sequence.pendingReplyEmailId === args.emailId) {
    if (args.occurredAt !== null && sequence.replyCheckStartedAt !== observed(args.occurredAt))
      await ctx.db.patch(sequence._id, { replyCheckStartedAt: observed(args.occurredAt) });
    return { isPending: true, status: "reply_check" };
  }
  await terminalizeSequence(ctx, sequence, {
    status: "responded",
    reason: "multiple_replies_during_check",
    now: args.now,
  });
  return { isPending: false, status: "responded" };
}

/**
 * Persists a verified webhook event once and schedules `handleInboxEvent`.
 * A newly recorded `received` event for a known thread holds the sequence in
 * `reply_check` in this same transaction. `occurredAt` is the email's Resend
 * `received_at` (epoch ms), used only to order replies.
 */
export const recordInboxEventInternal = internalMutation({
  args: {
    emailId: v.string(),
    eventType: inboxEventTypeValidator,
    inboxId: v.string(),
    threadId: v.string(),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // The Resend webhook is account-wide; only inboxes this deployment created
    // matter (retired ones included, so replies to old threads still map).
    const known = await knownInbox(ctx, args.inboxId);
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
    if (args.eventType === "inbox.email.received") {
      // Includes a reply on the old thread of a sequence that moved to a new inbox.
      const owned = await sequenceForInboxEvent(ctx, args);
      if (owned)
        await holdForInboundReply(ctx, owned.sequence, {
          emailId: args.emailId,
          occurredAt: args.occurredAt ?? null,
          fallbackAt: now,
          now,
        });
    }
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
      outreachId: Id<"procurementBrokerOutreaches"> | null;
      sequenceStatus: SequenceStatus;
      recipientEmail: string;
      resendThreadId: string | null;
      senderUserId: Id<"users">;
    }
  /** An existing team conversation: by thread id, by a linked extra thread, or by the sent email it was bound from. */
  | {
      kind: "thread";
      threadId: Id<"teamEmailThreads">;
      via: "thread" | "link" | "sent_binding";
    }
  /** Normal mail in a known operator inbox that no conversation owns: becomes an unlinked team thread. */
  | { kind: "team" }
  /** The shared command-channel inbox: never imported as mail. */
  | { kind: "agent" }
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
      /** The operator who owns the inbox; null for the agent inbox. */
      inboxOwnerUserId: Id<"users"> | null;
      inbox: InboxRecord | null;
    };

/** A row for an inbox this deployment created (active or retired), else null. */
async function knownInbox(ctx: Ctx, inboxId: string) {
  return await ctx.db
    .query("operatorOutreachInboxes")
    .withIndex("by_inboxId", (q) => q.eq("inboxId", inboxId))
    .first();
}

/** Exact pointers keep retired-inbox replies and manual takeover independent of request size. */
async function sequencesForTeamThread(ctx: Ctx, thread: TeamThread): Promise<Sequence[]> {
  const current = await ctx.db
    .query("procurementOutreachSequences")
    .withIndex("by_teamEmailThreadId", (q) => q.eq("teamEmailThreadId", thread._id))
    .take(101);
  if (current.length > 100)
    throw new Error("Too many outreach sequences for this conversation; review before replying");
  return current.filter((sequence) => sequence.requestId === thread.requestId);
}

/**
 * The outreach sequence an inbox event belongs to. Either the sequence's own
 * inbox and thread, or, after the sender's inbox was retired and the sequence
 * moved, an exact link: this inbox and thread are linked to the sequence's team
 * conversation, and the inbox belongs to the sequence's sender. Both the inbox
 * and the thread id must match; a thread id alone never attributes an event.
 */
async function sequenceForInboxEvent(
  ctx: Ctx,
  event: { inboxId: string; threadId: string; eventType: string; emailId: string },
): Promise<{ sequence: Sequence; step: Step | null } | null> {
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
  if (sequence && sequence.inboxId === event.inboxId) return { sequence, step };
  const link = await ctx.db
    .query("teamEmailThreadLinks")
    .withIndex("by_inboxId_and_resendThreadId", (q) =>
      q.eq("inboxId", event.inboxId).eq("resendThreadId", event.threadId),
    )
    .first();
  const thread = link ? await ctx.db.get(link.threadId) : null;
  const inbox = await knownInbox(ctx, event.inboxId);
  if (!thread || thread.deletedAt || thread.source !== "outreach" || !thread.requestId || !inbox?.userId)
    return null;
  const owner = (await sequencesForTeamThread(ctx, thread)).find(
    (candidate) => candidate.requestId === thread.requestId && candidate.senderUserId === inbox.userId,
  );
  if (owner) return { sequence: owner, step: null };
  return null;
}

/**
 * Routing order: the known-inbox guard, then the outreach sequence, a team
 * thread by Resend thread id, a link row, the sent email a conversation was
 * bound from, and finally an unlinked team thread. Unknown inboxes are never
 * imported and the command-channel inbox is reserved.
 */
async function routeInboxEvent(
  ctx: Ctx,
  event: Doc<"providerOutreachWebhookEvents">,
): Promise<InboxEventRoute> {
  const inbox = await knownInbox(ctx, event.inboxId);
  if (!inbox) return { kind: "unmatched" };
  if (inbox.kind === "agent") return { kind: "agent" };
  const owned = await sequenceForInboxEvent(ctx, event);
  if (owned) {
    const { sequence, step } = owned;
    return {
      kind: "sequence",
      sequenceId: sequence._id,
      stepId: step?._id ?? null,
      requestId: sequence.requestId,
      outreachId: sequence.outreachId ?? null,
      sequenceStatus: sequence.status,
      recipientEmail: sequence.recipient.email,
      resendThreadId: sequence.resendThreadId ?? null,
      senderUserId: sequence.senderUserId,
    };
  }
  const byThread = await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", event.threadId))
    .first();
  if (byThread && !byThread.deletedAt)
    return { kind: "thread", threadId: byThread._id, via: "thread" };
  const link = await ctx.db
    .query("teamEmailThreadLinks")
    .withIndex("by_inboxId_and_resendThreadId", (q) =>
      q.eq("inboxId", event.inboxId).eq("resendThreadId", event.threadId),
    )
    .first();
  const linked = link ? await ctx.db.get(link.threadId) : null;
  if (linked && !linked.deletedAt) return { kind: "thread", threadId: linked._id, via: "link" };
  if (event.eventType === "inbox.email.sent") {
    const sent = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_resendInboxEmailId", (q) => q.eq("resendInboxEmailId", event.emailId))
      .first();
    const bound = sent ? await ctx.db.get(sent.threadId) : null;
    if (bound && !bound.deletedAt)
      return { kind: "thread", threadId: bound._id, via: "sent_binding" };
  }
  return { kind: "team" };
}

/**
 * Whether a conversation event that nothing owns yet could still gain an owner:
 * an inbound email can be the copy of a sent email (in any inbox) whose own
 * event has not been processed, and a sent email can belong to a send that has
 * not been mirrored.
 */
async function teamBindingMayAppear(
  ctx: MutationCtx,
  event: Doc<"providerOutreachWebhookEvents">,
  now: number,
) {
  if (event.eventType === "inbox.email.sent")
    return now - event.createdAt < SENT_EVENT_BINDING_WAIT_MS;
  const LIMIT = 100;
  for (const status of ["pending", "processing"] as const) {
    const open = await ctx.db
      .query("providerOutreachWebhookEvents")
      .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status))
      .take(LIMIT);
    if (open.length >= LIMIT) return true;
    if (
      open.some(
        (row) => row._id !== event._id && row.eventType === "inbox.email.sent",
      )
    )
      return true;
  }
  return false;
}

/**
 * Whether an unmapped event could still gain a sequence: only if a recently
 * updated sequence in the same inbox has no thread id yet (its first
 * email's sent-event or finish has not landed, including a send stopped in flight). Bounded scan; if the bound is
 * hit, waiting is assumed. Anything else is unmatched immediately.
 */
async function mappingMayAppear(
  ctx: MutationCtx,
  event: Doc<"providerOutreachWebhookEvents">,
  now: number,
) {
  const LIMIT = 100;
  for (const status of SEQUENCE_STATUSES) {
    const recent = await ctx.db
      .query("procurementOutreachSequences")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", status).gte("updatedAt", now - INBOX_EVENT_MAPPING_WINDOW_MS),
      )
      .take(LIMIT);
    if (recent.length >= LIMIT) return true;
    if (recent.some((row) => row.inboxId === event.inboxId && !row.resendThreadId)) return true;
  }
  return false;
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
    let route = await routeInboxEvent(ctx, event);
    if (route.kind === "sequence" && event.eventType === "inbox.email.received") {
      const sequence = await ctx.db.get(route.sequenceId);
      if (sequence) {
        const held = await holdForInboundReply(ctx, sequence, {
          emailId: event.emailId,
          occurredAt: null,
          fallbackAt: event.createdAt,
          now,
        });
        route = { ...route, sequenceStatus: held.status };
      }
    }
    if (
      (route.kind === "unmatched" || route.kind === "team") &&
      now - event.createdAt < INBOX_EVENT_MAPPING_WINDOW_MS &&
      ((await mappingMayAppear(ctx, event, now)) ||
        (route.kind === "team" && (await teamBindingMayAppear(ctx, event, now))))
    ) {
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
    const operatorInbox = await knownInbox(ctx, event.inboxId);
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
      inboxOwnerUserId: operatorInbox?.userId ?? null,
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

/**
 * The event, sequence, inbox and thread must agree; the caller-supplied
 * sequence id is never trusted on its own.
 */
async function eventCorrelatesWithSequence(
  ctx: MutationCtx,
  event: Doc<"providerOutreachWebhookEvents">,
  sequence: Sequence,
) {
  if (sequence.inboxId !== event.inboxId) {
    // Not the sequence's current inbox: only an exact link to its conversation counts.
    return (await sequenceForInboxEvent(ctx, event))?.sequence._id === sequence._id;
  }
  if (!sequence.inboxId) return false;
  if (sequence.resendThreadId) return sequence.resendThreadId === event.threadId;
  if (event.eventType !== "inbox.email.sent") return false;
  // The thread id is learned from the first sent event, matched by its step's email id.
  const step = await ctx.db
    .query("procurementOutreachSteps")
    .withIndex("by_resendEmailId", (q) => q.eq("resendEmailId", event.emailId))
    .first();
  return step?.sequenceId === sequence._id;
}

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
 * Idempotent mirror of one sequence email into its request's conversation. The
 * conversation is the sequence's team thread, found by Resend thread id, or created on
 * the first email. Outreach conversations never move between requests.
 */
async function mirrorInboxEmail(
  ctx: MutationCtx,
  args: {
    sequence: Sequence;
    request: Doc<"procurementRequests">;
    email: InboxEmail;
    attachments: { fileId: Id<"_storage">; filename: string; contentType: string; size: number }[];
    resendThreadId: string;
    /** The inbox that holds `resendThreadId`; defaults to the sequence's inbox. */
    inboxId?: string;
    inbound: boolean;
    sentByUserId?: Id<"users">;
    now: number;
  },
) {
  const { sequence, request, email } = args;
  let thread: TeamThread | null = sequence.teamEmailThreadId
    ? await ctx.db.get(sequence.teamEmailThreadId)
    : null;
  if (thread?.deletedAt) thread = null;
  thread ??= await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", args.resendThreadId))
    .first();
  if (thread?.deletedAt) thread = null;
  if (thread && (thread.requestId !== request._id || thread.clientOrgId !== sequence.clientOrgId)) {
    await Promise.all(args.attachments.map((file) => ctx.storage.delete(file.fileId)));
    throw new Error("Outreach conversation belongs to another request");
  }
  const client = isClientSequence(sequence);
  const create: NewTeamThread = {
    source: "outreach",
    ownerUserId: sequence.senderUserId,
    outreachId: sequence.outreachId,
    resendThreadId: args.resendThreadId,
    clientOrgId: sequence.clientOrgId,
    requestId: request._id,
    addressedRequestId: request._id,
    category: client ? "client" : "broker",
    categoryReason: client ? "client email" : "provider outreach",
  };
  const mirrored = await mirrorTeamEmail(ctx, {
    target: thread ? { thread } : { create },
    email,
    direction: args.inbound ? "inbound" : "outbound",
    attachments: args.attachments,
    resendThreadId: args.resendThreadId,
    inboxId: args.inboxId ?? sequence.inboxId,
    sentByUserId: args.inbound ? undefined : (args.sentByUserId ?? sequence.senderUserId),
    extraParticipants: [sequence.recipient.email],
    now: args.now,
  });
  if ("rejected" in mirrored) throw new Error(`Outreach conversation unavailable: ${mirrored.reason}`);
  if (sequence.teamEmailThreadId !== mirrored.threadId)
    await ctx.db.patch(sequence._id, {
      teamEmailThreadId: mirrored.threadId,
      updatedAt: args.now,
    });
  return mirrored;
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
    if (
      event.eventType !== "inbox.email.sent" ||
      event.emailId !== args.email.resendInboxEmailId ||
      !(await eventCorrelatesWithSequence(ctx, event, sequence))
    ) {
      await finishEvent(ctx, event, now, "event_sequence_mismatch");
      return { applied: false as const, reason: "event_sequence_mismatch" };
    }
    // The sequence learns its thread only from an email in its own inbox; an email on
    // an old thread in a retired inbox must not replace it.
    if (!sequence.resendThreadId && sequence.inboxId === event.inboxId)
      await ctx.db.patch(sequence._id, { resendThreadId: event.threadId, updatedAt: now });
    const request = await mirrorableRequest(ctx, sequence);
    const mirrored = request
      ? await mirrorInboxEmail(ctx, {
          sequence: { ...sequence, resendThreadId: sequence.resendThreadId ?? event.threadId },
          request,
          email: args.email,
          attachments: [],
          resendThreadId: event.threadId,
          inboxId: event.inboxId,
          inbound: false,
          now,
        })
      : null;
    await finishEvent(ctx, event, now);
    return { applied: true as const, duplicate: mirrored?.duplicate ?? false };
  },
});

function repliedReason(sequence: Sequence) {
  return isClientSequence(sequence) ? "client_replied" : "provider_replied";
}

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
    if (
      event.eventType !== "inbox.email.received" ||
      event.emailId !== args.email.resendInboxEmailId ||
      !(await eventCorrelatesWithSequence(ctx, event, sequence))
    ) {
      await Promise.all(attachments.map((file) => ctx.storage.delete(file.fileId)));
      await finishEvent(ctx, event, now, "event_sequence_mismatch");
      return { applied: false as const, reason: "event_sequence_mismatch" };
    }
    const request = await mirrorableRequest(ctx, sequence);
    const mirrored = request
      ? await mirrorInboxEmail(ctx, {
          sequence,
          request,
          email: args.email,
          attachments,
          resendThreadId: event.threadId,
          inboxId: event.inboxId,
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
    if (mirrored && args.classification === "reply") {
      const senderAddress = normalizeProcurementEmail(args.email.fromEmail);
      const operatorSender =
        (await resolveActiveOperatorEmail(ctx, senderAddress)) ||
        (await ctx.db.query("operatorOutreachInboxes")
          .withIndex("by_emailAddress", (q) => q.eq("emailAddress", senderAddress))
          .first());
      if (!operatorSender)
        await emitOperatorNotification(ctx, {
          eventKey: `inbox:team_mail:${mirrored.messageId}`,
          category: "inbox",
          target: { kind: "inbox", threadId: mirrored.threadId },
        });
    }
    const emailId = args.email.resendInboxEmailId;
    let status: SequenceStatus = sequence.status;
    let classifyScheduled = false;
    if (args.classification === "bounce") {
      if (isLiveOrHandoffTarget(sequence.status)) {
        await terminalizeSequence(ctx, sequence, { status: "stopped", reason: "bounced", now });
        status = "stopped";
      }
    } else if (sequence.status === "completed") {
      // Final step already sent: nothing to resume, hand straight to the operator.
      await terminalizeSequence(ctx, sequence, {
        status: "responded",
        reason: repliedReason(sequence),
        now,
      });
      status = "responded";
    } else {
      // Normally a no-op: the record/claim steps already held the sequence. Only
      // the newest reply is classified; an older or repeated one just stays mirrored.
      const held = await holdForInboundReply(ctx, sequence, {
        emailId,
        occurredAt: args.email.occurredAt,
        fallbackAt: now,
        now,
      });
      status = held.status;
      if (held.isPending) {
        await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.classifyReply, {
          sequenceId: sequence._id,
          emailId,
        });
        classifyScheduled = true;
      }
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

/**
 * `inbox.email.received` / `inbox.email.sent` for mail no outreach sequence
 * owns: mirrors it into its team conversation (found by thread id, link, or
 * the send it was bound from) or into a new unlinked conversation owned by the
 * inbox's operator. The route is recomputed here from the stored event; the
 * action's claim is never trusted. A copy of mail Spot itself sent (for example
 * a CC in another inbox) is bound to the original conversation, not stored again.
 */
export const applyTeamInboxEmailInternal = internalMutation({
  args: {
    eventId: v.id("providerOutreachWebhookEvents"),
    leaseToken: v.string(),
    email: inboxEmailValidator,
    /** Uploaded attachment bytes; empty while Resend exposes no byte download. */
    attachments: v.optional(v.array(inboxAttachmentValidator)),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const attachments = args.attachments ?? [];
    const dropUploads = () =>
      Promise.all(attachments.map((file) => ctx.storage.delete(file.fileId)));
    const event = await fencedEvent(ctx, args.eventId, args.leaseToken, now);
    if (!event) {
      await dropUploads();
      return { applied: false as const, reason: "stale_lease" };
    }
    const reject = async (reason: string) => {
      await dropUploads();
      await finishEvent(ctx, event, now, reason);
      return { applied: false as const, reason };
    };
    if (event.emailId !== args.email.resendInboxEmailId) return await reject("event_email_mismatch");
    const inbox = await knownInbox(ctx, event.inboxId);
    if (!inbox) return await reject("unknown_inbox");
    if (inbox.kind === "agent") return await reject("agent_inbox_reserved");
    const route = await routeInboxEvent(ctx, event);
    if (route.kind !== "thread" && route.kind !== "team") return await reject("event_route_mismatch");
    const inbound = event.eventType === "inbox.email.received";
    // Mail from one of our own inboxes may be the copy of a send whose
    // `inbox.email.sent` has not landed to supply its Message-ID: wait briefly,
    // then treat it as ordinary (internal) mail. The sender address only delays.
    if (
      route.kind === "team" &&
      inbound &&
      now - event.createdAt < SENT_EVENT_BINDING_WAIT_MS &&
      (await ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_emailAddress", (q) =>
          q.eq("emailAddress", normalizeProcurementEmail(args.email.fromEmail)),
        )
        .first())
    ) {
      await dropUploads();
      const retryAt = now + INBOX_EVENT_RETRY_MS;
      await ctx.db.patch(event._id, {
        status: "pending",
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAt(retryAt, internal.actions.providerOutreach.handleInboxEvent, {
        eventId: event._id,
      });
      return { applied: false as const, reason: "awaiting_sent_event" };
    }
    let target: { thread: TeamThread } | { create: NewTeamThread };
    if (route.kind === "thread") {
      const thread = await ctx.db.get(route.threadId);
      if (!thread || thread.deletedAt) return await reject("thread_missing");
      target = { thread };
    } else {
      target = {
        create: {
          source: "team",
          ownerUserId: inbox.userId,
          resendThreadId: event.threadId,
          category: "other",
          categoryReason: "Unlinked team mail",
        },
      };
    }
    const mirrored = await mirrorTeamEmail(ctx, {
      target,
      email: args.email,
      direction: inbound ? "inbound" : "outbound",
      attachments,
      resendThreadId: event.threadId,
      inboxId: event.inboxId,
      sentByUserId: inbound ? undefined : inbox.userId,
      now,
    });
    // A dead client/request target takes nothing (uploads already deleted); the event is final.
    if ("rejected" in mirrored) {
      await finishEvent(ctx, event, now, mirrored.reason);
      return { applied: false as const, reason: mirrored.reason };
    }
    let notifyOwner = false;
    if (inbound && !mirrored.duplicate) {
      await ctx.scheduler.runAfter(0, internal.actions.teamEmailForwarding.process, {
        threadId: mirrored.threadId,
        inboxId: event.inboxId,
        emailId: event.emailId,
      });
    }
    const senderAddress = normalizeProcurementEmail(args.email.fromEmail);
    const operatorSender = inbound && (
      (await resolveActiveOperatorEmail(ctx, senderAddress)) ||
      (await ctx.db.query("operatorOutreachInboxes")
        .withIndex("by_emailAddress", (q) => q.eq("emailAddress", senderAddress))
        .first())
    );
    if (inbound && !mirrored.duplicate && !operatorSender) {
      await emitOperatorNotification(ctx, {
        eventKey: `inbox:team_mail:${mirrored.messageId}`,
        category: "inbox",
        target: { kind: "inbox", threadId: mirrored.threadId },
      });
      const thread = (await ctx.db.get(mirrored.threadId))!;
      const ownerUserId = thread.ownerUserId ?? inbox.userId;
      if (ownerUserId) {
        if (thread.clientOrgId && thread.requestId) {
          // Linked conversations reach the owner the same way outreach handoffs do.
          await ctx.scheduler.runAfter(0, internal.lib.notify.notifyInternal, {
            orgId: thread.clientOrgId,
            userId: ownerUserId,
            type: "mailbox_attention",
            severity: "warning",
            actionType: "view_operator_procurement",
            actionPayload: {
              clientOrgId: thread.clientOrgId,
              requestId: thread.requestId,
              view: "email",
              emailThreadId: thread._id,
            },
            title: "New email in your conversation",
            body: `${thread.subject.slice(0, 200)}: review it in the request Inbox.`,
            coalesceKeyParts: ["team_email_thread", String(thread._id)],
            nowMs: now,
          });
        } else {
          // No client to file a notification under: the badge shows it and the owner is emailed.
          await ctx.scheduler.runAfter(0, internal.actions.teamInbox.notifyOwnerOfUnlinkedMail, {
            userId: ownerUserId,
            threadId: thread._id,
          });
          notifyOwner = true;
        }
      }
    }
    await finishEvent(ctx, event, now);
    return {
      applied: true as const,
      duplicate: mirrored.duplicate,
      internalCopy: mirrored.internalCopy,
      threadId: mirrored.threadId,
      notifyOwner,
    };
  },
});

// ---------------------------------------------------------------------------
// Reply classification
// ---------------------------------------------------------------------------

/**
 * One-shot claim of the reply to classify. Returns `claimed` once per
 * (sequence, email): the first caller records `replyClassificationEmailId`
 * before any inference, so a repeated action never replays it. `stale` means
 * the email is no longer the pending reply.
 */
export const getReplyContextInternal = internalMutation({
  args: { sequenceId: v.id("procurementOutreachSequences"), emailId: v.string() },
  handler: async (ctx, args) => {
    const sequence = await ctx.db.get(args.sequenceId);
    if (
      !sequence ||
      sequence.status !== "reply_check" ||
      sequence.pendingReplyEmailId !== args.emailId
    )
      return { status: "stale" as const };
    if (sequence.replyClassificationEmailId === args.emailId)
      return { status: "already_claimed" as const };
    const message = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_resendInboxEmailId", (q) => q.eq("resendInboxEmailId", args.emailId))
      .first();
    // Not mirrored yet: leave unclaimed; recovery hands it to the operator on timeout.
    if (!message) return { status: "not_ready" as const };
    await ctx.db.patch(sequence._id, {
      replyClassificationEmailId: args.emailId,
      updatedAt: dayjs().valueOf(),
    });
    const request = await ctx.db.get(sequence.requestId);
    return {
      status: "claimed" as const,
      sequenceId: sequence._id,
      emailId: args.emailId,
      inboxId: sequence.inboxId ?? null,
      resendThreadId: sequence.resendThreadId ?? null,
      recipientEmail: sequence.recipient.email,
      requestTitle: request?.title ?? null,
      message: {
        subject: message.subject,
        fromEmail: message.fromEmail,
        fromName: message.fromName ?? null,
        text: message.currentText.slice(0, 20_000),
        receivedAt: message.receivedAt,
      },
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
        reason: repliedReason(sequence),
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
const BLOCKED_RECHECK_MS = 5 * 60 * 1000;

export const recoverInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = dayjs().valueOf();
    let dispatched = 0;
    const dispatch = async (stepId: Id<"procurementOutreachSteps">) => {
      await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.sendStep, { stepId });
      dispatched += 1;
    };

    // Expired leases first: the earlier attempt's outcome is unknown and claim
    // reuses its draft and keys. Held or finished sequences never consume the budget.
    const expired = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_status_and_leaseUntil", (q) => q.eq("status", "sending").lte("leaseUntil", now))
      .take(RECOVERY_SCAN);
    for (const step of expired) {
      const sequence = await ctx.db.get(step.sequenceId);
      if (!sequence || !isLive(sequence.status)) {
        // Keep the token: a late worker may still record what it really sent.
        await ctx.db.patch(step._id, {
          status: "cancelled",
          error: "stopped_while_sending",
          updatedAt: now,
        });
        continue;
      }
      if (sequence.status !== "active") {
        // Held: push the lease out so held rows stop crowding the scan window. The
        // original token stays valid for its worker; the sequence is re-timed on resume.
        await ctx.db.patch(step._id, { leaseUntil: now + REPLY_CHECK_TIMEOUT_MS });
        continue;
      }
      if (dispatched >= RECOVERY_DISPATCH) continue;
      await dispatch(step._id);
    }

    // Due scheduled steps. Rows that cannot run yet are pushed into the future so
    // they leave the scan window instead of starving later rows; the sequence
    // re-times its unsent steps when the predecessor finishes or the hold resolves.
    const due = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_status_and_dueAt", (q) => q.eq("status", "scheduled").lte("dueAt", now))
      .take(RECOVERY_SCAN);
    for (const step of due) {
      const sequence = await ctx.db.get(step.sequenceId);
      if (!sequence || !isLive(sequence.status)) {
        await ctx.db.patch(step._id, { status: "cancelled", updatedAt: now });
        continue;
      }
      let blockedFor: number | null = null;
      if (sequence.status !== "active") blockedFor = REPLY_CHECK_TIMEOUT_MS;
      else if (step.index > 0) {
        const previous = await ctx.db
          .query("procurementOutreachSteps")
          .withIndex("by_sequenceId_and_index", (q) =>
            q.eq("sequenceId", sequence._id).eq("index", step.index - 1),
          )
          .unique();
        // Neither skip ahead of, nor overtake, an unfinished predecessor.
        if (!previous || !stepDone(previous)) blockedFor = BLOCKED_RECHECK_MS;
      }
      if (blockedFor !== null) {
        await ctx.db.patch(step._id, { dueAt: now + blockedFor, updatedAt: now });
        continue;
      }
      if (dispatched >= RECOVERY_DISPATCH) break;
      await dispatch(step._id);
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

    // Webhook events: abandoned `processing` leases first (a crashed handler has
    // already consumed the mapping window), then pending ones, 50 in total.
    const stuckEvents = await ctx.db
      .query("providerOutreachWebhookEvents")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "processing").lte("updatedAt", now - INBOX_EVENT_LEASE_MS),
      )
      .take(RECOVERY_DISPATCH);
    const pendingEvents =
      stuckEvents.length < RECOVERY_DISPATCH
        ? await ctx.db
            .query("providerOutreachWebhookEvents")
            .withIndex("by_status_and_updatedAt", (q) =>
              q.eq("status", "pending").lte("updatedAt", now - 60_000),
            )
            .take(RECOVERY_DISPATCH - stuckEvents.length)
        : [];
    const eventBatch = [...stuckEvents, ...pendingEvents];
    for (const event of eventBatch)
      await ctx.scheduler.runAfter(0, internal.actions.providerOutreach.handleInboxEvent, {
        eventId: event._id,
      });

    return {
      steps: dispatched,
      replyChecksTimedOut: checking.length,
      cadencesFailed: pendingCadences.length,
      events: eventBatch.length,
    };
  },
});

/** Stops follow-ups immediately before an approved manual reply calls Resend. */
export const stopFollowUpsForOperatorReplyInternal = internalMutation({
  args: { teamEmailThreadId: v.id("teamEmailThreads") },
  handler: async (ctx, args): Promise<{ stopped: number }> => {
    const thread = await ctx.db.get(args.teamEmailThreadId);
    if (!thread || thread.deletedAt) return { stopped: 0 };
    const sequences = await sequencesForTeamThread(ctx, thread);
    const now = dayjs().valueOf();
    let stopped = 0;
    for (const sequence of sequences) {
      if (!isLive(sequence.status)) continue;
      await terminalizeSequence(ctx, sequence, { status: "stopped", reason: "operator_replied", now });
      stopped += 1;
    }
    return { stopped };
  },
});
