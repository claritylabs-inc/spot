/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  appendCapturedPresentationTool,
  capturePresentationTool,
  type CapturedPresentationTool,
  visiblePresentation,
} from "./chatPresentations";
import type { ChatPresentation } from "../lib/chat-presentation";

const { compose, generate } = vi.hoisted(() => ({
  compose: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("./lib/models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/models")>()),
  generateAgentTextForOperatorTask: generate,
}));
vi.mock("./lib/clRouterClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/clRouterClient")>()),
  clRouterDecide: vi.fn(
    async (request: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(
        Object.keys(request.questions).map((family) => [
          family,
          { type: "noul", noul: 1 },
        ]),
      ),
    }),
  ),
}));
vi.mock("./lib/chatPresentationComposer", () => ({
  composeChatPresentation: compose,
}));

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  compose.mockReset();
  generate.mockReset();
});

async function clientFixture() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "client@example.com",
    });
    const outsiderId = await ctx.db.insert("users", {
      email: "other@example.com",
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const otherOrgId = await ctx.db.insert("organizations", {
      name: "Other",
      type: "client",
    });
    const membershipId = await ctx.db.insert("orgMemberships", {
      userId,
      orgId,
      role: "admin",
    });
    await ctx.db.insert("orgMemberships", {
      userId: outsiderId,
      orgId: otherOrgId,
      role: "admin",
    });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      createdBy: userId,
      title: "Coverage",
      lastMessageAt: 1,
    });
    const userMessageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      userId,
      channel: "chat",
      role: "user",
      content: "Show requirements",
    });
    const messageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
      replyToMessageId: userMessageId,
      agentRunStartedAt: 1,
    });
    const requirementId = await ctx.db.insert("insuranceRequirements", {
      orgId,
      title: "Liability",
      requirementText: "$1 million",
      kind: "coverage",
      scope: "own_org",
      status: "active",
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    return {
      userId,
      outsiderId,
      orgId,
      otherOrgId,
      threadId,
      userMessageId,
      messageId,
      requirementId,
      membershipId,
    };
  });
  const tool = capturePresentationTool("lookup_compliance_requirements", {
    requirements: [
      {
        requirementId: ids.requirementId,
        orgId: ids.orgId,
        title: "Liability",
        requirementText: "$1 million",
      },
    ],
  });
  if (!tool) throw new Error("Expected structured requirement evidence");
  await t.mutation(internal.threads.updateAgentMessage, {
    id: ids.messageId,
    content: "Your liability requirement is $1 million.",
    presentationTools: [tool],
  });
  const sourceRevision = `${ids.messageId}:1`;
  const presentation: ChatPresentation = {
    version: 1,
    sourceRevision,
    createdAt: dayjs().valueOf(),
    references: [
      {
        id: "requirement",
        kind: "requirement",
        recordId: ids.requirementId,
        label: "Liability",
      },
    ],
    spec: {
      root: "facts",
      elements: {
        facts: {
          type: "FactList",
          props: {
            facts: [
              {
                label: "Liability",
                value: "$1 million",
                sourceIds: ["requirement"],
              },
            ],
          },
          children: [],
        },
      },
    },
  };
  return { t, ...ids, sourceRevision, presentation };
}

test("persisted presentations reconnect through authorized queries and disappear when referenced access is revoked", async () => {
  const f = await clientFixture();
  expect(
    await f.t.mutation(internal.chatPresentations.save, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
      presentation: f.presentation,
    }),
  ).toBe(true);
  const owner = f.t.withIdentity({ subject: `${f.userId}|session` });
  expect(
    (await owner.query(api.threads.messages, { threadId: f.threadId })).at(-1)
      ?.presentation,
  ).toMatchObject(f.presentation);
  await expect(
    f.t.query(api.threads.messages, { threadId: f.threadId }),
  ).rejects.toThrow();
  expect(
    await f.t
      .withIdentity({ subject: `${f.outsiderId}|session` })
      .query(api.threads.messages, { threadId: f.threadId }),
  ).toEqual([]);
  await f.t.run((ctx) =>
    ctx.db.patch(f.requirementId, { orgId: f.otherOrgId }),
  );
  const message = (
    await owner.query(api.threads.messages, { threadId: f.threadId })
  ).at(-1);
  expect(message?.presentation).toBeUndefined();
  expect(message?.content).toBe("Your liability requirement is $1 million.");
});

