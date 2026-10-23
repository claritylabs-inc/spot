import { v } from "convex/values";
import dayjs from "dayjs";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOperatorForUser } from "./lib/operatorIdentity";
import { inboxRecordValidator } from "./lib/providerOutreachValidators";
import {
  agentInboxAddress,
  getTeamEmailDomain,
  operatorTeamAddressFor,
} from "./lib/teamEmail";

/**
 * Storage for `operatorOutreachInboxes`: one active inbox per operator plus the
 * shared `agent` inbox. A row with no `status` is an active pre-cutover inbox.
 * Retired rows are kept: they still map replies to old threads and keep
 * reserving their address.
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

const ownedByOperator = (row: InboxRow, userId: Id<"users">) =>
  row.userId === userId && row.kind !== "agent";
const ownedByAgent = (row: InboxRow) =>
  row.kind === "agent" && row.userId === undefined;

async function activeOperatorInbox(ctx: Ctx, userId: Id<"users">) {
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
  return (
    [explicit, legacy]
      .filter((row): row is InboxRow => row !== null && row.kind !== "agent")
      .sort((a, b) => b._creationTime - a._creationTime)[0] ?? null
  );
}

async function rowsForAddress(ctx: Ctx, emailAddress: string) {
  return await ctx.db
    .query("operatorOutreachInboxes")
    .withIndex("by_emailAddress", (q) => q.eq("emailAddress", emailAddress))
    .take(11);
}

/** Requires an active, valid operator; anything else throws. */
export const getTeamIdentityInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { user, profile } = await requireOperatorForUser(ctx, args.userId);
    const inbox = await activeOperatorInbox(ctx, args.userId);
    return {
      name: user.name?.trim() || null,
      email: user.email ?? null,
      teamEmailLocalpart: profile.teamEmailLocalpart ?? null,
      alwaysCcEmail: profile.alwaysCcEmail ?? null,
      inbox: inbox ? toRecord(inbox) : null,
    };
  },
});

export const getAgentInboxInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_kind", (q) => q.eq("kind", "agent"))
      .filter((q) => q.neq(q.field("status"), "retired"))
      .order("desc")
      .take(2);
    const row = rows.find(isActive);
    return row ? toRecord(row) : null;
  },
});

const MAX_PROFILE_RESERVATIONS = 10;

/**
 * Whether another owner's saved team localpart (any profile status) reserves
 * `emailAddress` on the current team domain, before an inbox exists for it.
 * More matches than the bound fails closed.
 */
async function reservedByOtherProfile(
  ctx: Ctx,
  emailAddress: string,
  userId: Id<"users"> | undefined,
) {
  const [localpart, domain] = emailAddress.split("@");
  let teamDomain: string;
  try {
    teamDomain = getTeamEmailDomain();
  } catch {
    return false;
  }
  if (!localpart || domain !== teamDomain) return false;
  const profiles = await ctx.db
    .query("operatorProfiles")
    .withIndex("by_teamEmailLocalpart", (q) =>
      q.eq("teamEmailLocalpart", localpart),
    )
    .take(MAX_PROFILE_RESERVATIONS + 1);
  return (
    profiles.length > MAX_PROFILE_RESERVATIONS ||
    profiles.some((profile) => profile.userId !== userId)
  );
}

/**
 * Whether `emailAddress` is free, already the caller's, or reserved by another
 * owner: an inbox row (retired rows included) or another operator's saved team
 * localpart. Checked before any Resend call that could adopt or modify an
 * inbox. Omit `userId` for the agent inbox.
 */
