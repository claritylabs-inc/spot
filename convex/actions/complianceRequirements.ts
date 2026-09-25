"use node";

import mammoth from "mammoth";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { v } from "convex/values";
import dayjs from "dayjs";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { generateObjectForOrg } from "../lib/models";
import { extractPdfPlainText } from "../lib/pdfText";
import {
  REQUIREMENT_LIMIT_KINDS,
  REQUIREMENT_PROVISIONS,
  REQUIREMENT_SCOPES,
  hasCheckableCoverageTerms,
  normalizeRequirementLineOfBusiness,
  type RequirementScope,
} from "../lib/complianceTypes";
import { ACORD_LOB_LABELS, isLobCode } from "../lib/linesOfBusiness";

const COMMON_COMMERCIAL_LOBS = [
  "CGL",
  "AUTOB",
  "WORK",
  "WCMA",
  "UMBRC",
  "EXLIA",
  "EO",
  "PL",
  "PROP",
  "BOP",
  "CRIM",
  "EPLI",
  "DO",
  "FIDUC",
  "INMRC",
  "CYBER",
  "OLIB",
] as const;

const LobSchema = z.string().refine((value) => isLobCode(value), {
  message: "Expected an ACORD line-of-business code",
});

const sourceDocumentTypeValidator = v.union(
  v.literal("lease_agreement"),
  v.literal("client_contract"),
  v.literal("vendor_requirements"),
  v.literal("other"),
);

const ScopeSchema = z.enum(REQUIREMENT_SCOPES);

const CertificateHolderSchema = z.object({
  displayName: z.string().min(1).max(240),
  contactName: z.string().max(240).nullable(),
  email: z.string().max(320).nullable(),
  phone: z.string().max(80).nullable(),
  address: z
    .object({
      line1: z.string().max(240).nullable(),
      line2: z.string().max(240).nullable(),
      city: z.string().max(120).nullable(),
      state: z.string().max(120).nullable(),
      postalCode: z.string().max(40).nullable(),
      country: z.string().max(120).nullable(),
      formatted: z.string().max(600).nullable(),
    })
    .nullable(),
  sourceExcerpt: z.string().min(1).max(1200),
});

const RequirementSchema = z.object({
  scope: ScopeSchema.nullable(),
  title: z.string().min(1).max(120),
  requirementText: z.string().min(1).max(4000),
  lineOfBusiness: LobSchema.nullable(),
  limits: z
    .array(
      z.object({
        kind: z.enum(REQUIREMENT_LIMIT_KINDS),
        amount: z.number().nonnegative(),
        label: z.string().min(1).max(160).nullable(),
      }),
    )
    .max(12)
    .nullable(),
  maxDeductible: z
    .object({
      amount: z.number().nonnegative(),
      label: z.string().min(1).max(160).nullable(),
    })
    .nullable(),
  coverageForm: z.enum(["occurrence", "claims_made"]).nullable(),
  retroactiveDateOnOrBefore: z.string().min(1).max(60).nullable(),
  provisions: z.array(z.enum(REQUIREMENT_PROVISIONS)).max(8).nullable(),
  requiredForms: z.array(z.string().min(1).max(40)).max(12).nullable(),
  sourceExcerpt: z.string().min(1).max(4000),
  sourcePageStart: z.number().int().positive().nullable(),
  sourcePageEnd: z.number().int().positive().nullable(),
});

const RequirementImportSchema = z.object({
  certificateHolders: z.array(CertificateHolderSchema).max(20),
  requirements: z.array(RequirementSchema).max(32),
});

type ImportedRequirement = z.infer<typeof RequirementSchema>;
type ImportedCertificateHolder = z.infer<typeof CertificateHolderSchema>;
type ExistingRequirement = {
  kind: string;
  scope: string;
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  conditionType?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  coverageForm?: "occurrence" | "claims_made";
  retroactiveDateOnOrBefore?: string;
  provisions?: string[];
  requiredForms?: string[];
};
type RequirementImportContext = {
  userId: Id<"users">;
  existingRequirements: ExistingRequirement[];
};
type RequirementSourceHolderInput = {
  displayName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    formatted?: string;
  };
};
type ExtractedFileText = {
  text: string;
  parserBackend?: "liteparse" | "pdfjs" | "mammoth" | "plain_text";
  parsedAt?: number;
};