test("revision, cancellation, removal and membership fences reject late composition without rewriting text", async () => {
  const f = await clientFixture();
  const args = {
    messageId: f.messageId,
    sourceRevision: f.sourceRevision,
    presentation: f.presentation,
  };
  expect(
    await f.t.query(internal.chatPresentations.load, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
    }),
  ).not.toBeNull();
  await f.t.mutation(internal.threads.updateAgentMessage, {
    id: f.messageId,
    content: "Revised answer",
  });
  expect(await f.t.mutation(internal.chatPresentations.save, args)).toBe(false);
  await f.t.run((ctx) =>
    ctx.db.patch(f.messageId, { presentationRevision: 1, status: "cancelled" }),
  );
  expect(await f.t.mutation(internal.chatPresentations.save, args)).toBe(false);
  await f.t.run((ctx) => ctx.db.patch(f.messageId, { status: undefined }));
  await f.t.run((ctx) => ctx.db.delete(f.membershipId));
  expect(await f.t.mutation(internal.chatPresentations.save, args)).toBe(false);
  expect((await f.t.run((ctx) => ctx.db.get(f.messageId)))?.content).toBe(
    "Revised answer",
  );
  await f.t.run((ctx) => ctx.db.delete(f.messageId));
  expect(await f.t.mutation(internal.chatPresentations.save, args)).toBe(false);
});

test("client persistence rejects operator references and cross-organization facts", async () => {
  const f = await clientFixture();
  for (const kind of ["proposal", "provider"] as const) {
    const presentation = {
      ...f.presentation,
      references: [{ ...f.presentation.references[0], kind }],
    };
    expect(
      await f.t.mutation(internal.chatPresentations.save, {
        messageId: f.messageId,
        sourceRevision: f.sourceRevision,
        presentation,
      }),
    ).toBe(false);
  }
  await f.t.run((ctx) =>
    ctx.db.patch(f.requirementId, { orgId: f.otherOrgId }),
  );
  expect(
    await f.t.mutation(internal.chatPresentations.save, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
      presentation: f.presentation,
    }),
  ).toBe(false);
});

test("temporary evidence expiry leaves the completed answer intact", async () => {
  const f = await clientFixture();
  const evidence = await f.t.run((ctx) =>
    ctx.db.query("chatPresentationEvidence").first(),
  );
  if (!evidence) throw new Error("Missing temporary evidence");
  vi.setSystemTime(evidence.expiresAt + 1);
  expect(
    await f.t.query(internal.chatPresentations.load, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
    }),
  ).toBeNull();
  await f.t.mutation(internal.chatPresentations.cleanup, { id: evidence._id });
  expect(await f.t.run((ctx) => ctx.db.get(evidence._id))).toBeNull();
  expect(await f.t.run((ctx) => ctx.db.get(f.messageId))).toMatchObject({
    content: "Your liability requirement is $1 million.",
  });
  expect(
    (await f.t.run((ctx) => ctx.db.get(f.messageId)))?.status,
  ).toBeUndefined();
});

test("capture retains complete bounded domain values but excludes failed results, tool inputs, secrets and provider payloads", () => {
  const output = {
    status: "succeeded",
    result: {
      policyId: "policy",
      carrier: "Carrier",
      summary: "e".repeat(1500),
      token: "secret",
      downloadUrl: "https://private.example",
      providerPayload: { text: "private" },
    },
  };
  const captured = capturePresentationTool("get_policy_status", output);
  expect(JSON.parse(captured!.outputJson)).toEqual({
    policyId: "policy",
    carrier: "Carrier",
    summary: "e".repeat(1500),
  });
  expect(
    capturePresentationTool("get_policy_status", {
      status: "failed",
      result: output.result,
    }),
  ).toBeNull();
  expect(capturePresentationTool("call_mcp_tool", output)).toBeNull();
  expect(
    capturePresentationTool(
      "lookup_compliance_requirements",
      "Assistant prose is not typed evidence",
    ),
  ).toBeNull();
  expect(
    capturePresentationTool(
      "lookup_policy",
      Array.from({ length: 40 }, () => ({ summary: "x".repeat(4000) })),
    ),
  ).toEqual({ name: "lookup_policy", outputJson: '{"bounded":true}' });
});

