import { expect, test, vi } from "vitest";
import { completeOperatorEmailIdentityBackfill } from "../scripts/complete-operator-email-identity-backfill.mjs";

const phases = [
  "migrations:backfillOperatorUserEmailIdentities",
  "migrations:backfillOperatorProfileEmailIdentities",
  "migrations:backfillOperatorAuthEmailIdentities",
];
const status = (complete: boolean, ready = false) => ({
  ready,
  statuses: phases.map((name) => ({
    name,
    isDone: complete,
    state: complete ? "success" : "inProgress",
  })),
});

test("release waits for every phase before enabling login and verifies the persisted gate", async () => {
  const runFunction = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(status(false))
    .mockResolvedValueOnce(status(true))
    .mockResolvedValueOnce({ ready: true })
    .mockResolvedValueOnce(status(true, true));
  const wait = vi.fn().mockResolvedValue(undefined);
  await completeOperatorEmailIdentityBackfill({ runFunction, wait });
  expect(wait).toHaveBeenCalledOnce();
  expect(runFunction.mock.calls.map(([name]) => name)).toEqual([
    "migrations:runOperatorEmailIdentityBackfill",
    "migrations:operatorEmailIdentityBackfillStatus",
    "migrations:operatorEmailIdentityBackfillStatus",
    "migrations:finishOperatorEmailIdentityBackfill",
    "migrations:operatorEmailIdentityBackfillStatus",
  ]);
});

test("later releases verify the completed backfill without waiting", async () => {
  const runFunction = vi.fn().mockResolvedValue(status(true, true));
  const wait = vi.fn().mockResolvedValue(undefined);
  await completeOperatorEmailIdentityBackfill({ runFunction, wait });
  expect(wait).not.toHaveBeenCalled();
  expect(runFunction).toHaveBeenCalledTimes(4);
});

test.each(["failed", "timeout", "wrong phases", "unpersisted gate"])(
  "release fails closed for %s",
  async (failure) => {
    const incomplete = status(false);
    if (failure === "failed") incomplete.statuses[0].state = "failed";
    if (failure === "wrong phases")
      incomplete.statuses[0].name = "migrations:unrelated";
    const runFunction = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValue(
        failure === "unpersisted gate" ? status(true) : incomplete,
      );
    await expect(
      completeOperatorEmailIdentityBackfill({
        runFunction,
        wait: vi.fn().mockResolvedValue(undefined),
        timeoutMs: 0,
      }),
    ).rejects.toThrow();
    if (failure !== "unpersisted gate") {
      expect(runFunction).not.toHaveBeenCalledWith(
        "migrations:finishOperatorEmailIdentityBackfill",
      );
    }
  },
);
