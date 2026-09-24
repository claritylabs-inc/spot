/**
 * Manual eval for the Jev prompt-module selection (`client_agent_turn_modules`).
 *
 * Not run in CI: every case is skipped unless CL_ROUTER_EVALS=1. Run it against
 * the dev router with the router env loaded from the checkout's .env.local:
 *
 *   set -a; source .env.local; set +a
 *   CL_ROUTER_EVALS=1 npx vitest run convex/lib/__evals__/clientAgentModules.eval.test.ts
 *
 * Each case asserts that the expected modules are included (extra modules are
 * allowed; the threshold biases toward inclusion) and, when given, the answer
 * depth. The summary table at the end shows every selection for comparison.
 */
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import { afterAll, describe, expect, test } from "vitest";
import {
  decideClientAgentTurn,
  type AnswerDepth,
  type ClientAgentSurface,
  type ClientAgentTurnSelection,
  type OptionalPromptModule,
} from "../clientAgentPrompt";

const enabled = process.env.CL_ROUTER_EVALS === "1";

type EvalCase = {
  surface: ClientAgentSurface;
  message: string;
  summary?: string;
  attachments?: string[];
  expectModules: OptionalPromptModule[];
  expectDepth?: AnswerDepth;
};

const CORE = {
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
  generate_coi: {},
  lookup_address: {},
  lookup_connected_vendors: {},
  lookup_vendor_policies: {},
  lookup_vendor_compliance: {},
};

const TOOLS_BY_SURFACE: Record<ClientAgentSurface, Record<string, unknown>> = {
  web: {
    ...CORE,
    present_policy_card: {},
    email_expert: {},
    coordinate_mailbox_task: {},
    web_research: {},
    create_imessage_group_chat: {},
    import_requirement_attachments: {},
  },
  slack: {
    ...CORE,
    present_policy_card: {},
    email_expert: {},
    coordinate_mailbox_task: {},
    web_research: {},
  },
  imessage: {
    ...CORE,
    present_policy_card: {},
    email_expert: {},
    coordinate_mailbox_task: {},
    web_research: {},
    create_imessage_group_chat: {},
  },
  email: {
    ...CORE,
    email_expert: {},
    coordinate_mailbox_task: {},
    web_research: {},
    create_imessage_group_chat: {},
    extract_policy_attachment: {},
    import_requirement_attachments: {},
  },
  mcp: {
    ...CORE,
    coordinate_mailbox_task: {},
    web_research: {},
    create_imessage_group_chat: {},
  },
};

export const CLIENT_AGENT_MODULE_EVAL_CASES: EvalCase[] = [
  {
    surface: "web",
    message: "What's my GL policy number?",
    expectModules: ["policy_qa"],
    expectDepth: "specific_section",
  },
  {
    surface: "web",
    message: "Give me a summary of our property policy.",
    expectModules: ["policy_qa"],
    expectDepth: "basic_summary",
  },
  {
    surface: "web",
    message:
      "I need the complete breakdown of the cyber policy: every endorsement, sublimit, exclusion, and definition.",
    expectModules: ["policy_qa"],
    expectDepth: "comprehensive",
  },
  {
    surface: "web",
    message: "Are we covered if a customer slips on ice outside the store?",
    expectModules: ["policy_qa"],
  },
  {
    surface: "web",
    message: "Generate a COI for Acme Properties, 100 Main St, Denver CO 80202.",
    expectModules: ["coi"],
  },
  {
    surface: "web",
    message: "Email the certificate for Acme Properties to leasing@acme.com.",
    expectModules: ["coi"],
  },
  {
    surface: "web",
    message:
      "Here is our new lease. What insurance does it require and do we comply?",
    attachments: ["Lease Agreement - 2026.pdf"],
    expectModules: ["compliance"],
  },
  {
    surface: "web",
    message: "Which of our vendors are out of compliance right now?",
    expectModules: ["compliance"],
  },
  {
    surface: "web",
    message:
      "Please add our new warehouse at 42 Dock Rd to the property policy effective Oct 1.",
    expectModules: ["policy_change_email"],
  },
  {
    surface: "web",
    message: "Can you get us quotes for a new umbrella policy?",
    expectModules: ["procurement"],
  },
  {
    surface: "web",
    message: "Find the renewal quote our broker emailed last month and import the policy PDF.",
    expectModules: ["mailbox"],
  },
  {
    surface: "web",
    message: "What does Acme Roofing's website say they do?",
    expectModules: ["web_research"],
  },
  {
    surface: "web",
    message: "Loop in my broker so we can settle whether the endorsement applies.",
    expectModules: ["collaboration"],
  },
  {
    surface: "web",
    message: "What did you tell me earlier about the deductible on that claim?",
    summary: "The user asked about a hail claim deductible two weeks ago.",
    expectModules: ["history"],
  },
  {
    surface: "web",
    message: "Open the auto policy for me.",
    expectModules: ["presentation"],
  },
  {
    surface: "slack",
    message: "@Spot when does our workers comp policy expire?",
    expectModules: ["policy_qa"],
  },
  {
    surface: "slack",
    message: "@Spot draft an email to the landlord with the COI attached.",
    expectModules: ["coi"],
  },
  {
    surface: "imessage",
    message: "coi for bluebird events pls",
    expectModules: ["coi"],
  },
  {
    surface: "imessage",
    message: "does our policy cover a rented forklift",
    expectModules: ["policy_qa"],
  },
  {
    surface: "email",
    message:
      "Subject: Additional insured request\n\nHi Spot, our client Northwind needs to be added as additional insured on the GL policy and wants a certificate showing it.",
    expectModules: ["coi"],
  },
  {
    surface: "email",
    message:
      "Subject: Policy docs\n\nAttached is our renewed BOP. Please add it to the library.",
    attachments: ["BOP Renewal 2026.pdf"],
    expectModules: [],
  },
  {
    surface: "mcp",
    message: "List every active policy with its expiration date.",
    expectModules: ["policy_qa"],
  },
  {
    surface: "mcp",
    message: "Do our saved vendor requirements cover cyber liability?",
    expectModules: ["compliance"],
  },
];

const results: Array<{
  surface: string;
  message: string;
  expected: string;
  selected: string;
  depth: string;
  source: ClientAgentTurnSelection["source"];
}> = [];

describe.skipIf(!enabled)("client agent module selection (dev router)", () => {
  const ctx = { runMutation: async () => undefined } as unknown as ActionCtx;
  const orgId = "eval-org" as Id<"organizations">;

  test.each(CLIENT_AGENT_MODULE_EVAL_CASES)(
    "$surface: $message",
    async (evalCase) => {
      const selection = await decideClientAgentTurn(ctx, {
        orgId,
        surface: evalCase.surface,
        message: evalCase.message,
        summary: evalCase.summary,
        attachments: evalCase.attachments,
        tools: TOOLS_BY_SURFACE[evalCase.surface],
      });
      results.push({
        surface: evalCase.surface,
        message: evalCase.message.slice(0, 60),
        expected: evalCase.expectModules.join(","),
        selected: selection.modules.join(","),
        depth: selection.answerDepth ?? "-",
        source: selection.source,
      });
      expect(selection.source).toBe("jev");
      expect(selection.modules).toEqual(
        expect.arrayContaining(evalCase.expectModules),
      );
      if (evalCase.expectDepth) {
        expect(selection.answerDepth).toBe(evalCase.expectDepth);
      }
    },
    30_000,
  );

  afterAll(() => {
    if (results.length) console.table(results);
  });
});
