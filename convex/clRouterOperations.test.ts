/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getCapabilities, setGlobalFreeze } from "./clRouterOperations";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setGlobalFreezeFn = setGlobalFreeze as any;
const getCapabilitiesFn = getCapabilities as any;

beforeEach(() => {
  vi.stubEnv("SPOT_ENV", "production");
  vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
  vi.stubEnv("CL_ROUTER_ADMIN_SECRET", "router-admin-secret");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function seedOperator(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Spot Operator",
      email: "operator@spot.insure",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@spot.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return userId;
  });
}

function routerHealth(frozen: boolean, environment = "production") {
  return {
    status: "ok",
    environment,
    database: true,
    frozen,
    policyVersion: "policy-v1",
  };
}

describe("cl-router operator controls", () => {
  test("reads credential availability with the inference bearer", async () => {
    const t = convexTest(schema, modules);
    const operatorUserId = await seedOperator(t);
    vi.stubEnv("CL_ROUTER_SECRET", "router-inference-secret");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://router.example.test/v1/capabilities",
        );
        expect(init?.headers).toEqual({
          Authorization: "Bearer router-inference-secret",
        });
        return Response.json({
          apiVersion: "v1",
          credentialMode: "router",
          providers: [
            { provider: "fireworks", configured: true },
            { provider: "openai", configured: false },
          ],
          webRetrieval: {
            providers: [
              { provider: "parallel", configured: true },
              { provider: "exa", configured: false },
            ],
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(getCapabilitiesFn, {}),
    ).resolves.toMatchObject({
      availability: "available",
      apiVersion: "v1",
      credentialMode: "router",
      providers: [
        { provider: "fireworks", configured: true },
        { provider: "openai", configured: false },
      ],
      webRetrieval: {
        providers: [
          { provider: "parallel", configured: true },
          { provider: "exa", configured: false },
        ],
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("returns a sanitized unavailable state without router inference configuration", async () => {
    const t = convexTest(schema, modules);
    const operatorUserId = await seedOperator(t);
    vi.stubEnv("CL_ROUTER_SECRET", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(getCapabilitiesFn, {}),
    ).resolves.toMatchObject({
      availability: "unavailable",
      message: "Router inference is not configured for this deployment.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects malformed capabilities without returning router response details", async () => {
    const t = convexTest(schema, modules);
    const operatorUserId = await seedOperator(t);
    vi.stubEnv("CL_ROUTER_SECRET", "router-inference-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          apiVersion: "v1",
          credentialMode: "caller",
          providerKeyHint: "do-not-expose",
        }),
      ),
    );

    const result = await t
      .withIdentity({ subject: `${operatorUserId}|session` })
      .action(getCapabilitiesFn, {});
    expect(result).toMatchObject({
      availability: "unavailable",
      message: "Router returned an invalid capabilities response.",
    });
    expect(JSON.stringify(result)).not.toContain("do-not-expose");
  });

  test("rejects non-operators before contacting the router", async () => {
    const t = convexTest(schema, modules);
    const customerUserId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          name: "Spot Customer",
          email: "customer@example.com",
          accountKind: "customer",
        }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t
        .withIdentity({ subject: `${customerUserId}|session` })
        .action(setGlobalFreezeFn, { frozen: false }),
    ).rejects.toThrow(/operator/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("writes and verifies the versioned global freeze control", async () => {
    const t = convexTest(schema, modules);
    const operatorUserId = await seedOperator(t);
    let healthRequestCount = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          healthRequestCount += 1;
          return Response.json(routerHealth(healthRequestCount === 1));
        }
        if (url.endsWith("/admin/freeze")) {
          expect(init?.method).toBe("POST");
          expect(init?.headers).toMatchObject({
            Authorization: "Bearer router-admin-secret",
            "Content-Type": "application/json",
          });
          expect(JSON.parse(String(init?.body))).toMatchObject({
            tenantId: "glass",
            frozen: false,
            reason: expect.stringContaining(String(operatorUserId)),
          });
          return Response.json({
            frozen: false,
            policyVersion: "control-v2",
            controlVersion: "control-v2",
          });
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t
      .withIdentity({ subject: `${operatorUserId}|session` })
      .action(setGlobalFreezeFn, { frozen: false });

    expect(result).toEqual({
      frozen: false,
      policyVersion: "control-v2",
      controlVersion: "control-v2",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("lets an operator control the configured router across environments", async () => {
    const t = convexTest(schema, modules);
    const operatorUserId = await seedOperator(t);
    vi.stubEnv("SPOT_ENV", "local");
    let healthRequestCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        healthRequestCount += 1;
        return Response.json(routerHealth(healthRequestCount === 1, "dev"));
      }
      if (url.endsWith("/admin/freeze")) {
        return Response.json({
          frozen: false,
          policyVersion: "control-v2",
          controlVersion: "control-v2",
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(setGlobalFreezeFn, { frozen: false }),
    ).resolves.toMatchObject({ frozen: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("reports an environment panic switch that prevents unfreezing", async () => {
    const t = convexTest(schema, modules);
    const operatorUserId = await seedOperator(t);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json(routerHealth(true));
      if (url.endsWith("/admin/freeze")) {
        return Response.json({
          frozen: false,
          policyVersion: "control-v2",
          controlVersion: "control-v2",
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t
        .withIdentity({ subject: `${operatorUserId}|session` })
        .action(setGlobalFreezeFn, { frozen: false }),
    ).rejects.toThrow("CL_ROUTER_FROZEN environment panic switch");
  });
});
