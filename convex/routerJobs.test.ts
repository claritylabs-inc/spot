/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { routerJobTokenHash } from "./routerJobs";
import {
  clRouterGenerateMaybeManual,
  clRouterGenerateMaybeManualStream,
} from "./lib/clRouterClient";
import { createClRouterLanguageModel } from "./lib/clRouterLanguageModel";
import { mapSpotCallToClRouterPrimitive } from "./lib/clRouterPrimitive";
import { executeDurableRouterRequest } from "./lib/routerJobClient";
import { generateAgentTextForPublicTask } from "./lib/models";
import contractFixtures from "../contracts/cl-router/fixtures.v1.json";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Transport invariants: retired pins may fall back only before execution;
// unknown outcomes and partial streams must never replay inference. Durable
// fallback must retain its identity across a runner continuation.
const routerEnvironment = {
  CL_ROUTER_URL: "https://router.example.com",
  CL_ROUTER_SECRET: "test-only",
};
const route = { provider: "openai" as const, model: "fixture-live-model" };
const generation = {
  ...contractFixtures.fixtures.find(
    (item) => item.schema === "GenerateResponse",
  )!.value,
  output: "Done",
  model: route,
};
function capabilities(models = [route]) {
  return {
    apiVersion: "v1",
    credentialMode: "router",
    providers: [{ provider: "openai", configured: true }],
    webRetrieval: { providers: [] },
    models: models.map((model) => ({
      ...model,
      configured: true,
      primitives: ["text", "reasoning"],
      capabilities: {
        vision: true,
        tools: true,
        structuredOutput: true,
        embedding: false,
        audioInput: false,
      },
    })),
  };
}
function routerFailure(message: string, executionStarted = false) {
  return {
    error: {
      code: "router_rejected",
      message,
      executionStarted,
      retryable: false,
    },
  };
}

test("operator routing needs no stored pin; cleanup clears the old operator pin too", async () => {
  const t = convexTest(schema, modules);
  expect(
    await t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
  ).toBeNull();
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    await ctx.db.insert("globalModelSettings", {
      key: "default",
      updatedBy: userId,
      updatedAt: 0,
      routes: { operator_agent: route },
      explicitRouteOverrides: ["operator_agent"],
    });
  });
  expect(
    await t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
  ).toEqual(route);
  await t.mutation(
    internal.modelSettings.clearOperatorModelOverridesInternal,
    {},
  );
  expect(
    await t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
  ).toBeNull();
});

test("generation lets the router infer image, tool, schema and context capabilities", async () => {
  expect(mapSpotCallToClRouterPrimitive({ task: "chat_vision" })).toEqual({
    primitive: "text",
  });
  expect(
    mapSpotCallToClRouterPrimitive({
      task: "chat",
      taskKind: "operator_agent",
    }),
  ).toEqual({ primitive: "text" });
  expect(mapSpotCallToClRouterPrimitive({ task: "extraction" })).toEqual({
    primitive: "reasoning",
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(generation));
  const model = createClRouterLanguageModel({
    task: "chat_vision",
    taskKind: "operator_agent",
    sessionKey: "test",
    client: { environment: routerEnvironment, fetch: fetcher },
  });
  const options = {
    prompt: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "Hello" }],
      },
    ],
  };
  await model.doGenerate(options);
  await model.doGenerate(options);
  for (const [url, init] of fetcher.mock.calls) {
    expect(String(url).endsWith("/v1/generate")).toBe(true);
    const body = JSON.parse(String(init?.body));
    expect(body.primitive).toBe("text");
    expect(body).not.toHaveProperty("route");
    expect(body).not.toHaveProperty("requirements");
    expect(body).not.toHaveProperty("toolSelection");
  }
});

test("live capabilities replace a retired pin without executing manual inference", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/v1/capabilities") ? capabilities() : generation,
      ),
    );
  await clRouterGenerateMaybeManual(
    { primitive: "text", prompt: "Hello" },
    { ...route, model: "retired-fixture" },
    { environment: routerEnvironment, fetch: fetcher },
  );
  expect(
    fetcher.mock.calls.map(([url]) => String(url).split("/").pop()),
  ).toEqual(["capabilities", "generate"]);
});

