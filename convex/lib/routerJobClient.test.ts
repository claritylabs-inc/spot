import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  callbackSiteUrl,
  executeDurableRouterRequest,
  RouterJobPending,
} from "./routerJobClient";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubEnv("SPOT_ENV", "local");
  vi.stubEnv("CL_ROUTER_URL", "http://localhost:8080");
  vi.stubEnv("CL_ROUTER_SECRET", "secret");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
});

function harness() {
  let row: Doc<"routerJobs"> | null = null;
  let nextId = 0;
  const blobs = new Map<string, Blob>();
  const store = vi.fn(async (blob: Blob) => {
    const id = `blob-${++nextId}` as Id<"_storage">;
    blobs.set(id, blob);
    return id;
  });
  const ctx = {
    storage: {
      store,
      get: async (id: string) => blobs.get(id) ?? null,
      delete: async (id: string) => {
        blobs.delete(id);
      },
    },
    runQuery: vi.fn(async () => row),
    runMutation: vi.fn(async (ref, args) => {
      const name = getFunctionName(ref);
      if (name === "routerJobs:prepare") {
        row = {
          ...args,
          _id: "job-1",
          _creationTime: 0,
          createdAt: 0,
          updatedAt: 0,
          status: "prepared",
        } as Doc<"routerJobs">;
        return row;
      }
      if (
        name === "routerJobs:scheduleUploadCleanup" ||
        name === "routerJobs:cleanupUploads"
      )
        return null;
      if (!row) throw new Error("Missing fixture job");
      if (name === "routerJobs:bind") row.routerJobId = args.jobId;
      else if (name === "routerJobs:cancel") row.status = "cancelled";
      else if (name === "routerJobs:finish") {
        row.status = args.status;
        row.error = args.error;
      }
      return null;
    }),
  } as unknown as ActionCtx;
  return {
    ctx,
    store,
    blobs,
    row: () => row!,
    finish: async (result: unknown) => {
      row!.resultStorageId = await store(new Blob([JSON.stringify(result)]));
      row!.status = "succeeded";
    },
  };
}

test("lost submit acknowledgement yields and resubmits the frozen invocation without new inference identity", async () => {
  const h = harness();
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("connection lost"))
    .mockResolvedValueOnce(
      Response.json({ jobId: "router-1", status: "queued" }),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    executeDurableRouterRequest(
      h.ctx,
      "generate",
      { prompt: "original" },
      "run:0",
    ),
  ).rejects.toBeInstanceOf(RouterJobPending);
  await expect(
    executeDurableRouterRequest(
      h.ctx,
      "generate",
      { prompt: "regenerated input" },
      "run:0",
    ),
  ).rejects.toBeInstanceOf(RouterJobPending);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  expect(h.store).toHaveBeenCalledTimes(1);
  expect(await h.blobs.get(h.row().requestStorageId!)?.text()).toBe(
    '{"prompt":"original"}',
  );
  await h.finish({ text: "completed once" });
  await expect(
    executeDurableRouterRequest(h.ctx, "generate", {}, "run:0"),
  ).resolves.toEqual({ text: "completed once" });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("unknown provider outcome stops polling without submitting replacement inference", async () => {
  const h = harness();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ jobId: "router-1" }))
    .mockResolvedValueOnce(
      Response.json({ jobId: "router-1", status: "outcome_unknown" }),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    executeDurableRouterRequest(h.ctx, "generate", {}, "run:0"),
  ).rejects.toBeInstanceOf(RouterJobPending);
  await expect(
    executeDurableRouterRequest(h.ctx, "generate", {}, "run:0"),
  ).rejects.toThrow("outcome is unknown");
  expect(h.row().status).toBe("failed");
  expect(fetch.mock.calls[1][1].method).toBe("GET");
  await expect(
    executeDurableRouterRequest(h.ctx, "generate", {}, "run:0"),
  ).rejects.toThrow("outcome is unknown");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("copies referenced assets before yielding and retains only job capability URLs", async () => {
  const h = harness();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("abc", { headers: { "content-type": "image/png" } }),
    )
    .mockResolvedValueOnce(Response.json({ jobId: "router-1" }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    executeDurableRouterRequest(
      h.ctx,
      "generate",
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  url: "http://localhost:3211/router-assets?expires=soon",
                  sizeBytes: 3,
                  mediaType: "image/png",
                },
              },
            ],
          },
        ],
      },
      "run:0",
    ),
  ).rejects.toBeInstanceOf(RouterJobPending);
  expect(h.row().assetStorageIds).toHaveLength(1);
  const stored = await h.blobs.get(h.row().requestStorageId!)!.text();
  expect(stored).toContain("/router-jobs/asset?token=");
  expect(stored).not.toContain("expires=soon");
  expect(await h.blobs.get(h.row().assetStorageIds![0])!.text()).toBe("abc");
});

test("callback tunnel overrides are HTTPS origins and cannot replace production", () => {
  vi.stubEnv("SPOT_ROUTER_CALLBACK_URL", "https://spot-test.example");
  expect(callbackSiteUrl()).toBe("https://spot-test.example");
  vi.stubEnv("SPOT_ROUTER_CALLBACK_URL", "https://spot-test.example/path");
  expect(() => callbackSiteUrl()).toThrow("HTTPS origin");
  vi.stubEnv("SPOT_ENV", "production");
  vi.stubEnv("CONVEX_SITE_URL", "https://actions.spot.insure");
  vi.stubEnv("SPOT_ROUTER_CALLBACK_URL", "https://spot-test.example");
  expect(() => callbackSiteUrl()).toThrow("canonical Spot origin");
});
