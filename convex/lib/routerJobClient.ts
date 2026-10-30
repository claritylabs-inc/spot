"use node";

import type { ClRouterTraceInput } from "./clRouterClient";

import dayjs from "dayjs";
import { modelCallContext } from "./modelCallTelemetry";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  assertSpotRouterAssetUrl,
  ClRouterRequestError,
  clRouterCapabilities,
  clRouterRouteIsAvailable,
  clRouterSupports,
  isUnknownClRouterRouteFailure,
  logIgnoredClRouterPin,
} from "./clRouterClient";
import type { ModelRoute } from "./modelCatalog";
import { routerAssetSigningConfiguration } from "./routerAssetSignature";
import { ROUTER_JOB_INLINE_REQUEST_BYTES } from "./routerJobLimits";
import { parseRouterJobError, type RouterJobFailure } from "./routerJobFailure";

const REQUEST_BYTES = 4 * 1024 * 1024;
const ASSET_BYTES = 12 * 1024 * 1024;
const ASSET_AGGREGATE_BYTES = 16 * 1024 * 1024;
const CONTROL_WAIT_MS = 5_000;
// In-place waits poll the job row the result callback writes, so a finished
// job is seen within one interval. Most operator steps finish within the
// first seconds, where every interval adds directly to the step's handoff,
// so polling starts fast, settles, then eases off for long jobs.
const INLINE_POLL_FAST_MS = 100;
const INLINE_POLL_FAST_FOR_MS = 3_000;
const INLINE_POLL_MS = 250;
const INLINE_POLL_SLOW_AFTER_MS = 10_000;
const INLINE_POLL_MAX_MS = 1_000;
export type RouterJobOperation =
  | "generate"
  | "manual"
  | "embed"
  | "retrieve"
  | "transcribe"
  | "browse"
  | "research";

export function callbackSiteUrl(): string {
  const canonical = routerAssetSigningConfiguration().siteUrl;
  const override = process.env.SPOT_ROUTER_CALLBACK_URL?.trim();
  if (!override) return canonical;
  if (process.env.SPOT_ENV?.trim().toLowerCase() === "production") {
    if (override.replace(/\/+$/, "") !== canonical)
      throw new Error(
        "Production router callbacks must use the canonical Spot origin",
      );
    return canonical;
  }
  const url = new URL(override);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("SPOT_ROUTER_CALLBACK_URL must be an HTTPS origin");
  return url.origin;
}

export class RouterJobPending extends Error {
  constructor(
    readonly invocationKey: string,
    readonly jobId?: string,
  ) {
    super("Router job is still running");
    this.name = "RouterJobPending";
  }
}

export class RouterJobFailed extends Error {
  constructor(
    message: string,
    readonly failure?: RouterJobFailure,
  ) {
    super(message);
    this.name = "RouterJobFailed";
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function boundedAsset(
  response: Response,
  expectedBytes: number,
): Promise<Blob> {
  if (!response.ok || !response.body)
    throw new Error("Unable to snapshot router asset");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > ASSET_BYTES || size > expectedBytes) {
        await reader.cancel();
        throw new Error("Router asset exceeds declared size");
      }
      chunks.push(new Uint8Array(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== expectedBytes) throw new Error("Router asset size changed");
  return new Blob(chunks, {
    type: response.headers.get("content-type") ?? "application/octet-stream",
  });
}

async function stageRequest(
  ctx: ActionCtx,
  payload: unknown,
  requestToken: string,
  siteUrl: string,
  storageIds: Id<"_storage">[],
  signal?: AbortSignal,
): Promise<string> {
  let totalBytes = 0;
  async function visit(
    value: unknown,
    asset = false,
    root = false,
  ): Promise<unknown> {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value) result.push(await visit(item));
      return result;
    }
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (
      asset &&
      typeof record.url === "string" &&
      typeof record.mediaType === "string" &&
      typeof record.sizeBytes === "number"
    ) {
      const url = new URL(record.url);
      assertSpotRouterAssetUrl(url);
      if (
        !Number.isSafeInteger(record.sizeBytes) ||
        record.sizeBytes <= 0 ||
        record.sizeBytes > ASSET_BYTES ||
        storageIds.length >= 8 ||
        (totalBytes += record.sizeBytes) > ASSET_AGGREGATE_BYTES
      )
        throw new Error("Router assets exceed request limits");
      const blob = await boundedAsset(
        await fetch(url, { redirect: "manual", signal }),
        record.sizeBytes,
      );
      const storageId = await ctx.storage.store(blob);
      const index = storageIds.length;
      storageIds.push(storageId);
      return {
        ...record,
        url: `${siteUrl}/router-jobs/asset?token=${requestToken}&index=${index}`,
      };
    }
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record))
      result[key] = await visit(
        nested,
        (root && key === "audio") ||
          (key === "source" &&
            (record.type === "image" || record.type === "file")),
      );
    return result;
  }
  const serialized = JSON.stringify(await visit(payload, false, true));
  if (
    typeof serialized !== "string" ||
    new TextEncoder().encode(serialized).byteLength > REQUEST_BYTES
  )
    throw new Error("Router request exceeds 4 MiB");
  return serialized;
}

