import { pathToFileURL } from "node:url";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import {
  createClRouterClient,
  type ClRouterAssetReference,
  type ClRouterGenerateResponse,
} from "./clRouterClient.js";
import {
  stageRouterAsset,
  validatedConvexSiteUrl,
  type RouterAssetLease,
  type StagedRouterAsset,
  type StagedRouterAssetCleanup,
} from "./routerAssetUpload.js";

export const WORKER_ROUTER_TRANSPORT_SMOKE_MARKER =
  "[spot:worker-router-transport-smoke]";

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const WORKER_ROUTER_TRANSPORT_SMOKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGPQcmigKWIYtWDUglELRi0YtWDUglELRi0YtWDUglELhooFAICWqC5sy2ZgAAAAAElFTkSuQmCC",
  "base64",
);

type FixtureLease = RouterAssetLease & { leaseExpiresAt: number };

export type WorkerRouterTransportSmokeAdapters = {
  begin: (requestId: string) => Promise<FixtureLease>;
  stage: (lease: FixtureLease) => Promise<StagedRouterAsset>;
  generate: (
    requestId: string,
    lease: FixtureLease,
    reference: ClRouterAssetReference,
  ) => Promise<ClRouterGenerateResponse>;
  deleteAsset: (cleanup: StagedRouterAssetCleanup) => Promise<boolean>;
  finish: (requestId: string) => Promise<boolean>;
};

export type WorkerRouterTransportSmokeResult = {
  ok: boolean;
  smokeRequestId: string;
  routerRequestId?: string;
  began: boolean;
  uploaded: boolean;
  generated: boolean;
  assetCleanupAcknowledged: boolean;
  fixtureCleanupAcknowledged: boolean;
};

export function renderWorkerRouterTransportSmokeResult(
  result: WorkerRouterTransportSmokeResult,
): string {
  return `${WORKER_ROUTER_TRANSPORT_SMOKE_MARKER} ${JSON.stringify(result)}\n`;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

function defaultAdapters(): WorkerRouterTransportSmokeAdapters {
  const secret = requiredEnv("EXTRACTION_WORKER_SECRET");
  const spotEnv = requiredEnv("SPOT_ENV");
  const siteUrl = validatedConvexSiteUrl(
    requiredEnv("CONVEX_SITE_URL"),
    spotEnv,
  );
  const tenantId = requiredEnv("CL_ROUTER_TENANT_ID");
  if (tenantId !== "glass")
    throw new Error("CL_ROUTER_TENANT_ID must be glass");
  const convex = new ConvexHttpClient(requiredEnv("CONVEX_URL"));
  const router = createClRouterClient({
    baseUrl: requiredEnv("CL_ROUTER_URL"),
    secret: requiredEnv("CL_ROUTER_SECRET"),
    timeoutMs: 180_000,
  });
  const begin = makeFunctionReference<
    "action",
    { secret: string; requestId: string },
    FixtureLease
  >("actions/workerRouterTransportSmoke:begin");
  const deleteAsset = makeFunctionReference<
    "action",
    {
      secret: string;
      assetId: string;
      expiresAt: number;
      signature: string;
    },
    { deleted: boolean }
  >("actions/routerAssets:deleteWorkerAsset");
  const finish = makeFunctionReference<
    "action",
    { secret: string; requestId: string },
    { deleted: boolean }
  >("actions/workerRouterTransportSmoke:finish");

  const removeAsset = async (cleanup: StagedRouterAssetCleanup) =>
    (
      await convex.action(deleteAsset, {
        secret,
        assetId: cleanup.assetId,
        expiresAt: cleanup.expiresAt,
        signature: cleanup.signature,
      })
    ).deleted;

  return {
    begin: async (requestId) =>
      await convex.action(begin, { secret, requestId }),
    stage: async (lease) =>
      await stageRouterAsset({
        siteUrl,
        secret,
        lease,
        mediaType: "image/png",
        filename: "synthetic-pixel.png",
        bytes: WORKER_ROUTER_TRANSPORT_SMOKE_PNG,
        cleanupInvalidResponse: async (cleanup) => {
          await removeAsset(cleanup);
        },
      }),
    generate: async (requestId, lease, reference) =>
      await router.generate({
        task: "extraction_preview",
        taskKind: "extraction_preview",
        tenantId,
        orgId: lease.orgId,
        prompt:
          'This is an isolated synthetic transport check. Return {"ok":true}.',
        schema: {
          type: "object",
          properties: { ok: { const: true, type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
        maxTokens: 32,
        sessionKey: `worker-router-transport:${requestId}`,
        assets: { images: [{ source: reference }] },
        trace: {
          label: "extraction-worker.routerTransportSmoke",
          phase: "asset_transport",
        },
      }),
    deleteAsset: removeAsset,
    finish: async (requestId) =>
      (await convex.action(finish, { secret, requestId })).deleted,
  };
}

export async function runWorkerRouterTransportSmoke(
  requestId: string,
  adapters?: WorkerRouterTransportSmokeAdapters,
): Promise<WorkerRouterTransportSmokeResult> {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return {
      ok: false,
      smokeRequestId: requestId,
      began: false,
      uploaded: false,
      generated: false,
      assetCleanupAcknowledged: false,
      fixtureCleanupAcknowledged: false,
    };
  }

  const activeAdapters = adapters ?? defaultAdapters();

  let began = false;
  let uploaded = false;
  let generated = false;
  let staged: StagedRouterAsset | undefined;
  let response: ClRouterGenerateResponse | undefined;
  let assetCleanupAcknowledged = false;
  let fixtureCleanupAcknowledged = false;
  try {
    const lease = await activeAdapters.begin(requestId);
    began = true;
    staged = await activeAdapters.stage(lease);
    uploaded = true;
    response = await activeAdapters.generate(
      requestId,
      lease,
      staged.reference,
    );
    const output = response.output as { ok?: unknown } | null;
    if (!output || output.ok !== true) throw new Error("SmokeOutputMismatch");
    generated = true;
  } catch {
    // The stdout contract intentionally omits internal failure details.
  } finally {
    if (staged) {
      const [assetCleanup] = await Promise.allSettled([
        activeAdapters.deleteAsset(staged.cleanup),
      ]);
      assetCleanupAcknowledged =
        assetCleanup.status === "fulfilled" && assetCleanup.value;
    }
    const [fixtureCleanup] = await Promise.allSettled([
      activeAdapters.finish(requestId),
    ]);
    fixtureCleanupAcknowledged =
      fixtureCleanup.status === "fulfilled" && fixtureCleanup.value;
  }

  const ok =
    began &&
    uploaded &&
    generated &&
    assetCleanupAcknowledged &&
    fixtureCleanupAcknowledged;
  return {
    ok,
    smokeRequestId: requestId,
    ...(response?.requestId ? { routerRequestId: response.requestId } : {}),
    began,
    uploaded,
    generated,
    assetCleanupAcknowledged,
    fixtureCleanupAcknowledged,
  };
}

async function main(): Promise<void> {
  const requestId = process.argv.length === 3 ? (process.argv[2] ?? "") : "";
  let result: WorkerRouterTransportSmokeResult;
  try {
    result = await runWorkerRouterTransportSmoke(requestId);
  } catch {
    result = {
      ok: false,
      smokeRequestId: requestId,
      began: false,
      uploaded: false,
      generated: false,
      assetCleanupAcknowledged: false,
      fixtureCleanupAcknowledged: false,
    };
  }
  process.stdout.write(renderWorkerRouterTransportSmokeResult(result));
  if (!result.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  void main();
}
