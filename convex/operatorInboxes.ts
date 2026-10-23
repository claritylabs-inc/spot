import { v } from "convex/values";
import dayjs from "dayjs";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { inboxRecordValidator } from "./lib/providerOutreachValidators";

/**
 * Storage for team inboxes (`operatorOutreachInboxes`): one active Resend
 * inbox per operator plus the shared `agent` command inbox. A row without
 * `status` is an active pre-cutover inbox; retired rows stay so replies to old
 * threads can still map. `convex/lib/operatorInbox.ts` drives these.
 */

type InboxRow = Doc<"operatorOutreachInboxes">;
type Ctx = QueryCtx | MutationCtx;

const isActive = (row: InboxRow) => (row.status ?? "active") === "active";

function toRecord(row: InboxRow) {
  return {
    inboxId: row.inboxId,
    emailAddress: row.emailAddress,
    fromName: row.fromName,
    labelIds: row.labelIds,
  };
}

/** The newest active operator inbox, counting pre-cutover rows with no status. */
async function activeOperatorInbox(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<InboxRow | null> {
  const [explicit, legacy] = await Promise.all([
    ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .order("desc")
      .first(),
    ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", userId).eq("status", undefined),
      )
      .order("desc")
      .first(),
  ]);
  const candidates = [explicit, legacy].filter(
    (row): row is InboxRow => row !== null && row.kind !== "agent",
  );
  candidates.sort((a, b) => b._creationTime - a._creationTime);
  return candidates[0] ?? null;
}

async function activeAgentInbox(ctx: Ctx): Promise<InboxRow | null> {
  const rows = await ctx.db
    .query("operatorOutreachInboxes")
    .withIndex("by_kind", (q) => q.eq("kind", "agent"))
    .order("desc")
    .take(20);
  return rows.find(isActive) ?? null;
}

export const getTeamIdentityInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const [user, profile, inbox] = await Promise.all([
      ctx.db.get(args.userId),
      ctx.db
        .query("operatorProfiles")
        .withIndex("user", (q) => q.eq("userId", args.userId))
        .first(),
      activeOperatorInbox(ctx, args.userId),
    ]);
    return {
      name: user?.name?.trim() || null,
      email: user?.email ?? null,
      teamEmailLocalpart: profile?.teamEmailLocalpart ?? null,
      alwaysCcEmail: profile?.alwaysCcEmail ?? null,
      inbox: inbox ? toRecord(inbox) : null,
    };
  },
});

export const getAgentInboxInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await activeAgentInbox(ctx);
    return row ? toRecord(row) : null;
  },
});

/**
 * Stores the operator's active inbox and retires every other active inbox of
 * theirs (a localpart or domain change creates a new one). Idempotent by
 * `inboxId`; returns null when the inbox or address belongs to someone else.
 */
export const recordOperatorInboxInternal = internalMutation({
  args: { userId: v.id("users"), inbox: inboxRecordValidator },
  handler: async (ctx, args): Promise<typeof inboxRecordValidator.type | null> => {
    const now = dayjs().valueOf();
    const emailAddress = args.inbox.emailAddress.toLowerCase();
    const [byInbox, byAddress] = await Promise.all([
      ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inbox.inboxId))
        .first(),
      ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_emailAddress", (q) => q.eq("emailAddress", emailAddress))
        .first(),
    ]);
    const owned = (row: InboxRow | null) =>
      row === null || (row.userId === args.userId && row.kind !== "agent");
    if (!owned(byInbox) || !owned(byAddress)) return null;

    const current = { ...args.inbox, emailAddress };
    // The same address with a new inbox id means the inbox was recreated.
    const existing = byInbox ?? byAddress;
    let storedId: InboxRow["_id"];
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...current,
        kind: "operator",
        status: "active",
        retiredAt: undefined,
      });
      storedId = existing._id;
    } else {
      storedId = await ctx.db.insert("operatorOutreachInboxes", {
        userId: args.userId,
        kind: "operator",
        status: "active",
        ...current,
        createdAt: now,
      });
    }

    const others = await ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(50);
    for (const row of others) {
      if (row._id === storedId || row.kind === "agent" || !isActive(row)) continue;
      await ctx.db.patch(row._id, { status: "retired", retiredAt: now });
    }
    return current;
  },
});

/** Stores the shared command-channel inbox (`kind: "agent"`, no user), retiring any other active one. */
export const recordAgentInboxInternal = internalMutation({
  args: { inbox: inboxRecordValidator },
  handler: async (ctx, args): Promise<typeof inboxRecordValidator.type | null> => {
    const now = dayjs().valueOf();
    const emailAddress = args.inbox.emailAddress.toLowerCase();
    const [byInbox, byAddress] = await Promise.all([
      ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inbox.inboxId))
        .first(),
      ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_emailAddress", (q) => q.eq("emailAddress", emailAddress))
        .first(),
    ]);
    const owned = (row: InboxRow | null) =>
      row === null || (row.kind === "agent" && row.userId === undefined);
    if (!owned(byInbox) || !owned(byAddress)) return null;

    const current = { ...args.inbox, emailAddress };
    const existing = byInbox ?? byAddress;
    let storedId: InboxRow["_id"];
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...current,
        status: "active",
        retiredAt: undefined,
      });
      storedId = existing._id;
    } else {
      storedId = await ctx.db.insert("operatorOutreachInboxes", {
        kind: "agent",
        status: "active",
        ...current,
        createdAt: now,
      });
    }

    const agents = await ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_kind", (q) => q.eq("kind", "agent"))
      .take(20);
    for (const row of agents) {
      if (row._id === storedId || !isActive(row)) continue;
      await ctx.db.patch(row._id, { status: "retired", retiredAt: now });
    }
    return current;
  },
});

/** Records the display name Resend now sends with; returns false for an unknown inbox. */
export const updateInboxFromNameInternal = internalMutation({
  args: { inboxId: v.string(), fromName: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inboxId))
      .first();
    if (!row) return false;
    if (row.fromName !== args.fromName) {
      await ctx.db.patch(row._id, { fromName: args.fromName });
    }
    return true;
  },
});
