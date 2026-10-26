import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireRequest } from "../procurementRequests";
import {
  assertExternalBrokerIdentity,
  brokerRegionCountry,
  brokerWritingCountries,
  isSpotOwnedBrokerIdentity,
  normalizeBrokerLineOfBusinessCodes,
  normalizeBrokerWritingStates,
  resolveBrokerAppetite,
} from "./brokerProfileValidation";
import {
  brokerCreateInput,
  brokerUpdateInput,
  ensureBrokerProfilesInput,
  updateBrokerProfilesInput,
} from "./operatorBrokerInputs";
import { NoWriteInputError } from "./noWriteInputError";

export function providerDomain(value: string) {
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`,
    );
  } catch {
    throw new NoWriteInputError(
      "invalid_provider_domain",
      "Supply a valid provider hostname or HTTP(S) website.",
    );
  }
  const domain = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    !domain.includes(".") ||
    !/^[a-z0-9.-]+$/.test(domain)
  ) {
    throw new NoWriteInputError(
      "invalid_provider_domain",
      "Supply a valid provider hostname or HTTP(S) website.",
    );
  }
  return domain;
}
function storedDomain(value?: string) {
  if (!value) return undefined;
  try {
    return providerDomain(value);
  } catch {
    return undefined;
  }
}
const normalizedName = (name: string) => name.trim().toLowerCase();

export async function providerDirectory(ctx: QueryCtx) {
  const brokers = await ctx.db
    .query("organizations")
    .withIndex("deletion_type", (q) =>
      q.eq("deletedAt", undefined).eq("type", "broker"),
    )
    .take(5_001);
  if (brokers.length > 5_000) {
    throw new NoWriteInputError(
      "provider_directory_bounded",
      "Provider identity scan exceeded 5,000 rows; no writes were made. Use exact provider IDs to update existing profiles.",
    );
  }
  return brokers;
}
export function matchProvider(
  brokers: Doc<"organizations">[],
  identity: { name?: string; website?: string },
) {
  const domain = storedDomain(identity.website);
  const domainMatches = domain
    ? brokers.filter((broker) => storedDomain(broker.website) === domain)
    : [];
  const matches = domainMatches.length
    ? domainMatches
    : identity.name
      ? brokers.filter(
          (broker) =>
            normalizedName(broker.name) === normalizedName(identity.name!),
        )
      : [];
  if (matches.length > 1) {
    throw new NoWriteInputError(
      "ambiguous_provider_identity",
      `Multiple providers match ${domain ?? identity.name}; resolve the exact provider ID before writing.`,
    );
  }
  const match = matches[0];
  if (match) assertExternalBrokerIdentity(match);
  return match;
}
export function validateProviderFields(
  input: Parameters<typeof resolveBrokerAppetite>[0] & {
    name?: string;
    website?: string | null;
    lineOfBusinessCodes?: string[];
  },
  existing?: Doc<"brokerProfiles"> | null,
) {
  assertExternalBrokerIdentity(input);
  resolveBrokerAppetite(input, existing);
  if (input.lineOfBusinessCodes)
    normalizeBrokerLineOfBusinessCodes(input.lineOfBusinessCodes);
}
export async function validateProviderCreate(ctx: MutationCtx, input: unknown) {
  const parsed = brokerCreateInput.parse(input);
  validateProviderFields(parsed);
  const duplicate = matchProvider(await providerDirectory(ctx), parsed);
  if (duplicate)
    throw new NoWriteInputError(
      "duplicate_provider",
      `Provider ${duplicate.name} is already registered as ${duplicate._id}; update that profile instead.`,
    );
  return parsed;
}
export async function validateProviderUpdate(ctx: MutationCtx, input: unknown) {
  const parsed = brokerUpdateInput.parse(input);
  const id = ctx.db.normalizeId("organizations", parsed.brokerOrgId);
  const broker = id ? await ctx.db.get(id) : null;
  if (!broker || broker.type !== "broker" || broker.deletedAt !== undefined) {
    throw new NoWriteInputError(
      "invalid_identifier",
      "Active external provider not found.",
    );
  }
  assertExternalBrokerIdentity(broker);
  assertExternalBrokerIdentity({ ...broker, ...parsed });
  const profile = await ctx.db
    .query("brokerProfiles")
    .withIndex("broker", (q) => q.eq("brokerOrgId", broker._id))
    .unique();
  validateProviderFields(parsed, profile);
  return { ...parsed, brokerOrgId: broker._id };
}
export async function prepareEnsureProviders(ctx: MutationCtx, input: unknown) {
  const parsed = ensureBrokerProfilesInput.parse(input);
  let requestId: Id<"procurementRequests"> | undefined;
  if (parsed.attachToProcurementRequestId) {
    requestId =
      ctx.db.normalizeId(
        "procurementRequests",
        parsed.attachToProcurementRequestId,
      ) ?? undefined;
    if (!requestId)
      throw new NoWriteInputError(
        "invalid_identifier",
        "Invalid procurement request ID.",
      );
    const request = await requireRequest(ctx, requestId);
    if (request.deletedAt !== undefined)
      throw new NoWriteInputError(
        "invalid_identifier",
        "Procurement request not found.",
      );
  }
  const brokers = await providerDirectory(ctx);
  const items = parsed.items.map((item) => {
    const domain = item.domain ? providerDomain(item.domain) : undefined;
    if (domain && item.website && domain !== providerDomain(item.website)) {
      throw new NoWriteInputError(
        "provider_identity_mismatch",
        `Domain and website disagree for ${item.name ?? domain}.`,
      );
    }
    const website = item.website ?? (domain ? `https://${domain}` : undefined);
    const name = item.name ?? (website ? providerDomain(website) : "");
    const fields = { ...item, name, website };
    validateProviderFields(fields);
    matchProvider(brokers, fields);
    return { input: item, fields };
  });
  return { items, brokers, requestId };
}
export async function prepareUpdateProviders(ctx: MutationCtx, input: unknown) {
  const parsed = updateBrokerProfilesInput.parse(input);
  const items = [];
  for (const item of parsed.items) {
    const fields = await validateProviderUpdate(ctx, {
      ...item.patch,
      brokerOrgId: item.orgId,
    });
    items.push({ orgId: fields.brokerOrgId, fields });
  }
  return items;
}

