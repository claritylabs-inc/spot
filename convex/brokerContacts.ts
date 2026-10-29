import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalQuery,
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { brokerContactFields } from "./lib/brokerContactFields";
import {
  assertExternalBrokerIdentity,
  isSpotOwnedBrokerIdentity,
  isSpotOwnedDomain,
  normalizeBrokerLineOfBusinessCodes,
} from "./lib/brokerProfileValidation";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { requireRequest } from "./procurementRequests";
import { teamTargetProblem } from "./lib/teamEmailStore";
import { CONSUMER_DOMAINS, normalizeProcurementEmail } from "./lib/procurement";
import { providerForEmail } from "./lib/providerRecipients";

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
/**
 * Email recipients among the providers added to one request: each outreach's
 * own contact plus the provider's relationship contacts. Bounded per request
 * and per provider; Spot-owned or missing providers are skipped.
 */
export const listForRequest = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    await requireOperator(ctx);
    await requireRequest(ctx, requestId);
    const outreaches = await ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .take(50);
    const recipients: Array<{
      email: string;
      name: string | null;
      brokerOrgId: Id<"organizations">;
      brokerName: string;
    }> = [];
    const seen = new Set<string>();
    const add = (entry: (typeof recipients)[number]) => {
      const email = entry.email.trim().toLowerCase();
      const key = `${entry.brokerOrgId}:${email}`;
      if (!email || seen.has(key)) return;
      seen.add(key);
      recipients.push({ ...entry, email });
    };
    const providers = new Set<Id<"organizations">>();
    for (const outreach of outreaches) {
      if (!outreach.brokerOrgId) continue;
      try {
        await requireProvider(ctx, outreach.brokerOrgId);
      } catch {
        continue;
      }
      if (outreach.contactEmail)
        add({
          email: outreach.contactEmail,
          name: outreach.contactName ?? null,
          brokerOrgId: outreach.brokerOrgId,
          brokerName: outreach.brokerName,
        });
      if (providers.has(outreach.brokerOrgId)) continue;
      providers.add(outreach.brokerOrgId);
      const contacts = await ctx.db
        .query("brokerContacts")
        .withIndex("by_brokerOrgId_and_deletedAt", (q) =>
          q.eq("brokerOrgId", outreach.brokerOrgId!).eq("deletedAt", undefined),
        )
        .take(25);
      for (const contact of contacts)
        if (contact.email)
          add({
            email: contact.email,
            name: contact.name || null,
            brokerOrgId: outreach.brokerOrgId,
            brokerName: outreach.brokerName,
          });
    }
    return recipients;
  },
});

const emailDomain = (email: string) => email.split("@")[1] ?? "";
const websiteDomain = (website: string | undefined) => {
  try {
    return website
      ? new URL(
          /^https?:\/\//i.test(website) ? website : `https://${website}`,
        ).hostname
          .toLowerCase()
          .replace(/^www\./, "")
      : "";
  } catch {
    return "";
  }
};

/**
 * Participants of one conversation who are not yet saved contacts of the
 * provider it belongs to (an outreach's own address included), keyed by email. The provider is the thread's outreach
 * provider; for other request conversations it is the request provider whose
 * company domain matches the participant. Consumer mail domains only match on
 * outreach conversations, and Spot-owned addresses are never suggested.
 */
