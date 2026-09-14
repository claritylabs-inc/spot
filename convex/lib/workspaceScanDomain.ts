import { requestNarrative } from "./procurementNarrative";
import { readOutreachLog } from "./outreachLog";
import { getMarkdownDocument } from "../markdownDocuments";
import dayjs from "dayjs";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  createStandaloneBrokerByOperator,
  updateBrokerProfileByOperator,
} from "../brokerProfiles";
import {
  createProcurementRequestByOperator,
  createProcurementOutreachByOperator,
  updateProcurementOutreachByOperator,
  updateProcurementRequestByOperator,
} from "../procurementRequests";
import { writeWorkspaceScanCompanyFacts } from "../orgWiki";
import { createStandaloneClientOrganizationByOperator } from "../operator";
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
  organizationIds?: Id<"organizations">[];
  requestIds?: Id<"procurementRequests">[];
};
export type ScanTarget = {
  outreachLogDocument: Doc<"markdownDocuments"> | null;
  org: Doc<"organizations"> | null;
  request: Doc<"procurementRequests"> | null;
  record:
    | Doc<"organizations">
    | Doc<"procurementRequests">
    | Doc<"brokerProfiles">
    | Doc<"markdownDocuments">
    | Doc<"procurementBrokerOutreaches">
    | null;
};

