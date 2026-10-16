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

export function operatorClientStatusLabel(client: OperatorClientRow) {
  return OPERATOR_CLIENT_STATUSES[client.clientAccessStatus].label;
}

export function operatorClientStatusPresentation(
  client: OperatorClientRow,
): StatusPresentation {
  const { tone, indicator } = OPERATOR_CLIENT_STATUSES[client.clientAccessStatus];
  return { tone, indicator };
}
