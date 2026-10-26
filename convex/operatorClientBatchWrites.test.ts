/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import schema from "./schema";
import { prepareOperatorBatch, applyOperatorBatch } from "./lib/operatorBatch";
import {
  prepareClientBatch,
  clientBatchConfirmationSummary,
} from "./lib/operatorClientBatch";
import { parseOperatorAgentToolInput } from "./lib/operatorAgentToolRegistry";
import { buildOperatorSlackConfirmationBlocks } from "./lib/operatorSlackBlocks";
import type { Id } from "./_generated/dataModel";

// Failure modes: duplicate targets, an invalid later item, partial writes when
// the caller catches an application failure, inactive assignees, and approvals
// silently omitting items beyond Slack's section limit.
const modules = {
  ...import.meta.glob("./**/*.ts"),
  "./batchFailureFixture.ts": async () => ({ failDuringApply }),
};

async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Adyan",
      email: "adyan@spot.insure",
      accountKind: "operator",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId,
      email: "adyan@spot.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const orgIds = await Promise.all(
      ["A", "B"].map((name) =>
        ctx.db.insert("organizations", { name, type: "client" }),
      ),
    );
    const brokerId = await ctx.db.insert("organizations", {
      name: "Provider",
      type: "broker",
    });
    return { userId, profileId, orgIds, brokerId };
  });
  return { t, ...data };
}

test("batch bounds and duplicate keys fail before preparing any item", async () => {
  let prepared = 0;
  const prepare = async (item: string) => {
    prepared++;
    return item;
  };
  for (const items of [
    [],
    Array.from({ length: 51 }, (_, index) => String(index)),
    ["same", "same"],
  ]) {
    await expect(
      prepareOperatorBatch(items, (item) => item, prepare),
    ).rejects.toThrow();
  }
  expect(prepared).toBe(0);
});

test("invalid later clients and inactive assignees are item-labeled preflight failures", async () => {
  const { t, userId, profileId, orgIds, brokerId } = await fixture();
  await expect(
    t.run((ctx) =>
      prepareClientBatch(ctx, "set_client_access_statuses", {
        items: [
          { orgId: orgIds[0], status: "active" },
          { orgId: brokerId, status: "active" },
        ],
      }),
    ),
  ).rejects.toThrow(/Item 2.*Client/);
  await t.run((ctx) => ctx.db.patch(profileId, { status: "disabled" }));
  await expect(
    t.run((ctx) =>
      prepareClientBatch(
        ctx,
        "set_client_assignees",
        parseOperatorAgentToolInput("set_client_assignees", {
          items: [
            { orgId: orgIds[0], assigneeUserId: null },
            { orgId: orgIds[1], assigneeUserId: userId },
          ],
        }),
      ),
    ),
  ).rejects.toThrow(/Item 2.*active operator/);
  await expect(
    t.run((ctx) =>
      prepareClientBatch(ctx, "set_client_feature_flags", {
        items: [{ orgId: orgIds[0], flagId: "unsupported", enabled: true }],
      }),
    ),
  ).rejects.toThrow();
});

test("batches are atomic and audit only changed items", async () => {
  const { t, userId, orgIds, brokerId } = await fixture();
  await expect(
    t.mutation(internal.operatorClientBatchWrites.applyInternal, {
      operatorUserId: userId,
      toolName: "set_client_access_statuses",
      input: {
        items: [
          { orgId: orgIds[0], status: "active" },
          { orgId: brokerId, status: "active" },
        ],
      },
    }),
  ).rejects.toThrow(/Item 2/);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(orgIds[0]))?.clientAccessStatus).toBeUndefined();
    expect(await ctx.db.query("operatorAuditEvents").collect()).toHaveLength(0);
  });
  const result = await t.mutation(
    internal.operatorClientBatchWrites.applyInternal,
    {
      operatorUserId: userId,
      toolName: "set_client_access_statuses",
      input: {
        items: [
          { orgId: orgIds[0], status: "active" },
          { orgId: orgIds[1], status: "limited" },
        ],
      },
    },
  );
  expect(result.results).toMatchObject([
    {
      orgId: orgIds[0],
      clientName: "A",
      status: "updated",
      previous: "limited",
      next: "active",
    },
    {
      orgId: orgIds[1],
      clientName: "B",
      status: "unchanged",
      previous: "limited",
      next: "limited",
    },
  ]);
  await t.run(async (ctx) => {
    const audits = await ctx.db.query("operatorAuditEvents").collect();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      targetOrgId: orgIds[0],
      metadata: { domain: "operator_agent" },
    });
  });
});

// A nested mutation must roll back even when its caller records the error.
const failDuringApply = internalMutation({
  args: { orgIds: v.array(v.id("organizations")) },
  handler: async (ctx, args) => {
    const prepared = await prepareOperatorBatch(
      args.orgIds,
      (id) => id,
      async (id) => id,
    );
    return applyOperatorBatch(prepared, async (id, index) => {
      if (index === 1) throw new Error("application failed");
      await ctx.db.patch(id, { clientAccessStatus: "active" });
      return id;
    });
  },
});

test("nested batch application rolls back if a later write fails and the caller catches it", async () => {
  const { t, orgIds } = await fixture();
  await t.run(async (ctx) => {
    try {
      await ctx.runMutation(
        makeFunctionReference<"mutation">(
          "batchFailureFixture:failDuringApply",
        ),
        { orgIds },
      );
    } catch (error) {
      expect(String(error)).toContain("application failed");
    }
    expect((await ctx.db.get(orgIds[0]))?.clientAccessStatus).toBeUndefined();
  });
});

test("approval summary resolves every client and assignee and Slack preserves all 50 rows", async () => {
  const { t, userId, orgIds } = await fixture();
  const summary = await t.run((ctx) =>
    clientBatchConfirmationSummary(ctx, "set_client_assignees", {
      items: orgIds.map((orgId) => ({ orgId, assigneeUserId: userId })),
    }),
  );
  expect(summary).toBe("Assign 2 clients to Adyan\n- A → Adyan\n- B → Adyan");
  const lines = Array.from(
    { length: 50 },
    (_, index) => `- Client ${index} ${"long name ".repeat(14)} → Adyan`,
  );
  const blocks = buildOperatorSlackConfirmationBlocks({
    confirmationId: "confirmation" as Id<"operatorAgentConfirmations">,
    summary: `Assign 50 clients to Adyan\n${lines.join("\n")}`,
    destructive: false,
  });
  const serialized = JSON.stringify(blocks);
  for (const line of lines) expect(serialized).toContain(line);
  for (const block of blocks) {
    if (block.type === "section")
      expect((block.text as { text: string }).text.length).toBeLessThanOrEqual(
        3_000,
      );
  }
});
