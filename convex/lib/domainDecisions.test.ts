import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { DecisionAnswer } from "./decisions";
import {
  acceptedChoice,
  choiceQuestion,
  decisionState,
} from "./domainDecisionQuestions";
import {
  boundedToolDispatch,
  closedToolParameters,
} from "./boundedToolDispatch";
import { decideCertificateEvidence } from "./certificateDecisions";
import { decideProposalReview } from "./proposalDecisions";
import { decideMailboxBatch } from "./mailboxDecisions";
import {
  hasDurableCompanyFacts,
  reviewCompanyFacts,
} from "./companyMemoryDecisions";

const mock = vi.hoisted(() => ({
  answers: {} as Record<string, DecisionAnswer>,
  active: true,
  calls: [] as unknown[],
}));
vi.mock("./decisions", () => ({
  decideWithFallback: async (args: {
    accept: (answers: Record<string, DecisionAnswer>) => unknown;
    fallback: () => Promise<unknown>;
  }) => {
    mock.calls.push(args);
    return (
      (mock.active ? args.accept(mock.answers) : undefined) ?? args.fallback()
    );
  },
}));
const ctx = {} as ActionCtx;
const orgId = "org" as Id<"organizations">;
function choice(value: string, confidence = 0.999): DecisionAnswer {
  return {
    type: "choice",
    choice: value,
    confidence,
    probabilities: { [value]: confidence, __abstain: 1 - confidence },
  };
}
beforeEach(() => {
  mock.answers = {};
  mock.active = true;
  mock.calls = [];
});

test("nested question criteria remain structured and raw distributions are not replaced by reasoning confidence", () => {
  const criteria = {
    candidate: { definition: ["a", { enabled: true, size: 3, missing: null }] },
  };
  expect(choiceQuestion("Select evidence", criteria).criteria).toMatchObject(
    criteria,
  );
  expect(decisionState({ nested: criteria, missing: undefined })).toEqual({
    nested: criteria,
  });
  expect(acceptedChoice({ type: "noul", noul: 1 }, ["yes"])).toBeUndefined();
  for (const answer of [
    choice("missing"),
    choice("__abstain"),
    choice("valid", 0.5),
    choice("valid", Number.NaN),
  ]) {
    expect(acceptedChoice(answer, ["valid"])).toBeUndefined();
  }
});

describe("certificate evidence gate", () => {
  const fallback = vi.fn(async () => ({
    status: "held" as const,
    reasonCode: "ambiguous_policy_evidence" as const,
    reasonMessage: "Reasoning needs broker review",
    requiredChanges: ["additional_insured", "waiver"],
    evidenceIds: [],
  }));
  const args = () => ({
    ctx,
    orgId,
    requiredChanges: ["additional_insured", "waiver"],
    certificateHolder: "Tenant Inc",
    evidencePacket: [
      { evidenceId: "E1", text: "Scheduled additional insured Tenant Inc." },
      { evidenceId: "E2", text: "Waiver granted to Tenant Inc." },
    ],
    fallback,
  });
  test("every requested change must resolve to an existing evidence candidate", async () => {
    mock.answers = { change_0: choice("E1"), change_1: choice("E2") };
    expect(await decideCertificateEvidence(args())).toMatchObject({
      status: "allowed",
      evidenceIds: ["E1", "E2"],
    });
    for (const missing of [
      undefined,
      choice("forged_evidence"),
      choice("E2", 0.7),
    ]) {
      mock.answers = {
        change_0: choice("E1"),
        ...(missing ? { change_1: missing } : {}),
      };
      expect(await decideCertificateEvidence(args())).toMatchObject({
        status: "held",
        reasonMessage: "Reasoning needs broker review",
      });
    }
  });
  test("explicit endorsement requirement never becomes an issuance approval", async () => {
    mock.answers = {
      change_0: choice("E1"),
      change_1: choice("change_required"),
    };
    expect(await decideCertificateEvidence(args())).toMatchObject({
      status: "held",
      reasonCode: "policy_change_required",
    });
  });
  test("shadow/legacy uses the original reasoning gate even for an apparently accepted choice", async () => {
    mock.active = false;
    mock.answers = { change_0: choice("E1"), change_1: choice("E2") };
    expect(await decideCertificateEvidence(args())).toMatchObject({
      status: "held",
      reasonMessage: "Reasoning needs broker review",
    });
  });
});

test("proposal review cannot omit sections or cite a tag absent from the visible document", async () => {
  const fallback = vi.fn(async () => ({
    conclusion: "insufficient_evidence" as const,
    findings: [],
  }));
  const args = {
    ctx,
    orgId,
    packetMarkdown: "## liability\n$1m limit\n## waiver\nWaiver required",
    proposalMarkdown: "[E1] $1m liability",
    sectionKeys: ["liability", "waiver"],
    legend: {
      E1: {
        proposalDocumentId: "doc",
        sourceNodeIds: [],
        sourceSpanIds: ["s1"],
      },
      E2: {
        proposalDocumentId: "doc",
        sourceNodeIds: [],
        sourceSpanIds: ["s2"],
      },
    },
    abortSignal: new AbortController().signal,
    fallback,
  };
  mock.answers = {
    section_0: choice("meets:E1"),
    section_1: choice("meets:E2"),
  };
  expect(await decideProposalReview(args)).toEqual(await fallback());
  mock.answers = {
    section_0: choice("meets:E1"),
    section_1: choice("has_gap:E1"),
  };
  expect(await decideProposalReview(args)).toMatchObject({
    conclusion: "has_gaps",
    findings: [{ sectionKey: "liability" }, { sectionKey: "waiver" }],
  });
});

