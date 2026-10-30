import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { pendingEmailDraftFingerprint } from "./actionConfirmationFingerprint";
import { extractEmailAddress } from "./emailAddress";
import { operatorSenderIdentity } from "./outreachIdentity";
import { doNotContactAddresses, doNotContactReason, providerForEmail } from "./providerRecipients";
import { buildOperatorSignature } from "./teamEmail";
import { teamTargetProblem } from "./teamEmailStore";
import {
  COMPOSE_KEY_PREFIX,
  isComposeKey,
  MAX_TEAM_REPLY_CHARS,
  isMachineAddress,
  normalizeReplyMessage,
  paragraphsHtml,
} from "./teamEmailReply";

type Ctx = QueryCtx | MutationCtx;

export { COMPOSE_KEY_PREFIX, isComposeKey };

const MAX_COPIES = 20;
const MAX_SUBJECT_CHARS = 200;

export type TeamComposeInput = {
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  /** Plain text, as typed; paragraphs are kept. */
  message: string;
  clientOrgId?: Id<"organizations">;
  /** Files the conversation under this request (and its client). */
  requestId?: Id<"procurementRequests">;
  /** Asks the client to complete this form; its reminders stop once the form is done. Needs `requestId`. */
  informationFormId?: Id<"procurementInformationForms">;
};

/** Every field of the pending draft a new email becomes; the fingerprint is computed over these. */
export type TeamComposeDraftFields = {
  recipientEmail: string;
  ccAddresses?: string[];
  bccAddresses?: string[];
  subject: string;
  emailBody: string;
  fromHeader: string;
  renderedText: string;
  renderedHtml: string;
  senderUserId: Id<"users">;
  operatorAlwaysCcEmail?: string;
  transport: "operator_inbox";
  orgId?: Id<"organizations">;
  procurementRequestId?: Id<"procurementRequests">;
  informationFormId?: Id<"procurementInformationForms">;
};

export type TeamComposePreview = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
  /** The sender's signature, appended below the typed message. */
  signature: string;
  /** The client this email is filed under, if any. */
  client: { _id: Id<"organizations">; name: string } | null;
  /** The request this email is filed under, if any. */
  request: { _id: Id<"procurementRequests">; title: string } | null;
  fingerprint: string;
};

export type TeamComposition =
  | { ok: true; fields: TeamComposeDraftFields; preview: TeamComposePreview }
  | { ok: false; reason: string };

function addresses(values: string[]) {
  const parsed = values.map((value) => ({ value, address: extractEmailAddress(value)?.toLowerCase() }));
  const malformed = parsed.filter((entry) => !entry.address).map((entry) => entry.value.trim());
  return { valid: parsed.flatMap((entry) => (entry.address ? [entry.address] : [])), malformed };
}

/**
 * The new email `operatorUserId` would send from their own team inbox, signed
 * as them, with their Always CC. Pure over current state: the preview, the
 * approval fingerprint and the stored draft all come from this one function,
 * so what is approved is what is sent. Recipients are exactly what the
 * operator typed (one To, any Cc/Bcc); Spot's own machine addresses are refused.
 */
