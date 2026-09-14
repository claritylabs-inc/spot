import dayjs from "dayjs";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  createStandaloneBrokerByOperator,
  updateBrokerProfileByOperator,
} from "../brokerProfiles";
import {
  createProcurementRequestByOperator,
  updateProcurementRequestByOperator,
} from "../procurementRequests";
import { writeWorkspaceScanCompanyFacts } from "../orgWiki";
import { requireOperatorForUser } from "./operatorIdentity";
import {
  ScanAttention,
  normalizedIdentity,
  assertNewerEvidence,
  type ScanOperation,
} from "./googleWorkspaceReconciliation";

type Ctx = QueryCtx | MutationCtx;
export type ScanSelection = {
  selectedOrgId?: Id<"organizations">;
  selectedRequestId?: Id<"procurementRequests">;
};
export type ScanTarget = {
  org: Doc<"organizations"> | null;
  request: Doc<"procurementRequests"> | null;
  record:
    | Doc<"organizations">
    | Doc<"procurementRequests">
    | Doc<"brokerProfiles">
    | Doc<"orgWikiSections">
    | null;
};

export async function resolveScanOrganization(
  ctx: Ctx,
  identity: ScanOperation["identity"],
  selectedOrgId?: Id<"organizations">,
) {
  if (selectedOrgId) {
    const org = await ctx.db.get(selectedOrgId);
    if (!org || org.type !== identity.kind)
      throw new ScanAttention(
        "Selected organization has the wrong type or no longer exists",
      );
    return org;
  }
  const identityKey = `${identity.kind}:${normalizedIdentity(identity.name)}:${normalizedIdentity(identity.contactEmail)}`;
  const bound = await ctx.db
    .query("operatorWorkspaceScanIdentities")
    .withIndex("identity", (q) => q.eq("identityKey", identityKey))
    .unique();
  if (bound) {
    const org = await ctx.db.get(bound.orgId);
    if (!org || org.type !== identity.kind)
      throw new ScanAttention("Previously matched organization changed");
    return org;
  }
  const organizations = await ctx.db
    .query("organizations")
    .withIndex("type", (q) => q.eq("type", identity.kind))
    .take(501);
  if (organizations.length > 500)
    throw new ScanAttention(
      "Organization inventory requires exact operator selection",
    );
  const sameName = organizations.filter(
    (org) => normalizedIdentity(org.name) === normalizedIdentity(identity.name),
  );
  const matches: Doc<"organizations">[] = [];
  for (const org of sameName) {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", org._id))
      .take(101);
    if (memberships.length > 100)
      throw new ScanAttention(
        "Organization membership inventory requires exact operator selection",
      );
    const users = await Promise.all(
      memberships.map((m) => ctx.db.get(m.userId)),
    );
    const emailMatches = [
      org.primaryContactEmail,
      ...users.map((u) => u?.email),
    ].some(
      (e) =>
        e &&
        normalizedIdentity(e) === normalizedIdentity(identity.contactEmail),
    );
    const address = identity.address;
    const addressMatches =
      address &&
      org.mailingAddress &&
      Object.entries(address).every(
        ([key, value]) =>
          normalizedIdentity(
            org.mailingAddress?.[key as keyof typeof address] ?? "",
          ) === normalizedIdentity(value),
      );
    if (emailMatches || addressMatches) matches.push(org);
  }
  if (matches.length > 1 || (sameName.length && !matches.length))
    throw new ScanAttention(
      "Organization identity is ambiguous; a name alone cannot establish a match",
    );
  return matches[0] ?? null;
}

export async function resolveScanTarget(
  ctx: Ctx,
  operation: ScanOperation,
  selection: ScanSelection = {},
): Promise<ScanTarget> {
  const org = await resolveScanOrganization(
    ctx,
    operation.identity,
    selection.selectedOrgId,
  );
  if (!org) return { org: null, request: null, record: null };
  let request: Doc<"procurementRequests"> | null = null;
  if ("request" in operation) {
    const requests = await ctx.db
      .query("procurementRequests")
      .withIndex("organization", (q) => q.eq("clientOrgId", org._id))
      .take(201);
    if (requests.length > 200)
      throw new ScanAttention(
        "Request inventory requires exact operator selection",
      );
    const matches = requests.filter(
      (r) =>
        normalizedIdentity(r.title) ===
          normalizedIdentity(operation.request.title) &&
        normalizedIdentity(`${r.title} ${r.narrative ?? ""}`).includes(
          normalizedIdentity(operation.request.coverage),
        ),
    );
    request = selection.selectedRequestId
      ? await ctx.db.get(selection.selectedRequestId)
      : (matches[0] ?? null);
    if (request && request.clientOrgId !== org._id)
      throw new ScanAttention("Request belongs to a different client");
    if (!selection.selectedRequestId && matches.length > 1)
      throw new ScanAttention("Several requests match the same coverage");
    if (operation.kind !== "create_request" && !request)
      throw new ScanAttention(
        "The exact coverage request could not be resolved",
      );
  }
  let record: ScanTarget["record"] = request ?? org;
  if (operation.kind === "company_facts")
    record = await ctx.db
      .query("orgWikiSections")
      .withIndex("organization_key", (q) =>
        q.eq("orgId", org._id).eq("key", operation.section),
      )
      .unique();
  if (operation.kind === "broker_capabilities")
    record = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", org._id))
      .unique();
  return { org, request, record };
}