test("an explicit live pin still uses manual generation", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/v1/capabilities") ? capabilities() : generation,
      ),
    );
  await clRouterGenerateMaybeManual(
    { primitive: "text", prompt: "Hello" },
    route,
    { environment: routerEnvironment, fetch: fetcher },
  );
  expect(
    fetcher.mock.calls.map(([url]) => String(url).split("/").pop()),
  ).toEqual(["capabilities", "manual"]);
});

// Reasoning is opt-in and route-bound: only opted-in calls request or replay
// it, each part names the provider that produced it so cl-router can withhold
// it from others, and a pin to another model never receives it.
test("reasoning continuity stays opt-in and bound to its producing route", async () => {
  const call = {
    toolCallId: "call_1",
    toolName: "list_policies",
    input: { status: "active" },
  };
  const reasoningMetadata = {
    openai: { itemId: "rs_1", reasoningEncryptedContent: "opaque" },
  };
  const callMetadata = { openai: { itemId: "fc_1" } };
  const pin = { provider: "openai" as const, model: "fixture-other-model" };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    Response.json(
      String(url).endsWith("/v1/capabilities")
        ? capabilities([pin])
        : {
            ...generation,
            output: { text: "", toolCalls: [call] },
            finishReason: "tool-calls",
            message: {
              role: "assistant",
              content: [
                {
                  type: "reasoning",
                  text: "Check policies.",
                  provider: "openai",
                  providerMetadata: reasoningMetadata,
                },
                { type: "tool-call", ...call, providerMetadata: callMetadata },
              ],
            },
          },
    ),
  );
  const model = (
    options: Partial<Parameters<typeof createClRouterLanguageModel>[0]>,
  ) =>
    createClRouterLanguageModel({
      task: "chat",
      taskKind: "operator_agent",
      sessionKey: "test",
      client: { environment: routerEnvironment, fetch: fetcher },
      ...options,
    });
  const user = {
    role: "user" as const,
    content: [{ type: "text" as const, text: "Renewals?" }],
  };
  const lastBody = () =>
    JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));

  const first = await model({
    reasoning: { include: true, effort: "low" },
  }).doGenerate({ prompt: [user] });
  expect(lastBody().reasoning).toEqual({ include: true, effort: "low" });
  expect(first.content).toEqual([
    {
      type: "reasoning",
      text: "Check policies.",
      providerMetadata: { ...reasoningMetadata, "cl-router": route },
    },
    {
      type: "tool-call",
      ...call,
      input: JSON.stringify(call.input),
      providerMetadata: callMetadata,
    },
  ]);

  // The next step replays the AI SDK response message as its prompt.
  const prompt = [
    user,
    {
      role: "assistant" as const,
      content: [
        {
          type: "reasoning" as const,
          text: "Check policies.",
          providerOptions: { ...reasoningMetadata, "cl-router": route },
        },
        { type: "tool-call" as const, ...call, providerOptions: callMetadata },
      ],
    },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: { type: "json" as const, value: [] },
        },
      ],
    },
  ];
  const replayedCall = { type: "tool-call", ...call };
  await model({ reasoning: { include: true } }).doGenerate({ prompt });
  expect(lastBody().messages[1].content).toEqual([
    {
      type: "reasoning",
      text: "Check policies.",
      provider: "openai",
      providerMetadata: reasoningMetadata,
    },
    { ...replayedCall, providerMetadata: callMetadata },
  ]);

  await model({
    reasoning: { include: true },
    initialRoutePin: pin,
  }).doGenerate({ prompt });
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toMatch(/\/v1\/manual$/);
  expect(lastBody().messages[1].content).toEqual([
    { ...replayedCall, providerMetadata: callMetadata },
  ]);

  const unopted = await model({}).doGenerate({ prompt });
  expect(lastBody()).not.toHaveProperty("reasoning");
  expect(lastBody().messages[1].content).toEqual([replayedCall]);
  expect(unopted.content.map((part) => part.type)).toEqual(["tool-call"]);
});