export async function composeTeamEmail(
  ctx: Ctx,
  args: TeamComposeInput & { operatorUserId: Id<"users"> },
): Promise<TeamComposition> {
  const message = normalizeReplyMessage(args.message);
  const subject = args.subject.replace(/\s+/g, " ").trim();
  const to = addresses([args.to].filter((value) => value.trim()));
  const cc = addresses(args.cc.filter((value) => value.trim()));
  const bcc = addresses(args.bcc.filter((value) => value.trim()));
  const malformed = [...to.malformed, ...cc.malformed, ...bcc.malformed];
  if (malformed.length) return { ok: false, reason: `Check the address ${malformed.join(", ")}.` };
  const [recipientEmail] = to.valid;
  if (!recipientEmail) return { ok: false, reason: "Add a recipient." };
  if (cc.valid.length > MAX_COPIES || bcc.valid.length > MAX_COPIES) {
    return { ok: false, reason: `Copy at most ${MAX_COPIES} people on Cc and on Bcc.` };
  }
  const machine = [recipientEmail, ...cc.valid, ...bcc.valid].filter(isMachineAddress);
  if (machine.length) return { ok: false, reason: `${machine.join(", ")} is a Spot system address.` };
  const doNotContact = await doNotContactAddresses(ctx, [recipientEmail, ...cc.valid, ...bcc.valid]);
  if (doNotContact.length) return { ok: false, reason: doNotContactReason(doNotContact) };
  if (!subject) return { ok: false, reason: "Add a subject." };
  if (subject.length > MAX_SUBJECT_CHARS) return { ok: false, reason: "The subject is too long." };
  if (!message) return { ok: false, reason: "Write a message." };
  if (message.length > MAX_TEAM_REPLY_CHARS) return { ok: false, reason: "The message is too long." };

  let client: TeamComposePreview["client"] = null;
  let request: TeamComposePreview["request"] = null;
  let clientOrgId = args.clientOrgId;
  if (args.requestId) {
    const record = await ctx.db.get(args.requestId);
    if (
      !record ||
      record.deletedAt !== undefined ||
      !record.clientOrgId ||
      record.intakeAnswers?.intakeGoal === "savings" ||
      (clientOrgId && clientOrgId !== record.clientOrgId)
    ) {
      return { ok: false, reason: "That request is no longer available." };
    }
    clientOrgId = record.clientOrgId;
    request = { _id: record._id, title: record.title };
  }
  let informationFormId: Id<"procurementInformationForms"> | undefined;
  if (args.informationFormId) {
    const form = await ctx.db.get(args.informationFormId);
    if (!request || !form || form.requestId !== request._id || form.status === "cancelled") {
      return { ok: false, reason: "That form is no longer available." };
    }
    informationFormId = form._id;
  }
  if (clientOrgId) {
    const problem = await teamTargetProblem(ctx, {
      clientOrgId,
      ...(request ? { requestId: request._id } : {}),
    });
    const organization = await ctx.db.get(clientOrgId);
    if (problem || !organization || organization.type !== "client") {
      return { ok: false, reason: "That client is no longer available." };
    }
    client = { _id: organization._id, name: organization.name };
  }

  let identity: Awaited<ReturnType<typeof operatorSenderIdentity>>;
  let signature: ReturnType<typeof buildOperatorSignature>;
  try {
    identity = await operatorSenderIdentity(ctx, args.operatorUserId);
    signature = buildOperatorSignature(
      { name: identity.name, address: identity.teamAddress, prompts: identity.prompts },
      { toProvider: !!(await providerForEmail(ctx, recipientEmail)) },
    );
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "You cannot send email yet." };
  }
  const own = identity.teamAddress.toLowerCase();
  const copies = (list: string[], taken: string[]) =>
    [...new Set(list)].filter((address) => address !== own && !taken.includes(address));
  const ccAddresses = copies(
    [...cc.valid, ...(identity.alwaysCc ? [identity.alwaysCc.toLowerCase()] : [])],
    [recipientEmail],
  );
  const bccAddresses = copies(bcc.valid, [recipientEmail, ...ccAddresses]);
  const fields: TeamComposeDraftFields = {
    recipientEmail,
    ...(ccAddresses.length ? { ccAddresses } : {}),
    ...(bccAddresses.length ? { bccAddresses } : {}),
    subject,
    emailBody: message,
    fromHeader: identity.fromHeader,
    renderedText: `${message}\n\n${signature.text}`,
    renderedHtml: `${paragraphsHtml(message)}${signature.html}`,
    senderUserId: args.operatorUserId,
    ...(identity.alwaysCc ? { operatorAlwaysCcEmail: identity.alwaysCc.toLowerCase() } : {}),
    transport: "operator_inbox",
    ...(client ? { orgId: client._id } : {}),
    ...(request ? { procurementRequestId: request._id } : {}),
    ...(informationFormId ? { informationFormId } : {}),
  };
  const fingerprint = await pendingEmailDraftFingerprint(fields);
  return {
    ok: true,
    fields,
    preview: {
      from: fields.fromHeader,
      to: [recipientEmail],
      cc: ccAddresses,
      bcc: bccAddresses,
      subject,
      text: fields.renderedText,
      html: fields.renderedHtml,
      signature: signature.text,
      client,
      request,
      fingerprint,
    },
  };
}