test("operator attempts fence evidence and duplicate completions cannot replay or schedule another presentation", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "operator@example.com",
      accountKind: "operator",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const threadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId: userId,
      visibility: "private",
      channel: "chat",
      title: "Policies",
      lastMessageAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const userMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: userId,
      role: "user",
      channel: "chat",
      content: "Show policy",
      createdAt: 1,
      updatedAt: 1,
    });
    const messageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: userId,
      role: "agent",
      channel: "chat",
      content: "",
      status: "processing",
      replyToMessageId: userMessageId,
      createdAt: 1,
      updatedAt: 1,
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      threadId,
      operatorUserId: userId,
      userMessageId,
      agentMessageId: messageId,
      objective: "Show policy",
      status: "running",
      runnerAttempt: 2,
      checkpoint: { iteration: 3, executionCount: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId, profileId, threadId, messageId, runId };
  });
  const tool = capturePresentationTool("get_policy_status", {
    policyId: "policy",
    carrier: "Carrier",
  })!;
  const capture = { runId: ids.runId, expectedCheckpointIteration: 3, tool };
  await t.mutation(internal.chatPresentations.captureOperatorEvidence, {
    ...capture,
    expectedRunnerAttempt: 1,
  });
  expect(
    await t.run((ctx) => ctx.db.query("chatPresentationEvidence").first()),
  ).toBeNull();
  await t.mutation(internal.chatPresentations.captureOperatorEvidence, {
    ...capture,
    expectedRunnerAttempt: 2,
  });
  const completion = {
    runId: ids.runId,
    expectedCheckpointIteration: 3,
    expectedRunnerAttempt: 2,
    content: "Completed answer",
    usedTools: ["get_policy_status"],
    toolCalls: [],
  };
  expect(
    await t.mutation(internal.operatorAgent.completeRunInternal, completion),
  ).toEqual({ status: "completed" });
  expect(
    await t.mutation(internal.operatorAgent.completeRunInternal, completion),
  ).toEqual({ status: "not_completed" });
  const args = {
    messageId: ids.messageId,
    sourceRevision: `${ids.messageId}:1`,
  };
  expect(
    (await t.query(internal.chatPresentations.load, args))?.evidence.tools,
  ).toEqual([
    {
      name: "get_policy_status",
      output: { policyId: "policy", carrier: "Carrier" },
    },
  ]);
  await t.run((ctx) => ctx.db.patch(ids.profileId, { status: "disabled" }));
  await expect(
    t.query(internal.chatPresentations.load, args),
  ).rejects.toThrow();
  expect((await t.run((ctx) => ctx.db.get(ids.runId)))?.status).toBe(
    "completed",
  );
  expect((await t.run((ctx) => ctx.db.get(ids.messageId)))?.content).toBe(
    "Completed answer",
  );
});

test("request file visibility is authorized through its current association, independently from general file visibility", async () => {
  const f = await clientFixture();
  const ids = await f.t.run(async (ctx) => {
    const fileId = await ctx.storage.store(new Blob(["evidence"]));
    const clientFileId = await ctx.db.insert("clientFiles", {
      orgId: f.orgId,
      fileId,
      name: "Requirements.pdf",
      originalName: "Requirements.pdf",
      contentType: "application/pdf",
      size: 8,
      clientVisible: false,
      uploadedBySide: "operator",
      nameSource: "original",
      nameStatus: "ready",
      createdAt: 1,
      updatedAt: 1,
    });
    const requestId = await ctx.db.insert("procurementRequests", {
      clientOrgId: f.orgId,
      title: "Renewal",
      status: "submitted",
      clientVisible: true,
      inboxToken: "request",
      createdByUserId: f.userId,
      updatedByUserId: f.userId,
      createdAt: 1,
      updatedAt: 1,
    });
    const itemId = await ctx.db.insert("procurementFileItems", {
      requestId,
      clientOrgId: f.orgId,
      clientFileId,
      label: "Requirements",
      clientVisible: true,
      createdAt: 1,
      updatedAt: 1,
    });
    return { clientFileId, requestId, itemId };
  });
  const presentation: ChatPresentation = {
    ...f.presentation,
    references: [
      {
        id: "file",
        kind: "file",
        recordId: ids.clientFileId,
        requestId: ids.requestId,
        label: "Requirements",
        page: 3,
        href: "/operator/settings",
      },
    ],
    spec: {
      root: "file",
      elements: {
        file: {
          type: "FileReference",
          props: { referenceId: "file" },
          children: [],
        },
      },
    },
  };
  expect(
    await f.t.mutation(internal.chatPresentations.save, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
      presentation,
    }),
  ).toBe(true);
  const stored = await f.t.run((ctx) => ctx.db.get(f.messageId));
  expect(stored?.presentation?.references[0].page).toBe(3);
  const owner = f.t.withIdentity({ subject: `${f.userId}|session` });
  const messages = () =>
    owner.query(api.threads.messages, { threadId: f.threadId });
  expect((await messages()).at(-1)?.presentation?.references[0].href).toBe(
    `/requests/${ids.requestId}`,
  );
  await f.t.run((ctx) => ctx.db.patch(ids.itemId, { clientVisible: false }));
  expect((await messages()).at(-1)?.presentation).toBeUndefined();
  await f.t.run((ctx) => ctx.db.patch(ids.itemId, { clientVisible: true }));
  await f.t.run((ctx) => ctx.db.patch(ids.requestId, { clientVisible: false }));
  expect((await messages()).at(-1)?.presentation).toBeUndefined();
});

