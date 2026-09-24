"use node";

import dayjs from "dayjs";
import { z } from "zod";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import {
  cleanupSignedRouterAssets,
  createSignedActionRouterAsset,
  type RouterAssetCleanup,
} from "../../actions/routerAssets";
import {
  MAX_CL_ROUTER_JSON_REQUEST_BYTES,
  clRouterGenerateMaybeManual,
  normalizeClRouterTrace,
  type ClRouterGenerateResponse,
  type ClRouterMessagePart,
} from "../clRouterClient";
import { mapSpotCallToClRouterPrimitive } from "../clRouterPrimitive";
import { extractionContractHash } from "../extractionPromotion";
import { EXTRACTION_MODEL_CAPABILITIES, type ModelRoute } from "../modelCatalog";
import { modelTaskForCall, resolveClRouterSettingsForOrg } from "../models";
import {
  slicePdfPages,
  type PolicySection,
  type PolicySectionKind,
} from "../policySectioning";
import { executeDurableRouterRequest, RouterJobPending } from "../routerJobClient";
import { buildSectionPrompt } from "./prompts";
import { SECTION_EXTRACTOR_VERSION, SECTION_OUTPUT_SCHEMAS } from "./schemas";

export const SECTION_TASK_KIND = "extraction_section";

// Same headroom sdkCallbacks keeps before staging a PDF as a signed asset.
const INLINE_REQUEST_HEADROOM_BYTES = 512 * 1024;

const SECTION_OUTPUT_TOKENS: Record<PolicySectionKind, number> = {
  declarations:
    EXTRACTION_MODEL_CAPABILITIES.taskOutputTokens.extraction_operational_profile,
  schedule: EXTRACTION_MODEL_CAPABILITIES.longListOutputTokens,
  forms_list: EXTRACTION_MODEL_CAPABILITIES.longListOutputTokens,
  coverage_form: EXTRACTION_MODEL_CAPABILITIES.taskOutputTokens.extraction_focused,
  endorsement: EXTRACTION_MODEL_CAPABILITIES.taskOutputTokens.extraction_focused,
  application: EXTRACTION_MODEL_CAPABILITIES.defaultOutputTokens,
  invoice: EXTRACTION_MODEL_CAPABILITIES.defaultOutputTokens,
  notice: EXTRACTION_MODEL_CAPABILITIES.defaultOutputTokens,
  other: EXTRACTION_MODEL_CAPABILITIES.defaultOutputTokens,
};

export type SectionJobOutcome =
  | {
      status: "succeeded";
      output: unknown;
      response: ClRouterGenerateResponse;
      durationMs: number;
    }
  | { status: "failed"; error: string }
  | { status: "pending" }
  | { status: "not_submitted" };

export function sectionLabel(section: PolicySection): string {
  return `Extract ${section.kind.replace(/_/g, " ")} pages ${section.pageStart}-${section.pageEnd}`;
}

