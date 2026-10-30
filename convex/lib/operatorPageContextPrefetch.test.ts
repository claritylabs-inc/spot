// Failure modes: a page type prefetching the wrong record, a write or an
// unoffered tool, or no family; the sticky page context re-read on every turn,
// or not read after it was attached or changed; a starter intent's read of the
// same record repeated.
import { expect, test } from "vitest";
import {
  getOperatorAgentToolSpec,
  isOperatorToolFamily,
} from "./operatorAgentToolRegistry";
import { decideOperatorPageContextPrefetch } from "./operatorPageContextPrefetch";
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
    for (const read of entry.prefetch.flat()) {
      const spec = getOperatorAgentToolSpec(read.toolName);
      expect([spec.effect, spec.confirmation, spec.execution]).toEqual([
        "read",
        "none",
        "mutation",
      ]);
    }
  }

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
                    body: "Hi,\nWe need a quote.\n\nLucy\nFounder, Luminvera Robotics Inc.\n> older",
                  },
                },
              },
            ],
          },
        ],
      ]),
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