test.each([
  ["The manual route is not in the model registry.", false, true],
  ["The manual route is not in the model registry.", true, false],
  ["Invalid tool schema", false, false],
])(
  "manual rejection %s (executionStarted=%s) only falls back for an unknown route",
  async (message, executionStarted, fallback) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/capabilities"))
        return Response.json(capabilities());
      if (String(url).endsWith("/v1/manual"))
        return Response.json(routerFailure(message, executionStarted), {
          status: 400,
        });
      return Response.json(generation);
    });
    const call = clRouterGenerateMaybeManual(
      { primitive: "text", prompt: "Hello" },
      route,
      { environment: routerEnvironment, fetch: fetcher },
    );
    if (fallback) await expect(call).resolves.toHaveProperty("output", "Done");
    else await expect(call).rejects.toThrow(message);
    expect(
      fetcher.mock.calls.some(([url]) => String(url).endsWith("/v1/generate")),
    ).toBe(fallback);
  },
);

test("a pre-output SSE route rejection falls back, but output followed by rejection never replays", async () => {
  for (const visible of [false, true]) {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/capabilities"))
        return Response.json(capabilities());
      const error = {
        type: "error",
        ...routerFailure("The manual route is not in the model registry."),
      };
      const done = { ...generation, type: "done", finishReason: "stop" };
      const events = String(url).endsWith("/v1/manual/stream")
        ? [
            ...(visible
              ? [{ type: "text-delta", id: "1", delta: "Partial" }]
              : []),
            error,
          ]
        : [done];
      return new Response(
        events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });
    const response = await clRouterGenerateMaybeManualStream(
      { primitive: "text", prompt: "Hello" },
      route,
      { environment: routerEnvironment, fetch: fetcher },
    );
    const events = [];
    for await (const event of response.events) events.push(event.type);
    expect(events).toEqual(visible ? ["text-delta", "error"] : ["done"]);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith("/v1/generate/stream"),
      ),
    ).toBe(!visible);
  }
});

async function fixture() {
  const t = convexTest(schema, modules);
  const requestStorageId = await t.run((ctx) =>
    ctx.storage.store(
      new Blob(['{"prompt":"test"}'], { type: "application/json" }),
    ),
  );
  const args = {
    invocationKey: "test:run:step:0",
    operation: "generate" as const,
    callContext: { task: "chat", taskKind: "test", channel: "web", sessionKey: "test" },
    fingerprint: "a".repeat(64),
    requestToken: "b".repeat(64),
    requestTokenHash: await routerJobTokenHash("b".repeat(64)),
    resultToken: "c".repeat(64),
    resultTokenHash: await routerJobTokenHash("c".repeat(64)),
    requestStorageId,
  };
  const row = await t.mutation(internal.routerJobs.prepare, args);
  return { t, args, row };
}

test("prepares one invocation and rejects conflicting identities", async () => {
  const { t, args, row } = await fixture();
  expect((await t.mutation(internal.routerJobs.prepare, args))._id).toBe(
    row._id,
  );
  await expect(
    t.mutation(internal.routerJobs.prepare, {
      ...args,
      fingerprint: "d".repeat(64),
    }),
  ).rejects.toThrow("identity conflict");
  expect(
    await t.query(internal.routerJobs.authorize, {
      tokenHash: args.requestToken,
      purpose: "request",
    }),
  ).toBeNull();
  expect(
    (
      await t.query(internal.routerJobs.authorize, {
        tokenHash: args.requestTokenHash,
        purpose: "request",
      })
    )?._id,
  ).toBe(row._id);
});