/** Operator pin for policy extraction; unpinned calls are routed by cl-router. */
export async function sectionExtractionRoute(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<ModelRoute | undefined> {
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  const task = modelTaskForCall("extraction", SECTION_TASK_KIND);
  return settings?.routeSources?.[task] === "global"
    ? settings.routes?.[task]
    : undefined;
}

/**
 * Stable per attempt: resume reuses the same router job, while a new
 * extraction (trace), plan, retry attempt, or declarations context submits a
 * fresh one. Cancellation lists a run's jobs by the `policy:<runId>:` prefix
 * (policies.pipelineListCancelledSectionJobs).
 */
export function sectionInvocationKey(args: {
  runId: string;
  traceId?: string;
  planHash: string;
  section: PolicySection;
  attempt: number;
  declarationsSummary?: string;
}): string {
  const sectionHash = extractionContractHash({
    extractorVersion: SECTION_EXTRACTOR_VERSION,
    traceId: args.traceId ?? null,
    planHash: args.planHash,
    section: args.section,
    attempt: args.attempt,
    declarationsSummary: args.declarationsSummary ?? null,
  });
  return `policy:${args.runId}:${args.section.sectionId}:${sectionHash}`;
}

async function sectionFilePart(
  ctx: ActionCtx,
  args: {
    bytes: Uint8Array;
    section: PolicySection;
    orgId: Id<"organizations">;
    sessionKey: string;
    requestBytes: number;
  },
  staged: RouterAssetCleanup[],
): Promise<ClRouterMessagePart> {
  const filename = `policy-pages-${args.section.pageStart}-${args.section.pageEnd}.pdf`;
  const inline: ClRouterMessagePart = {
    type: "file",
    data: Buffer.from(args.bytes).toString("base64"),
    mediaType: "application/pdf",
    filename,
  };
  if (
    args.requestBytes + JSON.stringify(inline).length <=
    MAX_CL_ROUTER_JSON_REQUEST_BYTES - INLINE_REQUEST_HEADROOM_BYTES
  ) {
    return inline;
  }
  const asset = await createSignedActionRouterAsset(ctx, {
    bytes: args.bytes,
    mediaType: "application/pdf",
    filename,
    orgId: args.orgId,
    surface: "policy_section_extraction",
    sessionKey: args.sessionKey,
  });
  staged.push(asset.cleanup);
  return { type: "file", source: asset.reference };
}

/**
 * Submits or polls one section's durable router job. Pending jobs report
 * `pending`; the caller checkpoints and advances again later.
 */
export async function runSectionJob(
  ctx: ActionCtx,
  args: {
    invocationKey: string;
    allowSubmission: boolean;
    orgId: Id<"organizations">;
    policyId: string;
    traceId?: string;
    section: PolicySection;
    pageCount: number;
    declarationsSummary?: string;
    route?: ModelRoute;
    loadPdf: () => Promise<Uint8Array>;
  },
): Promise<SectionJobOutcome> {
  const startedAt = dayjs().valueOf();
  const job = await ctx.runQuery(internal.routerJobs.get, {
    invocationKey: args.invocationKey,
  });
  if (!job && !args.allowSubmission) return { status: "not_submitted" };
  const { section } = args;
  const schema = SECTION_OUTPUT_SCHEMAS[section.kind];
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const { system, prompt } = buildSectionPrompt(args);
  const mapping = mapSpotCallToClRouterPrimitive({
    task: "extraction",
    taskKind: SECTION_TASK_KIND,
    hasStructuredOutput: true,
    hasVision: true,
  });
  const staged: RouterAssetCleanup[] = [];
  try {
    const content: ClRouterMessagePart[] = [{ type: "text", text: prompt }];
    // An existing invocation ignores its payload, so polls skip slicing the PDF.
    if (!job) {
      content.push(
        await sectionFilePart(
          ctx,
          {
            bytes: await slicePdfPages(
              await args.loadPdf(),
              section.pageStart,
              section.pageEnd,
            ),
            section,
            orgId: args.orgId,
            sessionKey: args.traceId ?? args.policyId,
            requestBytes: new TextEncoder().encode(
              `${system}${prompt}${JSON.stringify(jsonSchema)}`,
            ).byteLength,
          },
          staged,
        ),
      );
    }
    const response = await clRouterGenerateMaybeManual(
      {
        primitive: mapping.primitive,
        ...(mapping.requirements ? { requirements: mapping.requirements } : {}),
        orgId: String(args.orgId),
        system,
        messages: [{ role: "user", content }],
        schema: jsonSchema,
        schemaDialect: "https://json-schema.org/draft/2020-12/schema",
        maxTokens: SECTION_OUTPUT_TOKENS[section.kind],
        trace: normalizeClRouterTrace({
          traceId: args.traceId,
          label: sectionLabel(section),
          phase: "extract_sections",
          task: "extraction",
          taskKind: SECTION_TASK_KIND,
          policyId: args.policyId,
          channel: "convex",
          sectionId: section.sectionId,
          sectionKind: section.kind,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
        }),
      },
      job ? undefined : args.route,
      {
        executeJob: (operation, payload) =>
          executeDurableRouterRequest(
            ctx,
            job?.operation ?? operation,
            job ? null : payload,
            args.invocationKey,
            undefined,
            { wait: "yield" },
          ),
      },
    );
    const parsed = schema.safeParse(response.output);
    if (!parsed.success) {
      return {
        status: "failed",
        error: "Section extraction output does not match the section schema",
      };
    }
    return {
      status: "succeeded",
      output: parsed.data,
      response,
      durationMs: dayjs().valueOf() - (job?.createdAt ?? startedAt),
    };
  } catch (error) {
    if (error instanceof RouterJobPending) return { status: "pending" };
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (staged.length > 0) await cleanupSignedRouterAssets(ctx, staged);
  }
}
