export const FEATURE_FLAGS = {
  connect_features: {
    id: "connect_features",
    label: "Connect features",
    description:
      "Show client and vendor connection pages, plus vendor requirements in Compliance.",
    scope: "org",
    defaultEnabled: false,
    allowedOrgTypes: ["client"],
    beta: true,
  },
} as const;

export type FeatureFlagId = keyof typeof FEATURE_FLAGS;
export type FeatureFlag = (typeof FEATURE_FLAGS)[FeatureFlagId];
export type FeatureFlagMap = Partial<Record<FeatureFlagId, boolean>>;
export type FeatureFlagOrgType = "broker" | "client";

export const featureFlagIds = Object.keys(FEATURE_FLAGS) as FeatureFlagId[];

type FeatureFlagOrg = {
  type?: FeatureFlagOrgType;
  orgType?: FeatureFlagOrgType;
  featureFlags?: FeatureFlagMap;
};

export function getFeatureFlagDefault(flagId: FeatureFlagId) {
  return FEATURE_FLAGS[flagId].defaultEnabled;
}

export function featureFlagAllowedForOrgType(
  flagId: FeatureFlagId,
  orgType: FeatureFlagOrgType,
) {
  return (FEATURE_FLAGS[flagId].allowedOrgTypes as readonly FeatureFlagOrgType[])
    .includes(orgType);
}

export function getFeatureFlagOrgType(
  org: FeatureFlagOrg | null | undefined,
): FeatureFlagOrgType {
  return org?.type ?? org?.orgType ?? "client";
}

export function featureFlagsForOrgType(orgType: FeatureFlagOrgType) {
  return featureFlagIds
    .map((flagId) => FEATURE_FLAGS[flagId])
    .filter((flag) => featureFlagAllowedForOrgType(flag.id, orgType));
}

export function betaFeatureFlagsForOrgType(orgType: FeatureFlagOrgType) {
  return featureFlagsForOrgType(orgType).filter((flag) => flag.beta);
}

export function isFeatureEnabled(
  org: FeatureFlagOrg | null | undefined,
  flagId: FeatureFlagId,
) {
  if (!org) return getFeatureFlagDefault(flagId);
  const orgType = getFeatureFlagOrgType(org);
  if (!featureFlagAllowedForOrgType(flagId, orgType)) return false;
  const value = org.featureFlags?.[flagId];
  if (value !== undefined) return value;
  return getFeatureFlagDefault(flagId);
}

export function setFeatureFlagPatch(
  flags: FeatureFlagMap | undefined,
  flagId: FeatureFlagId,
  enabled: boolean,
): FeatureFlagMap {
  return { ...(flags ?? {}), [flagId]: enabled };
}

export function assertFeatureFlagAllowedForOrg(
  flagId: FeatureFlagId,
  org: FeatureFlagOrg,
) {
  if (!FEATURE_FLAGS[flagId]) throw new Error("Unknown feature flag");
  const orgType = getFeatureFlagOrgType(org);
  if (!featureFlagAllowedForOrgType(flagId, orgType)) {
    throw new Error(
      `${FEATURE_FLAGS[flagId].label} is not available for ${orgType} organizations`,
    );
  }
}