export const suggestionsForThread = query({
  args: { threadId: v.id("teamEmailThreads") },
  handler: async (ctx, { threadId }) => {
    await requireOperator(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.deletedAt || (await teamTargetProblem(ctx, thread)))
      return [];
    const direct = thread.outreachId
      ? await ctx.db.get(thread.outreachId)
      : null;
    const outreaches = direct
      ? [direct]
      : thread.requestId
        ? await ctx.db
            .query("procurementBrokerOutreaches")
            .withIndex("request", (q) => q.eq("requestId", thread.requestId!))
            .take(50)
        : [];
    const providers = new Map<
      Id<"organizations">,
      { brokerName: string; emails: Set<string>; domains: Set<string> }
    >();
    for (const outreach of outreaches) {
      if (!outreach.brokerOrgId) continue;
      let entry = providers.get(outreach.brokerOrgId);
      if (!entry) {
        let provider;
        try {
          provider = await requireProvider(ctx, outreach.brokerOrgId);
        } catch {
          continue;
        }
        const { contacts } = await listProviderContacts(ctx, provider._id);
        entry = {
          brokerName: provider.name,
          emails: new Set(contacts.flatMap((contact) => contact.email ?? [])),
          domains: new Set([websiteDomain(provider.website)].filter(Boolean)),
        };
        providers.set(provider._id, entry);
      }
      // The outreach address is not a saved contact; it only identifies the domain.
      for (const email of [
        ...entry.emails,
        ...(outreach.contactEmail
          ? [normalizeProcurementEmail(outreach.contactEmail)]
          : []),
      ]) {
        const domain = emailDomain(email);
        if (domain && !CONSUMER_DOMAINS.has(domain)) entry.domains.add(domain);
      }
    }
    const known = new Set(
      [...providers.values()].flatMap((entry) => [...entry.emails]),
    );
    const suggestions: Array<{
      email: string;
      brokerOrgId: Id<"organizations">;
      brokerName: string;
    }> = [];
    for (const raw of thread.participantEmails) {
      const email = normalizeProcurementEmail(raw);
      const domain = emailDomain(email);
      if (!domain || known.has(email) || isSpotOwnedDomain(email)) continue;
      const match = [...providers].find(
        ([brokerOrgId, entry]) =>
          entry.domains.has(domain) ||
          (direct?.brokerOrgId === brokerOrgId && CONSUMER_DOMAINS.has(domain)),
      );
      if (match)
        suggestions.push({
          email,
          brokerOrgId: match[0],
          brokerName: match[1].brokerName,
        });
    }
    return suggestions;
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
/**
 * Marks or unmarks one contact as its provider's primary, clearing any other
 * primary. The flag is not an edited field, so clearing it on another contact
 * keeps revisions unchanged and never conflicts with an open editor.
 */
async function setPrimary(
  ctx: MutationCtx,
  contact: Doc<"brokerContacts">,
  primary: boolean,
) {
  if (primary) {
    const others = await ctx.db
      .query("brokerContacts")
      .withIndex("by_brokerOrgId_and_deletedAt", (q) =>
        q.eq("brokerOrgId", contact.brokerOrgId).eq("deletedAt", undefined),
      )
      .take(201);
    for (const other of others)
      if (other._id !== contact._id && other.primary)
        await ctx.db.patch(other._id, { primary: undefined });
  }
  if (Boolean(contact.primary) !== primary)
    await ctx.db.patch(contact._id, { primary: primary || undefined });
}

export const save = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    contactId: v.optional(v.id("brokerContacts")),
    expectedRevision: v.optional(v.number()),
    ...brokerContactFields,
    /** True makes this the provider's only primary contact; omitted keeps it unchanged. */
    primary: v.optional(v.boolean()),
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
          ? row.email === email && row.name.toLowerCase() === name.toLowerCase()
          : phone
            ? row.phone === phone && row.name === name
            : row.name === name && row.contactUrl === contactUrl,
      );
      if (duplicate) {
        if (args.primary !== undefined)
          await setPrimary(ctx, duplicate, args.primary);
        return {
          contactId: duplicate._id,
          revision: duplicate.revision,
          existing: true,
        };
      }
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
    if (args.primary !== undefined) {
      const saved = (await ctx.db.get(contactId))!;
      await setPrimary(ctx, saved, args.primary);
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: provider._id,
      summary: `${existing ? "Updated" : "Added"} provider contact ${name}`,
      metadata: {
        contactId,
        sourceKind: args.sourceKind,
        ...(args.primary !== undefined ? { primary: args.primary } : {}),
      },
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
      ...(args.archived ? { primary: undefined } : {}),
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

const MAX_LOOKUP_EMAILS = 50;

/**
 * Saved provider contacts for email addresses, for showing an address as the
 * person and their provider. An address shared by several contacts resolves to
 * the first live one; Spot-owned or deleted providers are skipped.
 */
export const lookupByEmails = query({
  args: { emails: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const emails = [
      ...new Set(args.emails.map(normalizeProcurementEmail).filter(Boolean)),
    ].slice(0, MAX_LOOKUP_EMAILS);
    const found = await Promise.all(
      emails.map(async (email) => {
        const contacts = await ctx.db
          .query("brokerContacts")
          .withIndex("by_email_and_deletedAt", (q) =>
            q.eq("email", email).eq("deletedAt", undefined),
          )
          .take(5);
        for (const contact of contacts) {
          const provider = await ctx.db.get(contact.brokerOrgId);
          if (
            !provider ||
            provider.deletedAt !== undefined ||
            provider.type !== "broker" ||
            isSpotOwnedBrokerIdentity(provider)
          )
            continue;
          return {
            email,
            name: contact.name,
            primary: !!contact.primary,
            brokerOrgId: provider._id,
            brokerName: provider.name,
            brokerWebsite: provider.website ?? null,
            brokerIconUrl: provider.iconStorageId
              ? await ctx.storage.getUrl(provider.iconStorageId)
              : null,
          };
        }
        return null;
      }),
    );
    return found.filter((entry) => entry !== null);
  },
});

/**
 * Saved provider contacts whose address starts with what an operator has typed
 * into a recipient field, for completing it inline. Spot-owned or deleted
 * providers are skipped.
 */
export const suggestRecipients = query({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => {
    await requireOperator(ctx);
    const start = prefix.trim().toLowerCase().slice(0, 100);
    if (!start) return [];
    const contacts = await ctx.db
      .query("brokerContacts")
      .withIndex("by_email_and_deletedAt", (q) =>
        q.gte("email", start).lt("email", `${start}\uffff`),
      )
      .take(20);
    const found: Array<{ email: string; name: string }> = [];
    for (const contact of contacts) {
      if (contact.deletedAt !== undefined || !contact.email) continue;
      const provider = await ctx.db.get(contact.brokerOrgId);
      if (
        !provider ||
        provider.deletedAt !== undefined ||
        provider.type !== "broker" ||
        isSpotOwnedBrokerIdentity(provider)
      )
        continue;
      found.push({ email: contact.email, name: contact.name });
      if (found.length === 5) break;
    }
    return found;
  },
});

const MAX_COMPARED_CONTACTS = 10;

/**
 * Evidence for the primary-contact default when saving a thread participant:
 * the provider's current primary (or, without one, its contacts) and what the
 * participant wrote in this conversation. Runs as the calling operator.
 */
export const primaryDefaultInputInternal = internalQuery({
  args: {
    threadId: v.id("teamEmailThreads"),
    brokerOrgId: v.id("organizations"),
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.deletedAt || (await teamTargetProblem(ctx, thread)))
      throw new Error("Conversation not found");
    const provider = await requireProvider(ctx, args.brokerOrgId);
    const email = normalizeProcurementEmail(args.email);
    const { contacts } = await listProviderContacts(ctx, provider._id);
    const others = contacts.filter((contact) => contact.email !== email);
    const primary = others.find((contact) => contact.primary);
    const compared = (primary ? [primary] : others).slice(
      0,
      MAX_COMPARED_CONTACTS,
    );
    const messages = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_threadId_and_receivedAt", (q) =>
        q.eq("threadId", thread._id),
      )
      .order("desc")
      .take(20);
    return {
      provider: { name: provider.name },
      candidate: {
        name: args.name?.trim() || null,
        email,
        // Signatures sit at the end of a message.
        messages: messages
          .filter(
            (message) =>
              message.direction === "inbound" &&
              normalizeProcurementEmail(message.fromEmail) === email,
          )
          .slice(0, 3)
          .map((message) => message.currentText.slice(-1500)),
      },
      existing: compared.map((contact) => ({
        name: contact.name,
        email: contact.email ?? null,
        title: contact.title ?? null,
        role: contact.role,
        primary: !!contact.primary,
        notes: contact.notes?.slice(0, 500) ?? null,
      })),
    };
  },
});

/** Whether an address belongs to a provider, for the provider-only signature line. */
export const isProviderAddressInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => !!(await providerForEmail(ctx, args.email)),
});
