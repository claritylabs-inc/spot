"use node";

import dayjs from "dayjs";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  slackWebApi,
  SlackProviderError,
  type SlackReconcileChannel,
  type SlackWebApi,
} from "../lib/slackWebApi";

const internalApi = internal as any;
const RECONCILIATION_CONCURRENCY = 5;

async function probe(slack: SlackWebApi, teamId: string, channelIds: string[]) {
  try {
    return {
      ok: true,
      retryable: false,
      ...(await slack.reconcile({ teamId, channelIds })),
    };
  } catch (error) {
    const providerError =
      error instanceof SlackProviderError ? error : undefined;
    return {
      ok: false,
      channels: [] as SlackReconcileChannel[],
      errorCode: providerError?.code,
      errorSummary: error instanceof Error ? error.message : String(error),
      retryable: providerError?.retryable ?? true,
    };
  }
}

export const runDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const checkedAt = dayjs().valueOf();
    const slack = slackWebApi(ctx);
    const contexts = await ctx.runQuery(
      internalApi.slackLifecycle.listDueReconciliationContexts,
      { now: checkedAt, limit: 25 },
    );
    const reconcile = async ({
      connection,
      binding,
    }: (typeof contexts)[number]) => {
      const customerChannelIds = Array.from(
        new Set(
          [binding?.customerChannelId, connection.automaticChannelId].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      );
      const [customer, host] = await Promise.all([
        probe(slack, connection.teamId, customerChannelIds),
        binding
          ? probe(slack, binding.hostTeamId, [binding.hostChannelId])
          : null,
      ]);
      await ctx.runMutation(
        internalApi.slackLifecycle.applyReconciliationResult,
        {
          connectionId: connection._id,
          expectedAuthorizationUpdatedAt: connection.authorizationUpdatedAt,
          expectedBindingId: binding?._id,
          expectedBindingBoundAt: binding?.boundAt,
          side: "customer",
          teamId: connection.teamId,
          checkedAt,
          ...customer,
        },
      );

      if (!binding || !host) return 1;
      await ctx.runMutation(
        internalApi.slackLifecycle.applyReconciliationResult,
        {
          connectionId: connection._id,
          expectedAuthorizationUpdatedAt: connection.authorizationUpdatedAt,
          expectedBindingId: binding._id,
          expectedBindingBoundAt: binding.boundAt,
          side: "host",
          teamId: binding.hostTeamId,
          checkedAt,
          ...host,
        },
      );
      return 2;
    };

    let checked = 0;
    for (
      let offset = 0;
      offset < contexts.length;
      offset += RECONCILIATION_CONCURRENCY
    ) {
      const batch = contexts.slice(offset, offset + RECONCILIATION_CONCURRENCY);
      const counts = await Promise.all(batch.map(reconcile));
      checked += counts.reduce((total, count) => total + count, 0);
    }
    return { connections: contexts.length, checks: checked, checkedAt };
  },
});
