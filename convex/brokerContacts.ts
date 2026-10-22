import dayjs from "dayjs";
import { v } from "convex/values";
import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { brokerContactFields } from "./lib/brokerContactFields";
import {
  assertExternalBrokerIdentity,
  normalizeBrokerLineOfBusinessCodes,
} from "./lib/brokerProfileValidation";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";

async function requireProvider(
  ctx: QueryCtx | MutationCtx,
  id: Id<"organizations">,
) {
  const org = await ctx.db.get(id);
  if (!org || org.deletedAt !== undefined || org.type !== "broker")
    throw new Error("Provider not found");
  assertExternalBrokerIdentity(org);
  return org;
}

// Call only after operator resource authorization. Portal memberships remain separate.
export async function listProviderContacts(
  ctx: QueryCtx,
  brokerOrgId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("brokerContacts")
    .withIndex("by_brokerOrgId_and_deletedAt", (q) =>
      q.eq("brokerOrgId", brokerOrgId).eq("deletedAt", undefined),
    )
    .take(201);
  return {
    contacts: rows.slice(0, 200).sort((a, b) => a.name.localeCompare(b.name)),
    bounded: rows.length > 200,
  };
}
export const list = query({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, { brokerOrgId }) => {
    await requireOperator(ctx);
    await requireProvider(ctx, brokerOrgId);
    return listProviderContacts(ctx, brokerOrgId);
  },
});
const text = (value: string | undefined, max: number) => {
  const clean = value?.trim();
  if ((clean?.length ?? 0) > max)
    throw new Error(`Contact field exceeds ${max} characters`);
  return clean || undefined;
};
const url = (value: string | undefined) => {
  const clean = text(value, 2000);
  if (!clean) return undefined;
  const parsed = new URL(clean);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Enter an HTTP(S) contact URL");
  return parsed.href;
};
export const save = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    contactId: v.optional(v.id("brokerContacts")),
    expectedRevision: v.optional(v.number()),
    ...brokerContactFields,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const provider = await requireProvider(ctx, args.brokerOrgId);
    const existing = args.contactId ? await ctx.db.get(args.contactId) : null;
    if (
      args.contactId &&
      (!existing ||
        existing.brokerOrgId !== provider._id ||
        existing.deletedAt !== undefined)
    )
      throw new Error("Contact not found");
    if (existing && existing.revision !== args.expectedRevision)
      throw new Error("This contact changed. Reload before editing again.");
    const name = text(args.name, 200);
    if (!name) throw new Error("Contact name is required");
    const email = text(args.email, 320)?.toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Enter a valid contact email");
    if (args.sources.length > 5)
      throw new Error("Use at most five contact sources");
    const sources = [...new Set(args.sources.map((source) => url(source)!))];
    if (sources.some((source) => !source))
      throw new Error("Enter a valid contact source URL");
    const contactUrl = url(args.contactUrl);
    const phone = text(args.phone, 80);
    const sourceQuote =
      args.sourceKind === "research"
        ? text(args.sourceQuote, 1500)
        : existing?.sourceQuote;
    if (
      args.sourceKind === "research" &&
      (!sources.length || !sourceQuote || !(email || phone || contactUrl))
    )
      throw new Error(
        "Researched contacts require a published contact method, source and evidence",
      );
    if (!existing) {
      const current = await ctx.db
        .query("brokerContacts")
        .withIndex("by_brokerOrgId_and_deletedAt", (q) =>
          q.eq("brokerOrgId", provider._id).eq("deletedAt", undefined),
        )
        .take(201);
      const duplicate = current.find((row) =>
        email
          ? row.email === email
          : phone
            ? row.phone === phone && row.name === name
            : row.name === name && row.contactUrl === contactUrl,
      );
      if (duplicate)
        return {
          contactId: duplicate._id,
          revision: duplicate.revision,
          existing: true,
        };
      if (current.length >= 200)
        throw new Error("This provider already has 200 contacts");
    }
    const now = dayjs().valueOf();
    const fields = {
      name,
      email,
      phone,
      contactUrl,
      title: text(args.title, 200),
      role: args.role,
      notes: text(args.notes, 8000),
      lineOfBusinessCodes: normalizeBrokerLineOfBusinessCodes(
        args.lineOfBusinessCodes,
      ),
      sources,
      sourceQuote,
      sourceKind: args.sourceKind,
      researchedAt:
        args.sourceKind === "research" ? now : existing?.researchedAt,
      updatedAt: now,
      updatedByUserId: operator.userId,
      revision: (existing?.revision ?? 0) + 1,
    };
    const contactId = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert("brokerContacts", {
          brokerOrgId: provider._id,
          ...fields,
          createdAt: now,
        });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: provider._id,
      summary: `${existing ? "Updated" : "Added"} provider contact ${name}`,
      metadata: { contactId, sourceKind: args.sourceKind },
    });
    return { contactId, revision: fields.revision, existing: false };
  },
});
export const setArchived = mutation({
  args: {
    contactId: v.id("brokerContacts"),
    expectedRevision: v.number(),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new Error("Contact not found");
    const provider = await requireProvider(ctx, contact.brokerOrgId);
    if (contact.revision !== args.expectedRevision)
      throw new Error("This contact changed. Reload before removing it.");
    if (!args.archived && contact.deletedAt !== undefined) {
      const current = await listProviderContacts(ctx, provider._id);
      if (current.contacts.length >= 200)
        throw new Error("This provider already has 200 contacts");
    }
    const now = dayjs().valueOf();
    await ctx.db.patch(contact._id, {
      deletedAt: args.archived ? now : undefined,
      updatedAt: now,
      updatedByUserId: operator.userId,
      revision: contact.revision + 1,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: provider._id,
      summary: `${args.archived ? "Removed" : "Restored"} provider contact ${contact.name}`,
      metadata: { contactId: contact._id },
    });
    return { revision: contact.revision + 1 };
  },
});