const MAX_SOURCE_CHARS = 40_000;
const REQUIREMENT_EXTRACTION_TIMEOUT_MS = 90_000;

function truncateSource(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_SOURCE_CHARS) return trimmed;
  return trimmed.slice(0, MAX_SOURCE_CHARS);
}

function decodeText(buffer: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function optionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function optionalNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeImportedCertificateHolder(
  holder: ImportedCertificateHolder,
): RequirementSourceHolderInput {
  const address = holder.address
    ? {
        line1: optionalString(holder.address.line1),
        line2: optionalString(holder.address.line2),
        city: optionalString(holder.address.city),
        state: optionalString(holder.address.state),
        postalCode: optionalString(holder.address.postalCode),
        country: optionalString(holder.address.country),
        formatted: optionalString(holder.address.formatted),
      }
    : undefined;
  return {
    displayName: holder.displayName.trim(),
    contactName: optionalString(holder.contactName),
    email: optionalString(holder.email),
    phone: optionalString(holder.phone),
    address:
      address && Object.values(address).some(Boolean) ? address : undefined,
  };
}

function normalizeImportedRequirement(
  requirement: ImportedRequirement,
  defaultScope: RequirementScope,
) {
  return {
    kind: "coverage" as const,
    scope: requirement.scope ?? defaultScope,
    title: requirement.title.trim(),
    requirementText: requirement.requirementText.trim(),
    lineOfBusiness: normalizeRequirementLineOfBusiness(
      requirement.lineOfBusiness,
    ),
    limits: (requirement.limits ?? []).map((limit) => ({
      kind: limit.kind,
      amount: limit.amount,
      label: optionalString(limit.label),
    })),
    maxDeductible: requirement.maxDeductible
      ? {
        amount: requirement.maxDeductible.amount,
        label: optionalString(requirement.maxDeductible.label),
      }
      : undefined,
    coverageForm: requirement.coverageForm ?? undefined,
    retroactiveDateOnOrBefore: optionalString(
      requirement.retroactiveDateOnOrBefore,
    ),
    provisions: requirement.provisions ?? undefined,
    requiredForms: requirement.requiredForms ?? undefined,
    sourceExcerpt: requirement.sourceExcerpt.trim(),
    sourcePageStart: optionalNumber(requirement.sourcePageStart),
    sourcePageEnd: optionalNumber(requirement.sourcePageEnd),
  };
}

function isCheckableCoverageRequirement(
  requirement: ReturnType<typeof normalizeImportedRequirement>,
) {
  return Boolean(
    requirement.lineOfBusiness &&
      hasCheckableCoverageTerms(requirement),
  );
}

async function extractPdfRequirementText(
  buffer: ArrayBuffer,
  fileName?: string,
): Promise<ExtractedFileText> {
  const pdfBytes = new Uint8Array(buffer);
  const parsedText = await extractPdfPlainText({
    pdfBytes,
    documentId: fileName || "requirement-document",
    sourceKind: "attachment",
    maxChars: MAX_SOURCE_CHARS,
  });
  if (!parsedText) {
    throw new Error("Could not extract text from the requirement PDF");
  }
  return {
    text: parsedText,
    parserBackend: "pdfjs",
    parsedAt: dayjs().valueOf(),
  };
}

export async function extractDocxText(buffer: ArrayBuffer) {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  return result.value;
}

async function extractFileText({
  buffer,
  fileName,
  contentType,
}: {
  buffer: ArrayBuffer;
  fileName?: string;
  contentType?: string;
}): Promise<ExtractedFileText> {
  const lowerName = (fileName ?? "").toLowerCase();
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("pdf") || lowerName.endsWith(".pdf")) {
    return await extractPdfRequirementText(buffer, fileName);
  }
  if (type.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    return { text: await extractDocxText(buffer), parserBackend: "mammoth" };
  }
  if (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("csv") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json")
  ) {
    return { text: decodeText(buffer), parserBackend: "plain_text" };
  }
  throw new Error(
    "Unsupported requirement document type. Use TXT, Markdown, PDF, DOCX, CSV, or JSON.",
  );
}

