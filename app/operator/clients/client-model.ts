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
} satisfies Record<OperatorClientRow["operatorStatus"], StatusPresentation & { label: string }>;

export function operatorClientStatusLabel(client: OperatorClientRow) {
  if (client.inviteStatus === "draft") return "Draft";
  if (client.inviteStatus === "invited") return "Invited";
  return OPERATOR_CLIENT_STATUSES[client.operatorStatus].label;
}

export function operatorClientStatusPresentation(
  client: OperatorClientRow,
): StatusPresentation {
  if (client.inviteStatus === "draft") {
    return { tone: "warning", indicator: "draft" };
  }
  if (client.inviteStatus === "invited") {
    return { tone: "warning", indicator: "waiting" };
  }
  const { tone, indicator } = OPERATOR_CLIENT_STATUSES[client.operatorStatus];
  return { tone, indicator };
}
