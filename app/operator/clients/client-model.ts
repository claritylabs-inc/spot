import type { StatusPresentation } from "@/components/ui/status-tag";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

type OperatorClientList = FunctionReturnType<typeof api.operator.listClients>;

export type OperatorClientRow = OperatorClientList[number];

export const OPERATOR_CLIENT_STATUSES = {
  onboarding: {
    label: "Onboarding",
    tone: "warning",
    indicator: "progress",
  },
  live: {
    label: "Live",
    tone: "success",
    indicator: "complete",
  },
  lost: {
    label: "Lost",
    tone: "danger",
    indicator: "cancelled",
  },
  churned: {
    label: "Churned",
    tone: "danger",
    indicator: "cancelled",
  },
} satisfies Record<
  NonNullable<OperatorClientRow["operatorStatus"]>,
  StatusPresentation & { label: string }
>;

export const operatorClientStatuses = Object.fromEntries(
  Object.entries(OPERATOR_CLIENT_STATUSES).map(([value, { label }]) => [
    value,
    label,
  ]),
) as Record<keyof typeof OPERATOR_CLIENT_STATUSES, string>;

export function operatorClientStatusLabel(client: OperatorClientRow) {
  return OPERATOR_CLIENT_STATUSES[client.operatorStatus].label;
}

export function operatorClientStatusPresentation(
  client: OperatorClientRow,
): StatusPresentation {
  const { tone, indicator } = OPERATOR_CLIENT_STATUSES[client.operatorStatus];
  return { tone, indicator };
}
