import { query } from "./_generated/server";
import { operatorPerson } from "./lib/operatorAvatar";
import {
  OPERATOR_EMAIL_DOMAINS,
  operatorEmailAliases,
  requireOperator,
} from "./lib/operatorIdentity";
import { operatorTeamAddressFor, teamOwnedDomains } from "./lib/teamEmail";

/**
 * Active operators with every address that is theirs, for showing addresses
 * as people (From, To, Cc) and choosing who an email is sent from. An address
 * is theirs when it is their team address or login email, or the same
 * localpart at any of Spot's own domains (the team domain, spot.insure,
 * toolsforenlightenment.org and the other operator login domains).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const profiles = await ctx.db.query("operatorProfiles").take(200);
    let teamDomains: string[] = [];
    try {
      teamDomains = teamOwnedDomains();
    } catch {
      // Team email is not configured here; login domains still apply.
    }
    const domains = [...new Set([...teamDomains, ...OPERATOR_EMAIL_DOMAINS])];
    const operators = await Promise.all(
      profiles
        .filter((profile) => profile.status !== "disabled")
        .map(async (profile) => {
          const [person, user] = await Promise.all([
            operatorPerson(ctx, profile.userId),
            ctx.db.get(profile.userId),
          ]);
          const email = (user?.email ?? profile.email ?? "").toLowerCase();
          let teamAddress: string | null = null;
          try {
            teamAddress = operatorTeamAddressFor({
              email: email || null,
              teamEmailLocalpart: profile.teamEmailLocalpart ?? null,
            });
          } catch {
            // No usable team address yet: they cannot be chosen as a sender.
          }
          const localparts = [teamAddress, email]
            .map((address) => address?.split("@")[0])
            .filter((localpart): localpart is string => Boolean(localpart));
          const addresses = new Set<string>([
            ...(teamAddress ? [teamAddress] : []),
            ...(email ? [email, ...operatorEmailAliases(email)] : []),
            ...localparts.flatMap((localpart) =>
              domains.map((domain) => `${localpart}@${domain}`),
            ),
          ]);
          return {
            ...person,
            teamAddress,
            addresses: [...addresses],
          };
        }),
    );
    return operators.sort((a, b) => a.name.localeCompare(b.name));
  },
});
