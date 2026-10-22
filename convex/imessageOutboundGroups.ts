import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  buildImessageGroupMemberTitle,
  normalizeImessageAddress,
  resolveImessageConversationScope,
  type ResolvedImessageParticipant,
} from "./lib/imessageGroupResolution";

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7;
}

function normalizedToken(value: string): string {
  return value.trim().toLowerCase();
}

function matchesPerson(user: Doc<"users"> | null, token: string): boolean {
  if (!user) return false;
  const normalized = normalizedToken(token);
  if (!normalized) return false;
  return [user.name, user.email, user.title].some(
    (value) => value && normalizedToken(value).includes(normalized),
  );
}

function matchesOrg(org: Doc<"organizations"> | null, token: string): boolean {
  if (!org) return false;
  const normalized = normalizedToken(token);
  if (!normalized) return false;
  return [
    org.name,
    org.website,
    org.primaryContactName,
    org.primaryContactEmail,
  ].some((value) => value && normalizedToken(value).includes(normalized));
}

type ReadCtx = Pick<QueryCtx, "db">;
type OrgUser = {
  membership: Doc<"orgMemberships">;
  user: Doc<"users">;
};

async function listOrgUsers(ctx: ReadCtx, orgId: Id<"organizations">) {
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .collect();
  const rows = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      user: await ctx.db.get(membership.userId),
    })),
  );
  return rows.filter((row): row is OrgUser => row.user !== null);
}

async function firstContactForOrg(ctx: ReadCtx, orgId: Id<"organizations">) {
  const org = await ctx.db.get(orgId);
  if (!org) return null;
  if (org.primaryInsuranceContactId) {
    const user = await ctx.db.get(org.primaryInsuranceContactId);
    if (user?.phone) return { org, user };
  }
  const users = await listOrgUsers(ctx, orgId);
  const admin = users.find(
    (row) => row.membership.role === "admin" && row.user.phone,
  );
  const fallback = admin ?? users.find((row) => row.user.phone);
  return fallback ? { org, user: fallback.user } : null;
}

function participantFromUser(params: {
  user: Doc<"users">;
  orgId: Id<"organizations">;
  displayName?: string;
}): ResolvedImessageParticipant | null {
  if (!params.user.phone) return null;
  return {
    address: normalizeImessageAddress(params.user.phone),
    displayName: params.displayName ?? params.user.name ?? params.user.email,
    userId: params.user._id,
    userName: params.user.name,
    userEmail: params.user.email,
    orgId: params.orgId,
    role: "linked",
  };
}

function participantFromPhone(raw: string): ResolvedImessageParticipant {
  return {
    address: normalizeImessageAddress(raw),
    displayName: raw.trim(),
    role: "anonymous",
  };
}

export const resolveRecipients = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    recipients: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    const user = await ctx.db.get(args.userId);
    if (!org || !user) throw new Error("Organization or user not found");
    if (!user.phone) {
      return {
        ok: false,
        reason:
          "Your profile needs a phone number before Spot can start an iMessage group.",
        participants: [],
        unresolved: args.recipients,
      };
    }

    const participants = new Map<string, ResolvedImessageParticipant>();
    const unresolved: string[] = [];
    const ambiguous: Array<{ input: string; matches: string[] }> = [];
    const addParticipant = (
      participant: ResolvedImessageParticipant | null,
    ) => {
      if (!participant) return;
      const address = normalizeImessageAddress(participant.address);
      participants.set(address, { ...participant, address });
    };

    addParticipant(
      participantFromUser({
        user,
        orgId: args.orgId,
        displayName: user.name ?? "You",
      }),
    );

    const team = await listOrgUsers(ctx, args.orgId);
    const relatedOrgs: Array<{
      org: Doc<"organizations">;
      kind: "client" | "vendor";
    }> = [];
    const vendorRelationships = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", args.orgId).eq("status", "active"),
      )
      .collect();
    for (const relationship of vendorRelationships) {
      const vendorOrg = await ctx.db.get(relationship.vendorOrgId);
      if (vendorOrg) relatedOrgs.push({ org: vendorOrg, kind: "vendor" });
    }

    for (const rawRecipient of args.recipients) {
      const recipient = rawRecipient.trim();
      if (!recipient) continue;
      if (looksLikePhone(recipient)) {
        addParticipant(participantFromPhone(recipient));
        continue;
      }

      const normalized = normalizedToken(recipient);
      if (normalized === "me" || normalized === "myself") continue;

      if (
        normalized === "broker" ||
        normalized === "my broker" ||
        normalized === "provider" ||
        normalized === "my provider"
      ) {
        unresolved.push(recipient);
        continue;
      }

      const personMatches: ResolvedImessageParticipant[] = [];
      for (const row of team) {
        if (matchesPerson(row.user, recipient)) {
          const participant = participantFromUser({
            user: row.user,
            orgId: args.orgId,
          });
          if (participant) personMatches.push(participant);
        }
      }

      for (const related of relatedOrgs) {
        if (
          matchesOrg(related.org, recipient) ||
          normalized === related.kind ||
          normalized === `my ${related.kind}`
        ) {
          const contact = await firstContactForOrg(ctx, related.org._id);
          if (contact?.user) {
            const participant = participantFromUser({
              user: contact.user,
              orgId: contact.org._id,
              displayName: contact.user.name ?? contact.org.name,
            });
            if (participant) personMatches.push(participant);
          }
        }
        const relatedUsers = await listOrgUsers(ctx, related.org._id);
        for (const row of relatedUsers) {
          if (matchesPerson(row.user, recipient)) {
            const participant = participantFromUser({
              user: row.user,
              orgId: related.org._id,
            });
            if (participant) personMatches.push(participant);
          }
        }
      }

      const uniqueByAddress = new Map(
        personMatches.map((match) => [match.address, match]),
      );
      if (uniqueByAddress.size === 1) {
        addParticipant(uniqueByAddress.values().next().value ?? null);
      } else if (uniqueByAddress.size > 1) {
        ambiguous.push({
          input: recipient,
          matches: [...uniqueByAddress.values()].map(
            (match) => match.userName ?? match.displayName ?? match.address,
          ),
        });
      } else {
        unresolved.push(recipient);
      }
    }

    const resolvedParticipants = [...participants.values()];
    const scope = resolveImessageConversationScope({
      senderAddress: normalizeImessageAddress(user.phone),
      participants: resolvedParticipants,
    });
    const title = buildImessageGroupMemberTitle(resolvedParticipants);
    return {
      ok:
        unresolved.length === 0 &&
        ambiguous.length === 0 &&
        resolvedParticipants.length >= 2,
      reason:
        resolvedParticipants.length < 2
          ? "At least one other person with a phone number is required."
          : undefined,
      participants: resolvedParticipants,
      unresolved,
      ambiguous,
      scopeKind: scope.kind === "no_linked_users" ? "single_org" : scope.kind,
      primaryOrgId: scope.primaryOrgId ?? args.orgId,
      title,
    };
  },
});
