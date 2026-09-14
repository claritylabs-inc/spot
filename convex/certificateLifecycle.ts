import { copyHolderNotes } from "./certificateNotes";
import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertCanReadPolicies,
  getOrgAccess,
  getPolicyAccessForQuery,
  type OrgAccess,
} from "./lib/access";
import {
  holderSnapshot,
  normalizeCertificateHolderAddress,
  normalizeCertificateHolderContactName,
  normalizeCertificateHolderEmail,
  normalizeCertificateHolderName,
  policyCertificateDedupeKey,
} from "./lib/certificateIdentity";
import {
  certificateHolderIdentity,
  type CertificateHolderResolutionCandidate,
} from "./lib/certificateHolderResolution";
import { assertImpersonatedSetupWrite } from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";
import { certificateRequirementSnapshotValidator } from "./lib/certificateRequirementPlan";

const certificateSourceValidator = v.union(
  v.literal("policy_page"),
  v.literal("chat"),
  v.literal("email"),
  v.literal("imessage"),
  v.literal("slack"),
  v.literal("sms"),
  v.literal("api"),
  v.literal("mcp"),
  v.literal("agent"),
  v.literal("unknown"),
);

const certificateRequestKindValidator = v.union(
  v.literal("holder"),
  v.literal("additional_insured"),
);

const certificateFormCodeValidator = v.union(
  v.literal("acord25"),
  v.literal("acord24"),
  v.literal("acord27"),
  v.literal("acord28"),
  v.literal("acord29"),
  v.literal("acord30"),
  v.literal("acord31"),
);

type ReadCtx = QueryCtx | MutationCtx;
type IssuedCertificateCandidate = {
  candidateId: string;
  policyCertificateId: Id<"policyCertificates">;
  holderId: Id<"certificateHolders">;
  holder: Doc<"certificateHolders">;
  version: Doc<"certificateVersions">;
  url: string | null;
  issuedAt?: number;
  createdAt: number;
};

function assertCanWriteCertificates(access: OrgAccess) {
  assertCanReadPolicies(access);
  if (access.accessType === "connected_client") {
    throwUserFacingError(
      userFacingErrorCodes.readOnlyAccess,
      "Connected organization access is read-only. Ask the vendor to manage this certificate.",
    );
  }
}

function cleanOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isOpenWorkflowJobStatus(
  status: Doc<"certificateWorkflowJobs">["status"],
) {
  return (
    status === "review_required" ||
    status === "blocked_missing_contact" ||
    status === "sending"
  );
}

async function nextCertificateVersionNumber(
  ctx: ReadCtx,
  certificateId: Id<"policyCertificates">,
) {
  const latest = await ctx.db
    .query("certificateVersions")
    .withIndex("certificate_version", (q) =>
      q.eq("certificateId", certificateId),
    )
    .order("desc")
    .first();
  return (latest?.versionNumber ?? 0) + 1;
}

async function currentPolicyVersionId(ctx: ReadCtx, policyId: Id<"policies">) {
  const policy = await ctx.db.get(policyId);
  if (!policy) return undefined;
  if (policy.currentPolicyVersionId) return policy.currentPolicyVersionId;
  const latest = await ctx.db
    .query("policyVersions")
    .withIndex("policy_version", (q) => q.eq("policyId", policyId))
    .order("desc")
    .first();
  return latest?._id;
}

function candidateIdentity(
  holder: Doc<"certificateHolders">,
  version?: Doc<"certificateVersions"> | null,
) {
  const holderSnapshot = version?.holderSnapshot as
    | {
        displayName?: string;
        address?: {
          line1?: string;
          line2?: string;
          city?: string;
          state?: string;
          postalCode?: string;
          country?: string;
          formatted?: string;
        };
      }
    | undefined;
  return certificateHolderIdentity({
    displayName: holder.displayName,
    address: holder.address ?? holderSnapshot?.address,
  });
}

