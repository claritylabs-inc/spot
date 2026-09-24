import type {
  OperationalAddress,
  OperationalParty,
  PolicyOperationalProfile,
  SourceBackedValue,
} from "@claritylabs/cl-sdk";
import {
  carrierLegalEntityNames,
  formatCarrierLegalEntityNames,
  readCarrierIdentity,
  sameCarrierIdentityName,
} from "./carrierIdentity";

export type PolicyPartyAddress = string | OperationalAddress;

type ResolvedParty = Omit<OperationalParty, "address"> & {
  address?: PolicyPartyAddress;
  naicNumber?: string;
  licenseNumber?: string;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceBackedText(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return text((value as Partial<SourceBackedValue>).value);
}

function address(value: unknown): PolicyPartyAddress | undefined {
  const stringValue = text(value);
  if (stringValue) return stringValue;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const result: OperationalAddress = {
    street1: text(record.street1),
    street2: text(record.street2),
    city: text(record.city),
    state: text(record.state),
    zip: text(record.zip),
    country: text(record.country),
    formatted: text(record.formatted),
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

function normalizedIdentity(value: unknown) {
  return text(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchingIdentifier(
  resolvedName: string | undefined,
  candidates: Array<{ name?: unknown; identifier?: unknown }>,
) {
  const resolvedIdentity = normalizedIdentity(resolvedName);
  if (!resolvedIdentity) return undefined;
  const match = candidates.find((candidate) =>
    normalizedIdentity(candidate.name) === resolvedIdentity && text(candidate.identifier)
  );
  return text(match?.identifier);
}

function profileParty(
  profile: Partial<PolicyOperationalProfile>,
  roles: readonly string[],
): ResolvedParty | undefined {
  const accepted = new Set(roles);
  const parties: ResolvedParty[] = Array.isArray(profile.parties)
    ? profile.parties as ResolvedParty[]
    : [];
  const candidates = parties.filter((candidate) =>
    accepted.has(String(candidate.role).toLowerCase()),
  );
  const party = candidates.find((candidate) => address(candidate.address)) ?? candidates[0];
  if (!party?.name?.trim()) return undefined;
  const sameIdentity = candidates.filter((candidate) =>
    normalizedIdentity(candidate.name) === normalizedIdentity(party.name),
  );
  return {
    role: party.role,
    name: party.name.trim(),
    address: address(party.address),
    naicNumber: matchingIdentifier(party.name, sameIdentity.map((candidate) => ({
      name: candidate.name,
      identifier: candidate.naicNumber,
    }))),
    licenseNumber: matchingIdentifier(party.name, sameIdentity.map((candidate) => ({
      name: candidate.name,
      identifier: candidate.licenseNumber,
    }))),
    sourceNodeIds: [...new Set(sameIdentity.flatMap((candidate) => candidate.sourceNodeIds ?? []))],
    sourceSpanIds: [...new Set(sameIdentity.flatMap((candidate) => candidate.sourceSpanIds ?? []))],
  };
}

function compatibilityRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function ownedRecord(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? compatibilityRecord(record[key])
    : undefined;
}

function upsertResolvedParty(
  parties: ResolvedParty[],
  roles: readonly string[],
  fallbackRole: string,
  name: string | undefined,
  partyAddress: PolicyPartyAddress | undefined,
  provenance: Record<string, unknown> = {},
) {
  if (!name) return;
  const accepted = new Set(roles);
  const existing = parties.find((party) =>
    accepted.has(String(party.role).toLowerCase()) &&
    party.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (existing) {
    existing.address ??= partyAddress;
    existing.naicNumber ??= text(provenance.naicNumber);
    existing.licenseNumber ??= text(provenance.licenseNumber);
    return;
  }
  const documentNodeId = text(provenance.documentNodeId);
  parties.push({
    role: fallbackRole,
    name,
    address: partyAddress,
    naicNumber: text(provenance.naicNumber),
    licenseNumber: text(provenance.licenseNumber),
    sourceNodeIds: Array.isArray(provenance.sourceNodeIds)
      ? provenance.sourceNodeIds.filter((id): id is string => typeof id === "string")
      : documentNodeId ? [documentNodeId] : [],
    sourceSpanIds: Array.isArray(provenance.sourceSpanIds)
      ? provenance.sourceSpanIds.filter((id): id is string => typeof id === "string")
      : [],
  });
}

export function resolvePolicyPartyContext(
  policy: Record<string, any>,
) {
  const profile = compatibilityRecord(policy.operationalProfile) as Partial<PolicyOperationalProfile>;
  const producer = compatibilityRecord(policy.producer);
  const insurer = compatibilityRecord(policy.insurer);
  const generalAgent = compatibilityRecord(policy.generalAgent);
  const detailOverrides = compatibilityRecord(policy.policyDetailOverrides);
  const insuredOverride = ownedRecord(detailOverrides, "insured");
  const producerOverride = ownedRecord(detailOverrides, "producer");
  const insurerOverride = ownedRecord(detailOverrides, "insurer");
  const generalAgentOverride = ownedRecord(detailOverrides, "generalAgent");

  const insuredParty = profileParty(profile, ["named_insured"]);
  const producerParty = profileParty(profile, ["producer", "broker"]);
  const insurerParty = profileParty(profile, ["insurer"]);
  const carrierParty = profileParty(profile, ["carrier"]);
  const generalAgentParty = profileParty(profile, ["general_agent"]);
  const declarationFacts = Array.isArray(profile.declarationFacts)
    ? profile.declarationFacts as Array<{ field?: string; address?: unknown }>
    : [];
  const sourceBackedMailingAddress = declarationFacts.length > 0
    ? address(declarationFacts.find((fact) => fact.field === "mailingAddress")?.address)
    : undefined;

  const insuredName = insuredOverride
    ? text(insuredOverride.name)
    : insuredParty?.name ??
      sourceBackedText(profile.namedInsured) ??
      text(policy.insuredName);
  const insuredAddress = insuredOverride
    ? address(insuredOverride.address)
    : insuredParty?.address ??
      sourceBackedMailingAddress ??
      address(policy.insuredAddress);
  const producerName = producerOverride
    ? text(producerOverride.name)
    : producerParty?.name ??
      sourceBackedText(profile.broker) ??
      text(producer.agencyName);
  const producerAddress = producerOverride
    ? address(producerOverride.address)
    : producerParty?.address ??
      address(producer.address);
  const producerContactName = producerOverride
    ? text(producerOverride.contactName)
    : text(producer.contactName);
  const producerPhone = producerOverride
    ? text(producerOverride.phone)
    : text(producer.phone);
  const producerEmail = producerOverride
    ? text(producerOverride.email)
    : text(producer.email);
  const producerLicenseNumber = producerOverride
    ? text(producerOverride.licenseNumber)
    : matchingIdentifier(producerName, [
      { name: producerParty?.name, identifier: producerParty?.licenseNumber },
      { name: producer.agencyName, identifier: producer.licenseNumber },
    ]);
  const carrierIdentity = insurerOverride
    ? undefined
    : readCarrierIdentity(policy.carrierIdentity);
  const extractedCarrierLegalNames = carrierLegalEntityNames(carrierIdentity);
  const insurerName = insurerOverride
    ? text(insurerOverride.name)
    : formatCarrierLegalEntityNames(carrierIdentity) ??
      insurerParty?.name ??
      carrierParty?.name ??
      sourceBackedText(profile.insurer) ??
      text(insurer.legalName) ??
      text(policy.carrierLegalName) ??
      text(policy.security) ??
      text(policy.carrier);
  const carrierDisplayName = insurerOverride
    ? text(insurerOverride.name)
    : carrierIdentity?.displayName ??
      carrierParty?.name ??
      text(policy.carrier) ??
      insurerName;
  const carrierOperatingName = insurerOverride
    ? undefined
    : carrierIdentity?.operatingName;
  const insurerLegalNames = insurerOverride
    ? [text(insurerOverride.name)].filter(
      (value): value is string => Boolean(value),
    )
    : extractedCarrierLegalNames.length > 0
      ? extractedCarrierLegalNames
      : [insurerName].filter((value): value is string => Boolean(value));
  const hasMultipleLegalEntities = insurerLegalNames.length > 1;
  const resolvedInsurerParty = carrierIdentity
    ? [insurerParty, carrierParty].find((party) =>
        party &&
        extractedCarrierLegalNames.some((legalName) =>
          normalizedIdentity(party.name) === normalizedIdentity(legalName),
        ),
      )
    : insurerParty ?? carrierParty;
  const insurerAddress = insurerOverride
    ? address(insurerOverride.address)
    : hasMultipleLegalEntities
      ? undefined
      : resolvedInsurerParty?.address ??
      address(insurer.address);
  const insurerNaicNumber = insurerOverride
    ? text(insurerOverride.naicNumber)
    : hasMultipleLegalEntities
      ? undefined
      : matchingIdentifier(insurerName, [
      {
        name: resolvedInsurerParty?.name,
        identifier: resolvedInsurerParty?.naicNumber,
      },
      { name: insurer.legalName, identifier: insurer.naicNumber },
      {
        name: text(policy.carrierLegalName) ?? text(policy.security) ?? text(policy.carrier),
        identifier: policy.carrierNaicNumber,
      },
    ]);
  const extractedGeneralAgentName =
    generalAgentParty?.name ??
    text(generalAgent.agencyName) ??
    text(generalAgent.name);
  const suppressExtractedGeneralAgent = Boolean(
    !generalAgentOverride &&
    carrierOperatingName &&
    normalizedIdentity(extractedGeneralAgentName) ===
      normalizedIdentity(carrierOperatingName),
  );
  const generalAgentName = generalAgentOverride
    ? text(generalAgentOverride.name)
    : suppressExtractedGeneralAgent ? undefined : extractedGeneralAgentName;
  const generalAgentAddress = generalAgentOverride
    ? address(generalAgentOverride.address)
    : suppressExtractedGeneralAgent
      ? undefined
      : generalAgentParty?.address ??
      address(generalAgent.address);
  const generalAgentLicenseNumber = generalAgentOverride
    ? text(generalAgentOverride.licenseNumber)
    : suppressExtractedGeneralAgent
      ? undefined
      : matchingIdentifier(generalAgentName, [
      {
        name: generalAgentParty?.name,
        identifier: generalAgentParty?.licenseNumber,
      },
      {
        name: text(generalAgent.agencyName) ?? text(generalAgent.name),
        identifier: generalAgent.licenseNumber,
      },
    ]);
  const operationsDescription = Object.prototype.hasOwnProperty.call(
    detailOverrides,
    "operationsDescription",
  )
    ? text(detailOverrides.operationsDescription)
    : sourceBackedText(profile.operationsDescription);
  const additionalNamedInsureds = insuredOverride
    ? (Array.isArray(insuredOverride.additionalNamedInsureds)
      ? insuredOverride.additionalNamedInsureds
        .map(text)
        .filter((value): value is string => Boolean(value))
      : [])
    : Array.isArray(policy.additionalNamedInsureds)
      ? policy.additionalNamedInsureds
        .map((insured: unknown) => typeof insured === "string"
          ? text(insured)
          : text(compatibilityRecord(insured).name))
        .filter((value: string | undefined): value is string => Boolean(value))
      : [];
  const primaryDisplayName =
    carrierDisplayName ?? insurerName ?? generalAgentName;

  const rawParties: unknown[] = Array.isArray(profile.parties) ? profile.parties : [];
  const overriddenRoles = new Set<string>([
    ...(insuredOverride ? ["named_insured"] : []),
    ...(producerOverride ? ["producer", "broker"] : []),
    ...(insurerOverride ? ["insurer", "carrier"] : []),
    ...(generalAgentOverride ? ["general_agent"] : []),
  ]);
  const parties = rawParties
    .filter((party): party is OperationalParty =>
      Boolean(
        party &&
        typeof party === "object" &&
        !Array.isArray(party) &&
        text((party as { name?: unknown }).name) &&
        !overriddenRoles.has(
          String((party as { role?: unknown }).role).toLowerCase(),
        ) &&
        !(
          suppressExtractedGeneralAgent &&
          ["general_agent"].includes(
            String((party as { role?: unknown }).role).toLowerCase(),
          ) &&
          normalizedIdentity((party as { name?: unknown }).name) ===
            normalizedIdentity(carrierOperatingName)
        ),
      ),
    )
    .map((party: OperationalParty) => {
      const record = party as ResolvedParty;
      return {
        ...record,
        name: record.name.trim(),
        address: address(record.address),
        sourceNodeIds: record.sourceNodeIds ?? [],
        sourceSpanIds: record.sourceSpanIds ?? [],
      };
    });
  upsertResolvedParty(
    parties,
    ["named_insured"],
    "named_insured",
    insuredName,
    insuredAddress,
    insuredOverride ? {} : compatibilityRecord(policy.insuredAddress),
  );
  upsertResolvedParty(
    parties,
    ["producer", "broker"],
    "producer",
    producerName,
    producerAddress,
    producerOverride
      ? { ...producerOverride, licenseNumber: producerLicenseNumber }
      : { ...producer, licenseNumber: producerLicenseNumber },
  );
  if (!hasMultipleLegalEntities || insurerOverride) {
    upsertResolvedParty(
      parties,
      ["insurer"],
      "insurer",
      insurerName,
      insurerAddress,
      insurerOverride
        ? { ...insurerOverride, naicNumber: insurerNaicNumber }
        : { ...insurer, naicNumber: insurerNaicNumber },
    );
  }
  upsertResolvedParty(
    parties,
    ["general_agent"],
    "general_agent",
    generalAgentName,
    generalAgentAddress,
    generalAgentOverride
      ? {
          ...generalAgentOverride,
          licenseNumber: generalAgentLicenseNumber,
        }
      : { ...generalAgent, licenseNumber: generalAgentLicenseNumber },
  );

  return {
    profile,
    parties,
    insuredName,
    insuredAddress,
    producerName,
    producerAddress,
    producerContactName,
    producerPhone,
    producerEmail,
    producerLicenseNumber,
    primaryDisplayName,
    carrierDisplayName,
    carrierOperatingName,
    carrierLegalEntityRelationship:
      carrierIdentity?.legalEntityRelationship ?? "single",
    insurerName,
    insurerLegalNames,
    insurerAddress,
    insurerNaicNumber,
    generalAgentName,
    generalAgentAddress,
    generalAgentLicenseNumber,
    operationsDescription,
    additionalNamedInsureds,
  };
}

export function resolvePolicyCarrierDisplay(policy: Record<string, any>) {
  const carrierIdentity = readCarrierIdentity(policy.carrierIdentity);
  const carrierDisplayName =
    resolvePolicyPartyContext(policy).carrierDisplayName ??
    carrierIdentity?.displayName ??
    text(policy.carrier) ??
    text(policy.security);
  const identityMatchesDisplay = carrierIdentity &&
    [
      carrierIdentity.displayName,
      carrierIdentity.sourceName,
      carrierIdentity.operatingName,
      ...carrierIdentity.legalEntities.map((entity) => entity.name),
    ].some((name) => sameCarrierIdentityName(name, carrierDisplayName));

  return {
    carrierDisplayName,
    carrierIdentity: identityMatchesDisplay ? carrierIdentity : undefined,
  };
}
