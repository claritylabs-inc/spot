import type { StatusPresentation } from "@claritylabs-inc/ui/components/status-tag";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

type OperatorClientList = FunctionReturnType<typeof api.operator.listClients>;

export type OperatorClientRow = OperatorClientList[number];

export const OPERATOR_CLIENT_STATUSES = {
  limited: {
    label: "Limited",
    tone: "warning",
    indicator: "progress",
  },
  active: {
    label: "Active",
    tone: "success",
    indicator: "complete",
  },
} satisfies Record<
  NonNullable<OperatorClientRow["clientAccessStatus"]>,
  StatusPresentation & { label: string }
>;

export const operatorClientStatuses = Object.fromEntries(
  Object.entries(OPERATOR_CLIENT_STATUSES).map(([value, { label }]) => [
    value,
    label,
  ]),
) as Record<keyof typeof OPERATOR_CLIENT_STATUSES, string>;

export const ONBOARDING_CLIENT_STATUS = {
  label: "Onboarding",
  tone: "neutral",
  indicator: "progress",
} satisfies StatusPresentation & { label: string };

/** Limited clients with an unsubmitted application are still onboarding. */
export function operatorClientDisplayStatus(client: OperatorClientRow) {
  return client.clientAccessStatus === "limited" &&
    client.applicationInProgress
    ? "onboarding"
    : client.clientAccessStatus;
}

function displayStatus(client: OperatorClientRow) {
  const status = operatorClientDisplayStatus(client);
  return status === "onboarding"
    ? ONBOARDING_CLIENT_STATUS
    : OPERATOR_CLIENT_STATUSES[status];
}

export function operatorClientStatusLabel(client: OperatorClientRow) {
  return displayStatus(client).label;
}

export function operatorClientStatusPresentation(
  client: OperatorClientRow,
): StatusPresentation {
  const { tone, indicator } = displayStatus(client);
  return { tone, indicator };
}
