import { expect, test, vi } from "vitest";
import { completeSchemaCleanup } from "../scripts/complete-schema-cleanup.mjs";

const phases = [
  "cleanupOrganizationSettings", "cleanupPendingEmailStorage", "cleanupSlackAttachmentStorage",
  "cleanupNotificationExpiry", "cleanupThreadPolicyChangeReferences", "cleanupHoldPolicyChangeReferences",
  "cleanupCardPolicyChangeReferences", "cleanupRetiredModelRoute", "backfillSlackActorSpotIdentity",
];

function fixture({ blocker = false, wrongEnvironment = false, residual = false } = {}) {
  let started = false;
  let polls = 0;
  const runFunction = vi.fn(async (name: string, args: { table?: string; cursor?: string | null }) => {
    if (name === "migrations:runSchemaCleanup") {
      started = true;
      return {};
    }
    if (name === "migrations:schemaCleanupStatus") {
      polls++;
      return phases.map((phase) => ({ name: `migrations:${phase}`, isDone: polls > 1, state: polls > 1 ? "success" : "inProgress" }));
    }
    return {
      table: args.table, spotEnv: wrongEnvironment ? "dev" : "production", scanned: 1,
      changes: started && !residual ? 0 : 1,
      blockers: blocker && args.table === "pendingEmails" && args.cursor ? 1 : 0,
      isDone: args.table !== "pendingEmails" || args.cursor !== null,
      cursor: "second-page",
    };
  });
  return { runFunction, expectedEnv: "production", wait: vi.fn(async () => {}), report: vi.fn() };
}

test.each(["blocker", "wrongEnvironment"] as const)("does not start migrations when audit finds %s", async (failure) => {
  const setup = fixture({ [failure]: true });
  await expect(completeSchemaCleanup(setup)).rejects.toThrow();
  expect(setup.runFunction).not.toHaveBeenCalledWith("migrations:runSchemaCleanup", {});
});

test("waits for completion and checks every audit page again", async () => {
  const setup = fixture();
  await completeSchemaCleanup(setup);
  expect(setup.wait).toHaveBeenCalledOnce();
  expect(setup.runFunction.mock.calls.filter(([name, args]) => name === "schemaCleanup:audit" && args.table === "pendingEmails")).toHaveLength(4);
});

test("completed migration status cannot hide residual stored fields", async () => {
  await expect(completeSchemaCleanup(fixture({ residual: true }))).rejects.toThrow("residual");
});