/**
 * Finds or creates the job row for one invocation. A request within
 * ROUTER_JOB_INLINE_REQUEST_BYTES rides the `prepare` mutation itself, so the
 * row and its exact bytes commit together before anything is submitted; a
 * larger one, and any asset, is uploaded first. `input` is returned only when
 * this call created the row, so the submission can send the bytes it already
 * holds.
 */
async function prepareJob(
  ctx: ActionCtx,
  operation: RouterJobOperation,
  payload: unknown,
  invocationKey: string,
  signal?: AbortSignal,
  streamTarget?: Id<"threadMessages"> | Id<"operatorAgentMessages">,
  trace?: ClRouterTraceInput,
  timing?: RouterJobTiming,
  known?: Doc<"routerJobs"> | null,
): Promise<{ row: Doc<"routerJobs">; input?: string }> {
  const existing =
    known !== undefined
      ? known
      : await timed(timing, "submit.lookup", () =>
          ctx.runQuery(internal.routerJobs.get, { invocationKey }),
        );
  if (existing) {
    if (existing.operation !== operation)
      throw new Error("Router invocation operation conflict");
    return { row: existing };
  }
  const siteUrl = callbackSiteUrl();
  const requestToken = token();
  const resultToken = token();
  const assets: Id<"_storage">[] = [];
  let requestStorageId: Id<"_storage"> | undefined;
  let retained = false;
  try {
    const serialized = await timed(timing, "submit.stage", () =>
      stageRequest(ctx, payload, requestToken, siteUrl, assets, signal),
    );
    const [fingerprint, requestTokenHash, resultTokenHash] = await timed(
      timing,
      "submit.fingerprint",
      () =>
        Promise.all([
          sha256(serialized),
          sha256(requestToken),
          sha256(resultToken),
        ]),
    );
    const inline =
      new TextEncoder().encode(serialized).byteLength <=
      ROUTER_JOB_INLINE_REQUEST_BYTES;
    if (!inline || assets.length)
      await timed(timing, "submit.request_store", async () => {
        if (!inline)
          requestStorageId = await ctx.storage.store(
            new Blob([serialized], { type: "application/json" }),
          );
        await ctx.runMutation(internal.routerJobs.scheduleUploadCleanup, {
          invocationKey,
          storageIds: [
            ...(requestStorageId ? [requestStorageId] : []),
            ...assets,
          ],
        });
      });
    const callContext = modelCallContext(
      trace ? { ...(payload as Record<string, unknown>), trace } : payload,
      operation,
    );
    let row: Doc<"routerJobs">;
    try {
      row = await timed(timing, "submit.prepare", () =>
        ctx.runMutation(internal.routerJobs.prepare, {
          ...(streamTarget ? { streamTarget } : {}),
          invocationKey,
          operation,
          callContext: {
            ...callContext,
            orgId: callContext.orgId as Id<"organizations"> | undefined,
          },
          fingerprint,
          requestToken,
          requestTokenHash,
          resultToken,
          resultTokenHash,
          ...(requestStorageId
            ? { requestStorageId }
            : { request: serialized }),
          ...(assets.length ? { assetStorageIds: assets } : {}),
        }),
      );
    } catch (error) {
      const winner = await ctx.runQuery(internal.routerJobs.get, {
        invocationKey,
      });
      if (!winner || winner.operation !== operation) throw error;
      row = winner;
    }
    // A concurrent caller's row carries its own capability tokens.
    retained = row.requestToken === requestToken;
    return retained ? { row, input: serialized } : { row };
  } finally {
    if (!retained && (requestStorageId || assets.length)) {
      await ctx.runMutation(internal.routerJobs.cleanupUploads, {
        invocationKey,
        storageIds: [
          ...(requestStorageId ? [requestStorageId] : []),
          ...assets,
        ],
      });
    }
  }
}