test("durable routed fallback reconnects even after the pin is removed", async () => {
  const { t, args, row } = await fixture();
  await t.run((ctx) =>
    ctx.db.patch(row._id, {
      operation: "manual",
      status: "failed",
      error: "The manual route is not in the model registry.",
      failure: {
        code: "router_rejected",
        executionStarted: false,
        retryable: false,
      },
    }),
  );
  vi.stubEnv("SPOT_ENV", "local");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  vi.stubEnv("SPOT_ROUTER_CALLBACK_URL", "");
  vi.stubEnv("CL_ROUTER_URL", routerEnvironment.CL_ROUTER_URL);
  vi.stubEnv("CL_ROUTER_SECRET", "x".repeat(32));
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ jobId: "router-fallback" }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    t.action((ctx) =>
      executeDurableRouterRequest(
        ctx,
        "manual",
        { primitive: "text", route, prompt: "Original prompt" },
        args.invocationKey,
        undefined,
        { wait: "yield" },
      ),
    ),
  ).rejects.toThrow("still running");
  const fallback = (await t.query(internal.routerJobs.get, {
    invocationKey: `${args.invocationKey}:routed`,
  }))!;
  expect(fallback.operation).toBe("generate");
  const requestText = await t.run(async (ctx) =>
    (await ctx.storage.get(fallback.requestStorageId!))!.text(),
  );
  expect(JSON.parse(requestText)).not.toHaveProperty("route");
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([JSON.stringify(generation)])),
  );
  await t.mutation(internal.routerJobs.finish, {
    id: fallback._id,
    tokenHash: fallback.resultTokenHash,
    jobId: "router-fallback",
    invocationKey: fallback.invocationKey,
    fingerprint: fallback.fingerprint,
    status: "succeeded",
    storageId,
  });
  for (const operation of ["manual", "generate"] as const) {
    expect(
      await t.action((ctx) =>
        executeDurableRouterRequest(
          ctx,
          operation,
          {
            primitive: "text",
            prompt: "Rebuilt prompt",
            ...(operation === "manual" ? { route } : {}),
          },
          args.invocationKey,
        ),
      ),
    ).toEqual(generation);
  }
  expect(
    await t.run((ctx) => ctx.db.query("routerJobs").take(10)),
  ).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("a yielding call waits in place for its callback, then yields without resubmitting", async () => {
  const { t, args, row } = await fixture();
  vi.stubEnv("SPOT_ENV", "local");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  vi.stubEnv("SPOT_ROUTER_CALLBACK_URL", "");
  vi.stubEnv("CL_ROUTER_URL", routerEnvironment.CL_ROUTER_URL);
  vi.stubEnv("CL_ROUTER_SECRET", "x".repeat(32));
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ jobId: "router-inline" }));
  vi.stubGlobal("fetch", fetcher);
  const call = (inlineWaitMs: number) =>
    t.action((ctx) =>
      executeDurableRouterRequest(
        ctx,
        "generate",
        { primitive: "text", prompt: "Hello" },
        args.invocationKey,
        undefined,
        { wait: "yield", inlineWaitMs },
      ),
    );
  await expect(call(600)).rejects.toThrow("still running");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([JSON.stringify(generation)])),
  );
  fetcher.mockImplementation(async () =>
    Response.json({ status: "running" }),
  );
  const waiting = call(10_000);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await t.mutation(internal.routerJobs.finish, {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-inline",
    invocationKey: args.invocationKey,
    fingerprint: args.fingerprint,
    status: "succeeded",
    storageId,
  });
  expect(await waiting).toEqual(generation);
  // The resumed call checked status once and never submitted again.
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String(fetcher.mock.calls[1]![0])).toMatch(/\/v1\/jobs\/router-inline$/);
});

test("a durable unknown execution outcome cannot create a routed fallback", async () => {
  const { t, args, row } = await fixture();
  await t.run((ctx) =>
    ctx.db.patch(row._id, {
      operation: "manual",
      status: "failed",
      error: "Router execution outcome is unknown",
      failure: {
        code: "router_unavailable",
        executionStarted: true,
        retryable: false,
      },
    }),
  );
  await expect(
    t.action((ctx) =>
      executeDurableRouterRequest(
        ctx,
        "manual",
        { primitive: "text", route, prompt: "Hello" },
        args.invocationKey,
      ),
    ),
  ).rejects.toThrow("outcome is unknown");
  expect(
    await t.run((ctx) => ctx.db.query("routerJobs").take(10)),
  ).toHaveLength(1);
});

test("accepts callback before submission ACK, binds identity, and removes duplicate result uploads", async () => {
  vi.useFakeTimers();
  const { t, args, row } = await fixture();
  const resultId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['{"text":"done"}'])),
  );
  const finish = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey: args.invocationKey,
    fingerprint: args.fingerprint,
    status: "succeeded" as const,
    storageId: resultId,
  };
  expect(await t.mutation(internal.routerJobs.finish, finish)).toBe(true);
  const calls = await t.run(ctx => ctx.db.query("modelRoutingEvents").withIndex("call", q => q.eq("callKey", args.invocationKey)).take(2));
  expect(calls).toHaveLength(1);
  expect(calls[0].status).toBe("complete");
  await t.mutation(internal.routerJobs.bind, {
    id: row._id,
    jobId: "router-1",
  });
  await expect(
    t.mutation(internal.routerJobs.bind, {
      id: row._id,
      jobId: "router-other",
    }),
  ).rejects.toThrow("identity conflict");
  const duplicateId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['{"text":"other"}'])),
  );
  expect(
    await t.mutation(internal.routerJobs.finish, {
      ...finish,
      storageId: duplicateId,
    }),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.storage.get(duplicateId))).toBeNull();
  expect(
    (
      await t.query(internal.routerJobs.get, {
        invocationKey: args.invocationKey,
      })
    )?.resultStorageId,
  ).toBe(resultId);
  expect(
    await t.query(internal.routerJobs.authorize, {
      tokenHash: args.requestTokenHash,
      purpose: "request",
    }),
  ).toBeNull();
});

