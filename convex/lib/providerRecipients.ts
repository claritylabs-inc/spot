import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isSpotOwnedBrokerIdentity } from "./brokerProfileValidation";
import { CONSUMER_DOMAINS, normalizeProcurementEmail } from "./procurement";

export type ProviderRecipient = {
  email: string;
  brokerOrgId: Id<"organizations">;
  providerName: string;
  networkStatus?: Doc<"brokerProfiles">["networkStatus"];
};

/**
 * The provider an address belongs to: a saved provider contact or the
 * provider's primary contact email. Deleted providers are skipped.
 */
export async function providerForEmail(
  ctx: QueryCtx,
  rawEmail: string,
): Promise<ProviderRecipient | null> {
  const email = normalizeProcurementEmail(rawEmail);
  if (!email) return null;
  const contacts = await ctx.db
    .query("brokerContacts")
    .withIndex("by_email_and_deletedAt", (q) => q.eq("email", email).eq("deletedAt", undefined))
    .take(5);
  const primaries = await ctx.db
    .query("organizations")
    .withIndex("scan_contact", (q) => q.eq("primaryContactEmail", email))
    .take(5);
  const orgIds = [...new Set([...contacts.map((contact) => contact.brokerOrgId), ...primaries.map((org) => org._id)])];
  let found: ProviderRecipient | null = null;
  for (const orgId of orgIds) {
    const org = await ctx.db.get(orgId);
    if (!org || org.deletedAt !== undefined || org.type !== "broker") continue;
    const profile = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", org._id))
      .first();
    const provider = { email, brokerOrgId: org._id, providerName: org.name, networkStatus: profile?.networkStatus };
    // An address shared with a Do Not Contact provider is treated as Do Not Contact.
    if (provider.networkStatus === "blacklisted") return provider;
    found ??= provider;
  }
  return found;
}

/** Addresses that belong to a Do Not Contact provider. Spot never emails them. */
export async function doNotContactAddresses(ctx: QueryCtx, emails: string[]): Promise<string[]> {
  const providers = await Promise.all([...new Set(emails)].map((email) => providerForEmail(ctx, email)));
  return providers.flatMap((provider) => (provider?.networkStatus === "blacklisted" ? [provider.email] : []));
}

export function doNotContactReason(addresses: string[]): string {
  return `${addresses.join(", ")} ${addresses.length === 1 ? "belongs" : "belong"} to a Do Not Contact provider.`;
}

export const emailDomain = (email: string) => email.split("@")[1] ?? "";

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

type ProviderEmailIndex = Map<
  Id<"organizations">,
  {
    brokerName: string;
    contacts: Doc<"brokerContacts">[];
    emails: Set<string>;
    domains: Set<string>;
  }
>;

/**
 * The saved contact emails and company domains (website, contacts, outreach
 * address; never consumer mail domains) of each outreach's provider.
 */
export async function providerEmailIndex(
  ctx: QueryCtx,
  outreaches: Doc<"procurementBrokerOutreaches">[],
): Promise<ProviderEmailIndex> {
  const providers: ProviderEmailIndex = new Map();
  for (const outreach of outreaches) {
    if (!outreach.brokerOrgId) continue;
    let entry = providers.get(outreach.brokerOrgId);
    if (!entry) {
      const provider = await ctx.db.get(outreach.brokerOrgId);
      if (
        !provider ||
        provider.deletedAt !== undefined ||
        provider.type !== "broker" ||
        isSpotOwnedBrokerIdentity(provider)
      )
        continue;
      const contacts = await ctx.db
        .query("brokerContacts")
        .withIndex("by_brokerOrgId_and_deletedAt", (q) =>
          q.eq("brokerOrgId", provider._id).eq("deletedAt", undefined),
        )
        .take(200);
      entry = {
        brokerName: provider.name,
        contacts,
        emails: new Set(
          contacts.flatMap((contact) =>
            contact.email ? [normalizeProcurementEmail(contact.email)] : [],
          ),
        ),
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
  return providers;
}

/**
 * The provider an email belongs to: a saved contact first, then the company
 * domain. A consumer mail domain matches only the conversation's own provider.
 */
export function matchProviderEmail(
  providers: ProviderEmailIndex,
  rawEmail: string,
  conversationProvider?: Id<"organizations">,
) {
  const email = normalizeProcurementEmail(rawEmail);
  const domain = emailDomain(email);
  if (!domain) return undefined;
  const entries = [...providers];
  return (
    entries.find(([, entry]) => entry.emails.has(email)) ??
    entries.find(
      ([brokerOrgId, entry]) =>
        entry.domains.has(domain) ||
        (conversationProvider === brokerOrgId && CONSUMER_DOMAINS.has(domain)),
    )
  );
}