export async function assertScanChronology(
  ctx: MutationCtx,
  record: NonNullable<ScanTarget["record"]>,
  effectiveAt: number,
) {
  const last = await ctx.db
    .query("operatorWorkspaceScanChanges")
    .withIndex("entity", (q) => q.eq("entityId", record._id))
    .order("desc")
    .first();
  const currentChangedAt =
    "updatedAt" in record ? record.updatedAt : record._creationTime;
  const unchangedSinceScan =
    last && !last.correctedAt && JSON.stringify(record) === last.afterJson;
  assertNewerEvidence(
    effectiveAt,
    currentChangedAt,
    unchangedSinceScan ? last.effectiveAt : undefined,
  );
}

export async function writeScanDomain(
  ctx: MutationCtx,
  args: {
    operation: ScanOperation;
    target: ScanTarget;
    operatorUserId: Id<"users">;
    effectiveAt: number;
  },
) {
  const { operation: op, target, operatorUserId, effectiveAt } = args;
  await requireOperatorForUser(ctx, operatorUserId);
  if (op.kind === "create_organization") {
    if (target.org)
      return {
        table: "organizations" as const,
        id: target.org._id,
        created: false,
        noChange: true,
      };
    if (!op.identity.address)
      throw new ScanAttention(
        "New organization needs an independent full-address identity anchor",
      );
    const orgId =
      op.identity.kind === "broker"
        ? (
            await createStandaloneBrokerByOperator(ctx, {
              operatorUserId,
              name: op.identity.name,
              website: op.website ?? undefined,
              networkStatus: "prospect",
              source: "workspace_scan",
            })
          ).brokerOrgId
        : await ctx.db.insert("organizations", {
            name: op.identity.name,
            type: "client",
            website: op.website ?? undefined,
            onboardingComplete: true,
            operatorStatus: "live",
            emailVerification: "strict",
            allowedEmails: [],
          });
    await ctx.db.patch(orgId, {
      mailingAddress: op.identity.address,
      primaryContactEmail: op.identity.contactEmail,
    });
    await ctx.db.insert("operatorWorkspaceScanIdentities", {
      identityKey: `${op.identity.kind}:${normalizedIdentity(op.identity.name)}:${normalizedIdentity(op.identity.contactEmail)}`,
      orgId,
      createdAt: dayjs().valueOf(),
    });
    return { table: "organizations" as const, id: orgId, created: true };
  }
  if (!target.org)
    throw new ScanAttention(
      "No exact organization match; create or select the organization first",
    );
  const org = target.org;
  if (op.kind === "create_request") {
    if (org.type !== "client")
      throw new ScanAttention("Requests must belong to a client");
    if (target.request)
      return {
        table: "procurementRequests" as const,
        id: target.request._id,
        created: false,
        noChange: true,
      };
    const created = await createProcurementRequestByOperator(ctx, {
      operatorUserId,
      clientOrgId: org._id,
      title: op.request.title,
      narrative: op.narrative,
      targetEffectiveDate: op.targetEffectiveDate ?? undefined,
      status: "submitted",
      clientVisible: true,
      source: "workspace_scan",
    });
    return {
      table: "procurementRequests" as const,
      id: created.requestId,
      created: true,
    };
  }
  if (op.kind === "update_request" || op.kind === "external_placement") {
    if (!target.request) throw new ScanAttention("Exact request is required");
    await assertScanChronology(ctx, target.request, effectiveAt);
    await updateProcurementRequestByOperator(ctx, {
      operatorUserId,
      requestId: target.request._id,
      ...(op.kind === "external_placement"
        ? { completionOutcome: op.outcome }
        : {
            targetEffectiveDate: op.targetEffectiveDate ?? undefined,
            status: op.status ?? undefined,
          }),
      source: "workspace_scan",
    });
    return {
      table: "procurementRequests" as const,
      id: target.request._id,
      created: false,
    };
  }
  if (op.kind === "company_facts") {
    if (target.record)
      await assertScanChronology(ctx, target.record, effectiveAt);
    const id = await writeWorkspaceScanCompanyFacts(ctx, {
      operatorUserId,
      orgId: org._id,
      key: op.section,
      body: op.body,
    });
    if (!id) throw new ScanAttention("No company facts supplied");
    return { table: "orgWikiSections" as const, id, created: !target.record };
  }
  if (op.kind === "broker_capabilities") {
    if (org.type !== "broker")
      throw new ScanAttention("Capabilities must belong to a broker");
    if (target.record)
      await assertScanChronology(ctx, target.record, effectiveAt);
    await updateBrokerProfileByOperator(ctx, {
      operatorUserId,
      brokerOrgId: org._id,
      writingStates: op.writingStates,
      lineOfBusinessCodes: op.lineOfBusinessCodes,
    });
    const profile = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", org._id))
      .unique();
    if (!profile) throw new Error("Broker profile write failed");
    return {
      table: "brokerProfiles" as const,
      id: profile._id,
      created: !target.record,
    };
  }
  if (op.kind === "market_activity") {
    if (!target.request) throw new ScanAttention("Exact request is required");
    const broker = await resolveScanOrganization(ctx, op.brokerIdentity);
    if (!broker || broker.type !== "broker")
      throw new ScanAttention(
        "Exact broker identity is required for market activity",
      );
    // Observed activity is private and does not imply a sent packet or proposal selection.
    const id = await ctx.db.insert("procurementBrokerOutreaches", {
      requestId: target.request._id,
      clientOrgId: org._id,
      brokerOrgId: broker._id,
      brokerName: broker.name,
      status: "can_handle",
      applicationQuestions: [],
      notes: op.log,
      createdByUserId: operatorUserId,
      updatedByUserId: operatorUserId,
      createdAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
    });
    return { table: "procurementBrokerOutreaches" as const, id, created: true };
  }
  throw new Error(
    "Policy imports require the separately validated attachment entrypoint",
  );
}