test("composition failure preserves completed text and never re-enters the business runner", async () => {
  const f = await clientFixture();
  compose.mockRejectedValue(new Error("Decision service unavailable"));
  const before = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  await f.t.action(internal.actions.chatPresentations.compose, {
    messageId: f.messageId,
    sourceRevision: f.sourceRevision,
  });
  expect(compose).toHaveBeenCalledOnce();
  const message = await f.t.run((ctx) => ctx.db.get(f.messageId));
  expect(message?.content).toBe("Your liability requirement is $1 million.");
  expect(message?.status).toBeUndefined();
  expect(message?.presentation).toBeUndefined();
  const after = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(after).toEqual(before);
  expect(
    await f.t.run((ctx) => ctx.db.query("threadMessages").collect()),
  ).toHaveLength(2);
});

test("vendor selectors disappear when the current connection is revoked", async () => {
  const f = await clientFixture();
  const ids = await f.t.run(async (ctx) => {
    const vendorId = await ctx.db.insert("organizations", {
      name: "Vendor",
      type: "client",
    });
    const connectionId = await ctx.db.insert("connectedOrgRelationships", {
      clientOrgId: f.orgId,
      vendorOrgId: vendorId,
      status: "active",
      requestedByUserId: f.userId,
      createdAt: 1,
      updatedAt: 1,
    });
    return { vendorId, connectionId };
  });
  const presentation: ChatPresentation = {
    ...f.presentation,
    references: [
      { id: "vendor", kind: "vendor", recordId: ids.vendorId, label: "Vendor" },
    ],
    spec: {
      root: "vendor",
      elements: {
        vendor: {
          type: "RecordSelector",
          props: {
            label: "Which vendor?",
            referenceIds: ["vendor"],
            submitLabel: "Continue",
          },
          children: [],
        },
      },
    },
  };
  expect(
    await f.t.mutation(internal.chatPresentations.save, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
      presentation,
    }),
  ).toBe(true);
  const owner = f.t.withIdentity({ subject: `${f.userId}|session` });
  expect(
    (await owner.query(api.threads.messages, { threadId: f.threadId })).at(-1)
      ?.presentation?.references[0].href,
  ).toBe(`/connect/vendors/${ids.vendorId}/policies`);
  await f.t.run((ctx) => ctx.db.patch(ids.connectionId, { status: "revoked" }));
  expect(
    (await owner.query(api.threads.messages, { threadId: f.threadId })).at(-1)
      ?.presentation,
  ).toBeUndefined();
});