export const addressOwnershipInternal = internalQuery({
  args: { emailAddress: v.string(), userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<"free" | "own" | "conflict"> => {
    const emailAddress = args.emailAddress.toLowerCase();
    if (await reservedByOtherProfile(ctx, emailAddress, args.userId)) {
      return "conflict";
    }
    const rows = await rowsForAddress(ctx, emailAddress);
    if (rows.length > 10) return "conflict";
    if (rows.length === 0) return "free";
    const userId = args.userId;
    const mine = (row: InboxRow) =>
      userId ? ownedByOperator(row, userId) : ownedByAgent(row);
    return rows.every(mine) ? "own" : "conflict";
  },
});

export type RecordInboxResult =
  | { status: "stored"; inbox: typeof inboxRecordValidator.type }
  | { status: "conflict" }
  | { status: "stale" };

/**
 * Activates the operator's inbox and retires their other active ones. Rechecks
 * that the operator is still active and that the address is still the one
 * their profile intends (it may have changed during the Resend calls), and
 * that no other owner holds the address or inbox id. Idempotent by `inboxId`.
 */
export const recordOperatorInboxInternal = internalMutation({
  args: { userId: v.id("users"), inbox: inboxRecordValidator },
  handler: async (ctx, args): Promise<RecordInboxResult> => {
    const { user, profile } = await requireOperatorForUser(ctx, args.userId);
    const emailAddress = args.inbox.emailAddress.toLowerCase();
    let intended: string;
    try {
      intended = operatorTeamAddressFor({
        email: user.email ?? null,
        teamEmailLocalpart: profile.teamEmailLocalpart ?? null,
      });
    } catch {
      return { status: "stale" };
    }
    if (intended !== emailAddress) return { status: "stale" };
    if (await reservedByOtherProfile(ctx, emailAddress, args.userId)) {
      return { status: "conflict" };
    }

    const [byInbox, byAddress] = await Promise.all([
      ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inbox.inboxId))
        .first(),
      rowsForAddress(ctx, emailAddress),
    ]);
    if (
      (byInbox && !ownedByOperator(byInbox, args.userId)) ||
      byAddress.length > 10 ||
      byAddress.some((row) => !ownedByOperator(row, args.userId))
    ) {
      return { status: "conflict" };
    }

    const now = dayjs().valueOf();
    const current = { ...args.inbox, emailAddress };
    // The same address under a new inbox id means the inbox was recreated.
    const existing = byInbox ?? byAddress[0];
    let storedId: Id<"operatorOutreachInboxes">;
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

    const others = (await Promise.all(
      (["active", undefined] as const).map((status) => ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_userId_and_status", (q) => q.eq("userId", args.userId).eq("status", status))
        .take(51)),
    )).flat();
    if (others.length > 50) throw new Error("Too many active inboxes to reconcile");
    for (const row of others) {
      if (row._id === storedId || row.kind === "agent" || !isActive(row)) continue;
      await ctx.db.patch(row._id, { status: "retired", retiredAt: now });
    }
    return { status: "stored", inbox: current };
  },
});

/** Activates the shared `kind: "agent"` inbox (no user) and retires any other active one. */
export const recordAgentInboxInternal = internalMutation({
  args: { inbox: inboxRecordValidator },
  handler: async (ctx, args): Promise<RecordInboxResult> => {
    const emailAddress = args.inbox.emailAddress.toLowerCase();
    if (emailAddress !== agentInboxAddress()) return { status: "stale" };
    if (await reservedByOtherProfile(ctx, emailAddress, undefined)) {
      return { status: "conflict" };
    }

    const [byInbox, byAddress] = await Promise.all([
      ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inbox.inboxId))
        .first(),
      rowsForAddress(ctx, emailAddress),
    ]);
    if (
      (byInbox && !ownedByAgent(byInbox)) ||
      byAddress.length > 10 ||
      byAddress.some((row) => !ownedByAgent(row))
    ) {
      return { status: "conflict" };
    }

    const now = dayjs().valueOf();
    const current = { ...args.inbox, emailAddress };
    const existing = byInbox ?? byAddress[0];
    let storedId: Id<"operatorOutreachInboxes">;
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
      .filter((q) => q.neq(q.field("status"), "retired"))
      .take(21);
    if (agents.length > 20) throw new Error("Too many active agent inboxes to reconcile");
    for (const row of agents) {
      if (row._id === storedId || !isActive(row)) continue;
      await ctx.db.patch(row._id, { status: "retired", retiredAt: now });
    }
    return { status: "stored", inbox: current };
  },
});

/** Records the display name Resend now sends with; false for an unknown inbox. */
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
