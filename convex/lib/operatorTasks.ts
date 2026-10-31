import dayjs from "dayjs";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { pendingOperatorInputs } from "./operatorAgentInputs";
import { sanitizeOperatorReply } from "./operatorToolOutput";

/** Run states that hold a conversation's turn. */
export const ACTIVE_OPERATOR_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_confirmation",
] as const;

const SETTLED_OPERATOR_RUN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const SUBTASK_NOTICE_ANSWER_CHARS = 1_500;
const SUBTASK_NOTICE_SCAN = 50;

export function operatorRunFinished(run: Pick<Doc<"operatorAgentRuns">, "status">) {
  return SETTLED_OPERATOR_RUN_STATUSES.has(run.status);
}

/** A task the parent can act on: finished, or paused for the operator's approval. */
export function operatorTaskSettled(run: Pick<Doc<"operatorAgentRuns">, "status">) {
  return operatorRunFinished(run) || run.status === "waiting_confirmation";
}

export async function activeOperatorRuns(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"operatorAgentThreads">,
) {
  return (
    await Promise.all(
      ACTIVE_OPERATOR_RUN_STATUSES.map((status) =>
        ctx.db
          .query("operatorAgentRuns")
          .withIndex("thread_status", (q) =>
            q.eq("threadId", threadId).eq("status", status),
          )
          .take(25),
      ),
    )
  ).flat();
}

async function operatorName(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const user = await ctx.db.get(userId);
  return user?.name?.trim() || user?.email || "Another operator";
}

/**
 * Every operator can read and write in any operator conversation, but a run
 * belongs to the operator who started it: a message from someone else never
 * supersedes it, and only its operator can stop it.
 */
export async function assertNoOtherOperatorRun(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  operatorUserId: Id<"users">,
  action: "message" | "cancel",
) {
  const other = (await activeOperatorRuns(ctx, threadId)).find(
    (run) => run.operatorUserId !== operatorUserId,
  );
  if (!other) return;
  const name = await operatorName(ctx, other.operatorUserId);
  throw new ConvexError(
    action === "message"
      ? `${name}'s request is still running in this conversation. Wait for it to finish, or start a new chat.`
      : `Only ${name} can stop their request in this conversation.`,
  );
}

function subtaskNoticeContent(
  run: Doc<"operatorAgentRuns">,
  title: string,
  answer: string | undefined,
) {
  const label =
    run.status === "completed"
      ? "finished"
      : run.status === "cancelled"
        ? "was stopped"
        : "failed";
  const text = answer ? sanitizeOperatorReply(answer).trim() : "";
  const excerpt =
    text.length > SUBTASK_NOTICE_ANSWER_CHARS
      ? `${text.slice(0, SUBTASK_NOTICE_ANSWER_CHARS).trimEnd()}…`
      : text;
  return `Subtask “${title}” ${label}.${excerpt ? `\n\n${excerpt}` : ""}`;
}

/**
 * Brings each finished subtask's outcome into its parent conversation once.
 * While the parent has a run of its own, that run watches its subtasks with
 * get_operator_tasks (which marks what it read), so notices wait until the
 * conversation is idle and then cover only what no run has read.
 */
export async function postSubtaskNotices(
  ctx: MutationCtx,
  parentThreadId: Id<"operatorAgentThreads">,
) {
  if ((await activeOperatorRuns(ctx, parentThreadId)).length) return 0;
  const parent = await ctx.db.get(parentThreadId);
  if (!parent) return 0;
  const tasks = await ctx.db
    .query("operatorAgentRuns")
    .withIndex("parent_thread_created", (q) =>
      q.eq("parentThreadId", parentThreadId),
    )
    .order("desc")
    .take(SUBTASK_NOTICE_SCAN);
  const now = dayjs().valueOf();
  // Only a subtask conversation's latest run reports; a run its follow-up
  // superseded is settled quietly.
  const latestThreads = new Set<string>();
  const pending: Doc<"operatorAgentRuns">[] = [];
  for (const task of tasks) {
    const latest = !latestThreads.has(String(task.threadId));
    latestThreads.add(String(task.threadId));
    if (!operatorRunFinished(task) || task.parentNotifiedAt) continue;
    // A follow-up waiting to start becomes this subtask's next run, which
    // reports when it finishes.
    if (
      latest &&
      (await pendingOperatorInputs(ctx, task.threadId)).some(
        (input) =>
          input.parentThreadId === parentThreadId ||
          input.operatorUserId === task.operatorUserId,
      )
    )
      continue;
    if (latest) pending.unshift(task);
    else await ctx.db.patch(task._id, { parentNotifiedAt: now });
  }
  for (const task of pending) {
    const [thread, response] = await Promise.all([
      ctx.db.get(task.threadId),
      ctx.db.get(task.agentMessageId),
    ]);
    await ctx.db.insert("operatorAgentMessages", {
      threadId: parentThreadId,
      ownerUserId: parent.ownerUserId,
      channel: parent.channel,
      role: "agent",
      content: subtaskNoticeContent(
        task,
        thread?.title ?? "Subtask",
        response?.content,
      ),
      toolArtifacts: [
        {
          type: "operator_subtask_notice",
          data: { runId: task._id, threadId: task.threadId, status: task.status },
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(task._id, { parentNotifiedAt: now });
  }
  if (pending.length) {
    await ctx.db.patch(parentThreadId, { lastMessageAt: now, updatedAt: now });
  }
  return pending.length;
}

/**
 * Called after a run reaches a final state: a subtask reports to its parent,
 * and a parent that just went idle receives what its subtasks finished
 * without being read.
 */
export async function afterOperatorRunFinished(
  ctx: MutationCtx,
  run: Pick<Doc<"operatorAgentRuns">, "threadId" | "parentThreadId">,
) {
  if (run.parentThreadId) await postSubtaskNotices(ctx, run.parentThreadId);
  await postSubtaskNotices(ctx, run.threadId);
  await scheduleOperatorInputDrain(ctx, run.threadId);
}

/**
 * Starts the conversation's next queued message once no run holds it. The
 * drain runs after the finishing mutation, so its messages (a rejection
 * notice, subtask notices) land before the next user message.
 */
export async function scheduleOperatorInputDrain(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
) {
  if (!(await pendingOperatorInputs(ctx, threadId, 1)).length) return;
  await ctx.scheduler.runAfter(0, internal.operatorAgentInputs.drainInternal, {
    threadId,
  });
}
