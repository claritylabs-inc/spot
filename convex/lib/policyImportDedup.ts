import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** All policy upload-hash writers maintain these rows in their own transaction. */
export async function syncPolicyUploadFingerprints(
  ctx: MutationCtx,
  policyId: Id<"policies">,
) {
  const policy = await ctx.db.get(policyId);
  const existing = await ctx.db
    .query("policyUploadFingerprints")
    .withIndex("policy", (q) => q.eq("policyId", policyId))
    .collect();
  const hashes = new Set(policy?.orgId ? (policy.uploadFileSha256s ?? []) : []);
  for (const row of existing) {
    if (row.orgId !== policy?.orgId || !hashes.delete(row.sha256))
      await ctx.db.delete(row._id);
  }
  if (policy?.orgId)
    for (const sha256 of hashes)
      await ctx.db.insert("policyUploadFingerprints", {
        orgId: policy.orgId,
        policyId,
        sha256,
      });
}

/** Lazy legacy discovery is paginated; concurrent hash writes already update the index. */
export async function indexPolicyUploadFingerprintPage(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
) {
  const state = await ctx.db
    .query("policyUploadFingerprintInventories")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .unique();
  if (state?.complete) return true;
  const page = await ctx.db
    .query("policies")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .paginate({ cursor: state?.cursor ?? null, numItems: 100 });
  for (const policy of page.page)
    await syncPolicyUploadFingerprints(ctx, policy._id);
  const value = { orgId, cursor: page.continueCursor, complete: page.isDone };
  if (state) await ctx.db.patch(state._id, value);
  else await ctx.db.insert("policyUploadFingerprintInventories", value);
  return page.isDone;
}

export async function findIndexedPolicyDuplicate(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  hashes: string[],
) {
  const state = await ctx.db
    .query("policyUploadFingerprintInventories")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .unique();
  if (!state?.complete) return { complete: false as const, policyId: null };
  const rows = await ctx.db
    .query("policyUploadFingerprints")
    .withIndex("organization_hash", (q) =>
      q.eq("orgId", orgId).eq("sha256", hashes[0]),
    )
    .take(101);
  for (const row of rows) {
    const policy = await ctx.db.get(row.policyId);
    if (
      policy?.orgId === orgId &&
      !policy.deletedAt &&
      hashes.every((hash) => policy.uploadFileSha256s?.includes(hash))
    )
      return { complete: true as const, policyId: policy._id };
  }
  if (rows.length > 100)
    throw new Error(
      "Too many historical copies of this exact policy file; review duplicate records",
    );
  return { complete: true as const, policyId: null };
}
