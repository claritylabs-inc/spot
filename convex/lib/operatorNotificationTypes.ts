import { v, type Infer } from "convex/values";

export const operatorNotificationCategoryValidator = v.union(
  v.literal("inbox"),
  v.literal("approval"),
  v.literal("intake"),
  v.literal("failure"),
);
export type OperatorNotificationCategory = Infer<typeof operatorNotificationCategoryValidator>;

export const operatorNotificationTargetValidator = v.union(
  v.object({ kind: v.literal("inbox"), threadId: v.id("teamEmailThreads") }),
  v.object({ kind: v.literal("approval"), confirmationId: v.id("operatorAgentConfirmations") }),
  v.object({ kind: v.literal("intake"), requestId: v.id("procurementRequests") }),
  v.object({ kind: v.literal("operator_run"), runId: v.id("operatorAgentRuns") }),
  v.object({ kind: v.literal("policy"), policyId: v.id("policies") }),
  v.object({ kind: v.literal("proposal"), proposalId: v.id("procurementProposals") }),
);
export type OperatorNotificationTarget = Infer<typeof operatorNotificationTargetValidator>;

export const operatorNotificationStatusValidator = v.union(
  v.literal("suppressed"), v.literal("pending"), v.literal("sending"),
  v.literal("sent"), v.literal("failed"), v.literal("cancelled"), v.literal("unknown"),
);

export const OPERATOR_NOTIFICATION_CATEGORIES = [
  { category: "inbox", label: "Inbox", description: "New incoming team email.", title: "New email in the team inbox", body: "Open the conversation in Spot to review and reply." },
  { category: "approval", label: "Approvals", description: "Agent actions waiting for an operator’s approval.", title: "An action needs approval", body: "Review the requested action in Spot." },
  { category: "intake", label: "Applications", description: "Submitted and resubmitted insurance applications.", title: "An application is ready for review", body: "Open the application in Spot to review the submitted details." },
  { category: "failure", label: "Failures", description: "Terminal agent and policy processing failures.", title: "A task needs attention", body: "Open the record in Spot to review the failure." },
] as const satisfies ReadonlyArray<{ category: OperatorNotificationCategory; label: string; description: string; title: string; body: string }>;

export type OperatorNotificationInput = {
  eventKey: string;
  category: OperatorNotificationCategory;
  target: OperatorNotificationTarget;
};

export function isOperatorNotificationTargetCompatible(input: OperatorNotificationInput) {
  return input.category === "failure"
    ? ["operator_run", "policy", "proposal"].includes(input.target.kind)
    : input.category === input.target.kind;
}