describe("bounded dispatch preserves execution boundaries", () => {
  const step = () => ({
    messages: [{ role: "user" as const, content: "List current records" }],
    steps: [],
    stepNumber: 0,
    model: "test-model",
    experimental_context: undefined,
  });
  test("never fills an unconstrained string, reference, or number by guessing", () => {
    for (const field of [
      { type: "string" },
      { type: "number" },
      { $ref: "#/definitions/ID" },
    ]) {
      expect(
        closedToolParameters({
          type: "object",
          additionalProperties: false,
          properties: { value: field },
        }),
      ).toBeUndefined();
    }
  });
  test("preparation has no tool effects; actual execution retains registry checks and rejects changed arguments", async () => {
    const execute = vi.fn(async () => ({ status: "pending_confirmation" }));
    const original = {
      list: {
        description: "List records",
        inputSchema: z.object({
          scope: z.enum(["current", "archived"]),
          detailed: z.boolean().optional(),
        }),
        execute,
      },
    };
    const dispatched = boundedToolDispatch({ ctx, orgId, tools: original });
    mock.answers = {
      tool: choice("list"),
      arg_0_scope: choice("0"),
      arg_0_detailed: choice("omit"),
    };
    expect(await dispatched.prepareStep(step())).toMatchObject({
      activeTools: ["list"],
      toolChoice: { type: "tool", toolName: "list" },
    });
    expect(execute).not.toHaveBeenCalled();
    const options = { toolCallId: "call", messages: step().messages };
    await expect(
      dispatched.tools.list.execute!({ scope: "archived" }, options),
    ).rejects.toThrow("no action was executed");
    expect(execute).not.toHaveBeenCalled();
    expect(
      await dispatched.tools.list.execute!({ scope: "current" }, options),
    ).toEqual({ status: "pending_confirmation" });
    expect(execute).toHaveBeenCalledOnce();
    expect(
      original.list.inputSchema.safeParse({ scope: "archived" }).success,
    ).toBe(true);
  });
  test("uncertainty, rich inputs and an existing step owner leave reasoning in control", async () => {
    const tools = { list: { inputSchema: z.object({}), execute: vi.fn() } };
    const dispatched = boundedToolDispatch({ ctx, tools });
    expect(await dispatched.prepareStep(step())).toBeUndefined();
    mock.answers = { tool: choice("list") };
    expect(
      await dispatched.prepareStep({
        ...step(),
        messages: [
          {
            role: "user",
            content: [{ type: "image", image: "data:image/png;base64,AA==" }],
          },
        ],
      }),
    ).toBeUndefined();
    const owner = boundedToolDispatch({
      ctx,
      tools,
      prepareStep: () => ({ toolChoice: "none" }),
    });
    expect(await owner.prepareStep(step())).toEqual({ toolChoice: "none" });
  });
});

test("multi-PDF policy packages require reasoning rather than guessed grouping", async () => {
  const fallback = vi.fn(async () => ({ decisions: [] }));
  mock.answers = {
    category_0: choice("policy_document"),
    file_0_0: choice("policy"),
    file_0_1: choice("policy"),
  };
  expect(
    await decideMailboxBatch(
      ctx,
      orgId,
      {
        automation: {
          policyImports: true,
          requirementImports: false,
          companyMemory: false,
        },
        alertOnly: false,
      },
      [
        {
          subject: "Policy package",
          attachments: [
            { filename: "declarations.pdf", contentType: "application/pdf" },
            { filename: "endorsement.pdf", contentType: "application/pdf" },
          ],
        },
      ],
      fallback,
    ),
  ).toEqual({ decisions: [] });
  expect(fallback).toHaveBeenCalledOnce();
});

test("memory judgments preserve narrative provenance and escalate uncertain support", async () => {
  const facts = [
    {
      section: "notes",
      content: "Acme builds boats.",
      confidence: 0.93,
      sourceRef: "mail:1",
    },
  ];
  mock.answers = { support_0: choice("__abstain") };
  expect(
    await reviewCompanyFacts(
      ctx,
      orgId,
      { organizationName: "Acme", text: "We build boats." },
      facts,
    ),
  ).toEqual(facts);
  mock.answers = { support_0: choice("unsupported") };
  expect(
    await reviewCompanyFacts(
      ctx,
      orgId,
      { organizationName: "Acme", text: "Please send a certificate." },
      facts,
    ),
  ).toEqual([]);
  mock.answers = { presence: choice("no") };
  expect(
    await hasDurableCompanyFacts(
      ctx,
      orgId,
      "Acme",
      "Please send a certificate",
    ),
  ).toBe(false);
});
