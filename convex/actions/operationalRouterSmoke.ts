"use node";

import { Output, stepCountIs, tool, type ModelMessage } from "ai";
import { v } from "convex/values";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { EMBEDDING_DIMENSIONS, makeEmbedTexts } from "../lib/sdkCallbacks";
import {
  generateAgentTextForOperatorTask,
  generateObjectForOrg,
  generatedTextFromResult,
  generateTextForOrg,
  transcribeAudioForOrg,
} from "../lib/models";
import { runWebRetrieval } from "../lib/webRetrieval";
import { OPERATIONAL_ROUTER_SMOKE_PREFIX } from "../operationalRouterSmoke";

export const OPERATIONAL_ROUTER_SMOKE_AUDIO_MIN_BYTES = 1024;
export const OPERATIONAL_ROUTER_SMOKE_AUDIO_MAX_BYTES = 256 * 1024;
export const OPERATIONAL_ROUTER_SMOKE_AUDIO_MEDIA_TYPE = "audio/mp4";
export const OPERATIONAL_ROUTER_SMOKE_AUDIO_FILENAME = "synthetic-audio.m4a";
export const OPERATIONAL_ROUTER_SMOKE_PDF_BYTES = 4 * 1024 * 1024;
export const OPERATIONAL_ROUTER_SMOKE_RETRIEVAL_URL = "https://example.com/";

const ECHO_TOOL_NAME = "echo_smoke_marker";
const ECHO_VALUE = "SPOT_ROUTER_ECHO_OK";
const PDF_VALUE = "SPOT ROUTER ASSET ACCEPTANCE";

type Fixture = {
  smokeRunId: Id<"operationalRouterSmokeRuns">;
  orgId: Id<"organizations">;
};

type CleanupResult = {
  fixtureDeleted: boolean;
  routingEventCount: number;
  durableAssetLedgerCount: number;
};

type RouterStep = {
  requestId: string;
  provider: string;
  model: string;
};

type PhaseResult = {
  generation: { ok: boolean; requestId: string };
  structuredOutput: { ok: boolean; requestId: string };
  toolLoop: {
    ok: boolean;
    toolCallCount: number;
    stepCount: number;
    routePinned: boolean;
    requestIds: string[];
  };
  embeddings: {
    ok: boolean;
    inputCount: number;
    vectorCount: number;
    dimensions: number;
  };
  retrieval: {
    ok: boolean;
    attemptCount: number;
    sourceCount: number;
  };
  transcription: { ok: boolean; requestId: string };
  pdfAsset: { ok: boolean; decodedByteCount: number; requestId: string };
};

export type OperationalRouterSmokeResult = PhaseResult & {
  ok: boolean;
  cleanup: {
    cleanupRequestId: string;
    fixtureDeleted: boolean;
    durableFallbackScheduled: boolean;
    routingEventCount?: number;
    durableAssetLedgerCount?: number;
  };
};

export type OperationalRouterSmokeAdapters = {
  createFixture: (ctx: ActionCtx, marker: string) => Promise<Fixture>;
  cleanupFixture: (
    ctx: ActionCtx,
    smokeRunId: Id<"operationalRouterSmokeRuns">,
  ) => Promise<CleanupResult>;
  generateText: (
    ctx: ActionCtx,
    orgId: Id<"organizations">,
  ) => Promise<{ ok: boolean; requestId: string }>;
  generateObject: (
    ctx: ActionCtx,
    orgId: Id<"organizations">,
  ) => Promise<{ ok: boolean; requestId: string }>;
  runToolLoop: (
    ctx: ActionCtx,
    orgId: Id<"organizations">,
    marker: string,
  ) => Promise<PhaseResult["toolLoop"]>;
  embed: (
    ctx: ActionCtx,
    orgId: Id<"organizations">,
  ) => Promise<PhaseResult["embeddings"]>;
  retrieve: (
    ctx: ActionCtx,
    orgId: Id<"organizations">,
  ) => Promise<PhaseResult["retrieval"]>;
  transcribe: (
    ctx: ActionCtx,
    orgId: Id<"organizations">,
    audio: Buffer,
  ) => Promise<{ ok: boolean; requestId: string }>;
  runPdfAsset: (
    ctx: ActionCtx,
    orgId: Id<"organizations">,
    marker: string,
  ) => Promise<PhaseResult["pdfAsset"]>;
};