/**
 * Generation jobs send their exact request bytes inline when the router
 * accepts it, saving the router's request fetch; the fingerprint is unchanged.
 * The call that created the job already holds those bytes; a reconnect reads
 * them back from the job's inline request or blob. Other operations, older
 * routers and unreadable bytes use `requestUrl`. A resubmission after a lost
 * acknowledgement reconnects to the same job whichever source either attempt
 * used.
 */
async function jobInputSource(
  ctx: ActionCtx,
  row: Doc<"routerJobs">,
  siteUrl: string,
  abortSignal?: AbortSignal,
  heldInput?: string,
  timing?: RouterJobTiming,
): Promise<{ input: string } | { requestUrl: string }> {
  if (
    (row.operation === "generate" || row.operation === "manual") &&
    clRouterSupports(
      await timed(timing, "submit.capabilities", () =>
        clRouterCapabilities({ abortSignal }).catch(() => undefined),
      ),
      "inline_job_input",
    )
  ) {
    const { requestStorageId } = row;
    const input =
      heldInput ??
      (await timed(timing, "submit.request_read", async () =>
        requestStorageId
          ? await (await ctx.storage.get(requestStorageId))?.text()
          : ((await ctx.runQuery(internal.routerJobs.getInlineRequest, {
              id: row._id,
            })) ?? undefined),
      ));
    if (input !== undefined) return { input };
  }
  return {
    requestUrl: `${siteUrl}/router-jobs/request?token=${row.requestToken}`,
  };
}

function routerCredential(): string {
  const secret = process.env.CL_ROUTER_SECRET?.trim();
  if (!secret) throw new Error("CL_ROUTER_SECRET is required");
  return secret;
}

