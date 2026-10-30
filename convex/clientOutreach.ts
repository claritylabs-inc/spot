import dayjs from "dayjs";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  MAX_CLIENT_MESSAGE_CHARS,
  MAX_CLIENT_SUBJECT_CHARS,
  clientRecipientOptions,
  type ClientRecipientOption,
} from "./lib/clientOutreach";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";
import { normalizeProcurementEmail } from "./lib/procurement";
import { outreachSenderPanel, type OutreachSenderPanel } from "./lib/outreachIdentity";
import { type OutreachCadenceInput } from "./lib/providerOutreachValidators";
import { MAX_OUTREACH_FOLLOW_UPS, OUTREACH_DEFAULT_CADENCE } from "./lib/providerOutreachSchedule";
import { requireDirectOperatorWrite } from "./procurementRequests";
import {
  closedReason,
  insertOutreachSequence,
  loadCompanyRequest,
  requestSequences,
  sequenceView,
  type SequenceView,
} from "./providerOutreach";

/**
 * Client information requests: an operator email to a client contact with
 * automated follow-ups. Sequences, steps, delivery, inbox mirroring, reply
 * classification and recovery are the provider outreach primitives
 * (`audience: "client"`); this module owns only the composer read and launch.
 */

export type ClientOutreachPanel = {
  canLaunch: boolean;
  closedReason: ReturnType<typeof closedReason>;
  targetEffectiveDate: string | null;
  recipients: ClientRecipientOption[];
  defaultCadence: OutreachCadenceInput;
  sequences: SequenceView[];
};

/** Recipients and client email sequences for a request. Caller authorizes the operator. */
export async function getClientOutreachPanel(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"procurementRequests">,
): Promise<ClientOutreachPanel | null> {
  let loaded: Awaited<ReturnType<typeof loadCompanyRequest>>;
  try {
    loaded = await loadCompanyRequest(ctx, requestId);
  } catch {
    return null;
  }
  const { request, client } = loaded;
  const reason = closedReason(request);
  const sequences = await requestSequences(ctx, requestId, "client");
  const cadenceRow = await ctx.db
    .query("procurementOutreachCadences")
    .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
    .first();
  const views = await Promise.all(
    sequences.rows.slice(0, 50).map(async (sequence) =>
      sequenceView(
        sequence,
        await ctx.db
          .query("procurementOutreachSteps")
          .withIndex("by_sequenceId_and_index", (q) => q.eq("sequenceId", sequence._id))
          .take(MAX_OUTREACH_FOLLOW_UPS + 1),
      ),
    ),
  );
  return {
    canLaunch: reason === null,
    closedReason: reason,
    targetEffectiveDate: request.targetEffectiveDate ?? null,
    recipients: await clientRecipientOptions(ctx, request, client._id),
    // The request's saved provider cadence sets the client follow-up rhythm too.
    defaultCadence: { ...OUTREACH_DEFAULT_CADENCE, ...cadenceRow?.overrides, style: "brief_nudge" },
    sequences: views,
  };
}

/** The request's client contacts, for completing a recipient field. */
export const recipientOptions = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    await requireOperator(ctx);
    try {
      const { request, client } = await loadCompanyRequest(ctx, requestId);
      return await clientRecipientOptions(ctx, request, client._id);
    } catch {
      return [];
    }
  },
});

export const getPanel = query({
  args: {
    requestId: v.id("procurementRequests"),
    informationFormId: v.optional(v.id("procurementInformationForms")),
  },
  handler: async (
    ctx,
    { requestId, informationFormId },
  ): Promise<
    | (ClientOutreachPanel & {
        sender: OutreachSenderPanel & { email: string | null };
        formSubmitted: boolean;
      })
    | null
  > => {
    const operator = await requireOperator(ctx);
    const panel = await getClientOutreachPanel(ctx, requestId);
    if (!panel) return null;
    const form = informationFormId ? await ctx.db.get(informationFormId) : null;
    if (informationFormId && (!form || form.requestId !== requestId))
      throw new Error("Choose a form from this request");
    const formSubmitted = form?.status === "submitted";
    // The From line is the operator's current full name and personal team address,
    // with the Always CC and the fingerprint to approve. Nothing is provisioned here.
    const sender = await outreachSenderPanel(ctx, operator.userId);
    return { ...panel, formSubmitted, sender: { ...sender, email: sender.address } };
  },
});

type ClientOutreachLaunchInput = {
  requestId: Id<"procurementRequests">;
  recipientEmail: string;
  subject: string;
  text: string;
  cadence: OutreachCadenceInput;
  informationFormId?: Id<"procurementInformationForms">;
};

