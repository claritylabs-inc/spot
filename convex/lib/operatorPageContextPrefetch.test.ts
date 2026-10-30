// Failure modes: a page type prefetching the wrong record, a write or an
// unoffered tool, or no family; the sticky page context re-read on every turn,
// or not read after it was attached or changed; a starter intent's read of the
// same record repeated; a remote or side-effecting action read prefetched; a
// partial read framed as complete; a malformed related chip blocking a send.
import { expect, test } from "vitest";
import { operatorPrefetchReadAllowed } from "./operatorIntentPrefetch";
import { isOperatorToolFamily } from "./operatorAgentToolRegistry";
import {
  buildOperatorPageContextBlock,
  decideOperatorPageContextPrefetch,
} from "./operatorPageContextPrefetch";
import { normalizeOperatorPageContext } from "./threadPageContext";
import {
  OPERATOR_PAGE_CONTEXTS,
  operatorPageContextEntry,
} from "./pageContext";

test("page types map to plain reads of the attached record", () => {
  const email = operatorPageContextEntry("team_email_thread")!;
  expect(email.families).toEqual(["team_inbox"]);
  const [[thread], linked] = email.prefetch;
  expect(thread.input({ focus: { entityId: "t1" }, results: new Map() })).toEqual(
    { teamEmailThreadId: "t1", view: "full" },
  );
  const results = new Map<never, unknown>([
    [
      "get_team_inbox_thread" as never,
      { client: { _id: "o1" }, request: null, addressedRequest: { requestId: "r1" } },
    ],
  ]);
  expect(
    linked.map((read) => [read.toolName, read.input({ focus: {}, results })]),
  ).toEqual([
    ["get_procurement_request", { procurementRequestId: "r1", view: "summary" }],
    ["get_organization", { orgId: "o1" }],
  ]);
  expect(
    linked.map((read) => read.input({ focus: {}, results: new Map() })),
  ).toEqual([undefined, undefined]);
  for (const pageType of ["pdf_document", "operator_clients", "unknown"])
    expect(operatorPageContextEntry(pageType)).toBeUndefined();

  for (const entry of OPERATOR_PAGE_CONTEXTS) {
    expect(entry.families.every(isOperatorToolFamily)).toBe(true);
    for (const read of entry.prefetch.flat())
      expect([read.toolName, operatorPrefetchReadAllowed(read.toolName)]).toEqual(
        [read.toolName, true],
      );
  }
  // Mutation reads and Spot-only action reads qualify; writes, Jev searches,
  // remote integrations and conversation attachments do not.
  for (const name of ["get_team_inbox_thread", "lookup_policy", "read_client_file"] as const)
    expect(operatorPrefetchReadAllowed(name)).toBe(true);
  for (const name of [
    "search_team_inbox",
    "web_search",
    "list_mcp_tools",
    "search_company_email",
    "attach_client_file",
    "update_client_business_profile",
  ] as const)
    expect(operatorPrefetchReadAllowed(name)).toBe(false);

  // An unlinked forwarded thread names its outside sender and company.
  expect(
    email.hints!(
      new Map([
        [
          "get_team_inbox_thread",
          {
            thread: { subject: "Fwd: Commercial insurance quote" },
            client: null,
            request: null,
            addressedRequest: null,
            messages: [
              {
                direction: "inbound",
                fromEmail: "ops@insurewithspot.com",
                fromOperator: { name: "Ops" },
                forwarded: {
                  email: {
                    from: { address: "Lucy@Luminvera.com", name: "Lucy Luminvera" },
                    body: "Hi,\nWe need a quote.\n\nLucy Luminvera\nFounder, Luminvera Robotics Inc.\n> older",
                  },
                },
              },
            ],
          },
        ],
      ]),
      { pageType: "team_email_thread", entityId: "t1", related: [] },
    ),
  ).toEqual([
    "Sender: Lucy Luminvera <lucy@luminvera.com> (forwarded by ops@insurewithspot.com)",
    "Sender domain: luminvera.com (a company domain, not a personal mailbox)",
    'Company named in the sender\'s signature: "Founder, Luminvera Robotics Inc."',
    "Not linked to a client or procurement request.",
  ]);
});

test("a sticky page context is prefetched once per attachment unless still in history", () => {
  const entry = operatorPageContextEntry("team_email_thread")!;
  const context = { pageType: "team_email_thread", entityId: "t1" };
  const read = (entityId: string, status: string) => ({
    name: "get_team_inbox_thread",
    input: JSON.stringify({ teamEmailThreadId: entityId }),
    output: JSON.stringify({ status, result: {} }),
  });
  const decide = (
    previousContext: { pageType: string; entityId?: string } | null,
    recentToolCalls: Array<{ name: string; input?: string; output?: string }>,
    intentReads: Array<{ toolName: string; input: Record<string, unknown> }> = [],
  ) =>
    decideOperatorPageContextPrefetch({
      entry,
      context,
      previousContext,
      recentToolCalls,
      intentReads,
    });

  // First run after attaching or changing the page always reads it.
  expect(decide(null, [read("t1", "succeeded")])).toEqual({
    prefetch: true,
    trigger: "attached",
  });
  expect(
    decide({ pageType: "team_email_thread", entityId: "t0" }, [read("t1", "succeeded")]),
  ).toEqual({ prefetch: true, trigger: "attached" });
  // Later turns skip it while a recent turn read it successfully.
  expect(decide(context, [read("t1", "succeeded")])).toEqual({
    prefetch: false,
    reason: "in_history",
  });
  expect(decide(context, [read("t1", "failed"), read("t2", "succeeded")])).toEqual({
    prefetch: true,
    trigger: "not_in_history",
  });
  // A starter intent that already read the record covers it.
  expect(
    decide(null, [], [
      {
        toolName: "get_team_inbox_thread",
        input: { teamEmailThreadId: "t1", view: "compact" },
      },
    ]),
  ).toEqual({ prefetch: false, reason: "covered_by_intent" });
});

test("framing names partial reads and static notes; bad related chips are dropped", () => {
  const context = { pageType: "policy", entityId: "p1", summary: "Policy" };
  const block = buildOperatorPageContextBlock(
    context,
    {
      pageType: "policy",
      entityId: "p1",
      state: "loaded",
      tools: ["get_policy_status"],
      partial: ["get_policy_status: status only; lookup_policy returns coverages"],
    },
    undefined,
    { noun: "policy", staticHints: ["Reissue certificates with generate_coi."] },
  );
  expect(block).toContain("Part of its current content is already loaded");
  expect(block).toContain("- get_policy_status: status only; lookup_policy returns coverages");
  expect(block).not.toContain("Do not read it again");
  expect(block).toContain("Notes for this policy:\n- Reissue certificates with generate_coi.");
  // Static notes render with nothing read.
  expect(
    buildOperatorPageContextBlock(context, undefined, undefined, {
      noun: "certificate",
      staticHints: ["No certificate read tool; use the related policy."],
    }),
  ).toContain("- No certificate read tool; use the related policy.");

  expect(
    normalizeOperatorPageContext({
      pageType: "policy",
      related: [
        { kind: "organization", id: " o1 ", label: " Acme " },
        { kind: "Bad-Kind", id: "x" },
        { kind: "policy", id: "" },
        { kind: "policy", id: "p".repeat(201) },
        { kind: "client_file", id: "f1" },
      ],
    })?.related,
  ).toEqual([
    { kind: "organization", id: "o1", label: "Acme" },
    { kind: "client_file", id: "f1" },
  ]);
});
