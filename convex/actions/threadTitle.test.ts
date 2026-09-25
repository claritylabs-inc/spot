import { expect, test, vi, beforeEach } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateObjectForOrg } from "../lib/models";
import { generate } from "./threadTitle";

vi.mock("../lib/models", () => ({
  generateObjectForOrg: vi.fn(),
  generateObjectForPublicTask: vi.fn(),
}));
const handler = (
  generate as typeof generate & {
    _handler: (
      ctx: ActionCtx,
      args: {
        threadId: Id<"threads">;
        userMessageId: Id<"threadMessages">;
        expectedTitle: string;
      },
    ) => Promise<void>;
  }
)._handler;
const args = {
  threadId: "thread" as Id<"threads">,
  userMessageId: "message" as Id<"threadMessages">,
  expectedTitle: "MCP Chat",
};
beforeEach(() => vi.resetAllMocks());

test.each([false, true])(
  "the shared title path preserves fallback and expected-title guard on failure=%s",
  async (failed) => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ orgId: "org", title: "MCP Chat" })
      .mockResolvedValueOnce({ content: "Please find renewal policies" });
    const runMutation = vi.fn();
    if (failed)
      vi.mocked(generateObjectForOrg).mockRejectedValueOnce(
        new Error("router unavailable"),
      );
    else
      vi.mocked(generateObjectForOrg).mockResolvedValueOnce({
        object: { title: "Renewal Policies" },
      } as never);
    await handler({ runQuery, runMutation } as unknown as ActionCtx, args);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      threadId: "thread",
      expectedTitle: "MCP Chat",
      title: failed ? "Find Renewal Policies" : "Renewal Policies",
    });
    expect(vi.mocked(generateObjectForOrg).mock.calls[0][4]).toMatchObject({
      taskKind: "thread_title",
      trace: { traceId: "thread", parentRequestId: "message" },
    });
  },
);

test("does not overwrite a renamed thread or call the model", async () => {
  const runMutation = vi.fn();
  await handler(
    {
      runQuery: vi.fn(async () => ({ title: "User title" })),
      runMutation,
    } as unknown as ActionCtx,
    args,
  );
  expect(generateObjectForOrg).not.toHaveBeenCalled();
  expect(runMutation).not.toHaveBeenCalled();
});