test("source references require the current requirement document or verified provider source set", async () => {
  const f = await clientFixture();
  const sourceUrl = "https://provider.example/about";
  const ids = await f.t.run(async (ctx) => {
    const documentId = await ctx.db.insert("requirementSourceDocuments", {
      orgId: f.orgId,
      sourceType: "client_contract",
      title: "Contract",
      status: "complete",
      createdByUserId: f.userId,
      createdAt: 1,
      updatedAt: 1,
    });
    const providerId = await ctx.db.insert("organizations", {
      name: "Provider",
      type: "broker",
      companyResearch: {
        version: "public-company-v3",
        fingerprint: "identity",
        status: "completed",
        attempts: 1,
        unresolvedFields: [],
        sourceUrls: [sourceUrl],
        facts: [
          { key: "profile", content: "Insurance agency", sourceRef: sourceUrl },
        ],
        updatedAt: 1,
      },
    });
    return { documentId, providerId };
  });
  const sourcePresentation = (
    recordId: string,
    url?: string,
  ): ChatPresentation => ({
    ...f.presentation,
    references: [
      {
        id: "source",
        kind: "source",
        recordId,
        label: "Source",
        ...(url ? { sourceUrl: url } : {}),
      },
    ],
    spec: {
      root: "source",
      elements: {
        source: {
          type: "SourceReference",
          props: { referenceId: "source" },
          children: [],
        },
      },
    },
  });
  const read = (
    presentation: ChatPresentation,
    audience: "client" | "operator",
  ) =>
    f.t.run(async (ctx) => {
      const message = await ctx.db.get(f.messageId);
      if (!message) throw new Error("Missing response");
      return visiblePresentation(
        ctx,
        { ...message, presentation },
        { audience, orgId: f.orgId },
      );
    });
  const document = sourcePresentation(ids.documentId);
  expect(await read(document, "client")).toBeDefined();
  await f.t.run((ctx) => ctx.db.patch(ids.documentId, { archivedAt: 2 }));
  expect(await read(document, "client")).toBeNull();
  const provider = sourcePresentation(ids.providerId, sourceUrl);
  expect((await read(provider, "operator"))?.references[0].sourceUrl).toBe(
    sourceUrl,
  );
  expect(await read(provider, "client")).toBeNull();
  expect(
    await read(
      sourcePresentation(ids.providerId, "https://other.example"),
      "operator",
    ),
  ).toBeNull();
  await f.t.run(async (ctx) => {
    const org = await ctx.db.get(ids.providerId);
    if (!org?.companyResearch) throw new Error("Missing research");
    await ctx.db.patch(ids.providerId, {
      companyResearch: { ...org.companyResearch, facts: [] },
    });
  });
  expect(await read(provider, "operator")).toBeNull();
});

