import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import {
  availableClientAgentModules,
  buildClientAgentSystemPrompt,
  buildClientAgentTurnTools,
  fallbackClientAgentSelection,
  decideClientAgentTurn,
  filterToolsForModules,
  OPTIONAL_PROMPT_MODULES,
  type ClientAgentSurface,
} from "./clientAgentPrompt";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const decide = vi.mocked(clRouterDecide);
const ctx = { runMutation: vi.fn() } as unknown as ActionCtx;
const orgId = "org-cove" as Id<"organizations">;

const CORE_TOOLS = {
  search_thread_history: {},
  read_thread_attachment: {},
  lookup_policy: {},
  lookup_policy_section: {},
  lookup_company_context: {},
  compare_coverages: {},
  lookup_compliance_requirements: {},
  attach_policy_document: {},
  confirm_policy_fact: {},
  save_note: {},
};
const ALL_TOOLS = {
  ...CORE_TOOLS,
  generate_coi: {},
  lookup_address: {},
  import_requirement_attachments: {},
  lookup_connected_vendors: {},
  present_policy_card: {},
  draft_email: {},
  send_email_draft: {},
  coordinate_mailbox_task: {},
  web_research: {},
  create_imessage_group_chat: {},
};

function noul(value: number) {
  return { type: "noul" as const, noul: value };
}

function choice(value: string, probability: number) {
  return {
    type: "choice" as const,
    choice: value,
    probabilities: { [value]: probability },
    confidence: probability,
  };
}

function decideResponse(answers: Record<string, unknown>) {
  return {
    contractVersion: 1 as const,
    requestId: "req-1",
    model: "jev-1.0.0",
    answers: answers as never,
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced" as const, costNanoUsd: null },
    durationMs: 1,
  };
}

beforeEach(() => {
  decide.mockReset();
});

describe("module availability is decided in code", () => {
  it("offers only modules whose tools are registered", () => {
    expect(availableClientAgentModules(CORE_TOOLS)).toEqual([
      "policy_qa",
      "compliance",
      "procurement",
      "history",
    ]);
    expect(availableClientAgentModules(ALL_TOOLS)).toEqual([
      ...OPTIONAL_PROMPT_MODULES,
    ]);
    expect(
      availableClientAgentModules({
        lookup_policy: {},
        present_policy_card: {},
      }),
    ).toContain("presentation");
  });
});