export async function listProviderPage(
  ctx: QueryCtx,
  input: {
    query?: string;
    queries?: string[];
    domains?: string[];
    status?: string;
    writingState?: string;
    lineOfBusinessCode?: string;
    limit?: number;
    cursor?: string;
  },
) {
  const state = input.writingState
    ? normalizeBrokerWritingStates([input.writingState])[0]
    : undefined;
  const line = input.lineOfBusinessCode
    ? normalizeBrokerLineOfBusinessCodes([input.lineOfBusinessCode])[0]
    : undefined;
  const domains = input.domains?.map(providerDomain);
  const page = await ctx.db
    .query("organizations")
    .withIndex("deletion_type", (q) =>
      q.eq("deletedAt", undefined).eq("type", "broker"),
    )
    .paginate({ numItems: input.limit ?? 50, cursor: input.cursor ?? null });
  const rows: Array<{
    broker: Pick<Doc<"organizations">, "_id" | "name" | "website">;
    profile: (Doc<"brokerProfiles"> & { writingCountries: string[] }) | null;
  }> = [];
  for (const broker of page.page) {
    if (isSpotOwnedBrokerIdentity(broker)) continue;
    const profile = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", broker._id))
      .unique();
    if (input.status && profile?.networkStatus !== input.status) continue;
    if (line && !profile?.lineOfBusinessCodes.includes(line)) continue;
    if (
      state &&
      (!profile ||
        profile.excludedStates?.includes(state) ||
        !(
          profile.writingStates.includes(state) ||
          profile.nationwideCountries?.includes(brokerRegionCountry(state))
        ))
    )
      continue;
    rows.push({
      broker: { _id: broker._id, name: broker.name, website: broker.website },
      profile: profile
        ? { ...profile, writingCountries: brokerWritingCountries(profile) }
        : null,
    });
  }
  const matchesQuery = (row: (typeof rows)[number], query: string) =>
    [row.broker.name, row.broker.website].some((value) =>
      value?.toLowerCase().includes(query.trim().toLowerCase()),
    );
  const queryRows = input.query
    ? rows.filter((row) => matchesQuery(row, input.query!))
    : rows;
  const groups = [
    ...(input.queries ?? []).map((query) => ({
      query,
      orgIds: queryRows
        .filter((row) => matchesQuery(row, query))
        .map((row) => row.broker._id),
    })),
    ...(input.domains ?? []).map((domain, index) => ({
      domain,
      orgIds: queryRows
        .filter((row) => storedDomain(row.broker.website) === domains![index])
        .map((row) => row.broker._id),
    })),
  ];
  return {
    profiles: groups.length
      ? queryRows.filter((row) =>
          groups.some((group) => group.orgIds.includes(row.broker._id)),
        )
      : queryRows,
    ...(groups.length ? { groups } : {}),
    nextCursor: page.isDone ? null : page.continueCursor,
    bounded: !page.isDone,
    scanned: page.page.length,
  };
}
