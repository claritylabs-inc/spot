"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateCoiPdf, policyToCoiData, type CoiData } from "../lib/coiGenerator";
import type { DecisionQuestion } from "../../contracts/cl-router/policy";
import { clRouterDecide } from "../lib/clRouterClient";
import { pdfPageJevImage, stageJevImages } from "../lib/jevImages";
import { jevProceeds } from "../lib/jevThreshold";
import { renderPdfPageImages } from "../lib/pdfPageImages";
import { logAiError } from "../lib/aiUtils";
import {
  CERTIFICATE_FORM_FILE_SLUGS,
  CERTIFICATE_FORM_LABELS,
  type CertificateFormCode,
} from "../lib/acordForms/types";
import { selectCertificateForm } from "../lib/acordForms/select";
import {
  applyEndorsementsToCertificateData,
  type EndorsementCitation,
} from "../lib/certificateEndorsements";
import {
  normalizeCertificateDescription,
} from "../lib/certificateDescription";
import { certificateRequirementSnapshotValidator } from "../lib/certificateRequirementPlan";

const holderAddressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const certificateFormValidator = v.union(
  v.literal("acord25"),
  v.literal("acord24"),
  v.literal("acord27"),
  v.literal("acord28"),
  v.literal("acord29"),
  v.literal("acord30"),
  v.literal("acord31"),
);

const endorsementCitationValidator = v.object({
  kind: v.union(
    v.literal("additional_insured"),
    v.literal("named_insured"),
    v.literal("waiver_of_subrogation"),
    v.literal("primary_non_contributory"),
    v.literal("loss_payee"),
    v.literal("mortgagee"),
    v.literal("special_wording"),
    v.literal("policy_change"),
  ),
  formNumbers: v.array(v.string()),
  requiresWrittenContract: v.optional(v.boolean()),
});

const COI_QA_BUDGET_MS = 25_000;
const COI_QA_DESCRIPTION_CHARS = 400;

type CoiLayoutCheck = {
  /** True when the question describes a defect; false when it describes a healthy layout. */
  defectWhenYes: boolean;
  finding: string;
  question: DecisionQuestion;
};

function coiLayoutChecks(): Record<string, CoiLayoutCheck> {
  const noul = (question: string, inspect: string): DecisionQuestion => ({
    type: "noul",
    instructions: { question, inspect },
  });
  return {
    holder_visible: {
      defectWhenYes: false,
      finding: "Certificate holder name is not fully visible in its block.",
      question: noul(
        "Is the certificate holder name `coi.holder` fully visible, not clipped or cut off, inside the certificate holder block of `coi.page`?",
        "the certificate holder block at the bottom of `coi.page`",
      ),
    },
    holder_overflow: {
      defectWhenYes: true,
      finding: "Certificate holder text overflows its block.",
      question: noul(
        "Does any text in the certificate holder block of `coi.page` extend past the block's border or overlap other text?",
        "the certificate holder block of `coi.page`",
      ),
    },
    insured_visible: {
      defectWhenYes: false,
      finding: "Insured name is not fully visible in its block.",
      question: noul(
        "Is the insured name `coi.insured` fully visible, not clipped or cut off, inside the insured block of `coi.page`?",
        "the insured block of `coi.page`",
      ),
    },
    description_visible: {
      defectWhenYes: false,
      finding: "Description of operations is clipped or hidden.",
      question: noul(
        "Is the description of operations on `coi.page` readable and not clipped at the edge of its box? The beginning of `coi.description` is the expected text.",
        "the description of operations box of `coi.page`",
      ),
    },
    text_overlap: {
      defectWhenYes: true,
      finding: "Text overlaps other text on the first page.",
      question: noul(
        "Is there any place on `coi.page` where text is drawn on top of other text so that either becomes hard to read?",
        "all of `coi.page`",
      ),
    },
  };
}

type CoiLayoutQa = {
  status: "passed" | "flagged" | "unavailable";
  findings: string[];
  /** Raw yes-probabilities by check, for audit. */
  answers: Record<string, number>;
  error?: string;
};

/**
 * One Jev request over the rendered first page. Advisory only: a flagged or
 * unavailable result is logged and returned, never blocks issuance. Image
 * decisions are not production-hardened, so only confident defects are flagged.
 */
