import { expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import { decideForwardReplyDirection } from "./forwardReplyDirection";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

test("replies to the original sender at 0.70 but keeps the forwarder at 0.69", async () => {
  const args = {
    orgId: "org" as Id<"organizations">,
    currentText: "Reply to the original sender",
    forwarderEmail: "user@example.com",
    parsedOriginalSender: "Original@Example.com",
  };
  for (const probability of [0.69, 0.7]) {
    vi.mocked(clRouterDecide).mockResolvedValueOnce({
      answers: { replyToOriginal: { type: "noul", noul: probability } },
    } as never);
    const result = await decideForwardReplyDirection({} as ActionCtx, args);
    expect(result?.originalSender).toBe(
      probability < 0.7 ? undefined : "original@example.com",
    );
  }
});
