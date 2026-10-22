import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { submittedIntakeApplication } from "../../lib/intake-application";
import { isSpotOwnedDomain } from "./brokerProfileValidation";
import { extractEmailAddress } from "./emailAddress";
import { normalizeProcurementEmail } from "./procurement";

/** Client information requests: who at the client may receive one. */

const MAX_CLIENT_MEMBERS = 50;
export const MAX_CLIENT_SUBJECT_CHARS = 200;
export const MAX_CLIENT_MESSAGE_CHARS = 8_000;

export type ClientRecipientOption = {
  email: string;
  name: string | null;
  userId: Id<"users"> | null;
  source: "member" | "applicant";
};

/**
 * Current client members plus the request's applicant contact, deduplicated by
 * email. Spot-owned addresses are never offered. Launch and every send re-read
 * this list, so a removed member or edited applicant email stops follow-ups.
 */
export async function clientRecipientOptions(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
  clientOrgId: Id<"organizations">,
): Promise<ClientRecipientOption[]> {
  const options = new Map<string, ClientRecipientOption>();
  const add = (option: ClientRecipientOption) => {
    const email = extractEmailAddress(option.email);
    if (!email || isSpotOwnedDomain(email)) return;
    const key = normalizeProcurementEmail(email);
    const known = options.get(key);
    if (!known) options.set(key, { ...option, email: key });
    else if (!known.userId && option.userId)
      options.set(key, { ...known, userId: option.userId, source: "member" });
  };
  const answers =
    submittedIntakeApplication(request)?.answers ?? request.intakeAnswers;
  if (answers?.email)
    add({
      email: answers.email,
      name: answers.name?.trim() || null,
      userId: null,
      source: "applicant",
    });
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("organization", (q) => q.eq("orgId", clientOrgId))
    .take(MAX_CLIENT_MEMBERS);
  for (const membership of memberships) {
    const user = await ctx.db.get(membership.userId);
    if (!user?.email || user.isAnonymous) continue;
    add({
      email: user.email,
      name: user.name?.trim() || null,
      userId: user._id,
      source: "member",
    });
  }
  return [...options.values()];
}
