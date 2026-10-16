import type { Doc } from "../_generated/dataModel";

/** Normalizes the stored status; unset and the retired "intake" value both mean limited. */
export function clientAccessStatus(
  org: Pick<Doc<"organizations">, "clientAccessStatus">,
): "limited" | "active" {
  return org.clientAccessStatus === "active" ? "active" : "limited";
}