describe("Jev turn selection", () => {
  it("includes a module only when Jev is at least 70% sure and never asks about unavailable modules", async () => {
    decide.mockResolvedValue(
      decideResponse({
        policy_qa: noul(0.95),
        coi: noul(0.7),
        compliance: noul(0.69),
        procurement: noul(0.1),
        history: noul(0.2),
        presentation: noul(0.99),
        answer_depth: choice("comprehensive", 0.8),
      }),
    );
    const tools = { ...CORE_TOOLS, generate_coi: {} };
    const selection = await decideClientAgentTurn(ctx, {
      orgId,
      surface: "web",
      message: "Give me the full details of my GL policy and a COI for Acme",
      tools,
      summary: "Earlier the user asked about renewals.",
    });

    expect(selection).toMatchObject({
      source: "jev",
      requestId: "req-1",
      modules: ["policy_qa", "coi"],
      answerDepth: "comprehensive",
    });
    const request = decide.mock.calls[0][0];
    expect(request.task).toBe("client_agent_turn_modules");
    expect(Object.keys(request.questions)).toEqual([
      "policy_qa",
      "coi",
      "compliance",
      "procurement",
      "history",
      "answer_depth",
    ]);
    expect(request.state).toMatchObject({
      surface: "web",
      conversationSummaryTail: "Earlier the user asked about renewals.",
    });
    expect(decide.mock.calls[0][1]?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the answer depth open when Jev is unsure", async () => {
    decide.mockResolvedValue(
      decideResponse({
        policy_qa: noul(0.9),
        answer_depth: choice("basic_summary", 0.5),
      }),
    );
    const selection = await decideClientAgentTurn(ctx, {
      orgId,
      surface: "imessage",
      message: "policy details?",
      tools: { lookup_policy: {} },
    });
    expect(selection.answerDepth).toBeUndefined();
    expect(selection.modules).toEqual(["policy_qa"]);
  });

  it("asks for a Slack reaction only on Slack and applies the same threshold", async () => {
    decide.mockResolvedValue(
      decideResponse({
        policy_qa: noul(0.9),
        answer_depth: choice("specific_section", 0.9),
        slack_reaction: choice("email", 0.85),
      }),
    );
    const slack = await decideClientAgentTurn(ctx, {
      orgId,
      surface: "slack",
      message: "email the cyber dec page to our landlord",
      tools: ALL_TOOLS,
      slackReaction: true,
    });
    expect(slack.slackReaction).toBe("email");
    expect(decide.mock.calls[0][0].questions.slack_reaction).toMatchObject({
      type: "choice",
    });

    decide.mockResolvedValue(
      decideResponse({
        policy_qa: noul(0.9),
        answer_depth: choice("specific_section", 0.9),
        slack_reaction: choice("mag", 0.4),
      }),
    );
    const unsure = await decideClientAgentTurn(ctx, {
      orgId,
      surface: "slack",
      message: "find my auto policy",
      tools: ALL_TOOLS,
      slackReaction: true,
    });
    expect(unsure.slackReaction).toBeUndefined();

    await decideClientAgentTurn(ctx, {
      orgId,
      surface: "web",
      message: "find my auto policy",
      tools: ALL_TOOLS,
    });
    expect(decide.mock.calls[2][0].questions.slack_reaction).toBeUndefined();
  });

  it("falls back to every available module when Jev fails or times out", async () => {
    decide.mockRejectedValueOnce(new Error("router unavailable"));
    const failed = await decideClientAgentTurn(ctx, {
      orgId,
      surface: "email",
      message: "Can you check whether we meet the lease requirements?",
      tools: ALL_TOOLS,
    });
    expect(failed).toMatchObject({
      modules: [...OPTIONAL_PROMPT_MODULES],
      availableModules: [...OPTIONAL_PROMPT_MODULES],
      source: "fallback",
    });

    decide.mockRejectedValueOnce(
      new DOMException("The operation was aborted", "TimeoutError"),
    );
    const timedOut = await decideClientAgentTurn(ctx, {
      orgId,
      surface: "mcp",
      message: "what policies do we have?",
      tools: CORE_TOOLS,
    });
    expect(timedOut.source).toBe("fallback");
    expect(timedOut.modules).toEqual(availableClientAgentModules(CORE_TOOLS));
  });

  it("does not call Jev for an empty turn", async () => {
    const selection = await decideClientAgentTurn(ctx, {
      orgId,
      surface: "web",
      message: "   ",
      tools: CORE_TOOLS,
    });
    expect(decide).not.toHaveBeenCalled();
    expect(selection.source).toBe("fallback");
  });
});

describe("tool loading follows the selected modules", () => {
  it("drops single-module tools that were not selected and keeps core and shared tools", () => {
    const filtered = filterToolsForModules(ALL_TOOLS, ["policy_qa", "history"]);
    expect(Object.keys(filtered).sort()).toEqual(
      Object.keys(CORE_TOOLS).sort(),
    );
    expect(
      filterToolsForModules(ALL_TOOLS, [...OPTIONAL_PROMPT_MODULES]),
    ).toEqual(ALL_TOOLS);
  });
});

describe("system prompt per surface", () => {
  const EMAIL_ONLY_LINES = [
    "EMAIL MODE",
    "responding in an email workflow",
    "most recent sender's request",
    "mediated or forwarded threads",
    "Email reply length",
    "copied into a live email thread",
    "handling a forwarded email",
  ];
  const HEADERS: Record<ClientAgentSurface, string> = {
    web: "WEB CHAT MODE",
    imessage: "iMESSAGE MODE",
    slack: "SLACK SERVICE MODE",
    mcp: "MCP MODE",
    email: "EMAIL MODE",
  };

  function prompt(
    surface: ClientAgentSurface,
    overrides?: Partial<Parameters<typeof buildClientAgentSystemPrompt>[0]>,
  ) {
    return buildClientAgentSystemPrompt({
      surface,
      org: { name: "Cove Coffee" },
      userName: "Dana",
      siteUrl: "https://app.example",
      tools: ALL_TOOLS,
      modules: [...OPTIONAL_PROMPT_MODULES],
      answerDepth: "basic_summary",
      maxToolCalls: 10,
      canSendEmail: true,
      now: new Date("2026-09-24T12:00:00Z"),
      timeZone: "UTC",
      ...overrides,
    });
  }

  it.each(["web", "imessage", "slack", "mcp"] as const)(
    "never tells the %s surface it is email",
    (surface) => {
      const text = prompt(surface);
      expect(text).toContain(HEADERS[surface]);
      for (const line of EMAIL_ONLY_LINES) expect(text).not.toContain(line);
      expect(text).not.toContain("choose_slack_reaction");
      expect(text).not.toMatch(/"full details"|"complete breakdown"/);
      expect(text).toContain("ANSWER DEPTH:");
      expect(text).toContain("EVIDENCE BOUNDS:");
    },
  );

  it("keeps the email rules on the email surface, including cc and forward modes", () => {
    const direct = prompt("email");
    expect(direct).toContain("EMAIL MODE");
    expect(direct).toContain("most recent sender's request");
    expect(direct).toContain("Email reply length");
    expect(prompt("email", { mode: "cc" })).toContain(
      "copied into a live email thread",
    );
    expect(prompt("email", { mode: "forward" })).toContain(
      "handling a forwarded email",
    );
  });

  it("includes module rules only when their tools are registered for the turn", () => {
    const withoutTools = prompt("web", {
      tools: CORE_TOOLS,
      canSendEmail: false,
    });
    expect(withoutTools).not.toContain("POLICY CARDS:");
    expect(withoutTools).not.toContain("POLICY CHANGES AND BROKER FOLLOW-UP:");
    expect(withoutTools).not.toContain("CERTIFICATES OF INSURANCE:");
    expect(withoutTools).not.toContain("import_requirement_attachments");
    expect(withoutTools).not.toContain("For email drafts and sends:");
    expect(withoutTools).not.toContain("Drafting, forwarding, and sending");
    expect(withoutTools).toContain("COMPLIANCE REQUIREMENTS:");
    expect(withoutTools).toContain("OLDER THREAD HISTORY:");

    const unavailableDespiteIdentity = prompt("web", {
      tools: CORE_TOOLS,
      canSendEmail: true,
    });
    expect(unavailableDespiteIdentity).not.toContain(
      "Email sending is available",
    );
    expect(unavailableDespiteIdentity).not.toContain(
      "Drafting, forwarding, and sending",
    );

    const withTools = prompt("web");
    expect(withTools).toContain("POLICY CARDS:");
    expect(withTools).toContain("POLICY CHANGES AND BROKER FOLLOW-UP:");
    expect(withTools).toContain("import_requirement_attachments");
    expect(withTools).toContain("For email drafts and sends:");
  });

  it("omits modules Jev did not select and reflects the answer depth", () => {
    const text = prompt("mcp", {
      modules: ["policy_qa"],
      answerDepth: "specific_section",
    });
    expect(text).toContain("POLICY QUESTIONS:");
    expect(text).not.toContain("CERTIFICATES OF INSURANCE:");
    expect(text).not.toContain("CONNECTED MAILBOXES:");
    expect(text).toContain("specific section, clause, term, or fact");
    expect(prompt("web", { answerDepth: undefined })).toContain(
      "Infer the answer depth",
    );
  });

  it("appends extras, attachments, policy focus, and the continuity summary", () => {
    const text = prompt("web", {
      extras: ["FOCUSED CONTEXT — policy page", ""],
      attachments: ["lease.pdf"],
      policyFocus: "POLICY FOCUS: abc",
      summary: "The user wants a COI for the landlord.",
    });
    expect(text).toContain("FOCUSED CONTEXT — policy page");
    expect(text).toContain("1 attachment(s): lease.pdf");
    expect(text).toContain("POLICY FOCUS: abc");
    expect(text).toContain("<conversation_summary>");
  });
});

describe("client family selection within one SDK turn", () => {
  function turn(tools = ALL_TOOLS) {
    return buildClientAgentTurnTools(
      tools,
      {
        ...fallbackClientAgentSelection(tools),
        modules: ["policy_qa"],
        families: ["policy_qa"],
      },
      {
        surface: "web",
        org: { name: "Cove Coffee" },
        maxToolCalls: 10,
        canSendEmail: true,
      },
    );
  }

  it("registers every tool while exposing only selected tools at the first step", async () => {
    const options = turn();
    expect(options.tools.generate_coi).toBe(ALL_TOOLS.generate_coi);
    expect(options.tools.draft_email).toBe(ALL_TOOLS.draft_email);
    const step = await options.prepareStep({ steps: [] });
    expect(step.activeTools).toContain("lookup_policy");
    expect(step.activeTools).toContain("expand_tools");
    expect(step.activeTools).not.toContain("generate_coi");
    expect(step.activeTools).not.toContain("draft_email");
    expect(step.system).not.toContain("CERTIFICATES OF INSURANCE:");
  });

  it("expands tools and their guidance for the next step of the same turn", async () => {
    const options = turn();
    const first = await options.prepareStep({ steps: [] });
    await options.tools.expand_tools.execute({ families: ["coi", "email"] });
    expect(first.activeTools).not.toContain("generate_coi");
    const second = await options.prepareStep({ steps: [] });
    expect(second.activeTools).toEqual(
      expect.arrayContaining([
        "generate_coi",
        "draft_email",
        "send_email_draft",
        "expand_tools",
      ]),
    );
    expect(second.system).toContain("CERTIFICATES OF INSURANCE:");
    expect(second.system).toContain("EMAIL DRAFTS AND DELIVERY:");
    expect((await options.prepareStep({ steps: [] })).activeTools).toEqual(
      second.activeTools,
    );
  });

  it("retains a family used earlier in the turn", async () => {
    const options = turn();
    const step = await options.prepareStep({
      steps: [
        {
          toolCalls: [{ toolName: "search_thread_history" }],
        },
      ],
    });
    expect(step.activeTools).toContain("search_thread_history");
    expect(step.system).toContain("OLDER THREAD HISTORY:");
    expect((await options.prepareStep({ steps: [] })).activeTools).toContain(
      "search_thread_history",
    );
  });

  it("cannot expand unavailable tools or bypass requirement-import authorization", async () => {
    const options = turn(CORE_TOOLS as typeof ALL_TOOLS);
    const expanded = await options.tools.expand_tools.execute({
      families: ["email", "compliance", "coi"],
    });
    expect(expanded).toMatchObject({
      unavailable: ["email", "coi"],
    });
    const step = await options.prepareStep({ steps: [] });
    expect(step.activeTools).not.toContain("draft_email");
    expect(step.activeTools).not.toContain("import_requirement_attachments");
    expect(step.system).not.toContain("use import_requirement_attachments");
  });
});

it("AI SDK activates expanded tools and guidance on the next generation step", async () => {
  const generateCertificate = vi.fn(async () => ({ status: "generated" }));
  const tools = {
    generate_coi: tool({
      inputSchema: z.object({}),
      execute: generateCertificate,
    }),
  };
  const selection = {
    ...fallbackClientAgentSelection(tools),
    families: [],
    modules: [],
  };
  const turnTools = buildClientAgentTurnTools(tools, selection, {
    surface: "web",
    org: { name: "Cove Coffee" },
    maxToolCalls: 3,
  });
  let step = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const toolNames = options.tools
        ?.filter((entry) => entry.type === "function")
        .map((entry) => entry.name);
      const system = options.prompt
        .filter((entry) => entry.role === "system")
        .map((entry) => entry.content)
        .join("\n");
      const usage = {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      };
      if (step++ === 0) {
        expect(toolNames).toEqual(["expand_tools"]);
        expect(system).not.toContain("CERTIFICATES OF INSURANCE:");
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "expand",
              toolName: "expand_tools",
              input: JSON.stringify({ families: ["coi"] }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage,
          warnings: [],
        };
      }
      expect(toolNames).toEqual(["generate_coi", "expand_tools"]);
      expect(system).toContain("CERTIFICATES OF INSURANCE:");
      if (step === 2)
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "certificate",
              toolName: "generate_coi",
              input: "{}",
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage,
          warnings: [],
        };
      return {
        content: [{ type: "text", text: "Certificate generated." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
  const result = await generateText({
    ...turnTools,
    model,
    prompt: "Generate a certificate.",
    stopWhen: stepCountIs(3),
  });
  expect(result.text).toBe("Certificate generated.");
  expect(result.steps).toHaveLength(3);
  expect(generateCertificate).toHaveBeenCalledOnce();
  expect(decide).not.toHaveBeenCalled();
});
