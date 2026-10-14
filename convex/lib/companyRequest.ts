import type { Doc, Id } from "../_generated/dataModel";
export type CompanyRequest = Doc<"procurementRequests"> & {
  clientOrgId: Id<"organizations">;
};
/** Fulfillment and shared packets are unavailable before company attachment. */
export function requireCompanyRequest(
  request: Doc<"procurementRequests"> | null,
): asserts request is CompanyRequest {
  if (!request?.clientOrgId)
    throw new Error("Company-linked insurance request required");
}