async function routerControl(
  path: string,
  body: unknown | undefined,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const secret = routerCredential();
  const base = process.env.CL_ROUTER_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("CL_ROUTER_URL is required");
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Invalid router control URL");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, CONTROL_WAIT_MS);
  try {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429)
        throw new RouterJobPending("control");
      // Retain the router's typed rejection so configuration failures can be
      // diagnosed without logging capability URLs or request bodies.
      const envelope: unknown = await response.json().catch(() => null);
      if (envelope && typeof envelope === "object" && "error" in envelope) {
        const parsed = parseRouterJobError(
          (envelope as { error: unknown }).error,
        );
        if (parsed.failure)
          throw new RouterJobFailed(parsed.error, parsed.failure);
      }
      throw new Error(`Router job control rejected (${response.status})`);
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid router job control response");
    return value as Record<string, unknown>;
  } catch (error) {
    if (signal?.aborted)
      throw signal.reason ?? new Error("Router job cancelled");
    if (controller.signal.aborted || error instanceof TypeError)
      throw new RouterJobPending("control");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Optional metadata-only timing of one durable request. `submit.*` splits job
 * creation and submission: row lookups, request staging (serialization and
 * asset snapshots), fingerprints, blob uploads (large requests and assets
 * only), the `prepare` mutation, the capability check, a reconnect's request
 * read, the POST and the bind mutation. `status` is a reconnect's status
 * check, `wait` the in-place wait (with its poll count) and `read` the result
 * read. Observation only; it never changes waiting or retries.
 */
export type RouterJobPhase =
  | "submit.lookup"
  | "submit.stage"
  | "submit.fingerprint"
  | "submit.request_store"
  | "submit.prepare"
  | "submit.capabilities"
  | "submit.request_read"
  | "submit.post"
  | "submit.bind"
  | "status"
  | "wait"
  | "read";
export type RouterJobTiming = {
  phase(name: RouterJobPhase, ms: number, polls?: number): void;
  job(
    invocationKey: string,
    routerJobId: string | undefined,
    result?: "inline" | "storage",
  ): void;
};

async function timed<T>(
  timing: RouterJobTiming | undefined,
  name: Parameters<RouterJobTiming["phase"]>[0],
  run: () => Promise<T>,
): Promise<T> {
  if (!timing) return run();
  const started = dayjs();
  try {
    return await run();
  } finally {
    timing.phase(name, dayjs().diff(started));
  }
}

type RouterRequestWaitOptions = {
  wait?: "yield" | "poll";
  /**
   * With `yield`, how long to wait in place for a submitted job before
   * throwing RouterJobPending.
   */
  inlineWaitMs?: number;
  streamTarget?: Id<"threadMessages"> | Id<"operatorAgentMessages">;
  timing?: RouterJobTiming;
};

function routerJobEnded(row: Doc<"routerJobs">) {
  return (
    row.status === "succeeded" ||
    row.status === "failed" ||
    row.status === "cancelled"
  );
}

/** Polls the job row until it ends, the deadline passes, or the call aborts. */
async function waitForRouterJobRow(
  ctx: ActionCtx,
  invocationKey: string,
  deadline: dayjs.Dayjs,
  abortSignal?: AbortSignal,
  timing?: RouterJobTiming,
): Promise<Doc<"routerJobs"> | null> {
  const started = dayjs();
  let interval = INLINE_POLL_FAST_MS;
  let row: Doc<"routerJobs"> | null = null;
  let polls = 0;
  while (!abortSignal?.aborted) {
    const remaining = deadline.diff(dayjs());
    if (remaining <= 0) break;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(interval, remaining)),
    );
    row = await ctx.runQuery(internal.routerJobs.get, { invocationKey });
    polls += 1;
    if (!row || routerJobEnded(row)) break;
    const elapsed = dayjs().diff(started);
    interval =
      elapsed < INLINE_POLL_FAST_FOR_MS
        ? INLINE_POLL_FAST_MS
        : elapsed < INLINE_POLL_SLOW_AFTER_MS
          ? INLINE_POLL_MS
          : Math.min(
              INLINE_POLL_MAX_MS,
              Math.max(interval, INLINE_POLL_MS) * 1.25,
            );
  }
  timing?.phase("wait", dayjs().diff(started), polls);
  return row;
}

export async function executeDurableRouterRequest(
  ctx: ActionCtx,
  operation: RouterJobOperation,
  payload: unknown,
  invocationKey: string,
  abortSignal?: AbortSignal,
  options: RouterRequestWaitOptions = {},
): Promise<unknown> {
  return executeRouterRequest(
    ctx,
    operation,
    payload,
    invocationKey,
    abortSignal,
    options,
  );
}

async function executeRouterRequest(
  ctx: ActionCtx,
  operation: RouterJobOperation,
  payload: unknown,
  invocationKey: string,
  abortSignal?: AbortSignal,
  options: RouterRequestWaitOptions = {},
  trace?: ClRouterTraceInput,
): Promise<unknown> {
  if (operation !== "manual" && operation !== "generate") {
    return executeRouterRequestOnce(
      ctx,
      operation,
      payload,
      invocationKey,
      abortSignal,
      options,
      trace,
    );
  }
  const routedKey = `${invocationKey}:routed`;
  const { row: existing, routed: routedExisting } = await timed(
    options.timing,
    "submit.lookup",
    () =>
      ctx.runQuery(internal.routerJobs.getWithRouted, {
        invocationKey,
        routedKey,
      }),
  );
  const { route, ...routedPayload } = payload as Record<string, unknown> & {
    route?: ModelRoute;
  };
  // `known` is a row from the lookup just above; later calls look again.
  const runRouted = (known?: Doc<"routerJobs"> | null) =>
    executeRouterRequestOnce(
      ctx,
      "generate",
      routedPayload,
      routedKey,
      abortSignal,
      options,
      trace,
      known,
    );
  if (routedExisting) return runRouted(routedExisting);
  // Reconnect before consulting the current pin or registry. A job may already
  // have executed even if settings changed while the operator run was asleep.
  const activeOperation = existing?.operation ?? operation;
  if (activeOperation !== "manual") {
    return executeRouterRequestOnce(
      ctx,
      activeOperation,
      payload,
      invocationKey,
      abortSignal,
      options,
      trace,
      existing,
    );
  }
  if (
    !existing &&
    route &&
    !(await timed(options.timing, "submit.capabilities", () =>
      clRouterRouteIsAvailable(route, { abortSignal }),
    ))
  )
    return runRouted(null);
  try {
    return await executeRouterRequestOnce(
      ctx,
      "manual",
      payload,
      invocationKey,
      abortSignal,
      options,
      trace,
      existing,
    );
  } catch (error) {
    const failure =
      error instanceof RouterJobFailed ? error.failure : undefined;
    const code =
      error instanceof ClRouterRequestError ? error.routerCode : failure?.code;
    const executionStarted =
      error instanceof ClRouterRequestError
        ? error.executionStarted
        : failure?.executionStarted;
    if (
      !(error instanceof Error) ||
      abortSignal?.aborted ||
      !isUnknownClRouterRouteFailure(code, executionStarted, error.message)
    )
      throw error;
    logIgnoredClRouterPin(route, "unknown_route");
    return runRouted();
  }
}

