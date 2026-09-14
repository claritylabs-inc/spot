/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("retired notifications stay readable while new unsupported notifications are rejected", async () => {
  const t = convexTest(schema, modules);
  const orgId = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    await ctx.db.insert("notifications", {
      orgId,
      type: "policy_change_completed",
      title: "Historical change",
      body: "Historical notification remains available",
      severity: "info",
      status: "unread",
      createdAt: 1,
    });
    return orgId;
  });
  const payload = {
    orgId,
    title: "Notice",
    body: "Notice body",
    severity: "info" as const,
  };
  for (const type of [
    "policy_change_completed",
    "unsupported_notification",
  ] as const) {
    await expect(
      t.mutation(internal.lib.notify.notifyInternal, {
        ...payload,
        // @ts-expect-error Runtime callers must not bypass the active-type contract.
        type,
      }),
    ).rejects.toThrow();
  }
  await t.mutation(internal.lib.notify.notifyInternal, {
    ...payload,
    type: "mailbox_attention",
  });
  const notifications = await t.query(internal.notifications.listInternal, {
    orgId,
  });
  expect(notifications.map((notification) => notification.type).sort()).toEqual(
    ["mailbox_attention", "policy_change_completed"],
  );
});