function buildPrompt({
  sourceText,
  existingRequirements,
  scope,
}: {
  sourceText: string;
  existingRequirements: ExistingRequirement[];
  scope: RequirementScope;
}) {
  const existing = existingRequirements.length
    ? existingRequirements
        .map(
          (requirement) => `- ${JSON.stringify({
            scope: requirement.scope,
            lineOfBusiness: requirement.lineOfBusiness,
            title: requirement.title,
            limits: requirement.limits,
            maxDeductible: requirement.maxDeductible,
            coverageForm: requirement.coverageForm,
            retroactiveDateOnOrBefore:
              requirement.retroactiveDateOnOrBefore,
            provisions: requirement.provisions,
            requiredForms: requirement.requiredForms,
          })}`,
        )
        .join("\n")
    : "None";
  const commonLobs = COMMON_COMMERCIAL_LOBS.map(
    (code) => `${code}: ${ACORD_LOB_LABELS[code]}`,
  ).join("\n");

  return `Extract certificate-holder contacts and policy coverage requirements from the source text as a concise, source-backed record.

Default scope: ${scope}. Use "vendors" for requirements vendors/contractors must satisfy. Use "own_org" for requirements this organization must satisfy.

Only extract coverage requirements: rules that can be checked against a structured insurance policy (line of business, limits, deductibles, coverage form, provisions, endorsement forms).

Separately extract every explicitly identified certificate holder or certificate recipient into certificateHolders[]. A holder is the company or person requesting proof of insurance, not the named insured, insurer, broker, vendor being evaluated, or additional insured unless the source explicitly identifies that party as the certificate holder/recipient.
- Preserve the complete company/person display name.
- Capture the attention/contact name, email, phone, and postal address when stated.
- Split multiple holder companies or recipients into separate entries and keep source order.
- sourceExcerpt is required and must be the shortest exact source language supporting the identity and contact details.
- Return an empty certificateHolders array when the source does not explicitly identify one. Do not invent missing contact details.

Skip everything that is not a policy coverage requirement, including:
- carrier/insurer standards such as AM Best rating, financial size, or admitted/licensed status
- administrative conditions such as cancellation notice, certificate of insurance delivery, claims reporting, or subcontractor flow-down obligations
- indemnification, warranty, and other contract clauses that are not insurance coverage

For each coverage rule:
- Set lineOfBusiness to an ACORD code. Use one of these common commercial codes when possible:
${commonLobs}
- Split unrelated insurance lines into separate rules.
- Extract each required limit into limits[] with kind, amount, and original label.
- Amounts must be plain numbers: 1000000 for "$1M" or "$1,000,000". Keep the source wording in label.
- Use limit kinds only from: ${REQUIREMENT_LIMIT_KINDS.join(", ")}.
- Extract provisions from: ${REQUIREMENT_PROVISIONS.join(", ")}.
- Extract required endorsement/form numbers such as CG 20 10 or CG 20 37 into requiredForms.
- Extract max deductible/retention only when the source states a ceiling.
- sourceExcerpt is required and should be the shortest exact source language supporting the rule.
- Set source pages when obvious from page markers; otherwise leave null.
- Do not invent unsupported requirements.
- Extract every source-backed coverage rule, even when an existing requirement has the same line of business or a similar title. The server performs exact typed deduplication after extraction.
- Within this source, merge rules only when every material typed term is equivalent. Different limit kinds or amounts, deductible ceilings, coverage forms, retroactive dates, provisions, or required forms are distinct requirements.
- Keep titles short and scannable.

Existing active requirements (reference only; do not suppress a rule unless every material typed term is equivalent):
${existing}

Source text:
${sourceText}`;
}