async function executeRouterRequestOnce(
  ctx: ActionCtx,
  operation: RouterJobOperation,
  payload: unknown,
  invocationKey: string,
  abortSignal?: AbortSignal,
  options: RouterRequestWaitOptions = {},
  trace?: ClRouterTraceInput,
  known?: Doc<"routerJobs"> | null,
): Promise<unknown> {
  const { timing } = options;
  const prepared = await prepareJob(
    ctx,
    operation,
    payload,
    invocationKey,
    abortSignal,
    options.streamTarget,
    trace,
    timing,
    known,
  );
  let row = prepared.row;
  for (;;) {
    timing?.job(invocationKey, row.routerJobId);
    if (abortSignal?.aborted) {
      await ctx.runMutation(internal.routerJobs.cancel, { id: row._id });
      if (row.routerJobId) {
        try {
          await routerControl(
            `/v1/jobs/${encodeURIComponent(row.routerJobId)}/cancel`,
            {},
          );
        } catch {
          /* Cancellation is already enforced in Spot. */
        }
      }
      throw abortSignal.reason ?? new Error("Router job cancelled");
    }
    if (row.status === "succeeded") {
      // A small result arrived on the row itself; larger ones are in storage.
      const { resultJson, resultStorageId } = row;
      timing?.job(
        invocationKey,
        row.routerJobId,
        resultJson !== undefined ? "inline" : "storage",
      );
      return await timed(timing, "read", async () => {
        if (resultJson !== undefined) return JSON.parse(resultJson);
        const blob = resultStorageId
          ? await ctx.storage.get(resultStorageId)
          : null;
        if (!blob) throw new Error("Router job result is no longer retained");
        return JSON.parse(await blob.text());
      });
    }
    if (row.status === "failed")
      throw new RouterJobFailed(row.error ?? "Router job failed", row.failure);
    if (row.status === "cancelled") throw new Error("Router job cancelled");
    const control = row.routerJobId ? "status" : "submit.lookup";
    const controlStarted = dayjs();
    let bound: Doc<"routerJobs"> | undefined;
    try {
      if (!row.routerJobId) {
        const siteUrl = callbackSiteUrl();
        const source = await jobInputSource(
          ctx,
          row,
          siteUrl,
          abortSignal,
          prepared.input,
          timing,
        );
        const submitted = row;
        const response = await timed(timing, "submit.post", () =>
          routerControl(
            "/v1/jobs",
            {
              idempotencyKey: invocationKey,
              operation: submitted.operation,
              ...(submitted.streamTarget ? { stream: true } : {}),
              tenantId: "glass",
              fingerprint: submitted.fingerprint,
              ...source,
              resultUrl: `${siteUrl}/router-jobs/result?token=${submitted.resultToken}`,
            },
            abortSignal,
          ),
        );
        const jobId = response.jobId;
        if (typeof jobId !== "string")
          throw new Error("Router submission did not return a job ID");
        bound = await timed(timing, "submit.bind", () =>
          ctx.runMutation(internal.routerJobs.bind, { id: submitted._id, jobId }),
        );
      } else {
        const status = await routerControl(
          `/v1/jobs/${encodeURIComponent(row.routerJobId)}`,
          undefined,
          abortSignal,
        );
        if (status.status === "cancelled") {
          await ctx.runMutation(internal.routerJobs.cancel, { id: row._id });
        } else if (
          status.status === "failed" ||
          status.status === "outcome_unknown"
        ) {
          await ctx.runMutation(internal.routerJobs.finish, {
            id: row._id,
            tokenHash: row.resultTokenHash,
            jobId: row.routerJobId,
            invocationKey,
            fingerprint: row.fingerprint,
            status: "failed",
            ...(status.status === "outcome_unknown"
              ? {
                  error:
                    "Router execution outcome is unknown; the request was not replayed",
                }
              : parseRouterJobError(status.error)),
          });
        }
      }
    } catch (error) {
      if (!(error instanceof RouterJobPending)) throw error;
    } finally {
      if (control === "status")
        timing?.phase("status", dayjs().diff(controlStarted));
    }
    // A bound submission already returned the current row.
    row =
      bound ??
      (await timed(timing, control, () =>
        ctx.runQuery(internal.routerJobs.get, { invocationKey }),
      ))!;
    timing?.job(invocationKey, row.routerJobId);
    if (routerJobEnded(row)) continue;
    if (options.wait !== "poll") {
      // Waiting in place spares the caller a yield and rescheduled resume
      // when the job finishes promptly; an unsubmitted job has nothing to
      // wait for. An ended or aborted job settles at the top of the loop, so
      // the budget is spent once per call.
      if (row.routerJobId && options.inlineWaitMs) {
        const waited = await waitForRouterJobRow(
          ctx,
          invocationKey,
          dayjs().add(options.inlineWaitMs, "millisecond"),
          abortSignal,
          timing,
        );
        if (waited) row = waited;
        if (routerJobEnded(row) || abortSignal?.aborted) continue;
      }
      throw new RouterJobPending(invocationKey, row.routerJobId);
    }
    await timed(
      timing,
      "wait",
      () => new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    );
  }
}