/**
 * Every check a client information request must pass, without writing. The
 * launch and the agent's pre-approval preflight share it, so nothing that can
 * fail at execution is first discovered after the operator approves.
 */
export async function validateClientOutreachLaunch(
  ctx: MutationCtx,
  args: ClientOutreachLaunchInput,
) {
  const subject = args.subject.replace(/\s+/g, " ").trim();
  const text = args.text.replace(/\r\n?/g, "\n").trim();
  if (!subject) throw new Error("Add a subject");
  if (subject.length > MAX_CLIENT_SUBJECT_CHARS) throw new Error("Subject is too long");
  if (!text) throw new Error("Write the message first");
  if (text.length > MAX_CLIENT_MESSAGE_CHARS) throw new Error("Message is too long");
  const { followUpCount, intervalBusinessDays } = args.cadence;
  if (!Number.isInteger(followUpCount) || followUpCount < 0 || followUpCount > MAX_OUTREACH_FOLLOW_UPS)
    throw new Error(`Follow-ups must be 0 to ${MAX_OUTREACH_FOLLOW_UPS}`);
  if (!Number.isInteger(intervalBusinessDays) || intervalBusinessDays < 1 || intervalBusinessDays > 14)
    throw new Error("Interval must be 1 to 14 business days");

  const { request, client } = await loadCompanyRequest(ctx, args.requestId);
  if (closedReason(request)) throw new Error("Procurement request is closed");
  const email = normalizeProcurementEmail(args.recipientEmail);
  const recipient = (await clientRecipientOptions(ctx, request, client._id)).find(
    (option) => option.email === email,
  );
  if (!recipient) throw new Error("Choose a current client contact");
  const form = args.informationFormId ? await ctx.db.get(args.informationFormId) : null;
  if (args.informationFormId && (!form || form.requestId !== request._id || form.status === "cancelled")) throw new Error("Choose an available form from this request");
  if (form?.outreachSequenceId) throw new Error("This form already has an email sequence. Open its conversation to follow up.");
  const live = await requestSequences(ctx, request._id, "client");
  if (
    live.rows.some(
      (row) =>
        (row.status === "active" || row.status === "reply_check") &&
        normalizeProcurementEmail(row.recipient.email) === email &&
        (!args.informationFormId || !row.informationFormId || row.informationFormId === args.informationFormId),
    )
  )
    throw new Error(
      "Follow-ups to this contact are already running. Reply in that conversation or stop its follow-ups first.",
    );
  return { request, client, recipient, form, subject, text, email };
}

export async function launchClientOutreachByOperator(
  ctx: MutationCtx,
  args: ClientOutreachLaunchInput & {
    operatorUserId: Id<"users">;
    /** From the reviewed preview (`sender.fingerprint`); a mismatch refuses the launch. */
    expectedIdentityFingerprint?: string;
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const { request, recipient, form, subject, text } =
    await validateClientOutreachLaunch(ctx, args);
  const { followUpCount, intervalBusinessDays } = args.cadence;

  const now = dayjs().valueOf();
  const cadence = { followUpCount: form?.status === "submitted" ? 0 : followUpCount, intervalBusinessDays, style: "brief_nudge" as const };
  const { sequenceId, schedule } = await insertOutreachSequence(ctx, {
    request,
    sequence: {
      audience: "client",
      informationFormId: args.informationFormId,
      recipient: {
        email: recipient.email,
        ...(recipient.userId ? { userId: recipient.userId } : {}),
        ...(recipient.name ? { name: recipient.name } : {}),
      },
      message: { subject, text },
      senderUserId: args.operatorUserId,
      cadence,
      cadenceSource: { followUpCount: "operator", intervalBusinessDays: "operator", style: "default" },
    },
    staggerMs: 0,
    now,
    expectedIdentityFingerprint: args.expectedIdentityFingerprint,
  });
  if (form) await ctx.db.patch(form._id, { outreachSequenceId: sequenceId });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Started a client information request for ${request.title}`,
    metadata: {
      domain: "procurement",
      operation: "launch_client_outreach",
      requestId: request._id,
      sequenceId,
      recipientDomain: recipient.email.split("@")[1] ?? null,
      recipientUserId: recipient.userId,
      cadence,
      stepCount: schedule.steps.length,
    },
  });
  return {
    sequenceId,
    stepCount: schedule.steps.length,
    droppedFollowUps: schedule.droppedFollowUps,
  };
}