test("rejects wrong callback identity and cancellation races without retaining uploaded results", async () => {
  vi.useFakeTimers();
  const { t, args, row } = await fixture();
  const makeResult = () => t.run((ctx) => ctx.storage.store(new Blob(["{}"])));
  const storageId = await makeResult();
  const finish = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey: args.invocationKey,
    fingerprint: "e".repeat(64),
    status: "succeeded" as const,
    storageId,
  };
  expect(await t.mutation(internal.routerJobs.finish, finish)).toBe(false);
  expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  await t.mutation(internal.routerJobs.cancel, { id: row._id });
  const cancelledResultId = await makeResult();
  expect(
    await t.mutation(internal.routerJobs.finish, {
      ...finish,
      fingerprint: args.fingerprint,
      storageId: cancelledResultId,
    }),
  ).toBe(false);
  expect(await t.run((ctx) => ctx.storage.get(cancelledResultId))).toBeNull();
  expect(
    await t.query(internal.routerJobs.authorize, {
      tokenHash: args.resultTokenHash,
      purpose: "result",
    }),
  ).toBeNull();
});

test("cleanup never expires active work and retains a terminal idempotency tombstone", async () => {
  vi.useFakeTimers();
  const { t, args, row } = await fixture();
  vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
  await t.mutation(internal.routerJobs.cleanup, { id: row._id });
  expect(
    await t.run(async (ctx) =>
      Boolean(await ctx.storage.get(args.requestStorageId)),
    ),
  ).toBe(true);
  await t.mutation(internal.routerJobs.cancel, { id: row._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const terminal = await t.query(internal.routerJobs.get, {
    invocationKey: args.invocationKey,
  });
  expect(terminal?.status).toBe("cancelled");
  expect(terminal?.requestStorageId).toBeUndefined();
  expect(terminal?.requestToken).toBe("");
  expect(
    await t.run((ctx) => ctx.storage.get(args.requestStorageId)),
  ).toBeNull();
});

test("upload cleanup preserves adopted blobs after a lost mutation acknowledgement", async () => {
  const { t, args } = await fixture();
  const orphan = await t.run((ctx) => ctx.storage.store(new Blob(["orphan"])));
  await t.mutation(internal.routerJobs.cleanupUploads, {
    invocationKey: args.invocationKey,
    storageIds: [args.requestStorageId, orphan],
  });
  expect(
    await t.run(async (ctx) =>
      Boolean(await ctx.storage.get(args.requestStorageId)),
    ),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.storage.get(orphan))).toBeNull();
});

test("streams ordered snapshots only to the active message and rejects stale or foreign callbacks", async () => {
  const { t, args, row } = await fixture();
  const target = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { name: "Client" });
    const userId = await ctx.db.insert("users", { name: "Viewer" });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      createdBy: userId,
      title: "Chat",
      lastMessageAt: 0,
    });
    const id = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
    });
    await ctx.db.patch(row._id, { streamTarget: id });
    return id;
  });
  const progress = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey: args.invocationKey,
    fingerprint: args.fingerprint,
    sequence: 2,
    text: "The renewal costs",
  };
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      tokenHash: "wrong",
    }),
  ).toBe(false);
  expect(await t.mutation(internal.routerJobs.progress, progress)).toBe(true);
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      sequence: 1,
      text: "The",
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      jobId: "another",
      sequence: 3,
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(target)))?.content).toBe(
    "The renewal costs",
  );
  await t.run((ctx) =>
    ctx.db.patch(target, {
      status: "cancelled",
      content: "Response cancelled.",
    }),
  );
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      sequence: 3,
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(target)))?.content).toBe(
    "Response cancelled.",
  );
});