async function qaGeneratedCoi(
  ctx: ActionCtx,
  args: { orgId: Id<"organizations">; policyId: Id<"policies">; pdf: Uint8Array; coi: CoiData },
): Promise<CoiLayoutQa> {
  const checks = coiLayoutChecks();
  try {
    const [page] = await renderPdfPageImages({ pdfBytes: args.pdf, pages: [1] });
    if (!page) throw new Error("Generated certificate has no first page");
    const staged = await stageJevImages(ctx, [pdfPageJevImage(page)], {
      orgId: args.orgId,
      surface: "generate_coi_qa",
      sessionKey: String(args.policyId),
    });
    try {
      const judged = await Promise.race([
        clRouterDecide(
          {
            orgId: args.orgId,
            task: "generated_coi_layout_qa",
            state: {
              coi: {
                page: staged.refs[0],
                holder: firstCertificateHolderLine(args.coi.certificateHolder),
                insured: args.coi.insuredName,
                description: (args.coi.description ?? "").slice(
                  0,
                  COI_QA_DESCRIPTION_CHARS,
                ),
              },
            },
            assets: staged.assets,
            questions: Object.fromEntries(
              Object.entries(checks).map(([key, check]) => [key, check.question]),
            ),
            executionBudgetMs: COI_QA_BUDGET_MS,
          },
          { telemetry: ctx },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Certificate QA timed out")),
            COI_QA_BUDGET_MS + 5_000,
          ),
        ),
      ]);
      const answers: Record<string, number> = {};
      const findings: string[] = [];
      for (const [key, check] of Object.entries(checks)) {
        const answer = judged.answers[key];
        if (answer?.type !== "noul") continue;
        answers[key] = answer.noul;
        const defect = check.defectWhenYes
          ? jevProceeds(answer.noul)
          : jevProceeds(1 - answer.noul);
        if (defect) findings.push(check.finding);
      }
      return { status: findings.length > 0 ? "flagged" : "passed", findings, answers };
    } finally {
      await staged.cleanup();
    }
  } catch (error) {
    return {
      status: "unavailable",
      findings: [],
      answers: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function firstCertificateHolderLine(certificateHolder?: string, fallback = "Certificate holder") {
  return certificateHolder?.split(/\r?\n/)[0]?.trim() || fallback;
}

async function ensureCertificateLifecycleContext(
  ctx: any,
  args: {
    orgId: Id<"organizations">;
    policyId: Id<"policies">;
    certificateHolder?: string;
    certificateHolderName?: string;
    certificateHolderId?: Id<"certificateHolders">;
    policyCertificateId?: Id<"policyCertificates">;
    policyVersionId?: Id<"policyVersions">;
    holderEmail?: string;
    holderPhone?: string;
    holderContactName?: string;
    holderAddress?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      formatted?: string;
    };
    source?: string;
    requirementSourceDocumentId?: Id<"requirementSourceDocuments">;
    createdByUserId?: Id<"users">;
  },
) {
  const holderId = args.certificateHolderId ?? await ctx.runMutation(
    (internal as any).certificateHolders.upsertInternal,
    {
      orgId: args.orgId,
      displayName: args.certificateHolderName?.trim() || firstCertificateHolderLine(args.certificateHolder),
      contactName: args.holderContactName,
      email: args.holderEmail,
      phone: args.holderPhone,
      address: args.holderAddress,
      source: "certificate_generation",
      sourceRef: String(args.policyId),
      createdByUserId: args.createdByUserId,
      updatedByUserId: args.createdByUserId,
    },
  );
  const policyVersionId = args.policyVersionId ?? await ctx.runMutation(
    (internal as any).policyVersions.ensureInitialInternal,
    {
      policyId: args.policyId,
      createdByUserId: args.createdByUserId,
    },
  );
  const policyVersion = args.policyVersionId
    ? await ctx.runQuery(
        (internal as any).policyVersions.getByIdInternal,
        { id: args.policyVersionId },
      ).catch(() => null)
    : await ctx.runQuery(
        (internal as any).policyVersions.getCurrentInternal,
        { policyId: args.policyId },
      ).catch(() => null);
  const policyCertificateId = args.policyCertificateId ?? await ctx.runMutation(
    (internal as any).certificateLifecycle.getOrCreateParentInternal,
    {
      orgId: args.orgId,
      policyId: args.policyId,
      holderId,
      requirementSourceDocumentId: args.requirementSourceDocumentId,
      source: args.source ?? "unknown",
      createdByUserId: args.createdByUserId,
    },
  );

  return {
    holderId: holderId as Id<"certificateHolders">,
    policyCertificateId: policyCertificateId as Id<"policyCertificates">,
    policyVersionId: policyVersionId as Id<"policyVersions">,
    policySnapshot: policyVersion?.snapshot,
  };
}

function cleanFilenamePart(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, 90).trim();
}

