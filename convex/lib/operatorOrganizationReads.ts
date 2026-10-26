import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { readOrgWiki } from "../orgWiki";
import { readWebsiteTechProfile } from "../websiteTech";
import { isSpotOwnedBrokerIdentity } from "./brokerProfileValidation";
import { clientAccessStatus } from "./clientAccess";
import { readIntakeBusinessProfile } from "./intakeApplication";
import { operatorPeople } from "./operatorAvatar";
import { ORGANIZATION_INCLUDE_SECTIONS } from "./operatorAgentToolRegistry";

export type OrganizationIncludeSection =
  (typeof ORGANIZATION_INCLUDE_SECTIONS)[number];

type ReadCtx = QueryCtx | MutationCtx;
type OrganizationAssignee = { userId: Id<"users">; name: string };

/** Expands "all" and drops duplicates; no include means compact identity. */
export function organizationIncludeSet(
  value: unknown,
): Set<OrganizationIncludeSection> {
  const requested = Array.isArray(value) ? value : [];
  return new Set(
    requested.includes("all")
      ? ORGANIZATION_INCLUDE_SECTIONS
      : ORGANIZATION_INCLUDE_SECTIONS.filter((section) =>
          requested.includes(section),
        ),
  );
}

export function organizationReadType(organization: Doc<"organizations">) {
  return organization.type === "broker" &&
    isSpotOwnedBrokerIdentity(organization)
    ? "spot"
    : (organization.type ?? "client");
}

/** Resolves each distinct assignee once for a set of organizations. */
export async function loadOrganizationAssignees(
  ctx: ReadCtx,
  organizations: Doc<"organizations">[],
) {
  const people = await operatorPeople(
    ctx,
    organizations.flatMap((organization) =>
      organization.assignedOperatorUserId
        ? [organization.assignedOperatorUserId]
        : [],
    ),
  );
  return new Map<Id<"users">, OrganizationAssignee>(
    [...people].map(([userId, person]) => [
      userId,
      { userId, name: person.name },
    ]),
  );
}

/** Compact identity row shared by search, get and bulk get. */
export function organizationRow(
  organization: Doc<"organizations">,
  assignees: Map<Id<"users">, OrganizationAssignee>,
) {
  const isClient = organization.type === "client";
  return {
    orgId: organization._id,
    name: organization.name,
    type: organizationReadType(organization),
    ...(isClient
      ? {
          clientAccessStatus: clientAccessStatus(organization),
          assignee: organization.assignedOperatorUserId
            ? (assignees.get(organization.assignedOperatorUserId) ?? null)
            : null,
        }
      : {}),
    slug: organization.slug,
    website: organization.website,
    brokerOrgId: organization.brokerOrgId,
    createdAt: organization._creationTime,
  };
}

/** Identity plus optional sections; omitted sections are named in `omitted`. */
export async function organizationDetail(
  ctx: ReadCtx,
  organization: Doc<"organizations">,
  assignees: Map<Id<"users">, OrganizationAssignee>,
  include: ReadonlySet<OrganizationIncludeSection>,
  countCap: number,
) {
  const orgId = organization._id;
  const isClient = organization.type === "client";
  const isBroker = organization.type === "broker";
  const research = organization.companyResearch;
  const applicable = (section: OrganizationIncludeSection) =>
    section === "wiki"
      ? isBroker
      : section === "businessProfile" || section === "websiteTech"
        ? isClient
        : true;
  const omitted = ORGANIZATION_INCLUDE_SECTIONS.filter(
    (section) => applicable(section) && !include.has(section),
  );
  const counts = include.has("counts")
    ? await Promise.all([
        ctx.db
          .query("orgMemberships")
          .withIndex("organization", (index) => index.eq("orgId", orgId))
          .take(countCap + 1),
        ctx.db
          .query("policies")
          .withIndex("organization", (index) => index.eq("orgId", orgId))
          .take(countCap + 1),
      ])
    : null;
  return {
    ...organizationRow(organization, assignees),
    featureFlags: organization.featureFlags,
    onboardingComplete: organization.onboardingComplete,
    companyResearch: include.has("research")
      ? (research ?? null)
      : research
        ? { status: research.status, updatedAt: research.updatedAt }
        : null,
    ...(isClient && include.has("businessProfile")
      ? { businessProfile: await readIntakeBusinessProfile(ctx, orgId) }
      : {}),
    ...(isClient && include.has("websiteTech")
      ? {
          websiteTech: await readWebsiteTechProfile(ctx, organization.website),
        }
      : {}),
    ...(isBroker && include.has("wiki")
      ? { companyWiki: await readOrgWiki(ctx, orgId) }
      : {}),
    ...(counts
      ? {
          memberCount: Math.min(counts[0].length, countCap),
          policyCount: counts[1]
            .slice(0, countCap)
            .filter((policy) => !policy.deletedAt).length,
          archivedPolicyCount: counts[1]
            .slice(0, countCap)
            .filter((policy) => policy.deletedAt).length,
          countsAreLowerBounds:
            counts[0].length > countCap || counts[1].length > countCap,
        }
      : {}),
    ...(omitted.length ? { omitted } : {}),
  };
}
