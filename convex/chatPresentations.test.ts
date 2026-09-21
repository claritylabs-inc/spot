/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  capturePresentationTool,
  visiblePresentation,
} from "./chatPresentations";
import type { ChatPresentation } from "../lib/chat-presentation";

const { compose } = vi.hoisted(() => ({ compose: vi.fn() }));
vi.mock("./lib/chatPresentationComposer", () => ({
  composeChatPresentation: compose,
}));

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  compose.mockReset();
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
  ).toBeNull();
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
  ).toBe(`/connect/vendors/${ids.vendorId}`);
  await f.t.run((ctx) => ctx.db.patch(ids.connectionId, { status: "revoked" }));
  expect(
    (await owner.query(api.threads.messages, { threadId: f.threadId })).at(-1)
      ?.presentation,
  ).toBeUndefined();
});

test("long histories preserve every text message while newest presentations receive the bounded read budget", async () => {
  const f = await clientFixture();
  await f.t.run(async (ctx) => {
    for (let index = 0; index < 30; index++) {
      const id = await ctx.db.insert("threadMessages", {
        threadId: f.threadId,
        orgId: f.orgId,
        role: "agent",
        channel: "chat",
        content: `Answer ${index}`,
        presentationRevision: 1,
      });
      await ctx.db.patch(id, {
        presentation: { ...f.presentation, sourceRevision: `${id}:1` },
      });
    }
  });
  const messages = await f.t
    .withIdentity({ subject: `${f.userId}|session` })
    .query(api.threads.messages, { threadId: f.threadId });
  expect(messages).toHaveLength(32);
  expect(messages.filter((message) => message.presentation)).toHaveLength(24);
  expect(messages.at(-1)).toMatchObject({
    content: "Answer 29",
    presentation: { version: 1 },
  });
  expect(messages[2]).toMatchObject({ content: "Answer 0" });
  expect(messages[2].presentation).toBeUndefined();
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
