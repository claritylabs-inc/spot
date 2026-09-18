import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

type OperatorClientList = FunctionReturnType<typeof api.operator.listClients>;

export type OperatorClientRow = OperatorClientList[number];

export const operatorClientStatuses = {
  onboarding: "Onboarding",
  live: "Live",
  lost: "Lost",
  churned: "Churned",
};

export function operatorClientStatusLabel(client: OperatorClientRow) {
  return operatorClientStatuses[client.operatorStatus];
}