export function decodeOperationalSmokeAudio(audioBase64: string): Buffer {
  if (
    audioBase64.length === 0 ||
    audioBase64.length >
      Math.ceil(OPERATIONAL_ROUTER_SMOKE_AUDIO_MAX_BYTES / 3) * 4 ||
    audioBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)
  ) {
    throw new Error("Operational router smoke audio must be canonical base64");
  }
  const audio = Buffer.from(audioBase64, "base64");
  if (audio.toString("base64") !== audioBase64) {
    throw new Error("Operational router smoke audio must be canonical base64");
  }
  if (
    audio.byteLength < OPERATIONAL_ROUTER_SMOKE_AUDIO_MIN_BYTES ||
    audio.byteLength > OPERATIONAL_ROUTER_SMOKE_AUDIO_MAX_BYTES
  ) {
    throw new Error("Operational router smoke audio size is out of bounds");
  }
  if (audio.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw new Error("Operational router smoke audio must be an M4A container");
  }
  return audio;
}

function pdfCommentPadding(length: number): string {
  const line = `%${"p".repeat(78)}\n`;
  const lineCount = Math.floor(length / line.length);
  const remainder = length % line.length;
  return (
    line.repeat(lineCount) +
    (remainder === 0
      ? ""
      : remainder === 1
        ? "\n"
        : `%${"p".repeat(remainder - 2)}\n`)
  );
}