async function collectIssuedCertificateCandidates(
  ctx: ReadCtx,
  args: {
    orgId: Id<"organizations">;
    policyId: Id<"policies">;
    policyVersionId?: Id<"policyVersions">;
    requestKind?: "holder" | "additional_insured";
    requestSignature?: string;
    requireRequestSignature?: boolean;
  },
) {
  const policy = await ctx.db.get(args.policyId);
  if (!policy || policy.orgId !== args.orgId || policy.deletedAt) return [];
  const policyVersionId =
    args.policyVersionId ?? (await currentPolicyVersionId(ctx, args.policyId));
  const parents = await ctx.db
    .query("policyCertificates")
    .withIndex("policy_status", (q) =>
      q.eq("policyId", args.policyId).eq("status", "active"),
    )
    .collect();
  const candidates: CertificateHolderResolutionCandidate<IssuedCertificateCandidate>[] =
    [];
  for (const parent of parents.slice(0, 50)) {
    if (parent.orgId !== args.orgId || !parent.latestIssuedVersionId) continue;
    const [holder, version] = await Promise.all([
      ctx.db.get(parent.holderId),
      ctx.db.get(parent.latestIssuedVersionId),
    ]);
    if (!holder || !version || version.status !== "issued" || !version.fileId)
      continue;
    if (version.policyId !== args.policyId) continue;
    if (policyVersionId && version.policyVersionId !== policyVersionId)
      continue;
    if (
      args.requestKind &&
      (version.requestKind ?? "holder") !== args.requestKind
    )
      continue;
    if (
      args.requireRequestSignature &&
      version.requestSignature !== args.requestSignature
    )
      continue;
    if (
      !args.requireRequestSignature &&
      args.requestSignature &&
      version.requestSignature !== args.requestSignature
    )
      continue;
    const url = await ctx.storage.getUrl(version.fileId);
    const data = {
      candidateId: String(parent._id),
      policyCertificateId: parent._id,
      holderId: holder._id,
      holder,
      version,
      url,
      issuedAt: version.issuedAt,
      createdAt: version.createdAt,
    };
    candidates.push({
      candidateId: data.candidateId,
      identity: candidateIdentity(holder, version),
      issuedAt: version.issuedAt,
      createdAt: version.createdAt,
      data,
    });
  }
  return candidates.sort(
    (left, right) =>
      Number(right.issuedAt ?? right.createdAt ?? 0) -
      Number(left.issuedAt ?? left.createdAt ?? 0),
  );
}

export const listByPolicy = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const access = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!access) return [];
    const certificates = await ctx.db
      .query("policyCertificates")
      .withIndex("policy", (q) => q.eq("policyId", args.policyId))
      .collect();
    const enriched = await Promise.all(
      certificates.map(async (certificate) => {
        const [holder, policy, currentVersion, latestIssuedVersion, versions] =
          await Promise.all([
            ctx.db.get(certificate.holderId),
            ctx.db.get(certificate.policyId),
            certificate.currentVersionId
              ? ctx.db.get(certificate.currentVersionId)
              : null,
            certificate.latestIssuedVersionId
              ? ctx.db.get(certificate.latestIssuedVersionId)
              : null,
            ctx.db
              .query("certificateVersions")
              .withIndex("certificate_version", (q) =>
                q.eq("certificateId", certificate._id),
              )
              .order("desc")
              .collect(),
          ]);
        if (!policy || policy.deletedAt) return null;
        const versionsWithUrls = await Promise.all(
          versions.map(async (version) => ({
            ...version,
            url: version.fileId
              ? await ctx.storage.getUrl(version.fileId)
              : null,
          })),
        );
        return {
          ...certificate,
          holder,
          policy,
          currentVersion,
          latestIssuedVersion,
          url: currentVersion?.fileId
            ? await ctx.storage.getUrl(currentVersion.fileId)
            : null,
          versions: versionsWithUrls,
        };
      }),
    );
    return enriched.filter((row) => row !== null);
  },
});

export const listForOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId, { allowOperator: true });
    assertCanReadPolicies(access);
    const certificates = await ctx.db
      .query("policyCertificates")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .collect();
    return await Promise.all(
      certificates.map(async (certificate) => {
        const [holder, policy, currentVersion, versions] = await Promise.all([
          ctx.db.get(certificate.holderId),
          ctx.db.get(certificate.policyId),
          certificate.currentVersionId
            ? ctx.db.get(certificate.currentVersionId)
            : null,
          ctx.db
            .query("certificateVersions")
            .withIndex("certificate_version", (q) =>
              q.eq("certificateId", certificate._id),
            )
            .order("desc")
            .collect(),
        ]);
        const versionsWithUrls = await Promise.all(
          versions.map(async (version) => ({
            ...version,
            url: version.fileId
              ? await ctx.storage.getUrl(version.fileId)
              : null,
          })),
        );
        return {
          ...certificate,
          holder,
          policy,
          currentVersion,
          url: currentVersion?.fileId
            ? await ctx.storage.getUrl(currentVersion.fileId)
            : null,
          versions: versionsWithUrls,
        };
      }),
    );
  },
});

