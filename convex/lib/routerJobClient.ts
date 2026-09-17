"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { assertSpotRouterAssetUrl } from "./clRouterClient";
import { routerAssetSigningConfiguration } from "./routerAssetSignature";

const REQUEST_BYTES = 4 * 1024 * 1024;
const ASSET_BYTES = 12 * 1024 * 1024;
const ASSET_AGGREGATE_BYTES = 16 * 1024 * 1024;
const CONTROL_WAIT_MS = 5_000;
export type RouterJobOperation =
  | "generate"
  | "embed"
  | "retrieve"
  | "transcribe";

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

async function prepareJob(
  ctx: ActionCtx,
  operation: RouterJobOperation,
  payload: unknown,
  invocationKey: string,
  signal?: AbortSignal,
): Promise<Doc<"routerJobs">> {
  const existing = await ctx.runQuery(internal.routerJobs.get, {
    invocationKey,
  });
  if (existing) {
    if (existing.operation !== operation)
      throw new Error("Router invocation operation conflict");
    return existing;
  }
  const siteUrl = callbackSiteUrl();
  const requestToken = token();
  const resultToken = token();
  const assets: Id<"_storage">[] = [];
  let requestStorageId: Id<"_storage"> | undefined;
  let retained = false;
  try {
    const serialized = await stageRequest(
      ctx,
      payload,
      requestToken,
      siteUrl,
      assets,
      signal,
    );
    requestStorageId = await ctx.storage.store(
      new Blob([serialized], { type: "application/json" }),
    );
    await ctx.runMutation(internal.routerJobs.scheduleUploadCleanup, {
      invocationKey,
      storageIds: [requestStorageId, ...assets],
    });
    let row: Doc<"routerJobs">;
    try {
      row = await ctx.runMutation(internal.routerJobs.prepare, {
        invocationKey,
        operation,
        fingerprint: await sha256(serialized),
        requestToken,
        requestTokenHash: await sha256(requestToken),
        resultToken,
        resultTokenHash: await sha256(resultToken),
        requestStorageId,
        ...(assets.length ? { assetStorageIds: assets } : {}),
      });
    } catch (error) {
      const winner = await ctx.runQuery(internal.routerJobs.get, {
        invocationKey,
      });
      if (!winner || winner.operation !== operation) throw error;
      row = winner;
    }
    retained = row.requestStorageId === requestStorageId;
    return row;
  } finally {
    if (!retained) {
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

async function routerControl(
  path: string,
  body: unknown | undefined,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const { secret } = routerAssetSigningConfiguration();
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

export async function executeDurableRouterRequest(
  ctx: ActionCtx,
  operation: RouterJobOperation,
  payload: unknown,
  invocationKey: string,
  abortSignal?: AbortSignal,
  options: { wait?: "yield" | "poll" } = {},
): Promise<unknown> {
  let row = await prepareJob(
    ctx,
    operation,
    payload,
    invocationKey,
    abortSignal,
  );
  for (;;) {
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
      const blob = row.resultStorageId
        ? await ctx.storage.get(row.resultStorageId)
        : null;
      if (!blob) throw new Error("Router job result is no longer retained");
      return JSON.parse(await blob.text());
    }
    if (row.status === "failed")
      throw new Error(row.error ?? "Router job failed");
    if (row.status === "cancelled") throw new Error("Router job cancelled");
    try {
      if (!row.routerJobId) {
        const siteUrl = callbackSiteUrl();
        const response = await routerControl(
          "/v1/jobs",
          {
            idempotencyKey: invocationKey,
            operation: row.operation,
            tenantId: "glass",
            fingerprint: row.fingerprint,
            requestUrl: `${siteUrl}/router-jobs/request?token=${row.requestToken}`,
            resultUrl: `${siteUrl}/router-jobs/result?token=${row.resultToken}`,
          },
          abortSignal,
        );
        if (typeof response.jobId !== "string")
          throw new Error("Router submission did not return a job ID");
        await ctx.runMutation(internal.routerJobs.bind, {
          id: row._id,
          jobId: response.jobId,
        });
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
            error:
              status.status === "outcome_unknown"
                ? "Router execution outcome is unknown; the request was not replayed"
                : "Router job failed",
          });
        }
      }
    } catch (error) {
      if (!(error instanceof RouterJobPending)) throw error;
    }
    row = (await ctx.runQuery(internal.routerJobs.get, { invocationKey }))!;
    if (
      row.status === "succeeded" ||
      row.status === "failed" ||
      row.status === "cancelled"
    )
      continue;
    if (options.wait !== "poll")
      throw new RouterJobPending(invocationKey, row.routerJobId);
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
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
    if (!jobId) {
      const siteUrl = callbackSiteUrl();
      const response = await routerControl("/v1/jobs", {
        idempotencyKey: invocationKey,
        operation: row.operation,
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
