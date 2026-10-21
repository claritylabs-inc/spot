import type {
  MessageActivityStage,
  MessageActivityUpdate,
} from "./messageActivity";

export type RecordActivity = (update: MessageActivityUpdate) => Promise<void>;

/**
 * Runs one slow decision phase between a "running" and a terminal stage
 * record. Records are best effort and never change the phase's outcome; a
 * throw is marked failed and rethrown so the caller's handling is unchanged.
 */
export async function traceStage<T>(
  record: RecordActivity,
  stageId: string,
  stage: MessageActivityStage["stage"],
  run: () => Promise<T>,
  describe?: (result: T) => string,
): Promise<T> {
  await record({ kind: "stage", stageId, stage, status: "running" });
  try {
    const result = await run();
    await record({
      kind: "stage",
      stageId,
      stage,
      status: "completed",
      ...(describe ? { detail: describe(result) } : {}),
    });
    return result;
  } catch (error) {
    await record({ kind: "stage", stageId, stage, status: "failed" });
    throw error;
  }
}
