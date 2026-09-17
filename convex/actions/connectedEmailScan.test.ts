// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import type { DecisionQuestion, DecisionAnswer } from "../lib/decisions";
import { decideMailboxBatch } from "../lib/mailboxDecisions";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { MailboxAutomationDecision } from "../lib/mailboxAutomation";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  generate: vi.fn(),
  withClient: vi.fn(),
  importPolicy: vi.fn(),
  importRequirements: vi.fn(),
}));
vi.mock("../lib/sdkCallbacks", () => ({
  makeDecide:
    () =>
    async ({ signal, ...request }: Record<string, unknown>) => {
      const { clRouterDecide } = await import("../lib/clRouterClient");
      return clRouterDecide(request as Parameters<typeof clRouterDecide>[0], {
        abortSignal: signal as AbortSignal,
        environment: {
          CL_ROUTER_URL: "https://router.example.test",
          CL_ROUTER_SECRET: "test-only",
        },
        fetch: async (_url, options) =>
          Response.json(await mocks.decide(JSON.parse(String(options?.body)))),
      });
    },
}));
vi.mock("../lib/models", () => ({ generateObjectForOrg: mocks.generate }));
vi.mock("../lib/imapMailbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/imapMailbox")>()),
  withClient: mocks.withClient,
}));

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../actions/${path.slice(2)}` : path,
    load,
  ]),
);
const automation = {
  policyImports: true,
  requirementImports: true,
  companyMemory: true,
};
const messages = [
  { subject: "Company update", text: "Acme opened a new office.", files: [] },
  {
    subject: "Bound policy",
    text: "Attached is Acme's bound policy. Acme employs 25 people.",
    files: ["policy.pdf"],
  },
  {
    subject: "Lease insurance requirements",
    text: "Acme must carry liability insurance under the attached lease.",
    files: ["lease.pdf"],
  },
];
function decision(index: number): MailboxAutomationDecision {
  return {
    emailRef: String(index + 1),
    classification:
      index === 0
        ? "ignore"
        : index === 1
          ? "policy_document"
          : "insurance_requirements",
    confidence: 1,
    reason: "Explicit insurance intake evidence",
    policyGroups: index === 1 ? [{ filenames: ["policy.pdf"] }] : [],
    requirementFilenames: index === 2 ? ["lease.pdf"] : [],
    includeEmailBodyAsRequirements: false,
    requirementSourceType: index === 2 ? "lease_agreement" : null,
    requirementScope: index === 2 ? "own_org" : null,
    attentionTitle: null,
    attentionBody: null,
  };
}
function configure(mode: string, qualified = true) {
  vi.stubEnv(
    "SPOT_DECISION_POLICY",
    JSON.stringify({
      mode,
      families: qualified
        ? {
            "mailbox.classification": {
              threshold: 0.99,
              evaluationId: "test-only",
            },
          }
        : {},
    }),
  );
}
function response(
  questions: Record<string, DecisionQuestion>,
  uncertain = false,
) {
  const choices: Record<string, string> = {
    category_0: "ignore",
    category_1: "policy_document",
    category_2: "insurance_requirements",
    file_1_0: "policy",
    file_2_0: "requirements",
  };
  return {
    contractVersion: 1,
    requestId: "mailbox-test",
    model: "jev-1.13.0",
    durationMs: 1,
    usage: { inputTokens: 10, outputTokens: 5 },
    cost: { status: "unpriced", costNanoUsd: null },
    answers: Object.fromEntries(
      Object.entries(questions).map(([id, question]) => {
        if (question.type !== "choice") throw new Error("Expected choice");
        const selected =
          choices[id] ??
          (id.startsWith("scope_")
            ? "own_org"
            : id.startsWith("source_")
              ? "lease_agreement"
              : "no");
        return [
          id,
          {
            type: "choice",
            choice: selected,
            confidence: uncertain ? 0.5 : 1,
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((key) => [
                key,
                key === selected ? 1 : 0,
              ]),
            ),
          } satisfies DecisionAnswer,
        ];
      }),
    ),
  };
}
async function seed(settings = automation, count = messages.length) {
  const t = convexTest(schema, {
    ...modules,
    "../actions/connectedEmail.ts": async () => {
      const { internalAction } = await import("../_generated/server");
      return {
        importPolicyAttachmentsInternal: internalAction({
          handler: mocks.importPolicy,
        }),
        importRequirementAttachmentsInternal: internalAction({
          handler: mocks.importRequirements,
        }),
      };
    },
  });
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", { email: "owner@example.com" });
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
    const accountId = await ctx.db.insert("connectedEmailAccounts", {
      orgId,
      userId,
      scope: "user",
      emailAddress: "owner@example.com",
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "owner@example.com",
      encryptedPassword: "unused",
      status: "active",
      automation: settings,
      createdAt: 1,
      updatedAt: 1,
    });
    const wikiId = await ctx.db.insert("markdownDocuments", {
      orgId,
      kind: "company_wiki",
      filename: "company.md",
      markdown: "# Acme\nSaved manual company facts.",
      revision: 7,
      updatedAt: 1,
    });
    return { orgId, userId, accountId, wikiId };
  });
  mocks.withClient.mockImplementation(async (_account, run) =>
    run({
      mailboxOpen: async () => ({ uidValidity: BigInt(1), uidNext: count + 1 }),
      search: async () => Array.from({ length: count }, (_, i) => i + 1),
      fetchOne: async (uid: string) => {
        const message = messages[Number(uid) - 1];
        return {
          envelope: {
            subject: message.subject,
            from: [{ address: "broker@example.com" }],
            messageId: `<${uid}@example.com>`,
          },
          bodyStructure: {
            type: "multipart/mixed",
            childNodes: [
              { part: "1", type: "text/plain" },
              ...message.files.map((filename) => ({
                type: "application/pdf",
                disposition: "attachment",
                dispositionParameters: { filename },
                size: 100,
              })),
            ],
          },
        };
      },
      download: async (uid: string) => ({
        meta: { contentType: "text/plain" },
        content: (async function* () {
          yield Buffer.from(messages[Number(uid) - 1].text);
        })(),
      }),
    }),
  );
  mocks.importPolicy.mockResolvedValue({
    status: "imported",
    result: { policyId: "10000policies" },
  });
  mocks.importRequirements.mockImplementation(async (_ctx, args) => ({
    status: "imported",
    imports:
      args.filenames.length || args.includeEmailBody
        ? [{ requirementIds: ["10000insuranceRequirements"] }]
        : [],
  }));
  const scan = () =>
    t
      .withIdentity({ subject: `${ids.userId}|session` })
      .action(api.actions.connectedEmailScan.scanMailboxRange, {
        accountId: ids.accountId,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-17",
      });
  return { t, ...ids, scan };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.generate.mockImplementation(async (_ctx, _org, task, options) => {
    expect(task).toBe("mailbox_coordinator");
    expect(options.system).not.toContain("company_context");
    const decisions = JSON.parse(options.prompt).map(
      (_message: unknown, index: number) => decision(index),
    );
    return { object: options.schema.parse({ decisions }) };
  });
  mocks.decide.mockImplementation(async ({ questions }) => response(questions));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test.each(["legacy", "shadow", "active"])(
  "%s: old stored true never infers facts or writes wiki; imports still execute",
  async (mode) => {
    configure(mode);
    const { t, scan, orgId, userId } = await seed();
    const result = await scan();
    expect(result.processedCount).toBe(3);
    expect(result.attentionCount).toBe(0);
    expect(mocks.importPolicy).toHaveBeenCalledOnce();
    expect(mocks.importPolicy.mock.calls[0][1]).toMatchObject({
      orgId,
      userId,
      filenames: ["policy.pdf"],
    });
    expect(mocks.importRequirements).toHaveBeenCalledOnce();
    expect(mocks.importRequirements.mock.calls[0][1]).toMatchObject({
      orgId,
      userId,
      mailboxUserId: userId,
      filenames: ["lease.pdf"],
      scope: "own_org",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.decide).toHaveBeenCalledOnce();
    const stored = await t.run(async (ctx) => ({
      wiki: await ctx.db.query("markdownDocuments").collect(),
      items: await ctx.db.query("connectedEmailAutomationItems").collect(),
      messages: await ctx.db.query("threadMessages").collect(),
    }));
    expect(stored.wiki).toHaveLength(1);
    expect(stored.wiki[0]).toMatchObject({
      markdown: "# Acme\nSaved manual company facts.",
      revision: 7,
      updatedAt: 1,
    });
    expect(stored.items[0]).toMatchObject({
      classification: "ignore",
      status: "skipped",
      needsReview: false,
    });
    expect(
      stored.items.every((item) => item.wikiSectionKeys === undefined),
    ).toBe(true);
    expect(JSON.stringify(stored.messages)).not.toMatch(
      /company wiki|durable company fact/,
    );
    for (const [request] of mocks.decide.mock.calls) {
      expect(JSON.stringify(request)).not.toMatch(
        /companyMemory|company_context|extractCompanyMemory/,
      );
      expect(Object.keys(request.questions)).toHaveLength(14);
    }
  },
);

test("memory-only stored true is ineligible for background scans; explicit scan emits no alert", async () => {
  configure("legacy");
  const { t, scan, accountId, orgId, userId } = await seed(
    { ...automation, policyImports: false, requirementImports: false },
    1,
  );
  const receipt = await t.mutation(
    internal.connectedEmailAutomation.claimItemInternal,
    {
      accountId,
      orgId,
      userId,
      mailbox: "INBOX",
      uid: 99,
      messageKey: "historical-message",
      emailRef: "historical-ref",
      subject: "Old company update",
      classification: "company_context",
      confidence: 1,
      reason: "Historical company fact",
    },
  );
  await t.mutation(internal.connectedEmailAutomation.finishItemInternal, {
    itemId: receipt.itemId,
    status: "completed",
    wikiSectionKeys: ["operations"],
    actionSummary: "Company fact saved.",
  });
  const historical = await t.run((ctx) => ctx.db.get(receipt.itemId));
  expect(
    await t.action(internal.actions.connectedEmailScan.scanAccountInternal, {
      accountId,
    }),
  ).toEqual({ status: "automation_disabled" });
  expect(mocks.withClient).not.toHaveBeenCalled();
  expect(await scan()).toMatchObject({ attentionCount: 0, processedCount: 1 });
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.importPolicy).not.toHaveBeenCalled();
  expect(mocks.importRequirements).not.toHaveBeenCalled();
  expect(await t.run((ctx) => ctx.db.query("threads").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toEqual(
    [],
  );
  expect(await t.run((ctx) => ctx.db.get(receipt.itemId))).toEqual(historical);
});

test.each(["uncertain", "invalid_reference"])(
  "%s decisions use reasoning at the public scan callsite",
  async (variant) => {
    configure("active", false);
    mocks.decide.mockImplementation(async ({ questions }) => {
      const result = response(questions, variant === "uncertain");
      if (variant === "invalid_reference")
        result.answers.category_1 = {
          ...result.answers.category_1,
          choice: "company_context",
        };
      return result;
    });
    const { scan } = await seed();
    await scan();
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.importPolicy).toHaveBeenCalledOnce();
    expect(mocks.importRequirements).toHaveBeenCalledOnce();
  },
);

const decisionPolicy = {
  automation: { policyImports: true, requirementImports: true },
  alertOnly: false,
};

test("mailbox decision cancellation does not start reasoning or execute imports", async () => {
  configure("active");
  const controller = new AbortController();
  const fallback = vi.fn(async () => ({ decisions: [] }));
  mocks.decide.mockImplementation(async () => {
    controller.abort();
    throw new DOMException("Cancelled", "AbortError");
  });
  await expect(
    decideMailboxBatch(
      {} as ActionCtx,
      "org" as Id<"organizations">,
      decisionPolicy,
      [{ attachments: [] }],
      fallback,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(fallback).not.toHaveBeenCalled();
  expect(mocks.importPolicy).not.toHaveBeenCalled();
  expect(mocks.importRequirements).not.toHaveBeenCalled();
});

test.each(["questions", "serialized_body"])(
  "%s budget overflow retains full input for reasoning without sending an oversized decision request",
  async (budget) => {
    configure("active");
    const inputs: Parameters<typeof decideMailboxBatch>[3] =
      budget === "questions"
        ? [
            {
              attachments: Array.from({ length: 125 }, (_, i) => ({
                filename: `attachment-${i}.pdf`,
                contentType: "application/pdf",
              })),
            },
          ]
        : [{ attachments: [], subject: "é".repeat(3 * 1024 * 1024) }];
    const fallback = vi.fn(async () => ({ decisions: [decision(0)] }));
    const result = await decideMailboxBatch(
      {} as ActionCtx,
      "org" as Id<"organizations">,
      decisionPolicy,
      inputs,
      fallback,
    );
    expect(result.decisions).toEqual([decision(0)]);
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
    if (budget === "questions") expect(inputs[0].attachments).toHaveLength(125);
    else expect(inputs[0].subject).toHaveLength(3 * 1024 * 1024);
  },
);

test("unknown email and attachment references cannot import files", async () => {
  mocks.decide.mockRejectedValue(new Error("decision unavailable"));
  mocks.generate.mockImplementation(async () => ({
    object: {
      decisions: [
        decision(0),
        { ...decision(1), emailRef: "missing-message" },
        { ...decision(2), requirementFilenames: ["missing-file.pdf"] },
      ],
    },
  }));
  const { scan, t } = await seed();
  expect(await scan()).toMatchObject({ attentionCount: 2 });
  expect(mocks.importPolicy).not.toHaveBeenCalled();
  const args = mocks.importRequirements.mock.calls[0]?.[1];
  expect(args?.filenames).toEqual([]);
  expect(args?.includeEmailBody).toBe(false);
  const items = await t.run((ctx) =>
    ctx.db.query("connectedEmailAutomationItems").collect(),
  );
  expect(items[1]).toMatchObject({
    classification: "review_needed",
    needsReview: true,
  });
});

test("public connect validates the current settings contract before authentication", async () => {
  const t = convexTest(schema, modules);
  const orgId = await t.run((ctx) =>
    ctx.db.insert("organizations", { name: "Acme", type: "client" }),
  );
  const args = {
    orgId,
    emailAddress: "owner@example.com",
    host: "imap.example.com",
    port: 993,
    secure: true,
    username: "owner@example.com",
    password: "test-only",
    automation: decisionPolicy.automation,
  };
  await expect(
    t.action(api.actions.connectedEmail.connect, args),
  ).rejects.toThrow("AUTH_REQUIRED");
  await expect(
    t.action(api.actions.connectedEmail.connect, {
      ...args,
      automation: {
        ...args.automation,
        companyMemory: true,
      } as typeof args.automation,
    }),
  ).rejects.toThrow("companyMemory");
  expect(mocks.withClient).not.toHaveBeenCalled();
});
