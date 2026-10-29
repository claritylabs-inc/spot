import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { normalizeProcurementEmail } from "./procurement";

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
