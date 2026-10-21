export type OperatorImpersonationTarget = {
  targetOrgId: string;
  targetOrgType: "broker" | "client";
};

export function getOperatorBrokerHref(targetOrgId: string) {
  return `/operator/brokers/${encodeURIComponent(targetOrgId)}`;
}

export function getOperatorImpersonationReturnHref(
  target: OperatorImpersonationTarget | null | undefined,
) {
  if (!target) return "/operator";

  return target.targetOrgType === "broker"
    ? getOperatorBrokerHref(target.targetOrgId)
    : `/operator/clients/${encodeURIComponent(target.targetOrgId)}`;
}
