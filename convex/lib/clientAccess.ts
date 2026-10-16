import type { Doc } from "../_generated/dataModel";

/** Unset means limited. */
export function clientAccessStatus(
  org: Pick<Doc<"organizations">, "clientAccessStatus">,
): "limited" | "active" {
  return org.clientAccessStatus ?? "limited";
}
