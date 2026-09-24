import dayjs from "dayjs";
import { createRequire } from "module";
import { createServer } from "http";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ACORD_LOB_CODES, createExtractor, resolveAcordCoverageCode, stableHash, toLobCodes, } from "@claritylabs/cl-sdk";
import { DIRECT_MODEL_PROVIDERS, } from "./clRouterPolicy.js";
import { EXTRACTION_MODEL_CAPABILITIES } from "./modelCapabilities.js";
import { buildPdfSourceSpans, buildPdfTextSupplements, orderSourceSpansForPreview, } from "./pdfSourceSpans.js";
import { convertPdfWithLiteParse, LITEPARSE_MAX_QUEUED_DOCUMENTS, LITEPARSE_NATIVE_CONCURRENCY, } from "./liteparse.js";
import { resolveConvexStorageUrl } from "./convexStorageUrl.js";
import { ClRouterProtocolError, createClRouterClient, } from "./clRouterClient.js";
import { applyCarrierIdentityGuidance } from "./extractionPromptGuidance.js";
import { watchClientDisconnect } from "./httpRequestCancellation.js";
import { createPdfWorkAdmission } from "./pdfWorkAdmission.js";
import { resolveWorkerRuntimeAccess } from "./railwayRuntime.js";
import { inlineRouterImageFits, planExplicitRouterAssets, stageRouterAsset, validatedConvexSiteUrl, } from "./routerAssetUpload.js";
import { preparePdfSourceWithLiteParseFallback } from "./pdfSourceFallback.js";
import { aggregateProposalDocuments, } from "./proposalExtraction.js";
const proposalEvidenceItemSchema = z.object({
    description: z.string().min(1).max(2000),
    category: z.string().max(200).nullable(),
    sourceNodeIds: z.array(z.string().min(1)).max(20),
    sourceSpanIds: z.array(z.string().min(1)).max(50),
    pageStart: z.number().int().positive().nullable(),
    pageEnd: z.number().int().positive().nullable(),
});
const proposalQuoteSupplementSchema = z.object({
    quoteExpirationDate: z.string().max(100).nullable(),
    quoteExpirationEvidence: proposalEvidenceItemSchema.nullable(),
    subjectivities: z.array(proposalEvidenceItemSchema).max(100),
    conditions: z.array(proposalEvidenceItemSchema).max(100),
});
const require = createRequire(import.meta.url);
const workerPackage = require("../package.json");
const WORKER_PROTOCOL_VERSION = process.env.EXTRACTION_WORKER_PROTOCOL_VERSION === "source-tree-v2"
    ? "source-tree-v2"
    : "source-tree-v1";
const actions = {
    deleteWorkerRouterAsset: makeFunctionReference("actions/routerAssets.js:deleteWorkerAsset"),
    saveExternalCompletionPayload: makeFunctionReference("externalExtractionPayload:saveExternalCompletionPayload"),
    createExternalCompletionUploadUrl: makeFunctionReference("externalExtractionPayload:createExternalCompletionUploadUrl"),
    finalizeExternalCompletionPayload: makeFunctionReference("externalExtractionPayload:finalizeExternalCompletionPayload"),
    claimExternalJob: makeFunctionReference("actions/policyExtraction.js:claimExternalJob"),
    claimExternalPreviewJob: makeFunctionReference("actions/policyExtraction.js:claimExternalPreviewJob"),
    heartbeatExternalJob: makeFunctionReference("actions/policyExtraction.js:heartbeatExternalJob"),
    heartbeatExternalPreviewJob: makeFunctionReference("actions/policyExtraction.js:heartbeatExternalPreviewJob"),
    logExternalJob: makeFunctionReference("actions/policyExtraction.js:logExternalJob"),
    createExternalExtractionArtifactUploadUrl: makeFunctionReference("actions/policyExtraction.js:createExternalExtractionArtifactUploadUrl"),
    finalizeExternalExtractionArtifact: makeFunctionReference("actions/policyExtraction.js:finalizeExternalExtractionArtifact"),
    getExternalExtractionResumeArtifacts: makeFunctionReference("actions/policyExtraction.js:getExternalExtractionResumeArtifacts"),
    completeExternalExtract: makeFunctionReference("actions/policyExtraction.js:completeExternalExtract"),
    completeExternalExtractFromStoredPayload: makeFunctionReference("actions/policyExtraction.js:completeExternalExtractFromStoredPayload"),
    completeExternalPreview: makeFunctionReference("actions/policyExtraction.js:completeExternalPreview"),
    failExternalJob: makeFunctionReference("actions/policyExtraction.js:failExternalJob"),
    failExternalPreviewJob: makeFunctionReference("actions/policyExtraction.js:failExternalPreviewJob"),
    recordExternalTraceEvent: makeFunctionReference("actions/policyExtraction.js:recordExternalTraceEvent"),
    claimExternalProposalJob: makeFunctionReference("actions/proposalExtraction.js:claimExternalJob"),
    heartbeatExternalProposalJob: makeFunctionReference("actions/proposalExtraction.js:heartbeatExternalJob"),
    logExternalProposalJob: makeFunctionReference("actions/proposalExtraction.js:logExternalJob"),
    createExternalProposalCompletionUploadUrl: makeFunctionReference("actions/proposalExtraction.js:createExternalCompletionUploadUrl"),
    completeExternalProposalJob: makeFunctionReference("actions/proposalExtraction.js:completeExternalJob"),
    failExternalProposalJob: makeFunctionReference("actions/proposalExtraction.js:failExternalJob"),
};
const SPOT_ENV = process.env.SPOT_ENV ?? process.env.RAILWAY_ENVIRONMENT_NAME ?? "local";
const CONVEX_URL = requiredEnv("CONVEX_URL");
const CONVEX_SITE_URL = validatedConvexSiteUrl(requiredEnv("CONVEX_SITE_URL"), SPOT_ENV);
const SECRET = requiredEnv("EXTRACTION_WORKER_SECRET");
const WORKER_ID = process.env.EXTRACTION_WORKER_ID ?? `extraction-worker-${process.pid}`;
const WORKER_VERSION = process.env.EXTRACTION_WORKER_VERSION ?? workerPackage.version ?? "unknown";
const WORKER_CL_SDK_VERSION = process.env.EXTRACTION_WORKER_CL_SDK_VERSION ??
    workerPackage.dependencies?.["@claritylabs/cl-sdk"] ??
    "unknown";