async function runRequirementImport(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    pastedText?: string;
    fileId?: Id<"_storage">;
    fileName?: string;
    contentType?: string;
    sourceType?: "lease_agreement" | "client_contract" | "vendor_requirements" | "other";
    sourceName?: string;
    scope?: RequirementScope;
    holder?: RequirementSourceHolderInput;
    dealName?: string;
    dealType?: string;
    internalNotes?: string;
  },
  context: RequirementImportContext,
  titlePrefix: "Pasted requirements" | "Mailbox requirements",
): Promise<{
  createdCount: number;
  requirementIds: Id<"insuranceRequirements">[];
  sourceDocumentId: Id<"requirementSourceDocuments">;
}> {
  const runId = crypto.randomUUID();
  const sourceType = args.sourceType ?? inferRequirementSourceType(args.fileName);
  const scope = args.scope ?? "vendors";
  const sourceDocumentName =
    args.sourceName?.trim() ||
    args.fileName ||
    `${titlePrefix} ${dayjs().format("YYYY-MM-DD HH:mm")}`;
  const trigger = titlePrefix === "Mailbox requirements"
    ? "mailbox_import" as const
    : "web_import" as const;
  await ctx.runMutation(internal.requirementExtractionRuns.start, {
    runId,
    orgId: args.orgId,
    userId: context.userId,
    trigger,
    sourceName: sourceDocumentName,
    sourceType,
    scope,
    fileName: args.fileName,
    contentType: args.contentType,
  });
  const failRun = async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await ctx.runMutation(internal.requirementExtractionRuns.fail, {
        runId,
        error: message,
      });
    } catch (telemetryError) {
      console.warn("Failed to record requirement extraction error", telemetryError);
    }
  };

  let sourceText = args.pastedText?.trim() ?? "";
  let fileExtraction: ExtractedFileText | undefined;
  try {
    if (args.fileId) {
      const blob = await ctx.storage.get(args.fileId);
      if (!blob) throw new Error("Requirement document not found");
      fileExtraction = await extractFileText({
        buffer: await blob.arrayBuffer(),
        fileName: args.fileName,
        contentType: args.contentType,
      });
      sourceText = [sourceText, fileExtraction.text].filter(Boolean).join("\n\n");
    }
  } catch (error) {
    await failRun(error);
    throw error;
  }

  sourceText = truncateSource(sourceText);
  if (!sourceText) {
    const error = new Error("Paste text or upload a requirement document first");
    await failRun(error);
    throw error;
  }
  await ctx.runMutation(internal.requirementExtractionRuns.recordSource, {
    runId,
    parserBackend: fileExtraction?.parserBackend ?? "plain_text",
    sourceCharacterCount: sourceText.length,
  });

  const abortSignal = AbortSignal.timeout(REQUIREMENT_EXTRACTION_TIMEOUT_MS);
  let result;
  try {
    result = await generateObjectForOrg(ctx, args.orgId, "requirement_extraction", {
      schema: RequirementImportSchema,
      abortSignal,
      maxOutputTokens: 3_000,
      system:
        "You convert contract, lease, certificate, and vendor insurance language into typed ACORD-25-style coverage requirements for Spot.",
      prompt: buildPrompt({
        sourceText,
        existingRequirements: context.existingRequirements,
        scope,
      }),
    }, {
      taskKind: "requirement_extraction",
      trace: {
        traceId: runId,
        channel: trigger === "mailbox_import" ? "mailbox" : "web",
        phase: "extracting_requirements",
      },
    });
  } catch (error) {
    await failRun(error);
    if (abortSignal.aborted) {
      throw new Error(
        "Requirement extraction took too long. Try the import again in a moment.",
      );
    }
    throw error;
  }

  const usage = result.totalUsage ?? result.usage;
  const normalizedRequirements = result.object.requirements
    .map((requirement) => normalizeImportedRequirement(requirement, scope))
    .filter(isCheckableCoverageRequirement);
  await ctx.runMutation(internal.requirementExtractionRuns.recordExtraction, {
    runId,
    extractedRequirementCount: result.object.requirements.length,
    checkableRequirementCount: normalizedRequirements.length,
    extractedHolderCount: result.object.certificateHolders.length,
    ...(result.clRouter?.requestId
      ? { requestId: result.clRouter.requestId }
      : {}),
    provider: result.route.provider,
    model: result.route.model,
    ...(result.routeSource ? { routeSource: result.routeSource } : {}),
    ...(result.transport ? { transport: result.transport } : {}),
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(result.clRouter ? { costUsd: result.clRouter.costUsd } : {}),
  });
  // Do not leave a completed-looking source behind when extraction fails. A
  // successful import still records the source even when every extracted row
  // is an exact duplicate, preserving that audit trail without creating an
  // orphan for model errors or timeouts.
  let sourceDocumentId: Id<"requirementSourceDocuments">;
  let requirementIds: Id<"insuranceRequirements">[];
  try {
    sourceDocumentId = await ctx.runMutation(
      internal.compliance.createRequirementSourceDocumentInternal,
      {
        orgId: args.orgId,
        userId: context.userId,
        extractionRunId: runId,
        fileId: args.fileId,
        fileName: args.fileName,
        contentType: args.contentType,
        sourceType,
        title: sourceDocumentName,
        sourceTextExcerpt: sourceText.slice(0, 4000),
        parserBackend: fileExtraction?.parserBackend,
        parsedAt: fileExtraction?.parsedAt,
        holder: args.holder,
        holders: result.object.certificateHolders.map(
          normalizeImportedCertificateHolder,
        ),
        dealName: args.dealName,
        dealType: args.dealType,
        internalNotes: args.internalNotes,
      },
    );

    requirementIds = await ctx.runMutation(
      internal.compliance.createRequirementsInternal,
      {
        orgId: args.orgId,
        userId: context.userId,
        sourceDocumentId,
        sourceDocumentName,
        sourceType,
        requirements: normalizedRequirements,
      },
    );
  } catch (error) {
    await failRun(error);
    throw error;
  }

  await ctx.runMutation(internal.requirementExtractionRuns.complete, {
    runId,
    sourceDocumentId,
    createdRequirementCount: requirementIds.length,
    duplicateRequirementCount: Math.max(
      0,
      normalizedRequirements.length - requirementIds.length,
    ),
  });

  return { createdCount: requirementIds.length, requirementIds, sourceDocumentId };
}

