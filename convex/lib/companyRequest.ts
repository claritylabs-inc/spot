import type { Doc, Id } from "../_generated/dataModel";
export type CompanyRequest = Doc<"procurementRequests"> & {
  clientOrgId: Id<"organizations">;
};
/** Fulfillment and shared packets are unavailable before company attachment. */
export function requireCompanyRequest(
  request: Doc<"procurementRequests"> | null,
): asserts request is CompanyRequest {
  if (request?.intakeAnswers?.intakeGoal === "savings")
    throw new Error("Policy savings reviews are available under Policies");
  if (request?.deletedAt) throw new Error("Procurement request not found");
  if (!request?.clientOrgId)
    throw new Error("Company-linked insurance request required");
}