test("connected client requirements and their source metadata revoke together without granting other owner requirements", async () => {
  const f = await clientFixture();
  const ids = await f.t.run(async (ctx) => {
    const sourceId = await ctx.db.insert("requirementSourceDocuments", {
      orgId: f.otherOrgId,
      sourceType: "client_contract",
      title: "Client requirements",
      status: "complete",
      createdByUserId: f.outsiderId,
      createdAt: 1,
      updatedAt: 1,
    });
    const relationshipId = await ctx.db.insert("connectedOrgRelationships", {
      clientOrgId: f.otherOrgId,
      vendorOrgId: f.orgId,
      status: "active",
      requestedByUserId: f.outsiderId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.patch(f.requirementId, {
      orgId: f.otherOrgId,
      scope: "vendors",
      sourceDocumentId: sourceId,
    });
    return { sourceId, relationshipId };
  });
  const presentation: ChatPresentation = {
    ...f.presentation,
    references: [
      ...f.presentation.references,
      {
        id: "source",
        kind: "source",
        recordId: ids.sourceId,
        label: "Client requirements",
      },
    ],
  };
  expect(
    await f.t.mutation(internal.chatPresentations.save, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
      presentation,
    }),
  ).toBe(true);
  const owner = f.t.withIdentity({ subject: `${f.userId}|session` });
  const messages = () =>
    owner.query(api.threads.messages, { threadId: f.threadId });
  expect(
    (await messages()).at(-1)?.presentation?.references.map((ref) => ref.href),
  ).toEqual([
    `/compliance?requirement=${f.requirementId}`,
    `/compliance?requirement=${f.requirementId}`,
  ]);
  await f.t.run((ctx) => ctx.db.patch(f.requirementId, { scope: "own_org" }));
  expect((await messages()).at(-1)?.presentation).toBeUndefined();
  await f.t.run((ctx) => ctx.db.patch(f.requirementId, { scope: "vendors" }));
  await f.t.run((ctx) =>
    ctx.db.patch(ids.relationshipId, { status: "revoked" }),
  );
  expect((await messages()).at(-1)?.presentation).toBeUndefined();
});

test("capture marks omitted evidence and preserves bounded markers through persistence projection", () => {
  const result = {
    policies: Array.from({ length: 41 }, (_, i) => ({ id: `policy${i}` })),
  };
  const captured = capturePresentationTool("lookup_policy", result)!;
  const output = JSON.parse(captured.outputJson);
  expect(output.bounded).toBe(true);
  expect(output.result.policies).toHaveLength(40);
  expect(capturePresentationTool(captured.name, output)).toEqual(captured);
  const long = capturePresentationTool("get_procurement_proposal", {
    _id: "proposal1",
    summary: "x".repeat(4001),
  })!;
  expect(JSON.parse(long.outputJson)).toEqual({
    result: { _id: "proposal1" },
    bounded: true,
  });
  const nested = {
    result: {
      result: {
        result: {
          result: {
            result: {
              result: {
                result: {
                  result: {
                    result: {
                      result: {
                        result: { result: { result: { summary: "Deep" } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  expect(
    JSON.parse(capturePresentationTool("lookup_policy", nested)!.outputJson)
      .bounded,
  ).toBe(true);
});

test("tool count and byte limits retain a partial marker without changing successful tool execution", () => {
  const tools: CapturedPresentationTool[] = [];
  for (let i = 0; i < 25; i++) {
    const tool = capturePresentationTool("get_policy_status", {
      policyId: `policy${i}`,
    })!;
    appendCapturedPresentationTool(tools, tool);
  }
  expect(tools).toHaveLength(24);
  expect(JSON.parse(tools[23].outputJson)).toEqual({
    result: { policyId: "policy23" },
    bounded: true,
  });
  const large: CapturedPresentationTool[] = [];
  for (let i = 0; i < 10; i++) {
    const tool = capturePresentationTool("lookup_policy", {
      policies: Array.from({ length: 5 }, () => ({
        id: `policy${i}`,
        summary: "x".repeat(3900),
      })),
    })!;
    appendCapturedPresentationTool(large, tool);
  }
  expect(large.length).toBeLessThan(10);
  expect(
    new TextEncoder().encode(JSON.stringify(large)).length,
  ).toBeLessThanOrEqual(128 * 1024);
  expect(JSON.parse(large.at(-1)!.outputJson).bounded).toBe(true);
});

test("a revised client answer replaces its evidence and fences the old composition callback", async () => {
  const f = await clientFixture();
  const replacement = capturePresentationTool("get_policy_status", {
    policyId: "new-policy",
    status: "processing",
  })!;
  await f.t.mutation(internal.threads.updateAgentMessage, {
    id: f.messageId,
    content: "The policy is processing.",
    presentationTools: [replacement],
  });
  expect(
    await f.t.query(internal.chatPresentations.load, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
    }),
  ).toBeNull();
  const loaded = await f.t.query(internal.chatPresentations.load, {
    messageId: f.messageId,
    sourceRevision: `${f.messageId}:2`,
  });
  expect(loaded?.evidence.tools).toEqual([
    { name: replacement.name, output: JSON.parse(replacement.outputJson) },
  ]);
});

test("the web operator loop captures authorized results before audit truncation and never replays after composition failure", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const name = "Provider ".repeat(150);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const brokerOrgId = await ctx.db.insert("organizations", {
      name,
      type: "broker",
    });
    return { userId, brokerOrgId };
  });
  const operator = t.withIdentity({ subject: `${ids.userId}|session` });
  const threadId = await operator.mutation(api.operatorAgent.createThread, {});
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    const input = { brokerOrgId: ids.brokerOrgId };
    const output =
      await options.tools.get_broker_network_profile.execute(input);
    expect(output.status).toBe("succeeded");
    return {
      text: "Retrieved provider.",
      route: { provider: "openai", model: "gpt-5.6-terra" },
      response: {
        messages: [{ role: "assistant", content: "Retrieved provider." }],
      },
      steps: [
        {
          toolCalls: [{ toolName: "get_broker_network_profile", input }],
          toolResults: [{ toolName: "get_broker_network_profile", output }],
        },
      ],
    };
  });
  generate.mockResolvedValueOnce({
    text: "The provider lookup completed.",
    steps: [],
  });
  const queued = await t.mutation(
    internal.operatorAgent.enqueueMessageInternal,
    {
      operatorUserId: ids.userId,
      threadId,
      channel: "chat",
      content: "Show provider",
      dedupeKey: "presentation-loop",
    },
  );
  await t.action(internal.operatorAgentRunner.run, { runId: queued.runId });
  await t.action(internal.operatorAgentRunner.run, { runId: queued.runId });
  const result = await t.query(
    internal.operatorAgent.getRunResultForOperatorInternal,
    {
      operatorUserId: ids.userId,
      runId: queued.runId,
    },
  );
  expect(result.run.status, JSON.stringify(result.run)).toBe("completed");
  const sourceRevision = `${result.run.agentMessageId}:1`;
  const input = await t.query(internal.chatPresentations.load, {
    messageId: result.run.agentMessageId,
    sourceRevision,
  });
  expect(input?.evidence.tools).toHaveLength(1);
  expect(input?.evidence.tools[0].output).toMatchObject({ broker: { name } });
  expect(result.response?.toolCalls?.[0].output?.length).toBeLessThan(
    name.length,
  );
  compose.mockRejectedValueOnce(new Error("Decision service unavailable"));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await t.action(internal.actions.chatPresentations.compose, {
      messageId: result.run.agentMessageId,
      sourceRevision,
    });
  } finally {
    warning.mockRestore();
  }
  await t.action(internal.operatorAgentRunner.run, { runId: queued.runId });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(compose).toHaveBeenCalledTimes(1);
  expect((await t.run((ctx) => ctx.db.get(queued.runId)))?.status).toBe(
    "completed",
  );
  expect(
    await t.run((ctx) => ctx.db.get(result.run.agentMessageId)),
  ).toMatchObject({ content: "The provider lookup completed." });
});

test("plain client answers schedule no presentation work and clear earlier revision evidence", async () => {
  const f = await clientFixture();
  const scheduled = () =>
    f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const before = await scheduled();
  const plainMessageId = await f.t.run((ctx) =>
    ctx.db.insert("threadMessages", {
      threadId: f.threadId,
      orgId: f.orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
      replyToMessageId: f.userMessageId,
    }),
  );
  await f.t.mutation(internal.threads.updateAgentMessage, {
    id: plainMessageId,
    content: "Hello.",
    presentationTools: [],
  });
  expect(await scheduled()).toEqual(before);
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("chatPresentationEvidence")
        .withIndex("message", (q) => q.eq("messageId", plainMessageId))
        .unique(),
    ),
  ).toBeNull();
  await f.t.mutation(internal.threads.updateAgentMessage, {
    id: f.messageId,
    content: "A plain revised answer.",
    presentationTools: [],
  });
  expect(await scheduled()).toEqual(before);
  expect(
    await f.t.run((ctx) => ctx.db.query("chatPresentationEvidence").collect()),
  ).toEqual([]);
  expect(await f.t.run((ctx) => ctx.db.get(f.messageId))).toMatchObject({
    content: "A plain revised answer.",
    presentationRevision: 2,
  });
  expect(
    await f.t.mutation(internal.chatPresentations.save, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
      presentation: f.presentation,
    }),
  ).toBe(false);
});

test("unbound vendor choices cannot bypass reference reauthorization", async () => {
  const f = await clientFixture();
  const presentation: ChatPresentation = {
    ...f.presentation,
    references: [],
    spec: {
      root: "choice",
      elements: {
        choice: {
          type: "ChoiceGroup",
          props: {
            label: "Which vendor?",
            options: [{ value: f.otherOrgId, label: "Other" }],
            submitLabel: "Continue",
          },
          children: [],
        },
      },
    },
  };
  expect(
    await f.t.mutation(internal.chatPresentations.save, {
      messageId: f.messageId,
      sourceRevision: f.sourceRevision,
      presentation,
    }),
  ).toBe(false);
  await f.t.run((ctx) => ctx.db.patch(f.messageId, { presentation }));
  const messages = await f.t
    .withIdentity({ subject: `${f.userId}|session` })
    .query(api.threads.messages, { threadId: f.threadId });
  expect(messages.at(-1)?.presentation).toBeUndefined();
});