export const listVersionsInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    certificateId: v.optional(v.id("policyCertificates")),
    holderId: v.optional(v.id("certificateHolders")),
  },
  handler: async (ctx, args) => {
    const rows = args.certificateId
      ? await ctx.db
          .query("certificateVersions")
          .withIndex("certificate_version", (q) =>
            q.eq("certificateId", args.certificateId!),
          )
          .order("desc")
          .collect()
      : args.holderId
        ? await ctx.db
            .query("certificateVersions")
            .withIndex("holder", (q) => q.eq("holderId", args.holderId!))
            .collect()
        : args.policyId
          ? await ctx.db
              .query("certificateVersions")
              .withIndex("policy", (q) => q.eq("policyId", args.policyId!))
              .collect()
          : await ctx.db
              .query("certificateVersions")
              .withIndex("organization", (q) => q.eq("orgId", args.orgId))
              .collect();
    const scoped = rows
      .filter((row) => row.orgId === args.orgId)
      .sort((left, right) => right.createdAt - left.createdAt);
    const parentIds = Array.from(
      new Set(scoped.map((row) => row.certificateId)),
    );
    const parents = new Map(
      await Promise.all(
        parentIds.map(
          async (certificateId) =>
            [certificateId, await ctx.db.get(certificateId)] as const,
        ),
      ),
    );
    const policies = new Map(
      await Promise.all(
        Array.from(new Set(scoped.map((row) => row.policyId))).map(
          async (policyId) => [policyId, await ctx.db.get(policyId)] as const,
        ),
      ),
    );
    const visible = scoped.filter(
      (version) =>
        parents.get(version.certificateId)?.status !== "archived" &&
        !policies.get(version.policyId)?.deletedAt,
    );
    return await Promise.all(
      visible.map(async (version) => ({
        ...version,
        holder: await ctx.db.get(version.holderId),
        url: version.fileId ? await ctx.storage.getUrl(version.fileId) : null,
      })),
    );
  },
});

export const archive = mutation({
  args: { certificateId: v.id("policyCertificates") },
  handler: async (ctx, args) => {
    const certificate = await ctx.db.get(args.certificateId);
    if (!certificate) throw new Error("Certificate not found.");
    const access = await getOrgAccess(ctx, certificate.orgId, {
      allowOperator: true,
    });
    assertCanWriteCertificates(access);
    await assertImpersonatedSetupWrite(ctx, certificate.orgId);
    if (certificate.status === "archived") {
      return { status: "archived", cancelledJobs: 0 };
    }

    const now = dayjs().valueOf();
    await ctx.db.patch(args.certificateId, {
      status: "archived",
      archivedAt: now,
      archivedByUserId: access.userId,
      updatedByUserId: access.userId,
      updatedAt: now,
    });

    const jobs = await ctx.db
      .query("certificateWorkflowJobs")
      .withIndex("certificate", (q) =>
        q.eq("certificateId", args.certificateId),
      )
      .collect();
    let cancelledJobs = 0;
    for (const job of jobs) {
      if (!isOpenWorkflowJobStatus(job.status)) continue;
      await ctx.db.patch(job._id, {
        status: "cancelled",
        cancelReason: "Certificate archived",
        cancelledByUserId: access.userId,
        cancelledAt: now,
        updatedAt: now,
      });
      cancelledJobs += 1;
    }

    return { status: "archived", cancelledJobs };
  },
});

export const unarchive = mutation({
  args: { certificateId: v.id("policyCertificates") },
  handler: async (ctx, args) => {
    const certificate = await ctx.db.get(args.certificateId);
    if (!certificate) throw new Error("Certificate not found.");
    const access = await getOrgAccess(ctx, certificate.orgId, {
      allowOperator: true,
    });
    assertCanWriteCertificates(access);
    await assertImpersonatedSetupWrite(ctx, certificate.orgId);
    if (certificate.status !== "archived") {
      throw new Error("Certificate is not archived.");
    }

    const siblings = await ctx.db
      .query("policyCertificates")
      .withIndex("dedupe", (q) => q.eq("dedupeKey", certificate.dedupeKey))
      .collect();
    const conflict = siblings.find(
      (row) => row._id !== args.certificateId && row.status !== "archived",
    );
    if (conflict) {
      throw new Error("A newer certificate already exists for this holder");
    }

    const now = dayjs().valueOf();
    await ctx.db.patch(args.certificateId, {
      status: "active",
      archivedAt: undefined,
      archivedByUserId: undefined,
      updatedByUserId: access.userId,
      updatedAt: now,
    });

    return { status: "active" };
  },
});

