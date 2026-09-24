import { v, type Infer } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import {
  assertCanReadPolicies,
  getOrgAccess,
  type OrgAccess,
} from "./lib/access";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const jobStatusValidator = v.union(
  v.literal("review_required"),
  v.literal("blocked_missing_contact"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("cancelled"),
  v.literal("failed"),
);

const jobKindValidator = v.union(
  v.literal("renewal_reissue"),
  v.literal("manual_review"),
);

function assertCertificateWorkspace(access: OrgAccess) {
  assertCanReadPolicies(access);
  if (access.accessType === "connected_client") {
    throwUserFacingError(
      userFacingErrorCodes.readOnlyAccess,
      "Connected organization access is read-only. Ask the vendor to manage this certificate workflow.",
    );
  }
}

/**
 * Removed at integration: P3 call site (convex/actions/policyExtraction.ts).
 * Certificate renewal workflow jobs are removed (nothing could ever send
 * them; see docs/architecture/webmcp.md). Kept as a no-op so the existing
 * call site keeps compiling until P3 removes it.
 */
export const createRenewalJobsForPolicyInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async () => {
    return { created: 0, jobs: [] };
  },
});

/**
 * Removed at integration: P8 call site (components/webmcp/tools/insurance.ts,
 * list_certificate_review_jobs). Certificate renewal workflow jobs are
 * removed. Kept as a no-op so the existing call site keeps compiling until
 * P8 removes it.
 */
const listForOrgRowValidator = v.object({
  _id: v.id("certificateWorkflowJobs"),
  kind: jobKindValidator,
  status: jobStatusValidator,
  holder: v.union(v.object({ displayName: v.string() }), v.null()),
  policyId: v.id("policies"),
  policy: v.union(v.object({ policyNumber: v.optional(v.string()) }), v.null()),
  recipientEmail: v.optional(v.string()),
  reviewNotes: v.optional(v.string()),
});

export const listForOrg = query({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    status: v.optional(jobStatusValidator),
    kind: v.optional(jobKindValidator),
  },
  returns: v.array(listForOrgRowValidator),
  handler: async (ctx, args): Promise<Infer<typeof listForOrgRowValidator>[]> => {
    const access = await getOrgAccess(ctx, args.orgId, { allowOperator: true });
    assertCertificateWorkspace(access);
    return [];
  },
});