export async function cancelDurableRouterRequest(
  ctx: ActionCtx,
  invocationKey: string,
): Promise<void> {
  const row = await ctx.runQuery(internal.routerJobs.get, { invocationKey });
  if (!row || row.status === "succeeded" || row.status === "failed") return;
  await ctx.runMutation(internal.routerJobs.cancel, { id: row._id });
  try {
    let jobId = row.routerJobId;
    // A lost submission acknowledgement can still have started inference.
    // This resubmission only finds that job, so it keeps `requestUrl`: the
    // cancelled row no longer serves its input, and a new job cannot run.
    if (!jobId) {
      const siteUrl = callbackSiteUrl();
      const response = await routerControl("/v1/jobs", {
        idempotencyKey: invocationKey,
        operation: row.operation,
        ...(row.streamTarget ? { stream: true } : {}),
        tenantId: "glass",
        fingerprint: row.fingerprint,
        requestUrl: `${siteUrl}/router-jobs/request?token=${row.requestToken}`,
        resultUrl: `${siteUrl}/router-jobs/result?token=${row.resultToken}`,
      });
      if (typeof response.jobId === "string") jobId = response.jobId;
    }
    if (jobId)
      await routerControl(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {});
  } catch {
    // Revoked Spot capabilities and terminal state already prevent effects.
  }
}

export function durableRouterClientOptions(
  ctx: ActionCtx,
  invocationKey: string = crypto.randomUUID(),
  abortSignal?: AbortSignal,
): import("./clRouterClient").ClRouterClientOptions {
  return {
    abortSignal,
    executeJob: (operation, payload) =>
      executeDurableRouterRequest(
        ctx,
        operation,
        payload,
        invocationKey,
        abortSignal,
        { wait: "poll" },
      ),
  };
}

export function durableRouterClientOptionsWithTrace(
  ctx: ActionCtx,
  trace: ClRouterTraceInput,
): import("./clRouterClient").ClRouterClientOptions {
  const invocationKey = crypto.randomUUID();
  return {
    executeJob: (operation, payload, abortSignal) =>
      executeRouterRequest(
        ctx,
        operation,
        payload,
        invocationKey,
        abortSignal,
        { wait: "poll" },
        trace,
      ),
  };
}
