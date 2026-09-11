"use node";

import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import {
  routerAssetSigningConfiguration,
  signRouterAsset,
  verifyRouterAssetSignature,
} from "../lib/routerAssetSignature";
import { ROUTER_ASSET_MAX_BYTES, ROUTER_ASSET_TTL_MS } from "../routerAssets";

function requireWorkerSecret(secret: string): void {
  const expected = process.env.EXTRACTION_WORKER_SECRET?.trim();
  if (!expected || secret !== expected)
    throw new Error("Unauthorized extraction worker");
}

function signingSecret(): string {
  const secret = process.env.CL_ROUTER_SECRET?.trim();
  if (!secret)
    throw new Error("CL_ROUTER_SECRET is required for router assets");
  return secret;
}

export type RouterAssetCleanup = {
  assetId: Id<"routerAssets">;
  expiresAt: number;
  signature: string;
};

function normalizedMediaType(value: string): string | null {
  const mediaType = value.trim().toLowerCase().split(";", 1)[0] ?? "";
  return mediaType === "application/pdf" ||
    mediaType.startsWith("image/") ||
    mediaType.startsWith("audio/")
    ? mediaType
    : null;
}

async function cleanUnregisteredStorage(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch {
    await ctx.runMutation(internal.routerAssets.scheduleUnregisteredCleanup, {
      storageId,
      attempt: 1,
    });
  }
}

export async function deleteSignedRouterAsset(
  ctx: ActionCtx,
  cleanup: Pick<RouterAssetCleanup, "assetId">,
): Promise<boolean> {
  const row = await ctx.runQuery(internal.routerAssets.getForCleanup, {
    assetId: cleanup.assetId,
  });
  if (!row) return false;
  try {
    await ctx.storage.delete(row.storageId);
  } catch {
    await ctx.runMutation(internal.routerAssets.recordCleanupFailure, {
      assetId: cleanup.assetId,
      storageId: row.storageId,
    });
    return false;
  }
  await ctx.runMutation(internal.routerAssets.completeCleanup, {
    assetId: cleanup.assetId,
    storageId: row.storageId,
  });
  return true;
}

export async function settleRouterAssetCleanups(
  cleanups: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  const results = await Promise.allSettled(
    cleanups.map(async (cleanup) => cleanup()),
  );
  const failureCount = results.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failureCount > 0) {
    console.warn(`[cl-router] ${failureCount} staged asset cleanups failed`);
  }
}

export async function cleanupSignedRouterAssets(
  ctx: ActionCtx,
  cleanups: ReadonlyArray<Pick<RouterAssetCleanup, "assetId">>,
): Promise<void> {
  await settleRouterAssetCleanups(
    cleanups.map((cleanup) => async () => {
      await deleteSignedRouterAsset(ctx, cleanup);
    }),
  );
}

export async function createSignedActionRouterAsset(
  ctx: ActionCtx,
  args: {
    bytes: Uint8Array;
    mediaType: string;
    filename?: string;
    orgId?: Id<"organizations">;
    surface: string;
    sessionKey: string;
  },
): Promise<{
  reference: {
    url: string;
    mediaType: string;
    filename?: string;
    sizeBytes: number;
    sha256: string;
  };
  cleanup: RouterAssetCleanup;
}> {
  if (
    !args.bytes.byteLength ||
    args.bytes.byteLength > ROUTER_ASSET_MAX_BYTES ||
    !args.surface.trim() ||
    !args.sessionKey.trim()
  ) {
    throw new Error("Invalid action-owned router asset");
  }
  const mediaType = normalizedMediaType(args.mediaType);
  if (!mediaType) throw new Error("Unsupported action-owned router asset type");
  const signing = routerAssetSigningConfiguration();
  const ownedBytes = new Uint8Array(args.bytes.byteLength);
  ownedBytes.set(args.bytes);
  const storageId = await ctx.storage.store(
    new Blob([ownedBytes.buffer], { type: mediaType }),
  );
  let assetId: Id<"routerAssets"> | undefined;
  try {
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBytes.buffer)),
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const expiresAt = dayjs().valueOf() + ROUTER_ASSET_TTL_MS;
    const registeredAssetId = await ctx.runMutation(
      internal.routerAssets.registerActionAsset,
      {
        ...(args.orgId ? { orgId: args.orgId } : {}),
        surface: args.surface,
        sessionKey: args.sessionKey,
        storageId,
        mediaType,
        ...(args.filename ? { filename: args.filename } : {}),
        sizeBytes: args.bytes.byteLength,
        sha256,
        expiresAt,
      },
    );
    assetId = registeredAssetId;
    const signature = await signRouterAsset(
      String(registeredAssetId),
      expiresAt,
      signing.secret,
    );
    const query = new URLSearchParams({
      assetId: String(registeredAssetId),
      expiresAt: String(expiresAt),
      signature,
    });
    return {
      reference: {
        url: `${signing.siteUrl}/router-assets?${query.toString()}`,
        mediaType,
        ...(args.filename ? { filename: args.filename } : {}),
        sizeBytes: args.bytes.byteLength,
        sha256,
      },
      cleanup: { assetId: registeredAssetId, expiresAt, signature },
    };
  } catch (error) {
    const registeredAssetId = assetId;
    await settleRouterAssetCleanups([
      registeredAssetId
        ? async () => {
            await deleteSignedRouterAsset(ctx, {
              assetId: registeredAssetId,
            });
          }
        : async () => {
            await cleanUnregisteredStorage(ctx, storageId);
          },
    ]);
    throw error;
  }
}

export const deleteWorkerAsset = action({
  args: {
    secret: v.string(),
    assetId: v.id("routerAssets"),
    expiresAt: v.number(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.secret);
    if (
      !(await verifyRouterAssetSignature(
        String(args.assetId),
        args.expiresAt,
        args.signature,
        signingSecret(),
      ))
    ) {
      throw new Error("Invalid router asset cleanup token");
    }
    return { deleted: await deleteSignedRouterAsset(ctx, args) };
  },
});

export const expireAsset = internalAction({
  args: { assetId: v.id("routerAssets") },
  handler: async (ctx, args) => {
    await deleteSignedRouterAsset(ctx, args);
    return null;
  },
});

export const deleteUnregisteredAsset = internalAction({
  args: { storageId: v.id("_storage"), attempt: v.number() },
  handler: async (ctx, args) => {
    try {
      await ctx.storage.delete(args.storageId);
    } catch {
      await ctx.runMutation(internal.routerAssets.scheduleUnregisteredCleanup, {
        storageId: args.storageId,
        attempt: args.attempt + 1,
      });
    }
    return null;
  },
});