function buildCoiFileName(
  policy: Record<string, unknown>,
  certificateHolder?: string,
  certificateHolderName?: string,
  formCode: CertificateFormCode = "acord25",
) {
  const holder = cleanFilenamePart(
    certificateHolderName ?? certificateHolder?.split(/\r?\n/)[0],
    "certificate-holder",
  );
  const policyRef = cleanFilenamePart(
    policy.policyNumber ?? policy.security ?? policy.carrier,
    "policy",
  );
  const form = CERTIFICATE_FORM_FILE_SLUGS[formCode] ?? "certificate";
  return `${form} - ${holder} - ${policyRef}.pdf`;
}

function linesOfBusinessForCertificate(policy: Record<string, any>) {
  const profileLinesOfBusiness = Array.isArray(policy.operationalProfile?.linesOfBusiness)
    ? policy.operationalProfile.linesOfBusiness
    : [];
  const linesOfBusiness = Array.isArray(policy.linesOfBusiness)
    ? policy.linesOfBusiness
    : [];
  return [
    ...profileLinesOfBusiness,
    ...linesOfBusiness,
  ].filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );
}

type GenerateCoiDescriptionArgs = {
  descriptionOfOperations?: string;
};

function fillCertificateDescription(
  args: GenerateCoiDescriptionArgs,
  coiData: ReturnType<typeof policyToCoiData>,
) {
  const requestedDescription = normalizeCertificateDescription(args.descriptionOfOperations);
  return {
    ...coiData,
    description: requestedDescription || coiData.description,
  };
}

/**
 * Generate a COI PDF for a policy and store it in file storage.
 * Returns the storage ID and byte size for download/attachment metadata.
 */