export const getOrCreateParentInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    holderId: v.id("certificateHolders"),
    requirementSourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    source: v.optional(certificateSourceValidator),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const dedupeKey = policyCertificateDedupeKey({
      orgId: String(args.orgId),
      policyId: String(args.policyId),
      holderId: String(args.holderId),
    });
    const existing = (
      await ctx.db
        .query("policyCertificates")
        .withIndex("dedupe", (q) => q.eq("dedupeKey", dedupeKey))
        .collect()
    ).find((row) => row.status !== "archived");
    if (existing) {
      if (
        args.requirementSourceDocumentId &&
        existing.requirementSourceDocumentId !==
          args.requirementSourceDocumentId
      ) {
        await ctx.db.patch(existing._id, {
          requirementSourceDocumentId: args.requirementSourceDocumentId,
          updatedByUserId: args.createdByUserId,
          updatedAt: dayjs().valueOf(),
        });
      }
      return existing._id;
    }
    const now = dayjs().valueOf();
    return await ctx.db.insert("policyCertificates", {
      orgId: args.orgId,
      policyId: args.policyId,
      holderId: args.holderId,
      requirementSourceDocumentId: args.requirementSourceDocumentId,
      status: "active",
      dedupeKey,
      source: args.source,
      createdByUserId: args.createdByUserId,
      updatedByUserId: args.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const findIssuedCertificateHolderCandidatesInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    requestKind: v.optional(certificateRequestKindValidator),
    requestSignature: v.optional(v.string()),
    requireRequestSignature: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await collectIssuedCertificateCandidates(ctx, args);
  },
});

export const nextVersionNumberInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    certificateId: v.id("policyCertificates"),
  },
  handler: async (ctx, args) => {
    const certificate = await ctx.db.get(args.certificateId);
    if (!certificate || certificate.orgId !== args.orgId) {
      throw new Error("Certificate not found.");
    }
    return await nextCertificateVersionNumber(ctx, args.certificateId);
  },
});

