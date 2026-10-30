import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  claimCompanyResearch,
  scheduleCompanyResearch,
} from "../companyResearch";
import type { ClRouterResearchFieldType } from "./clRouterClient";
import { publicResearchUrl } from "./companyResearch";
import type { OrgWikiSectionKey } from "./orgWiki";
import { companyResearchStatus } from "./researchStatus";

/**
 * Book-wide client profile research: one cl-router `research_batch` job
 * researches up to 50 clients' public profile facts. Each client keeps the
 * company research lease, status and fact store of single-client research;
 * verified answers become cited facts in its company Markdown.
 */

export const MAX_PROFILE_BATCH_CLIENTS = 50;

const OWNERSHIP = [
  "private",
  "public",
  "nonprofit",
  "government",
  "subsidiary",
  "unknown",
];

export type ClientProfileField = {
  key: string;
  type: ClRouterResearchFieldType;
  description: string;
  options?: string[];
  section: OrgWikiSectionKey;
  /** Fact content starts with it, so a newer verified value supersedes the stored one. */
  label: string;
  /** The value as stored fact text, or null when it does not fit the field. */
  format: (value: string | number | boolean | null) => string | null;
};

const count = (min: number, max: number) => (value: unknown) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max
    ? String(value)
    : null;
const text = (max: number) => (value: unknown) =>
  (typeof value === "string" &&
    value.replace(/\s+/g, " ").trim().slice(0, max)) ||
  null;

export const CLIENT_PROFILE_FIELDS: ClientProfileField[] = [
  {
    key: "year_founded",
    type: "number",
    description: "The year the company was founded or established.",
    section: "profile",
    label: "Founded ",
    format: (value) =>
      count(1600, dayjs().year())(value) && `Founded ${String(value)}`,
  },
  {
    key: "employee_count",
    type: "number",
    description:
      "The company's latest published total headcount (number of employees).",
    section: "scale",
    label: "Employees: ",
    format: (value) =>
      count(1, 10_000_000)(value) &&
      `Employees: ${String(value)} (latest published total headcount)`,
  },
  {
    key: "primary_operations",
    type: "string",
    description:
      "What the company actually does: its main products, services or operations, in one or two sentences.",
    section: "operations",
    label: "Primary operations: ",
    format: (value) => {
      const operations = text(500)(value);
      return operations && `Primary operations: ${operations}`;
    },
  },
  {
    key: "industry",
    type: "string",
    description: "The company's industry.",
    section: "profile",
    label: "Industry: ",
    format: (value) => {
      const industry = text(200)(value);
      return industry && `Industry: ${industry}`;
    },
  },
  {
    key: "headquarters",
    type: "string",
    description:
      "The city and state (or region) of the company's headquarters.",
    section: "operations",
    label: "Headquarters: ",
    format: (value) => {
      const headquarters = text(200)(value);
      return headquarters && `Headquarters: ${headquarters}`;
    },
  },
  {
    key: "location_count",
    type: "number",
    description:
      "The number of physical locations (offices, stores, plants or sites) the company operates.",
    section: "operations",
    label: "Locations: ",
    format: (value) =>
      count(1, 1_000_000)(value) && `Locations: ${String(value)}`,
  },
  {
    key: "ownership",
    type: "enum",
    description:
      "The company's ownership: private, public (publicly traded), nonprofit, government, subsidiary (owned by another company), or unknown.",
    options: OWNERSHIP,
    section: "profile",
    label: "Ownership: ",
    // Unknown is not a fact.
    format: (value) =>
      typeof value === "string" &&
      OWNERSHIP.includes(value) &&
      value !== "unknown"
        ? `Ownership: ${value}`
        : null,
  },
];

export type ClientResearchEntity = {
  name: string;
  website?: string;
  location?: string;
};

/** Only public identity facts reach providers: name, website and city/region. */
export function clientResearchEntity(
  org: Doc<"organizations">,
): ClientResearchEntity {
  const rawWebsite = org.website?.trim();
  const website =
    rawWebsite &&
    publicResearchUrl(
      /^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`,
    );
  const details = org.intakeBusinessProfile?.details;
  const address = details?.registrationAddress ?? details?.mailingAddress;
  const location = [address?.city, address?.state]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ")
    .slice(0, 200);
  return {
    name: org.name.trim().slice(0, 200),
    ...(website ? { website } : {}),
    ...(location ? { location } : {}),
  };
}

/** Exact, distinct, live client organizations, in input order. */
export async function requireProfileBatchClients(
  ctx: QueryCtx,
  orgIds: unknown[],
) {
  if (!orgIds.length || orgIds.length > MAX_PROFILE_BATCH_CLIENTS)
    throw new Error(`Research 1–${MAX_PROFILE_BATCH_CLIENTS} clients per call`);
  if (new Set(orgIds).size !== orgIds.length)
    throw new Error("Client organization IDs must be distinct");
  const clients: Doc<"organizations">[] = [];
  for (const value of orgIds) {
    const orgId =
      typeof value === "string"
        ? ctx.db.normalizeId("organizations", value)
        : null;
    const org = orgId ? await ctx.db.get(orgId) : null;
    if (!org || org.deletedAt !== undefined || org.type !== "client")
      throw new Error(`Client organization ${String(value)} not found`);
    clients.push(org);
  }
  return clients;
}

export async function clientProfileResearchSummary(
  ctx: QueryCtx,
  orgIds: unknown[],
) {
  const clients = await requireProfileBatchClients(ctx, orgIds);
  return [
    `Research public profile facts for ${clients.length} client${clients.length === 1 ? "" : "s"}`,
    ...clients.map(
      (org) => `- ${org.name.replace(/\s+/g, " ").trim() || org._id}`,
    ),
  ].join("\n");
}

const isActive = (org: Doc<"organizations">) =>
  org.companyResearch?.status === "pending" ||
  org.companyResearch?.status === "running";

/**
 * Lease each client's company research to one batch runner. Clients whose
 * research is already queued or running are reported and skipped.
 */
export async function queueClientProfileBatchResearch(
  ctx: MutationCtx,
  orgIds: Id<"organizations">[],
) {
  const clients = await requireProfileBatchClients(ctx, orgIds);
  const items = [];
  const skipped = new Set<Id<"organizations">>();
  for (const org of clients) {
    const claim =
      !isActive(org) &&
      (await scheduleCompanyResearch(ctx, org._id, {
        force: true,
        run: false,
      }))
        ? await claimCompanyResearch(ctx, org._id)
        : null;
    if (!claim) {
      skipped.add(org._id);
      continue;
    }
    items.push({
      orgId: org._id,
      leaseId: claim.leaseId,
      fingerprint: claim.fingerprint,
      entity: clientResearchEntity(org),
    });
  }
  if (items.length)
    await ctx.scheduler.runAfter(
      0,
      internal.actions.clientProfileBatchResearch.run,
      { items },
    );
  const results = [];
  for (const org of clients) {
    const current = (await ctx.db.get(org._id))!;
    results.push({
      orgId: org._id,
      outcome: skipped.has(org._id)
        ? ("already_running" as const)
        : ("queued" as const),
      research: companyResearchStatus(current),
    });
  }
  return { queued: items.length, skipped: skipped.size, results };
}