export const run = internalAction({
  args: {
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    certificateHolder: v.optional(v.string()),
    certificateHolderName: v.optional(v.string()),
    source: v.optional(v.union(
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
    )),
    createdByUserId: v.optional(v.id("users")),
    requestKind: v.optional(v.union(
      v.literal("holder"),
      v.literal("additional_insured"),
    )),
    additionalInsuredName: v.optional(v.string()),
    descriptionOfOperations: v.optional(v.string()),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    requirementSourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    requirementSnapshots: v.optional(v.array(certificateRequirementSnapshotValidator)),
    includedLineOfBusinessCodes: v.optional(v.array(v.string())),
    generationBatchId: v.optional(v.string()),
    formCode: v.optional(certificateFormValidator),
    holderRelationship: v.optional(v.string()),
    endorsements: v.optional(v.array(endorsementCitationValidator)),
    requestSignature: v.optional(v.string()),
    certificateHolderId: v.optional(v.id("certificateHolders")),
    policyCertificateId: v.optional(v.id("policyCertificates")),
    policyVersionId: v.optional(v.id("policyVersions")),
    holderEmail: v.optional(v.string()),
    holderPhone: v.optional(v.string()),
    holderContactName: v.optional(v.string()),
    holderAddress: v.optional(holderAddressValidator),
    updateHolderDetails: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    storageId: string;
    size: number;
    fileName: string;
    certificateId: string;
    holderId?: string;
    policyCertificateId?: string;
    certificateVersionId?: string;
    versionNumber?: number;
    formCode: CertificateFormCode;
    descriptionOfOperations?: string;
    layoutQa: CoiLayoutQa;
  }> => {
    try {
      const policy = await ctx.runQuery(internal.policies.getInternal, { id: args.policyId });

      if (!policy) throw new Error("Policy not found");
      if (policy.orgId !== args.orgId) throw new Error("Policy not found for organization");

      const formCode = args.formCode ?? selectCertificateForm({
        linesOfBusiness: linesOfBusinessForCertificate(policy as Record<string, any>),
        holderRelationship: args.holderRelationship,
        operationalProfile: (policy as Record<string, unknown>).operationalProfile,
      });
      let coiData = policyToCoiData(policy, {
        includedLineOfBusinessCodes: args.includedLineOfBusinessCodes,
      });
      coiData = {
        ...coiData,
        formCode,
        title: CERTIFICATE_FORM_LABELS[formCode] ?? coiData.title,
        certificateHolderRelationship: args.holderRelationship,
        interestHolder: args.certificateHolder,
        interestHolderRelationship: args.holderRelationship,
      };
      if (args.certificateHolder) {
        coiData.certificateHolder = args.certificateHolder;
      }
      coiData = fillCertificateDescription({
        descriptionOfOperations: args.descriptionOfOperations,
      }, coiData);
      const endorsements = args.endorsements as EndorsementCitation[] | undefined;
      coiData = applyEndorsementsToCertificateData(coiData, {
        endorsements,
      });
      const lifecycle = await ensureCertificateLifecycleContext(ctx, args);
      const nextVersionNumber = await ctx.runQuery(
        (internal as any).certificateLifecycle.nextVersionNumberInternal,
        {
          orgId: args.orgId,
          certificateId: lifecycle.policyCertificateId,
        },
      );
      coiData = {
        ...coiData,
        certificateNumber: String(lifecycle.policyCertificateId),
        revisionNumber: String(nextVersionNumber),
      };
      const finalDescriptionOfOperations = normalizeCertificateDescription(
        coiData.description,
      );
      coiData = {
        ...coiData,
        description: finalDescriptionOfOperations,
      };
      const pdfBuffer = await generateCoiPdf(coiData);

      // Store in Convex file storage
      // Copy to a plain ArrayBuffer to satisfy strict Blob typing
      const arrayBuffer = pdfBuffer.buffer.slice(
        pdfBuffer.byteOffset,
        pdfBuffer.byteOffset + pdfBuffer.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: "application/pdf" });
      const storageId = await ctx.storage.store(blob);
      const size = pdfBuffer.byteLength;
      const fileName = buildCoiFileName(
        policy,
        args.certificateHolder,
        args.certificateHolderName,
        formCode,
      );

      const certificateId = await ctx.runMutation(internal.certificates.recordGenerated, {
        orgId: args.orgId,
        policyId: args.policyId,
        fileId: storageId,
        fileName,
        certificateHolder: args.certificateHolder,
        certificateHolderName: args.certificateHolderName,
        source: args.source,
        createdByUserId: args.createdByUserId,
        requestKind: args.requestKind,
        additionalInsuredName: args.additionalInsuredName,
        formCode,
        requestSignature: args.requestSignature,
        descriptionOfOperations: finalDescriptionOfOperations,
        requirementIds: args.requirementIds,
        requirementSourceDocumentId: args.requirementSourceDocumentId,
        requirementSnapshots: args.requirementSnapshots,
        generationBatchId: args.generationBatchId,
      });
      const issuedVersion = await ctx.runMutation(
        (internal as any).certificateLifecycle.recordIssuedVersionInternal,
        {
          orgId: args.orgId,
          certificateId: lifecycle.policyCertificateId,
          holderId: lifecycle.holderId,
          policyId: args.policyId,
          policyVersionId: lifecycle.policyVersionId,
          fileId: storageId,
          fileName,
          fileSize: size,
          certificateHolder: args.certificateHolder,
          certificateHolderName: args.certificateHolderName,
          holderEmail: args.holderEmail,
          holderPhone: args.holderPhone,
          holderContactName: args.holderContactName,
          holderAddress: args.holderAddress,
          updateHolderDetails: args.updateHolderDetails,
          policySnapshot: lifecycle.policySnapshot,
          source: args.source,
          requestKind: args.requestKind,
          additionalInsuredName: args.additionalInsuredName,
          formCode,
          requestSignature: args.requestSignature,
          descriptionOfOperations: finalDescriptionOfOperations,
          requirementIds: args.requirementIds,
          requirementSourceDocumentId: args.requirementSourceDocumentId,
          requirementSnapshots: args.requirementSnapshots,
          generationBatchId: args.generationBatchId,
          createdByUserId: args.createdByUserId,
        },
      );

      // Advisory layout QA runs after issuance is recorded, so it can never block it.
      const layoutQa = await qaGeneratedCoi(ctx, {
        orgId: args.orgId,
        policyId: args.policyId,
        pdf: pdfBuffer,
        coi: coiData,
      });
      if (layoutQa.status !== "passed") {
        console.warn("[generateCoi] Certificate layout QA", {
          policyId: args.policyId,
          certificateId: String(certificateId),
          ...layoutQa,
        });
      }

      return {
        layoutQa,
        storageId: storageId as string,
        size,
        fileName,
        certificateId: String(certificateId),
        holderId: String(issuedVersion.holderId),
        policyCertificateId: String(lifecycle.policyCertificateId),
        certificateVersionId: String(issuedVersion.versionId),
        versionNumber: issuedVersion.versionNumber,
        formCode,
        descriptionOfOperations: finalDescriptionOfOperations,
      };
    } catch (err) {
      logAiError("generateCoi", err, { policyId: args.policyId });
      throw err;
    }
  },
});