function inferRequirementSourceType(fileName?: string) {
  if (fileName?.toLowerCase().includes("lease")) {
    return "lease_agreement" as const;
  }
  if (/(?:contract|agreement)/i.test(fileName ?? "")) {
    return "client_contract" as const;
  }
  return "vendor_requirements" as const;
}

export const importRequirements = action({
  args: {
    orgId: v.id("organizations"),
    pastedText: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sourceType: v.optional(sourceDocumentTypeValidator),
    sourceName: v.optional(v.string()),
    scope: v.optional(v.union(v.literal("vendors"), v.literal("own_org"))),
    holder: v.optional(v.object({
      displayName: v.string(),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(v.object({
        line1: v.optional(v.string()),
        line2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        postalCode: v.optional(v.string()),
        country: v.optional(v.string()),
        formatted: v.optional(v.string()),
      })),
    })),
    dealName: v.optional(v.string()),
    dealType: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    createdCount: number;
    requirementIds: Id<"insuranceRequirements">[];
    sourceDocumentId: Id<"requirementSourceDocuments">;
  }> => {
    const context: RequirementImportContext = await ctx.runQuery(
      internal.compliance.getRequirementImportContextInternal,
      { orgId: args.orgId },
    );
    return await runRequirementImport(
      ctx,
      args,
      context,
      "Pasted requirements",
    );
  },
});

export const importRequirementsInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    pastedText: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sourceType: v.optional(sourceDocumentTypeValidator),
    sourceName: v.optional(v.string()),
    scope: v.optional(v.union(v.literal("vendors"), v.literal("own_org"))),
    holder: v.optional(v.object({
      displayName: v.string(),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(v.object({
        line1: v.optional(v.string()),
        line2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        postalCode: v.optional(v.string()),
        country: v.optional(v.string()),
        formatted: v.optional(v.string()),
      })),
    })),
    dealName: v.optional(v.string()),
    dealType: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    createdCount: number;
    requirementIds: Id<"insuranceRequirements">[];
    sourceDocumentId: Id<"requirementSourceDocuments">;
  }> => {
    const context: RequirementImportContext = await ctx.runQuery(
      internal.compliance.getRequirementImportContextForUserInternal,
      { orgId: args.orgId, userId: args.userId },
    );
    return await runRequirementImport(
      ctx,
      args,
      context,
      "Mailbox requirements",
    );
  },
});