function renderPdf(paddingBytes: number, validationToken: string): Buffer {
  const content = [
    "BT\n",
    "/F1 16 Tf\n",
    "72 720 Td\n",
    `(${PDF_VALUE}) Tj\n`,
    "0 -28 Td\n",
    "/F1 12 Tf\n",
    `(${validationToken}) Tj\n`,
    "ET\n",
    pdfCommentPadding(paddingBytes),
  ].join("");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}endstream`,
  ];
  let body = "%PDF-1.7\n%SPOT\n";
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body +=
    "trailer\n<< /Size 6 /Root 1 0 R >>\n" +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

export async function createOperationalSmokePdf(
  validationToken: string,
): Promise<Uint8Array> {
  if (!/^[0-9a-f-]{36}$/.test(validationToken)) {
    throw new Error("Invalid operational router smoke PDF token");
  }
  let paddingBytes = OPERATIONAL_ROUTER_SMOKE_PDF_BYTES - 1024;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pdf = renderPdf(paddingBytes, validationToken);
    const difference = OPERATIONAL_ROUTER_SMOKE_PDF_BYTES - pdf.byteLength;
    if (difference === 0) {
      const parsed = await PDFDocument.load(pdf, { ignoreEncryption: true });
      if (parsed.getPageCount() !== 1) {
        throw new Error("Operational router smoke PDF validation failed");
      }
      return new Uint8Array(pdf);
    }
    paddingBytes += difference;
  }
  throw new Error("Could not construct the operational router smoke PDF");
}

async function runGeneration(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<PhaseResult["generation"]> {
  const result = await generateTextForOrg(ctx, orgId, "classification", {
    maxOutputTokens: 256,
    system: "This is a synthetic operational health check.",
    prompt: "Reply with a short acknowledgement.",
  });
  return {
    ok: generatedTextFromResult(result).trim().length > 0,
    requestId: result.clRouter?.requestId ?? "",
  };
}

async function runStructuredOutput(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<PhaseResult["structuredOutput"]> {
  const result = await generateObjectForOrg(ctx, orgId, "classification", {
    maxOutputTokens: 256,
    schema: z.object({ ok: z.literal(true) }),
    system: "This is a synthetic operational health check.",
    prompt: "Return ok=true.",
  });
  return {
    ok: result.object.ok,
    requestId: result.clRouter?.requestId ?? "",
  };
}

async function runEchoToolLoop(
  ctx: ActionCtx,
  _orgId: Id<"organizations">,
  marker: string,
): Promise<PhaseResult["toolLoop"]> {
  let toolCallCount = 0;
  const steps: RouterStep[] = [];
  const result = await generateAgentTextForOperatorTask(
    ctx,
    "chat",
    {
      maxOutputTokens: 512,
      system:
        "This is an isolated operational health check. Use only the provided echo tool, then acknowledge its result.",
      prompt:
        "Call the echo tool once, then finish with a short acknowledgement.",
      tools: {
        [ECHO_TOOL_NAME]: tool({
          inputSchema: z.object({ value: z.literal(ECHO_VALUE) }),
          execute: async ({ value }) => {
            toolCallCount += 1;
            return { value };
          },
        }),
      },
      stopWhen: stepCountIs(2),
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0
          ? {
              toolChoice: {
                type: "tool" as const,
                toolName: ECHO_TOOL_NAME,
              },
            }
          : { activeTools: [] },
    },
    {
      taskKind: "operator_agent",
      sessionKey: marker,
      trace: {
        traceId: `${marker}:tool`,
        label: "convex.operationalRouterSmoke.toolLoop",
        phase: "tool_loop",
        channel: "web",
      },
      onResponse: async (response) => {
        steps.push({
          requestId: response.requestId,
          provider: response.model.provider,
          model: response.model.model,
        });
      },
    },
  );
  const first = steps[0];
  return {
    ok:
      toolCallCount === 1 &&
      steps.length === 2 &&
      generatedTextFromResult(result).trim().length > 0,
    toolCallCount,
    stepCount: steps.length,
    routePinned:
      first !== undefined &&
      steps.every(
        (step) =>
          step.provider === first.provider && step.model === first.model,
      ),
    requestIds: steps.map((step) => step.requestId),
  };
}

async function runEmbeddings(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<PhaseResult["embeddings"]> {
  const inputs = ["Spot synthetic router operational acceptance input."];
  const embeddings = await makeEmbedTexts(ctx, orgId)(inputs);
  return summarizeOperationalSmokeEmbeddings(embeddings, inputs.length);
}

export function summarizeOperationalSmokeEmbeddings(
  embeddings: number[][],
  inputCount: number,
): PhaseResult["embeddings"] {
  const dimensions = embeddings[0]?.length ?? 0;
  return {
    ok:
      inputCount > 0 &&
      embeddings.length === inputCount &&
      dimensions === EMBEDDING_DIMENSIONS &&
      embeddings.every(
        (embedding) =>
          embedding.length === dimensions && embedding.every(Number.isFinite),
      ),
    inputCount,
    vectorCount: embeddings.length,
    dimensions,
  };
}

async function runRetrieval(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<PhaseResult["retrieval"]> {
  const result = await runWebRetrieval(ctx, orgId, {
    url: OPERATIONAL_ROUTER_SMOKE_RETRIEVAL_URL,
    goal: "Retrieve the fixed IANA example page for an operational check.",
    allowedDomains: ["example.com"],
    maxResults: 1,
  });
  return {
    ok:
      result.text.trim().length > 0 &&
      result.sources.some((source) => {
        try {
          return new URL(source.url).hostname === "example.com";
        } catch {
          return false;
        }
      }),
    attemptCount: result.attempts.length,
    sourceCount: result.sources.length,
  };
}

async function runTranscription(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  audio: Buffer,
): Promise<PhaseResult["transcription"]> {
  const result = await transcribeAudioForOrg(ctx, orgId, {
    data: audio,
    filename: OPERATIONAL_ROUTER_SMOKE_AUDIO_FILENAME,
    mediaType: OPERATIONAL_ROUTER_SMOKE_AUDIO_MEDIA_TYPE,
    prompt:
      "Transcribe the clearly spoken synthetic router migration test phrase.",
  });
  const normalized = result.text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return {
    ok:
      normalized.includes("synthetic") &&
      normalized.includes("router") &&
      normalized.includes("migration") &&
      (normalized.includes("forty two") || /(^| )42( |$)/.test(normalized)),
    requestId: result.clRouter?.requestId ?? "",
  };
}

async function runPdfAsset(
  ctx: ActionCtx,
  _orgId: Id<"organizations">,
  marker: string,
): Promise<PhaseResult["pdfAsset"]> {
  const validationToken = crypto.randomUUID();
  const pdf = await createOperationalSmokePdf(validationToken);
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Read the attached synthetic PDF and return its validation token exactly.",
        },
        {
          type: "file",
          data: pdf,
          mediaType: "application/pdf",
          filename: "synthetic-router-smoke.pdf",
        },
      ],
    },
  ];
  const result = await generateAgentTextForOperatorTask(
    ctx,
    "chat_vision",
    {
      maxOutputTokens: 512,
      messages,
      output: Output.object({
        schema: z.object({ validationToken: z.string() }),
      }),
    },
    {
      taskKind: "operator_agent",
      sessionKey: marker,
      trace: {
        traceId: `${marker}:pdf`,
        label: "convex.operationalRouterSmoke.pdfAsset",
        phase: "asset_fetch",
        channel: "web",
      },
    },
  );
  const parsed = z
    .object({ validationToken: z.string() })
    .safeParse(result.output);
  return {
    ok: parsed.success && parsed.data.validationToken === validationToken,
    decodedByteCount: pdf.byteLength,
    requestId: result.clRouter?.requestId ?? "",
  };
}

const defaultAdapters: OperationalRouterSmokeAdapters = {
  createFixture: async (ctx, marker) =>
    await ctx.runMutation(internal.operationalRouterSmoke.createFixture, {
      marker,
    }),
  cleanupFixture: async (ctx, smokeRunId) =>
    await ctx.runMutation(internal.operationalRouterSmoke.cleanupFixture, {
      smokeRunId,
    }),
  generateText: runGeneration,
  generateObject: runStructuredOutput,
  runToolLoop: runEchoToolLoop,
  embed: runEmbeddings,
  retrieve: runRetrieval,
  transcribe: runTranscription,
  runPdfAsset,
};

function phaseResultsOk(result: PhaseResult): boolean {
  return (
    result.generation.ok &&
    result.generation.requestId.length > 0 &&
    result.structuredOutput.ok &&
    result.structuredOutput.requestId.length > 0 &&
    result.toolLoop.ok &&
    result.toolLoop.routePinned &&
    result.toolLoop.requestIds.every((requestId) => requestId.length > 0) &&
    result.embeddings.ok &&
    result.retrieval.ok &&
    result.transcription.ok &&
    result.transcription.requestId.length > 0 &&
    result.pdfAsset.ok &&
    result.pdfAsset.requestId.length > 0
  );
}

export async function runOperationalRouterSmoke(
  ctx: ActionCtx,
  args: { audioBase64: string },
  adapters: OperationalRouterSmokeAdapters = defaultAdapters,
): Promise<OperationalRouterSmokeResult> {
  const audio = decodeOperationalSmokeAudio(args.audioBase64);
  const marker = `${OPERATIONAL_ROUTER_SMOKE_PREFIX}${crypto.randomUUID()}`;
  const fixture = await adapters.createFixture(ctx, marker);
  const safePhase = async <T>(
    phase: () => Promise<T>,
    fallback: (requestId: string) => T,
  ): Promise<T> => {
    try {
      return await phase();
    } catch (error) {
      const requestId =
        error &&
        typeof error === "object" &&
        typeof (error as { requestId?: unknown }).requestId === "string"
          ? (error as { requestId: string }).requestId
          : "";
      return fallback(requestId);
    }
  };
  const executionResult: PhaseResult = {
    generation: await safePhase(
      () => adapters.generateText(ctx, fixture.orgId),
      (requestId) => ({ ok: false, requestId }),
    ),
    structuredOutput: await safePhase(
      () => adapters.generateObject(ctx, fixture.orgId),
      (requestId) => ({ ok: false, requestId }),
    ),
    toolLoop: await safePhase(
      () => adapters.runToolLoop(ctx, fixture.orgId, marker),
      (requestId) => ({
        ok: false,
        toolCallCount: 0,
        stepCount: requestId ? 1 : 0,
        routePinned: false,
        requestIds: requestId ? [requestId] : [],
      }),
    ),
    embeddings: await safePhase(
      () => adapters.embed(ctx, fixture.orgId),
      () => ({
        ok: false,
        inputCount: 1,
        vectorCount: 0,
        dimensions: 0,
      }),
    ),
    retrieval: await safePhase(
      () => adapters.retrieve(ctx, fixture.orgId),
      () => ({ ok: false, attemptCount: 0, sourceCount: 0 }),
    ),
    transcription: await safePhase(
      () => adapters.transcribe(ctx, fixture.orgId, audio),
      (requestId) => ({ ok: false, requestId }),
    ),
    pdfAsset: await safePhase(
      () => adapters.runPdfAsset(ctx, fixture.orgId, marker),
      (requestId) => ({
        ok: false,
        decodedByteCount: OPERATIONAL_ROUTER_SMOKE_PDF_BYTES,
        requestId,
      }),
    ),
  };

  let cleanup:
    | (CleanupResult & {
        cleanupRequestId: string;
        durableFallbackScheduled: true;
      })
    | {
        cleanupRequestId: string;
        fixtureDeleted: false;
        durableFallbackScheduled: true;
      };
  try {
    cleanup = {
      ...(await adapters.cleanupFixture(ctx, fixture.smokeRunId)),
      cleanupRequestId: String(fixture.smokeRunId),
      durableFallbackScheduled: true,
    };
  } catch {
    console.warn(
      "[cl-router] Operational smoke eager fixture cleanup failed; scheduled cleanup remains active",
    );
    cleanup = {
      cleanupRequestId: String(fixture.smokeRunId),
      fixtureDeleted: false,
      durableFallbackScheduled: true,
    };
  }

  return {
    ...executionResult,
    ok: phaseResultsOk(executionResult),
    cleanup,
  };
}

const requestIdResultValidator = v.object({
  ok: v.boolean(),
  requestId: v.string(),
});

export const run = internalAction({
  args: { audioBase64: v.string() },
  returns: v.object({
    ok: v.boolean(),
    generation: requestIdResultValidator,
    structuredOutput: requestIdResultValidator,
    toolLoop: v.object({
      ok: v.boolean(),
      toolCallCount: v.number(),
      stepCount: v.number(),
      routePinned: v.boolean(),
      requestIds: v.array(v.string()),
    }),
    embeddings: v.object({
      ok: v.boolean(),
      inputCount: v.number(),
      vectorCount: v.number(),
      dimensions: v.number(),
    }),
    retrieval: v.object({
      ok: v.boolean(),
      attemptCount: v.number(),
      sourceCount: v.number(),
    }),
    transcription: requestIdResultValidator,
    pdfAsset: v.object({
      ok: v.boolean(),
      decodedByteCount: v.number(),
      requestId: v.string(),
    }),
    cleanup: v.object({
      cleanupRequestId: v.string(),
      fixtureDeleted: v.boolean(),
      durableFallbackScheduled: v.boolean(),
      routingEventCount: v.optional(v.number()),
      durableAssetLedgerCount: v.optional(v.number()),
    }),
  }),
  handler: async (ctx, args) => await runOperationalRouterSmoke(ctx, args),
});

export const cleanupExpired = internalAction({
  args: {
    smokeRunId: v.id("operationalRouterSmokeRuns"),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.operationalRouterSmoke.cleanupFixture, {
        smokeRunId: args.smokeRunId,
      });
    } catch {
      console.warn(
        "[cl-router] Scheduled operational smoke fixture cleanup failed",
      );
      const attempt = Math.max(0, Math.floor(args.attempt ?? 0));
      if (attempt < 5) {
        await ctx.scheduler.runAfter(
          Math.min(2 ** attempt * 5_000, 60_000),
          internal.actions.operationalRouterSmoke.cleanupExpired,
          { smokeRunId: args.smokeRunId, attempt: attempt + 1 },
        );
      }
    }
    return null;
  },
});
