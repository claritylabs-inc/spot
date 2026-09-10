import dayjs from "dayjs";
import { internal } from "../_generated/api";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

const internalApi = internal as any;

export const operatorChannelDeliveryValidator = v.union(
  v.object({
    channel: v.literal("slack"),
    teamId: v.string(),
    channelId: v.string(),
    threadTs: v.optional(v.string()),
    eventId: v.optional(v.id("slackInboundEvents")),
    clientMessageId: v.string(),
  }),
  v.object({
    channel: v.literal("imessage"),
    toPhone: v.string(),
    chatGuid: v.string(),
    clientMessageId: v.string(),
  }),
);
export type OperatorChannelDelivery = Infer<
  typeof operatorChannelDeliveryValidator
>;
export type OperatorChannelRunResult = {
  run: Doc<"operatorAgentRuns">;
  response?: Pick<Doc<"operatorAgentMessages">, "content" | "attachments"> & {
    messageId: Id<"operatorAgentMessages">;
  };
};

export function operatorConfirmationDecision(
  content: string,
): "approve" | "reject" | undefined {
  const normalized = content.trim().toLowerCase();
  if (normalized === "approve") return "approve";
  if (normalized === "reject") return "reject";
  return undefined;
}

export async function handleOperatorChannelConfirmation(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    channel: "slack" | "imessage";
    content: string;
  },
) {
  const decision = operatorConfirmationDecision(args.content);
  if (!decision) return null;
  const confirmation = await ctx.runQuery(
    internalApi.operatorAgent.getPendingConfirmationInternal,
    {
      operatorUserId: args.operatorUserId,
      threadId: args.threadId,
    },
  );
  if (!confirmation) return null;
  const result = await ctx.runMutation(
    internalApi.operatorAgent.confirmActionInternal,
    {
      operatorUserId: args.operatorUserId,
      channel: args.channel,
      threadId: args.threadId,
      confirmationId: confirmation._id,
      decision,
    },
  );
  return { ...result, confirmationId: confirmation._id };
}

export async function waitForOperatorAgentRun(
  ctx: ActionCtx,
  operatorUserId: Id<"users">,
  runId: Id<"operatorAgentRuns">,
  delivery: OperatorChannelDelivery,
): Promise<OperatorChannelRunResult | null> {
  // Bound each action invocation, not the lifetime of the underlying task.
  const deadline = dayjs().add(4, "minute").valueOf();
  while (dayjs().valueOf() < deadline) {
    const result: OperatorChannelRunResult = await ctx.runQuery(
      internalApi.operatorAgent.getRunResultForOperatorInternal,
      { operatorUserId, runId },
    );
    if (
      result?.run?.status === "completed" ||
      result?.run?.status === "waiting_confirmation"
    ) {
      return result;
    }
    if (
      result?.run?.status === "failed" ||
      result?.run?.status === "cancelled"
    ) {
      throw new Error(
        result.run.lastError ?? `Operator agent run ${result.run.status}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await ctx.scheduler.runAfter(
    0,
    internalApi.actions.operatorChannelDelivery.deliver,
    { operatorUserId, runId, delivery },
  );
  return null;
}
