/// <reference types="vite/client" />

import { afterEach, describe, expect, test, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import {
  createSignedActionRouterAsset,
  deleteSignedRouterAsset,
  settleRouterAssetCleanups,
} from "./actions/routerAssets";
import { routerAssetSigningConfiguration } from "./lib/routerAssetSignature";

describe("router asset signing configuration", () => {
  test("requires the exact lane HTTP-action origin", () => {
    expect(
      routerAssetSigningConfiguration({
        SPOT_ENV: "dev",
        CL_ROUTER_SECRET: "router-secret-that-is-at-least-32-chars-long",
        CONVEX_SITE_URL: "https://acoustic-caiman-755.convex.site",
      }),
    ).toMatchObject({
      siteUrl: "https://acoustic-caiman-755.convex.site",
    });
    expect(
      routerAssetSigningConfiguration({
        SPOT_ENV: "production",
        CL_ROUTER_SECRET: "router-secret-that-is-at-least-32-chars-long",
        CONVEX_SITE_URL: "https://actions.spot.insure",
      }),
    ).toMatchObject({ siteUrl: "https://actions.spot.insure" });

    for (const siteUrl of [
      "https://actions.spot.insure:8443",
      "https://worker@actions.spot.insure",
      "https://actions.spot.insure/unexpected",
      "https://actions.spot.insure?lane=production",
    ]) {
      expect(() =>
        routerAssetSigningConfiguration({
          SPOT_ENV: "production",
          CL_ROUTER_SECRET: "router-secret-that-is-at-least-32-chars-long",
          CONVEX_SITE_URL: siteUrl,
        }),
      ).toThrow("canonical router asset host");
    }
  });

  test("uses CL_ROUTER_ASSET_SIGNING_SECRET when set, independent of CL_ROUTER_SECRET", () => {
    expect(
      routerAssetSigningConfiguration({
        SPOT_ENV: "local",
        CL_ROUTER_SECRET: "router-secret-that-is-at-least-32-chars-long",
        CL_ROUTER_ASSET_SIGNING_SECRET:
          "dedicated-signing-secret-that-is-at-least-32-chars",
        CONVEX_SITE_URL: "http://localhost:3211",
      }),
    ).toMatchObject({
      secret: "dedicated-signing-secret-that-is-at-least-32-chars",
    });
  });

  test("falls back to CL_ROUTER_SECRET when CL_ROUTER_ASSET_SIGNING_SECRET is unset", () => {
    expect(
      routerAssetSigningConfiguration({
        SPOT_ENV: "local",
        CL_ROUTER_SECRET: "router-secret-that-is-at-least-32-chars-long",
        CONVEX_SITE_URL: "http://localhost:3211",
      }),
    ).toMatchObject({
      secret: "router-secret-that-is-at-least-32-chars-long",
    });
  });

  test("rejects a signing secret shorter than the minimum length", () => {
    expect(() =>
      routerAssetSigningConfiguration({
        SPOT_ENV: "local",
        CL_ROUTER_ASSET_SIGNING_SECRET: "too-short",
        CONVEX_SITE_URL: "http://localhost:3211",
      }),
    ).toThrow("Router asset signing is not configured");
    expect(() =>
      routerAssetSigningConfiguration({
        SPOT_ENV: "local",
        CL_ROUTER_SECRET: "too-short",
        CONVEX_SITE_URL: "http://localhost:3211",
      }),
    ).toThrow("Router asset signing is not configured");
  });
});

describe("action-owned router asset cleanup", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("attempts every cleanup and reports only a sanitized failure count", async () => {
    const first = vi.fn(async () => {
      throw new Error("secret storage failure");
    });
    const second = vi.fn(async () => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      settleRouterAssetCleanups([first, second]),
    ).resolves.toBeUndefined();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[cl-router] 1 staged asset cleanups failed",
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("secret storage failure"),
    );
  });

  test("retains the ledger and schedules retry when blob deletion fails", async () => {
    const assetId = "asset-id" as Id<"routerAssets">;
    const storageId = "storage-id" as Id<"_storage">;
    const ctx = {
      runQuery: vi.fn(async () => ({ storageId })),
      runMutation: vi.fn(async () => true),
      storage: {
        delete: vi.fn(async () => Promise.reject(new Error("retry"))),
      },
    };
    await expect(
      deleteSignedRouterAsset(ctx as never, { assetId }),
    ).resolves.toBe(false);
    expect(ctx.runMutation).toHaveBeenCalledOnce();
    const [, failureArgs] = ctx.runMutation.mock.calls[0] as unknown as [
      unknown,
      unknown,
    ];
    expect(failureArgs).toEqual({ assetId, storageId });

    ctx.storage.delete.mockResolvedValueOnce(undefined as never);
    ctx.runMutation.mockClear();
    await expect(
      deleteSignedRouterAsset(ctx as never, { assetId }),
    ).resolves.toBe(true);
    expect(ctx.runMutation).toHaveBeenCalledOnce();
  });

  test("register failure with an initial delete failure schedules orphan cleanup", async () => {
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret-that-is-at-least-32-chars-long");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
    vi.stubEnv("SPOT_ENV", "local");
    const storageId = "storage-id" as Id<"_storage">;
    const ctx = {
      storage: {
        store: vi.fn(async () => storageId),
        delete: vi.fn(async () => Promise.reject(new Error("temporary"))),
      },
      runMutation: vi
        .fn()
        .mockRejectedValueOnce(new Error("registration failed"))
        .mockResolvedValueOnce(true),
    };
    await expect(
      createSignedActionRouterAsset(ctx as never, {
        bytes: new Uint8Array([1]),
        mediaType: "audio/webm",
        surface: "voice_transcription",
        sessionKey: "session-1",
      }),
    ).rejects.toThrow("registration failed");
    expect(ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      storageId,
      attempt: 1,
    });
  });

  test("preserves registration failure when immediate orphan cleanup also fails", async () => {
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret-that-is-at-least-32-chars-long");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
    vi.stubEnv("SPOT_ENV", "local");
    const storageId = "storage-id" as Id<"_storage">;
    const ctx = {
      storage: {
        store: vi.fn(async () => storageId),
        delete: vi.fn(async () => Promise.reject(new Error("delete failed"))),
      },
      runMutation: vi
        .fn()
        .mockRejectedValueOnce(new Error("registration failed"))
        .mockRejectedValueOnce(new Error("cleanup scheduling failed")),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      createSignedActionRouterAsset(ctx as never, {
        bytes: new Uint8Array([1]),
        mediaType: "audio/webm",
        surface: "voice_transcription",
        sessionKey: "session-1",
      }),
    ).rejects.toThrow("registration failed");
    expect(warn).toHaveBeenCalledWith(
      "[cl-router] 1 staged asset cleanups failed",
    );
  });
});