const RUNTIME_ACCESS = resolveWorkerRuntimeAccess(process.env);
const POLL_MS = readBoundedIntEnv("EXTRACTION_WORKER_POLL_MS", 5000, 500, 60_000);
const IDLE_LOG_MS = readBoundedIntEnv("EXTRACTION_WORKER_IDLE_LOG_MS", 60_000, 5_000, 10 * 60_000);
const HEARTBEAT_MS = readBoundedIntEnv("EXTRACTION_WORKER_HEARTBEAT_MS", 30_000, 5_000, 5 * 60_000);
const HTTP_PORT = readOptionalIntEnv("PORT") ?? readOptionalIntEnv("LITEPARSE_HTTP_PORT");
const HTTP_MAX_BODY_BYTES = readBoundedIntEnv("LITEPARSE_HTTP_MAX_BODY_BYTES", 50 * 1024 * 1024, 1024, 250 * 1024 * 1024);
const LITEPARSE_MAX_PAGES = readOptionalIntEnv("LITEPARSE_MAX_PAGES");
const LITEPARSE_MAX_FILE_SIZE = readOptionalIntEnv("LITEPARSE_MAX_FILE_SIZE_BYTES");
// Keep the original opaque tenant key so the rebrand does not fork learned
// routing state from existing production policy history and telemetry.
const CL_ROUTER_TENANT_ID = requiredEnv("CL_ROUTER_TENANT_ID").trim();
if (CL_ROUTER_TENANT_ID !== "glass") {
    throw new Error("CL_ROUTER_TENANT_ID must be glass");
}
const clRouter = createClRouterClient({
    baseUrl: requiredEnv("CL_ROUTER_URL"),
    secret: requiredEnv("CL_ROUTER_SECRET"),
});
const POLICY_PREVIEW_VERSION = "policy-preview-v2";
const POLICY_PREVIEW_TEXT_LIMIT = readBoundedIntEnv("EXTRACTION_PREVIEW_TEXT_LIMIT", 120_000, 20_000, 300_000);
const POLICY_PREVIEW_MAX_COVERAGES = readBoundedIntEnv("EXTRACTION_PREVIEW_MAX_COVERAGES", 24, 1, 100);
const PREVIEW_JOB_CONCURRENCY = readBoundedIntEnv("EXTRACTION_PREVIEW_CONCURRENCY", 2, 1, 8);
const EXTRACTION_JOB_CONCURRENCY = readBoundedIntEnv("EXTRACTION_JOB_CONCURRENCY", 8, 1, 1000);
const PROPOSAL_EXTRACTION_CONCURRENCY = readBoundedIntEnv("PROPOSAL_EXTRACTION_CONCURRENCY", 2, 1, 16);
const PDF_WORK_MAX_ACTIVE = readBoundedIntEnv("EXTRACTION_PDF_WORK_MAX_ACTIVE", Math.min(12, LITEPARSE_MAX_QUEUED_DOCUMENTS + 1), 2, LITEPARSE_MAX_QUEUED_DOCUMENTS + 1);
const PDF_WORK_MAX_FULL_ACTIVE = readBoundedIntEnv("EXTRACTION_PDF_WORK_MAX_FULL_ACTIVE", Math.min(8, PDF_WORK_MAX_ACTIVE), 1, PDF_WORK_MAX_ACTIVE);
const convex = new ConvexHttpClient(CONVEX_URL);
const pdfWorkAdmission = createPdfWorkAdmission({
    maxActive: PDF_WORK_MAX_ACTIVE,
    maxFullActive: PDF_WORK_MAX_FULL_ACTIVE,
});
const shutdownController = new AbortController();
let shuttingDown = false;
process.on("SIGTERM", () => {
    shuttingDown = true;
    shutdownController.abort();
});
process.on("SIGINT", () => {
    shuttingDown = true;
    shutdownController.abort();
});
function requiredEnv(name) {
    const value = process.env[name];
    if (!value)
        throw new Error(`${name} is required`);
    return value;
}
function readBoundedIntEnv(name, fallback, min, max) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value))
        return fallback;
    return Math.max(min, Math.min(max, value));
}
function readOptionalIntEnv(name) {
    const raw = process.env[name];
    if (!raw)
        return undefined;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : undefined;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function nowMs() {
    return dayjs().valueOf();
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function mapUsage(usage) {
    return {
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
    };
}
function readTaskKind(params) {
    return typeof params.taskKind === "string" ? params.taskKind : undefined;
}
function selectPageImages(screenshots, trace) {
    if (!screenshots?.length)
        return {};
    const startPage = typeof trace?.startPage === "number" ? trace.startPage : undefined;
    const endPage = typeof trace?.endPage === "number" ? trace.endPage : startPage;
    if (!startPage || !endPage)
        return {};
    const maxImages = readBoundedIntEnv("EXTRACTION_MULTIMODAL_MAX_IMAGES", 2, 0, 6);
    if (maxImages <= 0)
        return {};
    const images = screenshots
        .filter((shot) => shot.page >= startPage && shot.page <= endPage)
        .slice(0, maxImages)
        .map((shot) => ({
        imageBase64: shot.imageBase64,
        mimeType: shot.mimeType,
    }));
    return images.length > 0 ? { images } : {};
}
function enrichProviderOptions(providerOptions, screenshots, trace) {
    return {
        ...(providerOptions ?? {}),
        ...selectPageImages(screenshots, trace),
    };
}
function readSourceKind(value) {
    if (value === "policy_pdf" ||
        value === "email" ||
        value === "attachment" ||
        value === "manual_note") {
        return value;
    }
    return "policy_pdf";
}
const WORKER_MODEL_PROVIDERS = new Set(DIRECT_MODEL_PROVIDERS);
function isModelProvider(value) {
    return WORKER_MODEL_PROVIDERS.has(value);
}
function isWorkerModelRoute(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const route = value;
    return (typeof route.provider === "string" &&
        isModelProvider(route.provider) &&
        typeof route.model === "string" &&
        route.model.length > 0);
}
function modelTaskForTaskKind(taskKind) {
    if (taskKind === "extraction_preview")
        return "extraction_preview";
    if (taskKind?.endsWith("_classify")) {
        throw new Error("Classification requires a typed router /v1/decide request, not an SDK generation callback");
    }
    if (taskKind === "extraction_coverage_recovery") {
        throw new Error("AI coverage recovery is retired");
    }
    return "extraction";
}
function resolveModelForTaskKind(taskKind, settings) {
    const task = modelTaskForTaskKind(taskKind);
    const pinnedRoute = settings?.routes?.[task];
    return settings?.routeSources?.[task] === "global" &&
        isWorkerModelRoute(pinnedRoute)
        ? { task, route: pinnedRoute, routeSource: "global", transport: "cl-router" }
        : { task, transport: "cl-router" };
}
function modelRouteTrace(route) {
    return {
        provider: route.route?.provider,
        model: route.route?.model,
        routeSource: route.routeSource,
        transport: route.transport,
    };
}
async function recordModelCallSoftFailure(opts) {
    await recordTraceEvent(opts.job, {
        kind: "model_call",
        label: opts.label,
        task: opts.route.task,
        taskKind: opts.taskKind,
        ...modelRouteTrace(opts.route),
        attempt: 1,
        status: "soft_failed",
        durationMs: nowMs() - opts.startedAt,
        ...(opts.error === undefined ? {} : { error: errorMessage(opts.error) }),
        details: opts.details,
    });
}
async function recordModelCallComplete(opts) {
    await recordTraceEvent(opts.job, {
        kind: "model_call",
        label: opts.label,
        task: opts.route.task,
        taskKind: opts.taskKind,
        ...modelRouteTrace(opts.route),
        attempt: opts.attempt,
        status: "complete",
        durationMs: nowMs() - opts.startedAt,
        inputTokens: opts.usage.inputTokens,
        outputTokens: opts.usage.outputTokens,
        details: opts.details,
    });
}
function shouldReturnEmptySections(prompt, error) {
    return (prompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER) &&
        errorMessage(error).includes("No output generated"));
}
function readTraceDetails(params) {
    if (!params.trace ||
        typeof params.trace !== "object" ||
        Array.isArray(params.trace))
        return undefined;
    return params.trace;
}
function modelTraceLabel(kind, taskKind, task, trace) {
    if (trace?.label)
        return trace.label;
    if (trace?.extractorName) {
        const pageRange = trace.startPage
            ? ` pages ${trace.startPage}${trace.endPage && trace.endPage !== trace.startPage ? `-${trace.endPage}` : ""}`
            : "";
        return `${trace.extractorName}${pageRange}`;
    }
    if (trace?.phase === "format" && trace.batchIndex && trace.batchCount) {
        return `Format extracted content ${trace.batchIndex}/${trace.batchCount}`;
    }
    const labels = {
        extraction_classify: "Classify document",
        extraction_preview: "Extract provisional policy fields",
        extraction_source_tree: "Build source-native document tree",
        extraction_operational_profile: "Build operational profile",
        extraction_coverage_cleanup: "Clean coverage schedules",
        extraction_page_map: "Map policy pages",
        extraction_focused: "Extract policy fields",
        extraction_long_list: "Extract long policy lists",
        extraction_referential_lookup: "Resolve policy references",
        extraction_review: "Review extraction evidence",
        extraction_summary: "Summarize extracted policy",
        extraction_format: "Format extracted policy",
    };
    if (taskKind && labels[taskKind])
        return labels[taskKind];
    if (taskKind) {
        return taskKind
            .replace(/_/g, " ")
            .replace(/\b\w/g, (letter) => letter.toUpperCase());
    }
    if (task === "extraction")
        return kind === "generateText"
            ? "Extract policy text"
            : "Extract policy structure";
    if (task === "extraction_preview")
        return "Extract provisional policy fields";
    return kind === "generateText"
        ? "Generate text"
        : "Generate structured output";
}
const TRACE_TEXT_PREVIEW_LIMIT = 6000;
const TRACE_OUTPUT_PREVIEW_LIMIT = 6000;
function truncateTraceText(value, limit) {
    if (value.length <= limit)
        return value;
    return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}
function redactEmbeddedPdfBase64(value) {
    return value.replace(/JVBER[A-Za-z0-9+/=\s]{200,}/g, (match) => {
        const compact = match.replace(/\s/g, "");
        return `[PDF base64 omitted: ${compact.length} chars]`;
    });
}
function traceTextPreview(value, limit = TRACE_TEXT_PREVIEW_LIMIT) {
    if (typeof value !== "string" || value.length === 0)
        return undefined;
    return truncateTraceText(redactEmbeddedPdfBase64(value), limit);
}
function traceJsonPreview(value) {
    try {
        return truncateTraceText(JSON.stringify(value, null, 2), TRACE_OUTPUT_PREVIEW_LIMIT);
    }
    catch {
        return truncateTraceText(String(value), TRACE_OUTPUT_PREVIEW_LIMIT);
    }
}
function stripUndefined(value) {
    if (Array.isArray(value))
        return value.map(stripUndefined);
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)]));
}
function providerInputSummary(providerOptions) {
    const options = providerOptions;
    if (!options)
        return undefined;
    return {
        hasPdfBase64: typeof options.pdfBase64 === "string",
        pdfBase64Chars: typeof options.pdfBase64 === "string"
            ? options.pdfBase64.length
            : undefined,
        hasPdfUrl: !!options.pdfUrl,
        pdfUrl: typeof options.pdfUrl === "string"
            ? options.pdfUrl
            : options.pdfUrl instanceof URL
                ? options.pdfUrl.toString()
                : undefined,
        hasPdfBytes: options.pdfBytes instanceof Uint8Array,
        pdfBytes: options.pdfBytes instanceof Uint8Array
            ? options.pdfBytes.byteLength
            : undefined,
        mimeType: typeof options.mimeType === "string" ? options.mimeType : undefined,
        images: Array.isArray(options.images)
            ? options.images.map((image) => ({
                mimeType: image.mimeType,
                base64Chars: image.imageBase64.length,
            }))
            : undefined,
    };
}
function modelTraceDetails(params) {
    return stripUndefined({
        purpose: params.label,
        callKind: params.kind,
        task: params.task,
        taskKind: params.taskKind,
        trace: params.trace,
        maxOutputTokens: params.maxOutputTokens,
        systemPreview: traceTextPreview(params.system),
        promptPreview: traceTextPreview(params.prompt),
        inputSummary: providerInputSummary(params.providerOptions),
        outputKind: params.outputKind,
        outputPreview: params.outputKind === "object"
            ? traceJsonPreview(params.output)
            : traceTextPreview(params.output, TRACE_OUTPUT_PREVIEW_LIMIT),
    });
}
const SECTIONS_EXTRACTOR_PROMPT_MARKER = "Build a compact source-backed section index for this document";
async function recordTraceEvent(job, event) {
    if (!job.state.traceId)
        return;
    try {
        await convex.action(actions.recordExternalTraceEvent, {
            secret: SECRET,
            traceId: job.state.traceId,
            ...event,
        });
    }
    catch {
        // Extraction telemetry should never fail the worker.
    }
}
function routerAssetLease(job) {
    return {
        jobKind: job.routerAssetLease?.jobKind ?? "policy",
        jobId: job.routerAssetLease?.jobId ?? job.policyId,
        leaseId: job.leaseId,
        orgId: job.state.orgId,
    };
}
async function deleteStagedRouterAssets(assets) {
    const results = await Promise.allSettled(assets.map((asset) => convex.action(actions.deleteWorkerRouterAsset, {
        secret: SECRET,
        assetId: asset.assetId,
        expiresAt: asset.expiresAt,
        signature: asset.signature,
    })));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) {
        console.warn(`Failed to delete ${failed} staged router asset${failed === 1 ? "" : "s"}; scheduled expiry cleanup remains active.`);
    }
}
async function stageRouterImage(job, image) {
    const bytes = Buffer.from(image.imageBase64.replace(/\s/g, ""), "base64");
    return await stageRouterAsset({
        siteUrl: CONVEX_SITE_URL,
        secret: SECRET,
        lease: routerAssetLease(job),
        mediaType: image.mimeType,
        filename: "page.png",
        bytes,
        cleanupInvalidResponse: async (cleanup) => {
            await deleteStagedRouterAssets([cleanup]);
        },
    });
}
async function prepareClRouterAssets(job, providerOptions, baseEnvelopeBytes) {
    const options = providerOptions;
    const { images, pdfBase64, pdfBytes, pdfSize } = planExplicitRouterAssets(providerOptions);
    const includePdf = pdfSize > 0;
    const staged = [];
    const routerImages = [];
    let inlineEnvelopeBytes = baseEnvelopeBytes;
    try {
        for (const image of images) {
            const normalized = image.imageBase64.replace(/\s/g, "");
            const inlineBytes = Buffer.byteLength(normalized) + 128;
            if (inlineRouterImageFits(inlineEnvelopeBytes, normalized)) {
                routerImages.push({ ...image, imageBase64: normalized });
                inlineEnvelopeBytes += inlineBytes;
                continue;
            }
            const uploaded = await stageRouterImage(job, image);
            routerImages.push({ source: uploaded.reference });
            staged.push(uploaded.cleanup);
        }
    }
    catch (error) {
        await deleteStagedRouterAssets(staged);
        throw error;
    }
    if (!includePdf && routerImages.length === 0)
        return { staged };
    return {
        assets: {
            ...(includePdf ? { pdfUrl: job.fileUrl, pdfBase64 } : {}),
            ...(includePdf && pdfBytes ? { pdfBytes } : {}),
            ...(typeof options.mimeType === "string"
                ? { mimeType: options.mimeType }
                : {}),
            ...(routerImages.length ? { images: routerImages } : {}),
        },
        staged,
    };
}
function clRouterTraceRoute(task, response) {
    return {
        task,
        route: response.model,
        routeSource: response.routing.source ?? response.routing.decision,
        transport: "cl-router",
    };
}
function clRouterTraceDetails(response) {
    return {
        requestId: response.requestId,
        costUsd: response.costUsd,
        costStatus: response.costStatus,
        finishReason: response.finishReason,
        cachedInputTokens: response.usage.cachedInputTokens,
        cacheWriteTokens: response.usage.cacheWriteTokens,
        reasoningTokens: response.usage.reasoningTokens,
        routing: response.routing,
    };
}
async function generateObjectWithClRouter(opts) {
    const startedAt = nowMs();
    await recordTraceEvent(opts.job, {
        kind: "worker",
        phase: "model_call",
        label: opts.label,
        task: opts.route.task,
        taskKind: opts.taskKind,
        transport: "cl-router",
        attempt: 1,
        status: "started",
        details: stripUndefined({
            maxOutputTokens: opts.maxOutputTokens,
            trace: opts.trace,
            inputSummary: providerInputSummary(opts.providerOptions),
            schemaBytes: Buffer.byteLength(JSON.stringify(opts.schema)),
        }),
    });
    const pinnedRoute = opts.route.route;
    const mappingHint = {
        task: opts.route.task,
        taskKind: opts.taskKind,
    };
    const baseEnvelopeBytes = Buffer.byteLength(JSON.stringify(stripUndefined({
        primitive: "reasoning",
        tenantId: CL_ROUTER_TENANT_ID,
        orgId: opts.job.state.orgId,
        system: opts.system,
        prompt: opts.prompt,
        schema: opts.schema,
        maxTokens: opts.maxOutputTokens,
        route: pinnedRoute,
    }))) + 8_192;
    const preparedAssets = await prepareClRouterAssets(opts.job, opts.providerOptions, baseEnvelopeBytes);
    try {
        const response = await clRouter.generate({
            ...mappingHint,
            tenantId: CL_ROUTER_TENANT_ID,
            orgId: opts.job.state.orgId,
            system: opts.system,
            prompt: opts.prompt,
            schema: opts.schema,
            maxTokens: opts.maxOutputTokens,
            assets: preparedAssets.assets,
            route: pinnedRoute,
            trace: stripUndefined({
                traceId: opts.job.state.traceId,
                label: opts.label,
                phase: opts.trace?.phase,
                taskKind: opts.taskKind,
                policyId: opts.job.policyId,
                workerId: WORKER_ID,
            }),
        }, async (payload) => {
            const invocationKey = stableHash(JSON.stringify({
                run: opts.job.state.traceId ?? opts.job.leaseId,
                label: opts.label,
                prompt: opts.prompt,
                system: opts.system,
                schema: opts.schema,
                route: opts.route,
                trace: opts.trace,
            }));
            const body = JSON.stringify({
                ...routerAssetLease(opts.job),
                invocationKey,
                payload,
            });
            for (;;) {
                let response;
                try {
                    response = await fetch(new URL("/router-jobs/worker", CONVEX_SITE_URL), {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${SECRET}`,
                            "content-type": "application/json",
                        },
                        body,
                        // Reconnect the control request without cancelling the durable inference.
                        signal: AbortSignal.timeout(10_000),
                    });
                }
                catch {
                    await sleep(2_000);
                    continue;
                }
                if (response.status === 202 ||
                    response.status === 429 ||
                    response.status >= 500) {
                    await response.body?.cancel();
                    await sleep(2_000);
                    continue;
                }
                if (!response.ok)
                    throw new Error(`Durable router job lookup failed (${response.status})`);
                const outcome = (await response.json());
                return outcome.result;
            }
        });
        const object = opts.validate(response.output);
        const route = clRouterTraceRoute(opts.route.task, response);
        const usage = mapUsage(response.usage);
        await recordModelCallComplete({
            job: opts.job,
            route,
            label: opts.label,
            taskKind: opts.taskKind,
            attempt: response.routing.attemptCount,
            startedAt,
            usage,
            details: stripUndefined({
                ...modelTraceDetails({
                    kind: "generateObject",
                    label: opts.label,
                    task: opts.route.task,
                    taskKind: opts.taskKind,
                    prompt: opts.prompt,
                    system: opts.system,
                    maxOutputTokens: opts.maxOutputTokens,
                    providerOptions: opts.providerOptions,
                    trace: opts.trace,
                    output: object,
                    outputKind: "object",
                }),
                clRouter: clRouterTraceDetails(response),
            }),
        });
        return { object, usage, route };
    }
    catch (error) {
        await recordTraceEvent(opts.job, {
            kind: "model_call",
            label: opts.label,
            task: opts.route.task,
            taskKind: opts.taskKind,
            transport: "cl-router",
            attempt: 1,
            status: "error",
            durationMs: nowMs() - startedAt,
            error: errorMessage(error),
            details: stripUndefined({
                trace: opts.trace,
            }),
        });
        throw error;
    }
    finally {
        await deleteStagedRouterAssets(preparedAssets.staged);
    }
}
function buildWorkerExtractor(opts) {
    const generateObject = async (params) => {
        const taskKind = readTaskKind(params);
        const trace = readTraceDetails(params);
        const prompt = applyCarrierIdentityGuidance(params.prompt, taskKind, trace?.extractorName);
        const providerOptions = enrichProviderOptions(params.providerOptions, opts.pageScreenshots, trace);
        const route = resolveModelForTaskKind(taskKind, opts.modelSettings);
        const label = modelTraceLabel("generateObject", taskKind, route.task, trace);
        const maxOutputTokens = params.maxTokens;
        const startedAt = nowMs();
        try {
            const routerSchema = z.toJSONSchema(params.schema);
            const routerResult = await generateObjectWithClRouter({
                job: opts.job,
                route,
                taskKind,
                label,
                prompt,
                system: params.system,
                schema: routerSchema,
                maxOutputTokens,
                providerOptions,
                trace,
                validate: (output) => {
                    const parsed = params.schema.safeParse(output);
                    if (!parsed.success) {
                        throw new ClRouterProtocolError("cl-router returned output that failed the extraction schema");
                    }
                    return parsed.data;
                },
            });
            return { object: routerResult.object, usage: routerResult.usage };
        }
        catch (error) {
            if (shouldReturnEmptySections(prompt, error)) {
                await recordModelCallSoftFailure({
                    job: opts.job,
                    route,
                    label,
                    taskKind,
                    startedAt,
                    error,
                    details: modelTraceDetails({
                        kind: "generateObject",
                        label,
                        task: route.task,
                        taskKind,
                        prompt,
                        system: params.system,
                        maxOutputTokens,
                        providerOptions,
                        trace,
                        output: { sections: [] },
                        outputKind: "object",
                    }),
                });
                return { object: { sections: [] }, usage: undefined };
            }
            throw error;
        }
    };
    return {
        extractor: createExtractor({
            generateObject,
            log: opts.log,
            onProgress: opts.log,
            modelCapabilities: EXTRACTION_MODEL_CAPABILITIES,
        }),
        generateObject,
    };
}
async function logJob(job, message, level = "info") {
    try {
        await convex.action(actions.logExternalJob, {
            secret: SECRET,
            policyId: job.policyId,
            leaseId: job.leaseId,
            message,
            phase: "worker",
            level,
        });
    }
    catch (error) {
        console.warn(`[${job.policyId}] failed to append extraction log: ${errorMessage(error)}`);
    }
}
async function fetchPdfBytes(fileUrl) {
    const response = await fetch(resolveConvexStorageUrl(fileUrl, {
        spotEnv: SPOT_ENV,
        convexUrl: CONVEX_URL,
    }));
    if (!response.ok) {
        throw new Error(`Failed to fetch source PDF: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}
function jsonResponse(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
}
async function readJsonBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > HTTP_MAX_BODY_BYTES) {
            throw new Error("Request body is too large");
        }
        chunks.push(buffer);
    }
    if (chunks.length === 0)
        return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function isAuthorized(req) {
    const header = req.headers.authorization;
    if (header === `Bearer ${SECRET}`)
        return true;
    return req.headers["x-extraction-worker-secret"] === SECRET;
}
async function handleConvertRequest(req, res) {
    if (!RUNTIME_ACCESS.conversionsEnabled) {
        jsonResponse(res, 503, {
            error: "PDF conversion is disabled in ephemeral Railway environments",
        });
        return;
    }
    if (!isAuthorized(req)) {
        jsonResponse(res, 401, { error: "Unauthorized" });
        return;
    }
    const cancellation = watchClientDisconnect(req, res);
    const signal = AbortSignal.any([
        cancellation.signal,
        shutdownController.signal,
    ]);
    let releasePdfWork;
    try {
        releasePdfWork = await pdfWorkAdmission.acquire("http", signal);
        const body = await readJsonBody(req);
        if (signal.aborted) {
            throw new DOMException("Client closed request", "AbortError");
        }
        const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : "";
        if (!pdfBase64) {
            jsonResponse(res, 400, { error: "Missing pdfBase64" });
            return;
        }
        const pdfBytes = Buffer.from(pdfBase64, "base64");
        const converted = await convertPdfWithLiteParse({
            pdfBytes,
            documentId: typeof body.documentId === "string" ? body.documentId : "inline-pdf",
            sourceKind: readSourceKind(body.sourceKind),
            maxPages: LITEPARSE_MAX_PAGES,
            maxFileSize: LITEPARSE_MAX_FILE_SIZE,
            priority: "http",
            signal,
        });
        jsonResponse(res, 200, {
            ok: true,
            text: converted.text,
            sourceSpans: converted.sourceSpans,
            sourceChunks: converted.sourceChunks,
            pageScreenshots: converted.pageScreenshots,
            metadata: converted.metadata,
        });
    }
    catch (error) {
        if (signal.aborted ||
            (error instanceof Error && error.name === "AbortError")) {
            if (!res.headersSent && !res.destroyed && !res.writableEnded) {
                jsonResponse(res, 499, { error: "Client closed request" });
            }
            return;
        }
        throw error;
    }
    finally {
        releasePdfWork?.();
        cancellation.dispose();
    }
}
function startHttpServer() {
    if (!HTTP_PORT)
        return null;
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (req.method === "GET" && url.pathname === "/health") {
            jsonResponse(res, 200, {
                ok: true,
                spotEnv: SPOT_ENV,
                workerId: WORKER_ID,
                workerVersion: WORKER_VERSION,
                workerProtocolVersion: WORKER_PROTOCOL_VERSION,
                clSdkVersion: WORKER_CL_SDK_VERSION,
                convexUrl: CONVEX_URL,
                railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
                gitSha: process.env.RAILWAY_GIT_COMMIT_SHA,
                gitBranch: process.env.RAILWAY_GIT_BRANCH,
                workerMode: RUNTIME_ACCESS.mode,
                jobsEnabled: RUNTIME_ACCESS.jobsEnabled,
                conversionsEnabled: RUNTIME_ACCESS.conversionsEnabled,
                clRouterEnabled: true,
                extractionJobConcurrency: EXTRACTION_JOB_CONCURRENCY,
                previewJobConcurrency: PREVIEW_JOB_CONCURRENCY,
                pdfWorkMaxActive: PDF_WORK_MAX_ACTIVE,
                pdfWorkMaxFullActive: PDF_WORK_MAX_FULL_ACTIVE,
                pdfWorkAdmission: pdfWorkAdmission.snapshot(),
                liteParseNativeConcurrency: LITEPARSE_NATIVE_CONCURRENCY,
            });
            return;
        }
        if (req.method === "POST" && url.pathname === "/liteparse/convert") {
            handleConvertRequest(req, res).catch((error) => {
                console.error("LiteParse HTTP conversion failed:", error);
                if (!res.headersSent && !res.destroyed && !res.writableEnded) {
                    jsonResponse(res, 500, { error: errorMessage(error) });
                }
            });
            return;
        }
        jsonResponse(res, 404, { error: "Not found" });
    });
    server.listen(HTTP_PORT, () => {
        console.log(`LiteParse conversion endpoint listening on port ${HTTP_PORT}`);
    });
    return {
        close: () => server.close(),
    };
}
async function heartbeat(job) {
    const result = await convex.action(actions.heartbeatExternalJob, {
        secret: SECRET,
        policyId: job.policyId,
        leaseId: job.leaseId,
    });
    if (!result.ok) {
        throw new Error(`Lost external extraction lease for ${job.policyId}`);
    }
}
function jsonByteLength(value) {
    const json = JSON.stringify(value);
    return json ? Buffer.byteLength(json) : 0;
}
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function payloadSizeSummary(payload) {
    return Object.entries(payload)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key} ${formatBytes(jsonByteLength(value))}`)
        .join(", ");
}
const COMPLETION_UPLOAD_ATTEMPTS = 3;
const COMPLETION_ACTION_FALLBACK_MAX_BYTES = 4.5 * 1024 * 1024;
async function uploadCompletionPayload(job, payload) {
    const json = JSON.stringify(payload);
    const byteLength = Buffer.byteLength(json);
    let lastError;
    for (let attempt = 1; attempt <= COMPLETION_UPLOAD_ATTEMPTS; attempt += 1) {
        try {
            const { uploadUrl } = await convex.action(actions.createExternalCompletionUploadUrl, {
                secret: SECRET,
            });
            const response = await fetch(resolveConvexStorageUrl(uploadUrl, {
                spotEnv: SPOT_ENV,
                convexUrl: CONVEX_URL,
            }), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: json,
            });
            if (!response.ok) {
                throw new Error(`Failed to upload completion payload: ${response.status} ${await response.text()}`);
            }
            const uploaded = (await response.json());
            if (!uploaded.storageId) {
                throw new Error("Completion payload upload did not return a storageId");
            }
            return await convex.action(actions.finalizeExternalCompletionPayload, {
                secret: SECRET,
                policyId: job.policyId,
                leaseId: job.leaseId,
                storageId: uploaded.storageId,
                byteLength,
            });
        }
        catch (error) {
            lastError = error;
            if (attempt < COMPLETION_UPLOAD_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 500));
            }
        }
    }
    if (byteLength <= COMPLETION_ACTION_FALLBACK_MAX_BYTES) {
        await logJob(job, `Direct completion payload upload failed; retrying through Convex action fallback (${formatBytes(byteLength)}): ${errorMessage(lastError)}`, "warn");
        return await convex.action(actions.saveExternalCompletionPayload, {
            secret: SECRET,
            policyId: job.policyId,
            leaseId: job.leaseId,
            payload,
        });
    }
    throw lastError instanceof Error
        ? lastError
        : new Error(`Failed to upload completion payload: ${String(lastError)}`);
}
async function uploadExtractionArtifact(job, args) {
    const json = JSON.stringify(args.value);
    let lastError;
    for (let attempt = 1; attempt <= COMPLETION_UPLOAD_ATTEMPTS; attempt += 1) {
        try {
            const { uploadUrl } = await convex.action(actions.createExternalExtractionArtifactUploadUrl, { secret: SECRET });
            const response = await fetch(resolveConvexStorageUrl(uploadUrl, {
                spotEnv: SPOT_ENV,
                convexUrl: CONVEX_URL,
            }), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: json,
            });
            if (!response.ok) {
                throw new Error(`Failed to upload ${args.kind}: ${response.status} ${await response.text()}`);
            }
            const uploaded = (await response.json());
            if (!uploaded.storageId)
                throw new Error(`${args.kind} upload did not return a storageId`);
            const finalized = await convex.action(actions.finalizeExternalExtractionArtifact, {
                secret: SECRET,
                policyId: job.policyId,
                leaseId: job.leaseId,
                kind: args.kind,
                storageId: uploaded.storageId,
                sourceFingerprint: args.sourceFingerprint,
                extractorVersion: args.extractorVersion,
                sectionId: args.sectionId,
                metadata: args.metadata,
            });
            if (!finalized.ok)
                throw new Error(`Convex rejected ${args.kind} for ${job.policyId}`);
            return finalized;
        }
        catch (error) {
            lastError = error;
            if (attempt < COMPLETION_UPLOAD_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 500));
            }
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error(`Failed to upload ${args.kind}: ${String(lastError)}`);
}
async function loadExtractionArtifact(url) {
    const response = await fetch(resolveConvexStorageUrl(url, {
        spotEnv: SPOT_ENV,
        convexUrl: CONVEX_URL,
    }));
    if (!response.ok) {
        throw new Error(`Failed to load extraction artifact: ${response.status} ${await response.text()}`);
    }
    return await response.json();
}
function sourceBundleFingerprint(sourceSpans) {
    return stableHash(sourceSpans.map((span) => ({
        id: span.id,
        hash: span.textHash ?? stableHash(span.text),
        pageStart: span.pageStart,
        pageEnd: span.pageEnd,
    })));
}
const EXTRACTION_SECTION_IDS = new Set([
    "extraction_policy_core",
    "extraction_policy_coverage",
    "extraction_coverage_cleanup",
]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isExtractionSectionResult(value) {
    return (isRecord(value) &&
        value.version === "extraction-section-result-v1" &&
        typeof value.sectionId === "string" &&
        EXTRACTION_SECTION_IDS.has(value.sectionId) &&
        (value.status === "complete" ||
            value.status === "not_applicable" ||
            value.status === "degraded") &&
        typeof value.sourceFingerprint === "string" &&
        typeof value.extractorVersion === "string" &&
        Array.isArray(value.sourceSpanIds) &&
        value.sourceSpanIds.every((id) => typeof id === "string") &&
        Array.isArray(value.warnings) &&
        value.warnings.every((warning) => typeof warning === "string") &&
        (value.error === undefined || typeof value.error === "string") &&
        (value.operationalProfile === undefined ||
            isRecord(value.operationalProfile)) &&
        typeof value.resultHash === "string");
}
async function loadResumableExtraction(job) {
    if (WORKER_PROTOCOL_VERSION !== "source-tree-v2") {
        return {
            sourceBundle: undefined,
            sectionResults: new Map(),
        };
    }
    const response = await convex.action(actions.getExternalExtractionResumeArtifacts, {
        secret: SECRET,
        policyId: job.policyId,
        leaseId: job.leaseId,
    });
    if (!response.ok)
        throw new Error(`Lost external extraction lease for ${job.policyId}`);
    const matching = response.artifacts.filter((artifact) => artifact.extractorVersion === WORKER_CL_SDK_VERSION && artifact.url);
    let sourceBundle;
    const sectionResults = new Map();
    for (const artifact of matching) {
        const value = await loadExtractionArtifact(artifact.url);
        if (artifact.kind === "source_bundle" && !sourceBundle) {
            const candidate = value;
            if (candidate.version === "worker-source-bundle-v1" &&
                candidate.protocolVersion === "source-tree-v2" &&
                candidate.extractorVersion === WORKER_CL_SDK_VERSION &&
                Array.isArray(candidate.sourceSpans) &&
                Array.isArray(candidate.sourceChunks) &&
                candidate.sourceFingerprint ===
                    sourceBundleFingerprint(candidate.sourceSpans)) {
                sourceBundle = candidate;
            }
        }
        else if (artifact.kind === "section_result" &&
            artifact.sectionId &&
            isExtractionSectionResult(value) &&
            value.sectionId === artifact.sectionId &&
            value.extractorVersion === WORKER_CL_SDK_VERSION) {
            sectionResults.set(value.sectionId, value);
        }
    }
    return { sourceBundle, sectionResults };
}
const HEAVY_PAYLOAD_KEYS = new Set([
    "base64",
    "data",
    "image",
    "imageBase64",
    "images",
    "pageImages",
    "pageScreenshots",
    "pdf",
    "pdfBase64",
    "providerOptions",
    "request",
    "requestBody",
    "sourceChunks",
    "sourceSpans",
    "sourceTree",
]);
function sanitizeCompletionDocument(value, depth = 0) {
    if (depth > 8)
        return undefined;
    if (Array.isArray(value)) {
        return value
            .map((item) => sanitizeCompletionDocument(item, depth + 1))
            .filter((item) => item !== undefined);
    }
    if (!value || typeof value !== "object") {
        if (typeof value === "string" && value.length > 100_000) {
            return `${value.slice(0, 100_000)}...[truncated ${value.length - 100_000} chars]`;
        }
        return value;
    }
    const output = {};
    for (const [key, entryValue] of Object.entries(value)) {
        if (HEAVY_PAYLOAD_KEYS.has(key))
            continue;
        const sanitized = sanitizeCompletionDocument(entryValue, depth + 1);
        if (sanitized !== undefined)
            output[key] = sanitized;
    }
    return output;
}
const PREVIEW_TOP_LEVEL_FIELDS = [
    "documentType",
    "carrier",
    "security",
    "underwriter",
    "generalAgentName",
    "broker",
    "policyNumber",
    "productName",
    "linesOfBusiness",
    "effectiveDate",
    "expirationDate",
    "insuredName",
    "premium",
    "totalCost",
    "summary",
    "limits",
    "deductibles",
    "coverages",
];
const PREVIEW_LIMIT_FIELDS = [
    "perOccurrence",
    "generalAggregate",
    "productsCompletedOpsAggregate",
    "personalAdvertisingInjury",
    "eachEmployee",
    "combinedSingleLimit",
    "umbrellaAggregate",
    "umbrellaRetention",
];
const PREVIEW_DEDUCTIBLE_FIELDS = [
    "perClaim",
    "perOccurrence",
    "aggregateDeductible",
    "selfInsuredRetention",
    "appliesTo",
];
const PREVIEW_COVERAGE_FIELDS = [
    "name",
    "lineOfBusiness",
    "coverageCode",
    "limit",
    "limitType",
    "deductible",
    "deductibleType",
];
const previewExtractionSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        documentType: { type: ["string", "null"], enum: ["policy", null] },
        carrier: { type: ["string", "null"] },
        security: { type: ["string", "null"] },
        underwriter: { type: ["string", "null"] },
        generalAgentName: { type: ["string", "null"] },
        broker: { type: ["string", "null"] },
        policyNumber: { type: ["string", "null"] },
        productName: { type: ["string", "null"] },
        linesOfBusiness: {
            type: "array",
            items: { type: "string" },
            maxItems: 12,
        },
        effectiveDate: { type: ["string", "null"] },
        expirationDate: { type: ["string", "null"] },
        insuredName: { type: ["string", "null"] },
        premium: { type: ["string", "null"] },
        totalCost: { type: ["string", "null"] },
        summary: { type: ["string", "null"] },
        limits: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
                perOccurrence: { type: ["string", "null"] },
                generalAggregate: { type: ["string", "null"] },
                productsCompletedOpsAggregate: { type: ["string", "null"] },
                personalAdvertisingInjury: { type: ["string", "null"] },
                eachEmployee: { type: ["string", "null"] },
                combinedSingleLimit: { type: ["string", "null"] },
                umbrellaAggregate: { type: ["string", "null"] },
                umbrellaRetention: { type: ["string", "null"] },
            },
            required: [...PREVIEW_LIMIT_FIELDS],
        },
        deductibles: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
                perClaim: { type: ["string", "null"] },
                perOccurrence: { type: ["string", "null"] },
                aggregateDeductible: { type: ["string", "null"] },
                selfInsuredRetention: { type: ["string", "null"] },
                appliesTo: { type: ["string", "null"] },
            },
            required: [...PREVIEW_DEDUCTIBLE_FIELDS],
        },
        coverages: {
            type: "array",
            maxItems: POLICY_PREVIEW_MAX_COVERAGES,
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string" },
                    lineOfBusiness: { type: ["string", "null"] },
                    coverageCode: { type: ["string", "null"] },
                    limit: { type: ["string", "null"] },
                    limitType: { type: ["string", "null"] },
                    deductible: { type: ["string", "null"] },
                    deductibleType: { type: ["string", "null"] },
                },
                required: [...PREVIEW_COVERAGE_FIELDS],
            },
        },
    },
    required: [...PREVIEW_TOP_LEVEL_FIELDS],
};
function cleanPreviewString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!trimmed)
        return undefined;
    if (/^(unknown|not\s*(available|provided|found)|n\/a|null|none)$/i.test(trimmed)) {
        return undefined;
    }
    return trimmed.slice(0, 500);
}
function cleanPreviewParagraph(value) {
    const trimmed = cleanPreviewString(value);
    return trimmed ? trimmed.slice(0, 1000) : undefined;
}
function previewLobCodes(values) {
    if (!Array.isArray(values) || values.length === 0)
        return [];
    const source = values
        .map(cleanPreviewString)
        .filter((value) => Boolean(value));
    return source.length > 0 ? toLobCodes(source).slice(0, 12) : [];
}
function compactRecord(value, allowedKeys) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
    const output = {};
    for (const key of allowedKeys) {
        const cleaned = cleanPreviewString(value[key]);
        if (cleaned)
            output[key] = cleaned;
    }
    return Object.keys(output).length > 0 ? output : undefined;
}
function normalizePreviewFields(value) {
    const input = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    const fields = {};
    if (input.documentType === "policy")
        fields.documentType = "policy";
    for (const key of [
        "carrier",
        "security",
        "underwriter",
        "broker",
        "policyNumber",
        "effectiveDate",
        "expirationDate",
        "insuredName",
        "premium",
        "totalCost",
    ]) {
        const cleaned = cleanPreviewString(input[key]);
        if (cleaned)
            fields[key] = cleaned;
    }
    const generalAgentName = cleanPreviewString(input.generalAgentName);
    if (generalAgentName) {
        fields.generalAgent = { agencyName: generalAgentName };
    }
    const productName = cleanPreviewString(input.productName);
    if (productName)
        fields.programName = productName;
    const summary = cleanPreviewParagraph(input.summary);
    if (summary)
        fields.summary = summary;
    const linesOfBusiness = previewLobCodes(input.linesOfBusiness);
    if (linesOfBusiness.length > 0)
        fields.linesOfBusiness = linesOfBusiness;
    if (Array.isArray(input.coverages)) {
        const coverages = input.coverages
            .map((coverage) => {
            if (!coverage ||
                typeof coverage !== "object" ||
                Array.isArray(coverage))
                return null;
            const row = coverage;
            const name = cleanPreviewString(row.name);
            if (!name)
                return null;
            return stripUndefined({
                name,
                lineOfBusiness: cleanPreviewString(row.lineOfBusiness),
                coverageCode: resolveAcordCoverageCode(row.coverageCode, name),
                limit: cleanPreviewString(row.limit),
                limitType: cleanPreviewString(row.limitType),
                deductible: cleanPreviewString(row.deductible),
                deductibleType: cleanPreviewString(row.deductibleType),
            });
        })
            .filter(Boolean)
            .slice(0, POLICY_PREVIEW_MAX_COVERAGES);
        if (coverages.length > 0)
            fields.coverages = coverages;
    }
    const limits = compactRecord(input.limits, [
        "perOccurrence",
        "generalAggregate",
        "productsCompletedOpsAggregate",
        "personalAdvertisingInjury",
        "eachEmployee",
        "combinedSingleLimit",
        "umbrellaAggregate",
        "umbrellaRetention",
    ]);
    if (limits)
        fields.limits = limits;
    const deductibles = compactRecord(input.deductibles, [
        "perClaim",
        "perOccurrence",
        "aggregateDeductible",
        "selfInsuredRetention",
        "appliesTo",
    ]);
    if (deductibles)
        fields.deductibles = deductibles;
    return fields;
}
function previewTextFromSourceSpans(sourceSpans) {
    let output = "";
    for (const span of orderSourceSpansForPreview(sourceSpans)) {
        const text = span.text.replace(/\s+/g, " ").trim();
        if (!text)
            continue;
        const page = span.pageStart ? `p.${span.pageStart}` : "p.unknown";
        const next = `[${page}] ${text}\n`;
        if (output.length + next.length > POLICY_PREVIEW_TEXT_LIMIT) {
            output += next.slice(0, Math.max(0, POLICY_PREVIEW_TEXT_LIMIT - output.length));
            break;
        }
        output += next;
    }
    return output.trim();
}
async function extractPreviewFields(job, sourceText) {
    const route = resolveModelForTaskKind("extraction_preview", job.modelSettings);
    const maxOutputTokens = 4_096;
    const system = `You extract a fast provisional first read from already-bound insurance policy text.
Return only fields that are explicitly present or strongly implied by the document text.
Leave unknown fields null or empty. Do not invent carriers, dates, limits, policy numbers, insured names, or coverages.
This output is provisional and will be overwritten by a later source-backed extraction.`;
    const prompt = applyCarrierIdentityGuidance(`Extract a provisional policy summary from this LiteParse/PDF text.

Use concise display strings for dates, money, limits, deductibles, and coverage names.
Populate generalAgentName only when the document identifies a General Agent, including source labels such as managing general agent, MGA, program administrator, or administrator. Normalize a source-labeled Broker or Agent to Producer; do not use the Producer or insurer name as the General Agent.
Populate productName only from a source-stated carrier product, policy program, or plan name. Preserve the source wording; do not use the policy number, form number, carrier name, ACORD line label, or generic "insurance policy" text.
For linesOfBusiness and coverages[].lineOfBusiness, use only a current ACORD LOBCd from this list: ${ACORD_LOB_CODES.join(", ")}. Travel insurance is TRVL and commercial cyber/privacy liability is CYBER. Use UN only when no more specific code fits. Omit coverages[].lineOfBusiness when a coverage row cannot be assigned to exactly one line.
For coverages[].coverageCode, use ACORD CoverageCd only when the source prints the code or the coverage name has an unambiguous exact match. Otherwise omit it.

Document text:
${sourceText}`, "extraction_preview");
    const label = "Extract provisional policy fields";
    const routerResult = await generateObjectWithClRouter({
        job,
        route,
        taskKind: "extraction_preview",
        label,
        prompt,
        system,
        schema: previewExtractionSchema,
        maxOutputTokens,
        providerOptions: {},
        trace: { phase: "preview", label },
        validate: (output) => {
            if (!output || typeof output !== "object" || Array.isArray(output)) {
                throw new ClRouterProtocolError("cl-router returned an invalid preview extraction object");
            }
            return output;
        },
    });
    return {
        fields: normalizePreviewFields(routerResult.object),
        route: routerResult.route,
    };
}
async function completeJob(job, result, fallbackSource) {
    const resultSourceSpans = result.sourceSpans ?? [];
    const resultSourceChunks = result.sourceChunks ?? [];
    const resultSourceTree = result.sourceTree ?? [];
    const rawSourceSpans = fallbackSource.sourceSpans;
    const rawSourceChunks = fallbackSource.sourceChunks;
    const sourceSpanCandidates = resultSourceSpans.length > 0
        ? result.protocolVersion === "source-tree-v2"
            ? resultSourceSpans
            : [...resultSourceSpans, ...rawSourceSpans]
        : rawSourceSpans;
    const sourceChunkCandidates = resultSourceChunks.length > 0
        ? result.protocolVersion === "source-tree-v2"
            ? resultSourceChunks
            : [...resultSourceChunks, ...rawSourceChunks]
        : rawSourceChunks;
    const sourceSpans = dedupeById(sourceSpanCandidates);
    const sourceChunks = dedupeById(sourceChunkCandidates);
    const document = sanitizeCompletionDocument(result.document);
    const payload = {
        protocolVersion: result.protocolVersion ?? "source-tree-v1",
        extractorVersion: result.extractorVersion ?? WORKER_CL_SDK_VERSION,
        sections: result.sections,
        completionManifest: result.completionManifest,
        document,
        chunks: result.chunks,
        sourceSpans,
        sourceChunks,
        sourceTree: resultSourceTree,
        operationalProfile: result.operationalProfile,
        warnings: result.warnings ?? [],
        tokenUsage: result.tokenUsage,
        performanceReport: result.performanceReport
            ? {
                modelCallCount: result.performanceReport.modelCalls?.length ?? 0,
                totalModelCallDurationMs: result.performanceReport.totalModelCallDurationMs,
            }
            : undefined,
    };
    await logJob(job, `External extraction payload sizes: ${payloadSizeSummary(payload)}`);
    const savedPayload = await uploadCompletionPayload(job, payload);
    const completed = await convex.action(actions.completeExternalExtract, {
        secret: SECRET,
        policyId: job.policyId,
        leaseId: job.leaseId,
        state: job.state,
        payloadStorageId: savedPayload.storageId,
    });
    if (!completed.ok) {
        throw new Error(`Convex rejected completion for ${job.policyId}`);
    }
}
function dedupeById(items) {
    const seen = new Set();
    const deduped = [];
    for (const item of items) {
        const id = typeof item.id === "string" ? item.id : "";
        if (id && seen.has(id))
            continue;
        if (id)
            seen.add(id);
        deduped.push(item);
    }
    return deduped;
}
async function supplementPreparedPdfSource(pdfBytes, documentId, preparedSource, sourceKind = "policy_pdf") {
    const supplemental = await buildPdfTextSupplements({
        pdfBytes,
        documentId,
        sourceKind,
        primarySourceSpans: preparedSource.sourceSpans,
    });
    return {
        sourceSpans: dedupeById([
            ...preparedSource.sourceSpans,
            ...supplemental.sourceSpans,
        ]),
        sourceChunks: dedupeById([
            ...preparedSource.sourceChunks,
            ...supplemental.sourceChunks,
        ]),
        supplementCount: supplemental.sourceSpans.length,
    };
}
async function failJob(job, error) {
    await convex.action(actions.failExternalJob, {
        secret: SECRET,
        policyId: job.policyId,
        leaseId: job.leaseId,
        state: job.state,
        error: errorMessage(error),
    });
}
async function processJob(job, releasePdfWork) {
    console.log(`[${job.policyId}] claimed external extraction job`);
    await logJob(job, `External worker ${WORKER_ID} started extraction`);
    const heartbeatTimer = setInterval(() => {
        heartbeat(job).catch((error) => {
            console.error(`[${job.policyId}] heartbeat failed:`, error);
        });
    }, HEARTBEAT_MS);
    try {
        const replayedCompletion = await convex.action(actions.completeExternalExtractFromStoredPayload, {
            secret: SECRET,
            policyId: job.policyId,
            leaseId: job.leaseId,
            state: job.state,
        });
        if (replayedCompletion.ok) {
            await logJob(job, "Replayed stored external extraction completion payload");
            return;
        }
        const extractStartedAt = nowMs();
        await recordTraceEvent(job, {
            kind: "phase",
            phase: "external_extract",
            label: "external_extract",
            status: "started",
        });
        const resumable = await loadResumableExtraction(job);
        let pdfBytes = new Uint8Array();
        let preparedSource;
        let pageScreenshots;
        if (resumable.sourceBundle) {
            preparedSource = {
                sourceSpans: resumable.sourceBundle.sourceSpans,
                sourceChunks: resumable.sourceBundle.sourceChunks,
            };
            pageScreenshots = resumable.sourceBundle.pageScreenshots;
            await logJob(job, `Resumed persisted ${resumable.sourceBundle.parser} source bundle without reparsing the PDF`);
        }
        else {
            pdfBytes = await fetchPdfBytes(job.fileUrl);
            await logJob(job, `External worker fetched PDF (${pdfBytes.byteLength} bytes)`);
            const prepared = await preparePdfSourceWithLiteParseFallback({
                convertWithLiteParse: () => convertPdfWithLiteParse({
                    pdfBytes,
                    documentId: job.policyId,
                    sourceKind: "policy_pdf",
                    maxPages: LITEPARSE_MAX_PAGES,
                    maxFileSize: LITEPARSE_MAX_FILE_SIZE,
                    priority: "full",
                }),
                prepareLiteParseSource: async (converted) => {
                    await logJob(job, `LiteParse parsed PDF${converted.metadata.ocrRetried ? " after OCR retry" : ""} in ${converted.metadata.parsingMs ?? 0}ms; prepared ${converted.sourceSpans.length} hierarchical source spans`);
                    const supplementedSource = await supplementPreparedPdfSource(pdfBytes, job.policyId, {
                        sourceSpans: converted.sourceSpans,
                        sourceChunks: converted.sourceChunks,
                    });
                    if (supplementedSource.supplementCount > 0) {
                        await logJob(job, `Added ${supplementedSource.supplementCount} Poppler text supplement span${supplementedSource.supplementCount === 1 ? "" : "s"} for visible PDF text omitted by LiteParse`);
                    }
                    return supplementedSource;
                },
                onLiteParseFailure: (error) => logJob(job, `LiteParse unavailable; falling back to PDF.js source spans (${errorMessage(error)})`, "warn"),
                preparePdfJsSource: async () => {
                    const pdfJsSource = await buildPdfSourceSpans({
                        pdfBytes,
                        documentId: job.policyId,
                        sourceKind: "policy_pdf",
                    });
                    const fallbackSource = await supplementPreparedPdfSource(pdfBytes, job.policyId, {
                        sourceSpans: pdfJsSource.sourceSpans,
                        sourceChunks: pdfJsSource.sourceChunks,
                    });
                    if (fallbackSource.sourceSpans.length > 0) {
                        await logJob(job, `Prepared ${fallbackSource.sourceSpans.length} PDF.js/Poppler source spans for source-grounded extraction`);
                    }
                    return fallbackSource;
                },
            });
            preparedSource = prepared.prepared;
            pageScreenshots =
                prepared.parser === "liteparse"
                    ? prepared.converted.pageScreenshots
                    : undefined;
            if (WORKER_PROTOCOL_VERSION === "source-tree-v2") {
                const sourceFingerprint = sourceBundleFingerprint(preparedSource.sourceSpans);
                const sourceBundle = {
                    version: "worker-source-bundle-v1",
                    protocolVersion: "source-tree-v2",
                    extractorVersion: WORKER_CL_SDK_VERSION,
                    sourceFingerprint,
                    parser: prepared.parser,
                    sourceSpans: preparedSource.sourceSpans,
                    sourceChunks: preparedSource.sourceChunks,
                    pageScreenshots,
                };
                await uploadExtractionArtifact(job, {
                    kind: "source_bundle",
                    value: sourceBundle,
                    sourceFingerprint,
                    extractorVersion: WORKER_CL_SDK_VERSION,
                    metadata: {
                        artifactRole: "worker_source",
                        protocolVersion: WORKER_PROTOCOL_VERSION,
                        parser: prepared.parser,
                    },
                });
            }
        }
        const { extractor } = buildWorkerExtractor({
            job,
            log: async (message) => logJob(job, message),
            modelSettings: job.modelSettings,
            pageScreenshots,
        });
        const sectionStore = WORKER_PROTOCOL_VERSION === "source-tree-v2"
            ? {
                load: async ({ sectionId, sourceFingerprint, extractorVersion, }) => {
                    const sectionResult = resumable.sectionResults.get(sectionId);
                    return sectionResult?.sourceFingerprint === sourceFingerprint &&
                        sectionResult.extractorVersion === extractorVersion
                        ? sectionResult
                        : undefined;
                },
                save: async (sectionResult) => {
                    resumable.sectionResults.set(sectionResult.sectionId, sectionResult);
                    await uploadExtractionArtifact(job, {
                        kind: "section_result",
                        value: sectionResult,
                        sourceFingerprint: sectionResult.sourceFingerprint,
                        extractorVersion: sectionResult.extractorVersion,
                        sectionId: sectionResult.sectionId,
                        metadata: {
                            status: sectionResult.status,
                            resultHash: sectionResult.resultHash,
                            protocolVersion: WORKER_PROTOCOL_VERSION,
                        },
                    });
                },
            }
            : undefined;
        const extractOptions = {
            ...(preparedSource.sourceSpans.length > 0
                ? {
                    sourceSpans: preparedSource.sourceSpans,
                }
                : {}),
            coverageRecovery: { enabled: false },
            protocolVersion: WORKER_PROTOCOL_VERSION,
            extractorVersion: WORKER_CL_SDK_VERSION,
            sectionStore,
        };
        const result = await extractor.extract(pdfBytes, job.policyId, extractOptions);
        if (WORKER_PROTOCOL_VERSION === "source-tree-v2" &&
            result
                .protocolVersion !== "source-tree-v2") {
            throw new Error(`Configured source-tree-v2 requires a section-capable cl-sdk; ${WORKER_CL_SDK_VERSION} returned the legacy protocol`);
        }
        await recordTraceEvent(job, {
            kind: "phase",
            phase: "external_extract",
            label: "external_extract",
            status: "complete",
            durationMs: nowMs() - extractStartedAt,
        });
        await completeJob(job, result, preparedSource);
        console.log(`[${job.policyId}] completed external extraction`);
    }
    catch (error) {
        console.error(`[${job.policyId}] extraction failed:`, error);
        await failJob(job, error);
    }
    finally {
        releasePdfWork();
        clearInterval(heartbeatTimer);
    }
}
async function logProposalJob(job, message, level = "info", phase) {
    try {
        await convex.action(actions.logExternalProposalJob, {
            secret: SECRET,
            jobId: job.jobId,
            leaseId: job.leaseId,
            message,
            level,
            phase,
        });
    }
    catch (error) {
        console.warn(`[proposal:${job.proposalId}] could not persist worker log:`, error);
    }
}
async function heartbeatProposal(job) {
    return await convex.action(actions.heartbeatExternalProposalJob, {
        secret: SECRET,
        jobId: job.jobId,
        leaseId: job.leaseId,
    });
}
async function extractProposalDocument(job, document) {
    if (document.contentType && document.contentType !== "application/pdf") {
        throw new Error(`Proposal extraction supports PDF documents; ${document.fileName} is ${document.contentType}`);
    }
    const pdfBytes = await fetchPdfBytes(document.fileUrl);
    await logProposalJob(job, `Fetched ${document.fileName} (${pdfBytes.byteLength} bytes)`, "info", "parse");
    const prepared = await preparePdfSourceWithLiteParseFallback({
        convertWithLiteParse: () => convertPdfWithLiteParse({
            pdfBytes,
            documentId: document.proposalDocumentId,
            sourceKind: "attachment",
            maxPages: LITEPARSE_MAX_PAGES,
            maxFileSize: LITEPARSE_MAX_FILE_SIZE,
            priority: "full",
        }),
        prepareLiteParseSource: async (converted) => {
            await logProposalJob(job, `LiteParse parsed ${document.fileName}${converted.metadata.ocrRetried ? " after OCR retry" : ""}; prepared ${converted.sourceSpans.length} hierarchical source spans`, "info", "parse");
            return supplementPreparedPdfSource(pdfBytes, document.proposalDocumentId, {
                sourceSpans: converted.sourceSpans,
                sourceChunks: converted.sourceChunks,
            }, "attachment");
        },
        onLiteParseFailure: (error) => logProposalJob(job, `LiteParse unavailable for ${document.fileName}; using PDF.js (${errorMessage(error)})`, "warn", "parse"),
        preparePdfJsSource: async () => {
            const fallback = await buildPdfSourceSpans({
                pdfBytes,
                documentId: document.proposalDocumentId,
                sourceKind: "attachment",
            });
            return await supplementPreparedPdfSource(pdfBytes, document.proposalDocumentId, fallback, "attachment");
        },
    });
    const modelJob = {
        policyId: document.proposalDocumentId,
        leaseId: job.leaseId,
        leaseExpiresAt: job.leaseExpiresAt,
        state: {
            sourceKind: "upload",
            orgId: job.orgId,
            userId: job.requestedByUserId,
        },
        fileUrl: document.fileUrl,
        modelSettings: job.modelSettings,
        routerAssetLease: {
            jobKind: "proposal",
            jobId: job.jobId,
        },
    };
    const { extractor, generateObject } = buildWorkerExtractor({
        job: modelJob,
        log: (message) => logProposalJob(job, `${document.fileName}: ${message}`, "info", "extract"),
        modelSettings: job.modelSettings,
        pageScreenshots: prepared.parser === "liteparse"
            ? prepared.converted.pageScreenshots
            : undefined,
    });
    const result = await extractor.extract(pdfBytes, document.proposalDocumentId, {
        sourceSpans: prepared.prepared.sourceSpans,
        coverageRecovery: { enabled: false },
        protocolVersion: WORKER_PROTOCOL_VERSION,
        extractorVersion: WORKER_CL_SDK_VERSION,
    });
    const validNodeIds = new Set((result.sourceTree ?? []).map((node) => node.id));
    const validSpanIds = new Set((result.sourceSpans?.length
        ? result.sourceSpans
        : prepared.prepared.sourceSpans).map((span) => span.id));
    const proposalEvidence = (result.sourceTree ?? []).map((node) => ({
        sourceNodeId: node.id,
        sourceSpanIds: node.sourceSpanIds,
        pageStart: node.pageStart,
        pageEnd: node.pageEnd,
        title: node.title,
        text: node.textExcerpt ?? node.description,
    }));
    const supplementalResult = await generateObject({
        schema: proposalQuoteSupplementSchema,
        maxTokens: 3_000,
        system: `You extract quote-only commercial-insurance terms from source-backed proposal evidence. Copy source node and span IDs exactly. Do not infer an expiration date, subjectivity, or binding condition that is not explicit. Quote expiration means the deadline or validity date for accepting/binding the quote, not the proposed policy expiration date.`,
        prompt: `Extract the quote validity deadline, subjectivities, and binding or underwriting conditions from this single proposal document. Use null for an absent quote expiration. Every returned item, including quoteExpirationEvidence when a date is present, must cite supplied source IDs.

${JSON.stringify(proposalEvidence).slice(0, 160_000)}`,
        trace: {
            phase: "proposal_quote_terms",
            label: "Extract proposal quote terms",
            sourceBacked: true,
        },
    });
    const supplementalObject = proposalQuoteSupplementSchema.parse(supplementalResult.object);
    const normalizeEvidenceItem = (item) => {
        if (!item)
            return undefined;
        const sourceNodeIds = item.sourceNodeIds.filter((id) => validNodeIds.has(id));
        const sourceSpanIds = item.sourceSpanIds.filter((id) => validSpanIds.has(id));
        if (sourceNodeIds.length === 0 && sourceSpanIds.length === 0)
            return undefined;
        return {
            description: item.description.trim(),
            category: item.category ?? undefined,
            sourceNodeIds,
            sourceSpanIds,
            pageStart: item.pageStart ?? undefined,
            pageEnd: item.pageEnd ?? item.pageStart ?? undefined,
        };
    };
    const quoteExpirationEvidence = normalizeEvidenceItem(supplementalObject.quoteExpirationEvidence);
    const supplemental = {
        ...(supplementalObject.quoteExpirationDate && quoteExpirationEvidence
            ? {
                quoteExpirationDate: supplementalObject.quoteExpirationDate,
                quoteExpirationEvidence,
            }
            : {}),
        subjectivities: supplementalObject.subjectivities
            .map(normalizeEvidenceItem)
            .filter((item) => Boolean(item)),
        conditions: supplementalObject.conditions
            .map(normalizeEvidenceItem)
            .filter((item) => Boolean(item)),
    };
    const sourceSpans = result.sourceSpans?.length
        ? result.sourceSpans
        : prepared.prepared.sourceSpans;
    const completionDocument = sanitizeCompletionDocument(result.document);
    if (!completionDocument ||
        typeof completionDocument !== "object" ||
        Array.isArray(completionDocument)) {
        throw new Error(`Proposal extraction returned an invalid document for ${document.fileName}`);
    }
    return {
        proposalDocumentId: document.proposalDocumentId,
        fileName: document.fileName,
        document: completionDocument,
        operationalProfile: result.operationalProfile,
        sourceSpans: sourceSpans,
        sourceNodes: (result.sourceTree ?? []),
        warnings: result.warnings ?? [],
        tokenUsage: result.tokenUsage,
        supplemental,
    };
}
async function uploadProposalCompletionPayload(job, payload) {
    const json = JSON.stringify(payload);
    let lastError;
    for (let attempt = 1; attempt <= COMPLETION_UPLOAD_ATTEMPTS; attempt += 1) {
        try {
            const { uploadUrl } = await convex.action(actions.createExternalProposalCompletionUploadUrl, { secret: SECRET });
            const response = await fetch(resolveConvexStorageUrl(uploadUrl, {
                spotEnv: SPOT_ENV,
                convexUrl: CONVEX_URL,
            }), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: json,
            });
            if (!response.ok) {
                throw new Error(`Failed to upload proposal completion payload: ${response.status} ${await response.text()}`);
            }
            const uploaded = (await response.json());
            if (!uploaded.storageId)
                throw new Error("Proposal completion upload did not return a storageId");
            return uploaded.storageId;
        }
        catch (error) {
            lastError = error;
            if (attempt < COMPLETION_UPLOAD_ATTEMPTS)
                await sleep(attempt * 500);
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error(`Failed to upload proposal completion payload: ${String(lastError)}`);
}
async function processProposalJob(job, releasePdfWork) {
    console.log(`[proposal:${job.proposalId}] claimed proposal extraction job ${job.jobId}`);
    const heartbeatTimer = setInterval(() => {
        heartbeatProposal(job).catch((error) => {
            console.error(`[proposal:${job.proposalId}] heartbeat failed:`, error);
        });
    }, HEARTBEAT_MS);
    try {
        const extractedDocuments = [];
        for (const document of [...job.documents].sort((left, right) => left.order - right.order)) {
            extractedDocuments.push(await extractProposalDocument(job, document));
        }
        const aggregate = aggregateProposalDocuments(extractedDocuments);
        const payload = {
            version: "proposal-extraction-v1",
            fingerprint: job.fingerprint,
            documents: extractedDocuments,
            aggregate,
        };
        await logProposalJob(job, `Prepared ${extractedDocuments.length} proposal document${extractedDocuments.length === 1 ? "" : "s"}; ${aggregate.coverages.length} coverages and ${aggregate.premiums.length} premium lines`, "info", "complete");
        const payloadStorageId = await uploadProposalCompletionPayload(job, payload);
        const completed = await convex.action(actions.completeExternalProposalJob, {
            secret: SECRET,
            jobId: job.jobId,
            proposalId: job.proposalId,
            leaseId: job.leaseId,
            extractionFingerprint: job.fingerprint,
            payloadStorageId,
        });
        if (!completed.ok)
            throw new Error("Convex rejected stale proposal extraction completion");
        console.log(`[proposal:${job.proposalId}] completed proposal extraction`);
    }
    catch (error) {
        console.error(`[proposal:${job.proposalId}] extraction failed:`, error);
        await convex.action(actions.failExternalProposalJob, {
            secret: SECRET,
            jobId: job.jobId,
            proposalId: job.proposalId,
            leaseId: job.leaseId,
            extractionFingerprint: job.fingerprint,
            error: errorMessage(error),
        });
    }
    finally {
        clearInterval(heartbeatTimer);
        releasePdfWork();
    }
}
async function completePreviewJob(job, fields, previewModel) {
    const completed = await convex.action(actions.completeExternalPreview, {
        secret: SECRET,
        policyId: job.policyId,
        leaseId: job.leaseId,
        state: job.state,
        fields,
        previewVersion: POLICY_PREVIEW_VERSION,
        previewModel,
    });
    if (!completed.ok) {
        throw new Error(`Convex rejected preview completion for ${job.policyId}`);
    }
}
async function failPreviewJob(job, error) {
    await convex.action(actions.failExternalPreviewJob, {
        secret: SECRET,
        policyId: job.policyId,
        leaseId: job.leaseId,
        state: job.state,
        error: errorMessage(error),
        previewVersion: POLICY_PREVIEW_VERSION,
    });
}
async function heartbeatPreview(job) {
    return await convex.action(actions.heartbeatExternalPreviewJob, {
        secret: SECRET,
        policyId: job.policyId,
        leaseId: job.leaseId,
    });
}
async function processPreviewJob(job, releasePdfWork) {
    console.log(`[${job.policyId}] claimed external preview extraction job`);
    await logJob(job, `External worker ${WORKER_ID} started provisional extraction`, "info");
    const heartbeatTimer = setInterval(() => {
        heartbeatPreview(job).catch((error) => {
            console.error(`[${job.policyId}] preview heartbeat failed:`, error);
        });
    }, HEARTBEAT_MS);
    try {
        const pdfBytes = await fetchPdfBytes(job.fileUrl);
        let sourceSpans;
        try {
            const converted = await convertPdfWithLiteParse({
                pdfBytes,
                documentId: job.policyId,
                sourceKind: "policy_pdf",
                maxPages: LITEPARSE_MAX_PAGES,
                maxFileSize: LITEPARSE_MAX_FILE_SIZE,
                priority: "preview",
            });
            const supplementedSource = await supplementPreparedPdfSource(pdfBytes, job.policyId, {
                sourceSpans: converted.sourceSpans,
                sourceChunks: converted.sourceChunks,
            });
            sourceSpans = supplementedSource.sourceSpans;
            await logJob(job, `LiteParse${converted.metadata.ocrRetried ? " OCR retry" : ""} prepared ${converted.sourceSpans.length} spans plus ${supplementedSource.supplementCount} Poppler supplement${supplementedSource.supplementCount === 1 ? "" : "s"} for provisional extraction in ${converted.metadata.parsingMs ?? 0}ms`, "info");
        }
        catch (error) {
            await logJob(job, `LiteParse unavailable for provisional extraction; falling back to PDF.js source spans (${errorMessage(error)})`, "warn");
            const pdfJsSource = await buildPdfSourceSpans({
                pdfBytes,
                documentId: job.policyId,
                sourceKind: "policy_pdf",
            });
            const fallbackSource = await supplementPreparedPdfSource(pdfBytes, job.policyId, {
                sourceSpans: pdfJsSource.sourceSpans,
                sourceChunks: pdfJsSource.sourceChunks,
            });
            sourceSpans = fallbackSource.sourceSpans;
        }
        const sourceText = previewTextFromSourceSpans(sourceSpans);
        if (!sourceText) {
            throw new Error("No text was available for provisional extraction");
        }
        const { fields, route } = await extractPreviewFields(job, sourceText);
        if (Object.keys(fields).length === 0) {
            throw new Error("Provisional extraction returned no usable fields");
        }
        await completePreviewJob(job, fields, `${route.route.provider}/${route.route.model}`);
        console.log(`[${job.policyId}] completed external preview extraction`);
    }
    catch (error) {
        console.error(`[${job.policyId}] preview extraction failed:`, error);
        await failPreviewJob(job, error);
    }
    finally {
        releasePdfWork();
        clearInterval(heartbeatTimer);
    }
}
async function claimJob() {
    return await convex.action(actions.claimExternalJob, {
        secret: SECRET,
        workerId: WORKER_ID,
        workerVersion: WORKER_VERSION,
        workerProtocolVersion: WORKER_PROTOCOL_VERSION,
        clSdkVersion: WORKER_CL_SDK_VERSION,
    });
}
async function claimPreviewJob() {
    return await convex.action(actions.claimExternalPreviewJob, {
        secret: SECRET,
        workerId: WORKER_ID,
        workerVersion: WORKER_VERSION,
        workerProtocolVersion: WORKER_PROTOCOL_VERSION,
        clSdkVersion: WORKER_CL_SDK_VERSION,
    });
}
async function claimProposalJob() {
    return await convex.action(actions.claimExternalProposalJob, {
        secret: SECRET,
        workerId: WORKER_ID,
        workerVersion: WORKER_VERSION,
        workerProtocolVersion: WORKER_PROTOCOL_VERSION,
        clSdkVersion: WORKER_CL_SDK_VERSION,
    });
}
async function runProposalLoop() {
    const active = new Set();
    let lastIdleLogAt = 0;
    while (!shuttingDown) {
        if (active.size >= PROPOSAL_EXTRACTION_CONCURRENCY) {
            await Promise.race(active);
            continue;
        }
        let releasePdfWork;
        try {
            releasePdfWork = await pdfWorkAdmission.acquire("full", shutdownController.signal);
            if (shuttingDown) {
                releasePdfWork();
                break;
            }
            const job = await claimProposalJob();
            if (job) {
                const task = processProposalJob(job, releasePdfWork).finally(() => {
                    active.delete(task);
                });
                active.add(task);
                continue;
            }
            releasePdfWork();
            const now = nowMs();
            if (now - lastIdleLogAt >= IDLE_LOG_MS) {
                console.log("No proposal extraction jobs available");
                lastIdleLogAt = now;
            }
            await sleep(POLL_MS);
        }
        catch (error) {
            releasePdfWork?.();
            if (shuttingDown && error instanceof Error && error.name === "AbortError")
                break;
            console.error("Failed to claim proposal extraction job:", error);
            await sleep(POLL_MS);
        }
    }
    await Promise.allSettled(active);
}
async function runPreviewLoop() {
    const active = new Set();
    let lastIdleLogAt = 0;
    while (!shuttingDown) {
        if (active.size >= PREVIEW_JOB_CONCURRENCY) {
            await Promise.race(active);
            continue;
        }
        let job = null;
        let releasePdfWork;
        try {
            releasePdfWork = await pdfWorkAdmission.acquire("preview", shutdownController.signal);
            if (shuttingDown) {
                releasePdfWork();
                break;
            }
            job = await claimPreviewJob();
        }
        catch (error) {
            releasePdfWork?.();
            if (shuttingDown &&
                error instanceof Error &&
                error.name === "AbortError") {
                break;
            }
            console.error("Failed to claim preview extraction job:", error);
            await sleep(POLL_MS);
            continue;
        }
        if (job) {
            const task = processPreviewJob(job, releasePdfWork).finally(() => {
                active.delete(task);
            });
            active.add(task);
            continue;
        }
        releasePdfWork();
        const now = nowMs();
        if (now - lastIdleLogAt >= IDLE_LOG_MS) {
            console.log("No preview extraction jobs available");
            lastIdleLogAt = now;
        }
        await sleep(POLL_MS);
    }
    await Promise.allSettled(active);
}
async function main() {
    console.log(`Spot extraction worker ${WORKER_ID} env=${SPOT_ENV} v${WORKER_VERSION} protocol=${WORKER_PROTOCOL_VERSION} cl-sdk=${WORKER_CL_SDK_VERSION} extractionConcurrency=${EXTRACTION_JOB_CONCURRENCY} previewConcurrency=${PREVIEW_JOB_CONCURRENCY} proposalConcurrency=${PROPOSAL_EXTRACTION_CONCURRENCY} pdfWorkMaxActive=${PDF_WORK_MAX_ACTIVE} pdfWorkMaxFullActive=${PDF_WORK_MAX_FULL_ACTIVE} liteParseNativeConcurrency=${LITEPARSE_NATIVE_CONCURRENCY} connected to ${CONVEX_URL}`);
    const httpServer = startHttpServer();
    if (!RUNTIME_ACCESS.jobsEnabled) {
        console.warn(`Extraction job polling and PDF conversion are disabled in Railway environment ${RUNTIME_ACCESS.railwayEnvironment}`);
        try {
            while (!shuttingDown) {
                await sleep(POLL_MS);
            }
        }
        finally {
            httpServer?.close();
        }
        console.log("Extraction worker shutting down");
        return;
    }
    const previewLoop = runPreviewLoop().catch((error) => {
        console.error("Preview extraction loop failed:", error);
    });
    const proposalLoop = runProposalLoop().catch((error) => {
        console.error("Proposal extraction loop failed:", error);
    });
    const active = new Set();
    let lastIdleLogAt = 0;
    try {
        while (!shuttingDown) {
            if (active.size >= EXTRACTION_JOB_CONCURRENCY) {
                await Promise.race(active);
                continue;
            }
            let job = null;
            let releasePdfWork;
            try {
                releasePdfWork = await pdfWorkAdmission.acquire("full", shutdownController.signal);
                if (shuttingDown) {
                    releasePdfWork();
                    break;
                }
                job = await claimJob();
            }
            catch (error) {
                releasePdfWork?.();
                if (shuttingDown &&
                    error instanceof Error &&
                    error.name === "AbortError") {
                    break;
                }
                console.error("Failed to claim extraction job:", error);
                await sleep(POLL_MS);
                continue;
            }
            if (job) {
                const task = processJob(job, releasePdfWork).finally(() => {
                    active.delete(task);
                });
                active.add(task);
                continue;
            }
            releasePdfWork();
            const now = nowMs();
            if (now - lastIdleLogAt >= IDLE_LOG_MS) {
                console.log("No extraction jobs available");
                lastIdleLogAt = now;
            }
            await sleep(POLL_MS);
        }
    }
    finally {
        shuttingDown = true;
        shutdownController.abort();
        await Promise.allSettled(active);
        await Promise.allSettled([previewLoop, proposalLoop]);
        httpServer?.close();
    }
    console.log("Extraction worker shutting down");
}
main().catch((error) => {
    console.error("Extraction worker crashed:", error);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map