function scanIdentityKeys(identity: ScanOperation["identity"]) {
  const name = normalizedIdentity(identity.name);
  return [
    `${identity.kind}:${name}:${normalizedIdentity(identity.contactEmail)}`,
    ...(identity.address
      ? [
          `${identity.kind}:${name}:address:${Object.values(identity.address).map(normalizedIdentity).join("|")}`,
        ]
      : []),
  ];
}
export async function resolveScanOrganization(
  ctx: Ctx,
  identity: ScanOperation["identity"],
  selectedOrgId?: Id<"organizations">,
  discoveredIds: Id<"organizations">[] = [],
) {
  if (selectedOrgId) {
    const org = await ctx.db.get(selectedOrgId);
    if (!org || org.type !== identity.kind)
      throw new ScanAttention(
        "Selected organization has the wrong type or no longer exists",
      );
    return org;
  }
  const boundIds: Id<"organizations">[] = [];
  for (const identityKey of scanIdentityKeys(identity)) {
    const bound = await ctx.db
      .query("operatorWorkspaceScanIdentities")
      .withIndex("identity", (q) => q.eq("identityKey", identityKey))
      .unique();
    if (bound) {
      const org = await ctx.db.get(bound.orgId);
      if (
        !org ||
        org.type !== identity.kind ||
        normalizedIdentity(org.name) !== normalizedIdentity(identity.name)
      )
        throw new ScanAttention(
          "Previously matched organization identity changed",
        );
      boundIds.push(org._id);
    }
  }
  const contactEmail = normalizedIdentity(identity.contactEmail);
  const [contacts, named, users, addresses] = await Promise.all([
    ctx.db
      .query("organizations")
      .withIndex("scan_contact", (q) =>
        q.eq("primaryContactEmail", contactEmail),
      )
      .take(21),
    ctx.db
      .query("organizations")
      .withIndex("name", (q) => q.eq("name", identity.name))
      .take(21),
    ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", contactEmail))
      .take(21),
    identity.address
      ? ctx.db
          .query("organizations")
          .withIndex("scan_address", (q) =>
            q
              .eq("mailingAddress.street1", identity.address!.street1)
              .eq("mailingAddress.zip", identity.address!.zip),
          )
          .take(21)
      : Promise.resolve([]),
  ]);
  if (contacts.length > 20 || named.length > 20 || users.length > 20)
    throw new ScanAttention("Identity has too many conflicting exact matches");
  const memberOrgs: Doc<"organizations">[] = [];
  for (const user of users) {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", user._id))
      .take(21);
    if (memberships.length > 20)
      throw new ScanAttention("Contact belongs to too many organizations");
    for (const membership of memberships) {
      const org = await ctx.db.get(membership.orgId);
      if (org) memberOrgs.push(org);
    }
  }
  const discovered = (
    await Promise.all(
      [...new Set([...discoveredIds, ...boundIds])].map((id) => ctx.db.get(id)),
    )
  ).filter((org): org is Doc<"organizations"> => !!org);
  const organizations = [
    ...new Map(
      [...contacts, ...named, ...memberOrgs, ...discovered, ...addresses].map(
        (org) => [org._id, org],
      ),
    ).values(),
  ];
  const sameName = organizations.filter(
    (org) =>
      org.type === identity.kind &&
      normalizedIdentity(org.name) === normalizedIdentity(identity.name),
  );
  if (
    !sameName.length &&
    (contacts.length || memberOrgs.length || addresses.length)
  )
    throw new ScanAttention(
      "A known participant is associated with a different organization name; review the legal identity before creating a record",
    );
  const matches: Doc<"organizations">[] = [];
  for (const org of sameName) {
    const emailMatches =
      normalizedIdentity(org.primaryContactEmail ?? "") === contactEmail ||
      memberOrgs.some((memberOrg) => memberOrg._id === org._id);
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
    selection.organizationIds,
  );
  if (!org)
    return {
      org: null,
      request: null,
      record: null,
      outreachLogDocument: null,
    };
  let request: Doc<"procurementRequests"> | null = null;
  if ("request" in operation) {
    const requests = await ctx.db
      .query("procurementRequests")
      .withIndex("title", (q) =>
        q.eq("clientOrgId", org._id).eq("title", operation.request.title),
      )
      .take(21);
    if (requests.length > 20)
      throw new ScanAttention(
        "Several requests have this exact title; choose one explicitly",
      );
    const normalizedRequests = await ctx.db
      .query("procurementRequests")
      .withIndex("normalized_title", (q) =>
        q
          .eq("clientOrgId", org._id)
          .eq("normalizedTitle", normalizedIdentity(operation.request.title)),
      )
      .take(21);
    if (normalizedRequests.length > 20)
      throw new ScanAttention(
        "Several requests have this title; choose one explicitly",
      );
    const discoveredRequests = (
      await Promise.all(
        (selection.requestIds ?? []).map((id) => ctx.db.get(id)),
      )
    ).filter(
      (r): r is Doc<"procurementRequests"> => !!r && r.clientOrgId === org._id,
    );
    const candidates = [
      ...new Map(
        [...requests, ...normalizedRequests, ...discoveredRequests].map((r) => [
          r._id,
          r,
        ]),
      ).values(),
    ];
    const matches = (
      await Promise.all(
        candidates.map(async (candidate) => ({
          request: candidate,
          narrative: await requestNarrative(ctx, candidate, {
            includePrivate: true,
          }),
        })),
      )
    )
      .filter(
        ({ request: candidate, narrative }) =>
          normalizedIdentity(candidate.title) ===
            normalizedIdentity(operation.request.title) &&
          normalizedIdentity(`${candidate.title} ${narrative}`).includes(
            normalizedIdentity(operation.request.coverage),
          ),
      )
      .map(({ request: candidate }) => candidate);
    request = selection.selectedRequestId
      ? await ctx.db.get(selection.selectedRequestId)
      : (matches[0] ?? null);
    if (request && request.clientOrgId !== org._id)
      throw new ScanAttention("Request belongs to a different client");
    if (
      request &&
      !normalizedIdentity(
        `${request.title} ${await requestNarrative(ctx, request, { includePrivate: true })}`,
      ).includes(normalizedIdentity(operation.request.coverage))
    )
      throw new ScanAttention(
        "Selected request does not match the coverage in the evidence",
      );
    if (!selection.selectedRequestId && matches.length > 1)
      throw new ScanAttention("Several requests match the same coverage");
    if (operation.kind !== "create_request" && !request)
      throw new ScanAttention(
        "The exact coverage request could not be resolved",
      );
  }
  let record: ScanTarget["record"] = request ?? org;
  let outreachLogDocument: Doc<"markdownDocuments"> | null = null;
  if (operation.kind === "company_facts")
    record = await getMarkdownDocument(ctx, {
      orgId: org._id,
      kind: "company_wiki",
    });
  if (operation.kind === "broker_capabilities")
    record = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", org._id))
      .unique();
  if (operation.kind === "market_activity" && request) {
    const broker = await resolveScanOrganization(ctx, operation.brokerIdentity);
    if (!broker) throw new ScanAttention("Exact broker identity is required");
    const rows = await ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request_broker", (q) =>
        q.eq("requestId", request!._id).eq("brokerOrgId", broker._id),
      )
      .take(2);
    if (rows.length > 1)
      throw new ScanAttention(
        "Several market records match this request and broker",
      );
    record = rows[0] ?? null;
    if (rows[0])
      outreachLogDocument = await getMarkdownDocument(ctx, {
        orgId: org._id,
        outreachId: rows[0]._id,
        kind: "outreach_log",
      });
  }
  return { org, request, record, outreachLogDocument };
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
        : await createStandaloneClientOrganizationByOperator(ctx, {
            operatorUserId,
            name: op.identity.name,
            website: op.website ?? undefined,
            operatorStatus: "live",
          });
    await ctx.db.patch(orgId, {
      mailingAddress: op.identity.address,
      primaryContactEmail: op.identity.contactEmail,
    });
    for (const identityKey of scanIdentityKeys(op.identity))
      await ctx.db.insert("operatorWorkspaceScanIdentities", {
        identityKey,
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
      replaces: op.replaces,
    });
    if (!id) throw new ScanAttention("No company facts supplied");
    return { table: "markdownDocuments" as const, id, created: !target.record };
  }
  if (op.kind === "broker_capabilities") {
    if (org.type !== "broker")
      throw new ScanAttention("Capabilities must belong to a broker");
    if (target.record)
      await assertScanChronology(ctx, target.record, effectiveAt);
    await updateBrokerProfileByOperator(ctx, {
      operatorUserId,
      brokerOrgId: org._id,
      writingStates: [
        ...new Set([
          ...(target.record && "writingStates" in target.record
            ? target.record.writingStates
            : []),
          ...op.writingStates,
        ]),
      ].filter(
        (code) =>
          !op.removeWritingStates
            .map((value) => value.toUpperCase())
            .includes(code.toUpperCase()),
      ),
      lineOfBusinessCodes: [
        ...new Set([
          ...(target.record && "lineOfBusinessCodes" in target.record
            ? target.record.lineOfBusinessCodes
            : []),
          ...op.lineOfBusinessCodes,
        ]),
      ].filter(
        (code) =>
          !op.removeLineOfBusinessCodes
            .map((value) => value.toUpperCase())
            .includes(code.toUpperCase()),
      ),
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
    const previous =
      target.record && "brokerName" in target.record ? target.record : null;
    if (previous) {
      await assertScanChronology(ctx, previous, effectiveAt);
      if (target.outreachLogDocument)
        await assertScanChronology(
          ctx,
          target.outreachLogDocument,
          effectiveAt,
        );
      await updateProcurementOutreachByOperator(ctx, {
        operatorUserId,
        outreachId: previous._id,
        log: [await readOutreachLog(ctx, previous), op.log]
          .filter(Boolean)
          .join("\n\n"),
        status: op.observedStatus ?? undefined,
        source: "workspace_scan",
      });
      return {
        table: "procurementBrokerOutreaches" as const,
        id: previous._id,
        created: false,
      };
    }
    const created = await createProcurementOutreachByOperator(ctx, {
      operatorUserId,
      requestId: target.request._id,
      brokerOrgId: broker._id,
      status: op.observedStatus ?? "observed",
      log: op.log,
      source: "workspace_scan",
    });
    return {
      table: "procurementBrokerOutreaches" as const,
      id: created.outreachId,
      created: true,
    };
  }
  throw new Error(
    "Policy imports require the separately validated attachment entrypoint",
  );
}
