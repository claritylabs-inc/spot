import { clientPageContexts } from "./client";
import { emailPageContexts } from "./email";
import { policyPageContexts } from "./policy";
import { procurementPageContexts } from "./procurement";
import type { OperatorPageContextEntry } from "./types";

export type { OperatorPageContextEntry } from "./types";

// One module per page-type group; each page type belongs to one entry.
export const OPERATOR_PAGE_CONTEXTS: readonly OperatorPageContextEntry[] = [
  ...emailPageContexts,
  ...procurementPageContexts,
  ...clientPageContexts,
  ...policyPageContexts,
];

export function operatorPageContextEntry(pageType: string) {
  return (
    OPERATOR_PAGE_CONTEXTS.find((entry) => entry.pageTypes.includes(pageType)) ??
    OPERATOR_PAGE_CONTEXTS.find(
      (entry) =>
        entry.pageTypePrefix !== undefined &&
        pageType.startsWith(entry.pageTypePrefix),
    )
  );
}