export const recordIssuedVersionInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    certificateId: v.id("policyCertificates"),
    holderId: v.id("certificateHolders"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.optional(v.number()),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    holderContactName: v.optional(v.string()),
    holderEmail: v.optional(v.string()),
    holderPhone: v.optional(v.string()),
    holderAddress: v.optional(v.any()),
    updateHolderDetails: v.optional(v.boolean()),
    policySnapshot: v.optional(v.any()),
    policySnapshotHash: v.optional(v.string()),
    source: v.optional(certificateSourceValidator),
    requestKind: v.optional(certificateRequestKindValidator),
    additionalInsuredName: v.optional(v.string()),
    formCode: v.optional(certificateFormCodeValidator),
    requestSignature: v.optional(v.string()),
    descriptionOfOperations: v.optional(v.string()),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    requirementSourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    requirementSnapshots: v.optional(
      v.array(certificateRequirementSnapshotValidator),
    ),
    generationBatchId: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    let holderId = args.holderId;
    if (args.updateHolderDetails) {
      const [certificate, holder, holderReferences, holderPolicyLinks] =
        await Promise.all([
          ctx.db.get(args.certificateId),
          ctx.db.get(args.holderId),
          ctx.db
            .query("policyCertificates")
            .withIndex("holder", (q) => q.eq("holderId", args.holderId))
            .collect(),
          ctx.db
            .query("certificateHolderPolicyLinks")
            .withIndex("holder", (q) => q.eq("holderId", args.holderId))
            .collect(),
        ]);
      const displayName = args.certificateHolderName?.trim();
      if (
        !certificate ||
        certificate.orgId !== args.orgId ||
        certificate.policyId !== args.policyId ||
        certificate.holderId !== args.holderId ||
        !holder ||
        holder.orgId !== args.orgId ||
        !displayName
      ) {
        throw new Error("Certificate holder not found.");
      }
      const email = cleanOptionalText(args.holderEmail);
      const phone = cleanOptionalText(args.holderPhone);
      const normalizedAddressKey = normalizeCertificateHolderAddress(
        args.holderAddress,
      );
      const addressChanged =
        normalizedAddressKey !== holder.normalizedAddressKey;
      const holderDetails = {
        displayName,
        normalizedName: normalizeCertificateHolderName(displayName),
        contactName: normalizeCertificateHolderContactName(
          args.holderContactName,
        ),
        email,
        normalizedEmail: normalizeCertificateHolderEmail(email),
        phone,
        address: args.holderAddress,
        normalizedAddressKey,
        mapboxFeatureId: addressChanged ? undefined : holder.mapboxFeatureId,
        mapboxMetadata: addressChanged ? undefined : holder.mapboxMetadata,
        source: "manual",
        sourceRef: String(args.certificateId),
        updatedByUserId: args.createdByUserId,
        updatedAt: now,
      } as const;
      const holderIsShared = holderReferences.some(
        (reference) => reference._id !== args.certificateId,
      );
      if (holderIsShared) {
        holderId = await ctx.db.insert("certificateHolders", {
          orgId: args.orgId,
          ...holderDetails,
          createdByUserId: args.createdByUserId ?? holder.createdByUserId,
          createdAt: now,
        });
        const copiedHolder = await ctx.db.get(holderId);
        if (copiedHolder) await copyHolderNotes(ctx, holder, copiedHolder);
        await ctx.db.patch(args.certificateId, {
          holderId,
          dedupeKey: policyCertificateDedupeKey({
            orgId: String(args.orgId),
            policyId: String(args.policyId),
            holderId: String(holderId),
          }),
          updatedByUserId: args.createdByUserId,
          updatedAt: now,
        });
        for (const link of holderPolicyLinks) {
          if (link.policyId !== args.policyId) continue;
          await ctx.db.insert("certificateHolderPolicyLinks", {
            orgId: args.orgId,
            holderId,
            policyId: args.policyId,
            policyVersionId: link.policyVersionId,
            relationshipKind: link.relationshipKind,
            status: link.status,
            sourceNodeIds: link.sourceNodeIds,
            sourceSpanIds: link.sourceSpanIds,
            sourceSummary: link.sourceSummary,
            createdByUserId: args.createdByUserId ?? link.createdByUserId,
            updatedByUserId: args.createdByUserId,
            createdAt: now,
            updatedAt: now,
          });
        }
      } else {
        await ctx.db.patch(args.holderId, holderDetails);
      }
    }
    const existingIssued = await ctx.db
      .query("certificateVersions")
      .withIndex("certificate", (q) =>
        q.eq("certificateId", args.certificateId),
      )
      .filter((q) => q.eq(q.field("status"), "issued"))
      .collect();
    for (const version of existingIssued) {
      await ctx.db.patch(version._id, {
        status: "superseded",
        supersededAt: now,
        updatedAt: now,
      });
    }

    const versionNumber = await nextCertificateVersionNumber(
      ctx,
      args.certificateId,
    );
    const versionId = await ctx.db.insert("certificateVersions", {
      orgId: args.orgId,
      certificateId: args.certificateId,
      holderId,
      policyId: args.policyId,
      policyVersionId: args.policyVersionId,
      versionNumber,
      status: "issued",
      fileId: args.fileId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      certificateHolder: args.certificateHolder,
      certificateHolderName: args.certificateHolderName,
      holderSnapshot: holderSnapshot({
        displayName: args.certificateHolderName ?? "Certificate holder",
        contactName: args.holderContactName,
        email: args.holderEmail,
        phone: args.holderPhone,
        address: args.holderAddress,
      }),
      policySnapshot: args.policySnapshot,
      policySnapshotHash: args.policySnapshotHash,
      source: args.source,
      requestKind: args.requestKind ?? "holder",
      additionalInsuredName: args.additionalInsuredName,
      formCode: args.formCode,
      requestSignature: args.requestSignature,
      descriptionOfOperations: args.descriptionOfOperations,
      requirementIds: args.requirementIds,
      requirementSourceDocumentId: args.requirementSourceDocumentId,
      requirementSnapshots: args.requirementSnapshots,
      generationBatchId: args.generationBatchId,
      issuedAt: now,
      createdByUserId: args.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.certificateId, {
      currentVersionId: versionId,
      latestIssuedVersionId: versionId,
      formCode: args.formCode,
      lastIssuedAt: now,
      updatedByUserId: args.createdByUserId,
      updatedAt: now,
    });
    return {
      holderId,
      versionId,
      versionNumber,
    };
  },
});
