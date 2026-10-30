import dayjs from "dayjs";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { stripNameAfterSignOff } from "./emailSkill";
import {
  APPLICATION_LINK,
  MAX_PROVIDER_EMAIL_BODY_CHARS,
  MAX_PROVIDER_EMAIL_SUBJECT_CHARS,
  unknownMergeVariables,
  type ProviderEmail,
} from "./providerOutreachMerge";

type Ctx = QueryCtx | MutationCtx;
export type ProviderOutreachDraft = Doc<"providerOutreachDrafts">;

/** A request's saved draft for one provider, or its mail-merge template when `brokerOrgId` is omitted. */
export async function readProviderOutreachDraft(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
  brokerOrgId?: Id<"organizations">,
) {
  return await ctx.db
    .query("providerOutreachDrafts")
    .withIndex("by_requestId_and_brokerOrgId", (q) =>
      q.eq("requestId", requestId).eq("brokerOrgId", brokerOrgId),
    )
    .unique();
}

/** The draft's email when it is ready to show. */
export function readyDraftEmail(draft: ProviderOutreachDraft | null): ProviderEmail | null {
  return draft?.status === "ready" && draft.subject && draft.body
    ? { subject: draft.subject, body: draft.body }
    : null;
}

/** A draft's write problem; unlike a send, `[needs: …]` blanks are allowed. */
export function providerDraftProblem(email: ProviderEmail): string | null {
  const subject = email.subject.replace(/\s+/g, " ").trim();
  if (!subject) return "Add a subject.";
  if (subject.length > MAX_PROVIDER_EMAIL_SUBJECT_CHARS) return "The subject is too long.";
  if (!email.body.trim()) return "Write the email.";
  if (email.body.length > MAX_PROVIDER_EMAIL_BODY_CHARS) return "The email is too long.";
  const unknown = unknownMergeVariables(`${subject}\n${email.body}`);
  if (unknown.length) return `Unknown variable ${unknown.map((key) => `{{${key}}}`).join(", ")}.`;
  if (subject.includes(APPLICATION_LINK)) return "The application link can only go in the email body.";
  if (!email.body.includes(APPLICATION_LINK)) return `Keep ${APPLICATION_LINK} in the body; it becomes the provider's own secure link.`;
  return null;
}

export function normalizedDraftEmail(email: ProviderEmail): ProviderEmail {
  return {
    subject: email.subject.replace(/\s+/g, " ").trim(),
    body: stripNameAfterSignOff(email.body.replace(/\r\n?/g, "\n").trim()),
  };
}

/** Saves a draft that open composers adopt while unedited. Nothing is sent. */
export async function writeProviderOutreachDraft(
  ctx: MutationCtx,
  args: {
    requestId: Id<"procurementRequests">;
    brokerOrgId?: Id<"organizations">;
    email: ProviderEmail;
    source: "spot" | "agent";
  },
) {
  const email = normalizedDraftEmail(args.email);
  const problem = providerDraftProblem(email);
  if (problem) throw new Error(problem);
  const fields = {
    status: "ready" as const,
    subject: email.subject,
    body: email.body,
    source: args.source,
    updatedAt: dayjs().valueOf(),
  };
  const existing = await readProviderOutreachDraft(ctx, args.requestId, args.brokerOrgId);
  if (existing) await ctx.db.patch(existing._id, fields);
  else
    await ctx.db.insert("providerOutreachDrafts", {
      requestId: args.requestId,
      ...(args.brokerOrgId ? { brokerOrgId: args.brokerOrgId } : {}),
      ...fields,
    });
  return email;
}

/**
 * Asks Spot's drafting model to tailor one provider's first email, once: any
 * existing draft is kept, and a failed attempt is never replayed (the
 * composer keeps the request's template).
 */
export async function queueProviderOutreachDraft(
  ctx: MutationCtx,
  args: { requestId: Id<"procurementRequests">; brokerOrgId: Id<"organizations"> },
) {
  const existing = await readProviderOutreachDraft(ctx, args.requestId, args.brokerOrgId);
  if (existing) return { queued: false, status: existing.status };
  const draftId = await ctx.db.insert("providerOutreachDrafts", {
    ...args,
    status: "pending",
    updatedAt: dayjs().valueOf(),
  });
  await ctx.scheduler.runAfter(0, internal.actions.providerOutreachDrafts.tailor, { draftId });
  return { queued: true, status: "pending" as const };
}
