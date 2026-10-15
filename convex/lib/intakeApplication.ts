import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  companyApplicationProfile,
  submittedIntakeApplication,
  type IntakeApplication,
} from "../../lib/intake-application";

export async function readIntakeBusinessProfile(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  if (org?.intakeBusinessProfile) return org.intakeBusinessProfile;
  const requests = await ctx.db
    .query("procurementRequests")
    .withIndex("organization", (q) => q.eq("clientOrgId", orgId))
    .order("desc")
    .take(100);
  const candidates: {
    application: IntakeApplication;
    sourceRequestId: Id<"procurementRequests">;
  }[] = [];
  for (const request of requests) {
    const application = submittedIntakeApplication(request);
    if (!application || !request.ownerUserId) continue;
    const member = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", orgId).eq("userId", request.ownerUserId!),
      )
      .first();
    if (member?.role === "admin")
      candidates.push({ application, sourceRequestId: request._id });
  }
  candidates.sort(
    (a, b) => b.application.submittedAt - a.application.submittedAt,
  );
  const latest = candidates[0];
  return latest
    ? {
        ...companyApplicationProfile(latest.application),
        sourceRequestId: latest.sourceRequestId,
      }
    : null;
}
export async function saveIntakeBusinessProfile(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
  sourceRequestId: Id<"procurementRequests">,
  application: IntakeApplication,
) {
  const member = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .first();
  if (member?.role !== "admin") return;
  await ctx.db.patch(orgId, {
    intakeBusinessProfile: {
      ...companyApplicationProfile(application),
      sourceRequestId,
    },
  });
}