test("terminal jobs never replace the final reply with delayed progress", async () => {
  vi.useFakeTimers();
  const { t, row, args } = await fixture();
  const target = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { name: "Client" });
    const userId = await ctx.db.insert("users", { name: "Viewer" });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      createdBy: userId,
      title: "Chat",
      lastMessageAt: 0,
    });
    const id = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
    });
    await ctx.db.patch(row._id, { streamTarget: id });
    return id;
  });
  await t.mutation(internal.routerJobs.cancel, { id: row._id });
  expect(
    await t.mutation(internal.routerJobs.progress, {
      id: row._id,
      tokenHash: args.resultTokenHash,
      jobId: "router-1",
      invocationKey: args.invocationKey,
      fingerprint: args.fingerprint,
      sequence: 1,
      text: "late",
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(target)))?.content).toBe("");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

// A returned model is evidence; a routing preference is not. Replayed responses
// must not duplicate rows, and cancelled messages must not gain new activity.
test.each(["processing", "cancelled"] as const)(
  "records the executed model only for a %s message",
  async (status) => {
    const { t, args, row } = await fixture();
    const target = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { name: "Client" });
      const userId = await ctx.db.insert("users", { name: "Viewer" });
      const threadId = await ctx.db.insert("threads", {
        orgId,
        createdBy: userId,
        title: "Chat",
        lastMessageAt: 0,
      });
      return ctx.db.insert("threadMessages", {
        orgId,
        threadId,
        channel: "chat",
        role: "agent",
        content: "",
        status,
      });
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([JSON.stringify(generation)])),
    );
    await t.mutation(internal.routerJobs.finish, {
      id: row._id,
      tokenHash: args.resultTokenHash,
      jobId: "router-model",
      invocationKey: args.invocationKey,
      fingerprint: args.fingerprint,
      status: "succeeded",
      storageId,
    });
    for (let replay = 0; replay < 2; replay += 1) {
      await t.action(async (ctx) => {
        await generateAgentTextForPublicTask(
          ctx,
          "chat",
          { prompt: "Hello" },
          {
            taskKind: "operator_agent",
            streamTarget: target,
            durable: { invocationKey: "test:run:step" },
            sessionKey: "model-activity",
            trace: {
              traceId: "model-activity",
              label: "model-activity",
              phase: "test",
              channel: "web",
            },
          },
        );
      });
    }
    const message = await t.run((ctx) => ctx.db.get(target));
    expect(message?.activity?.stages ?? []).toEqual(
      status === "cancelled"
        ? []
        : [
            {
              stageId: `model:${generation.requestId}`,
              stage: "selecting_model",
              status: "completed",
              detail: "openai · fixture-live-model",
            },
          ],
    );
  },
);

test("operator streaming survives durable polling yields but fences approval waits and old checkpoints", async () => {
  const { t, args, row } = await fixture();
  const { runId, messageId, invocationKey } = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { name: "Operator" });
    const threadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId,
      visibility: "private",
      channel: "chat",
      title: "Task",
      lastMessageAt: 0,
      createdAt: 0,
      updatedAt: 0,
    });
    const messageId = await ctx.db.insert("operatorAgentMessages", {
      ownerUserId,
      threadId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
      createdAt: 0,
      updatedAt: 0,
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      operatorUserId: ownerUserId,
      threadId,
      userMessageId: messageId,
      agentMessageId: messageId,
      objective: "Task",
      status: "queued",
      checkpoint: { iteration: 0, executionCount: 0 },
      createdAt: 0,
      updatedAt: 0,
    });
    const invocationKey = `operator:${runId}:0:0`;
    await ctx.db.patch(row._id, { streamTarget: messageId, invocationKey });
    return { runId, messageId, invocationKey };
  });
  const progress = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey,
    fingerprint: args.fingerprint,
    sequence: 1,
    text: "Live reply",
  };
  expect(await t.mutation(internal.routerJobs.progress, progress)).toBe(true);
  await t.run((ctx) => ctx.db.patch(runId, { status: "waiting_confirmation" }));
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      sequence: 2,
    }),
  ).toBe(false);
  await t.run((ctx) =>
    ctx.db.patch(runId, {
      status: "running",
      checkpoint: { iteration: 1, executionCount: 0 },
    }),
  );
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      sequence: 2,
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(messageId)))?.content).toBe(
    "Live reply",
  );
});
