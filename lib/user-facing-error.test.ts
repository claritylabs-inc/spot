import { expect, test } from "vitest";
import { getUserFacingErrorMessage } from "./user-facing-error";

test("keeps actionable Convex errors without exposing server stacks", () => {
  const message =
    "The packet changed while you were editing. Copy your changes, then reopen the editor to review the latest packet.";
  expect(
    getUserFacingErrorMessage(
      new Error(
        `[CONVEX M(procurementPacket:updateSections)] [Request ID: example] Server Error\nUncaught Error: ${message}\n    at handler (../../convex/procurementPacket.ts:455:8)\n\n  Called by client`,
      ),
      "Could not save",
    ),
  ).toBe(message);
  expect(
    getUserFacingErrorMessage(
      new Error("Check the document:\nPage 2 is missing."),
      "Could not save",
    ),
  ).toBe("Check the document:\nPage 2 is missing.");
});
