import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

export const clientAccessStatusValidator = v.union(
  v.literal("limited"),
  v.literal("active"),
  v.literal("archived"),
);

export type ClientAccessStatus = "limited" | "active" | "archived";

/** Unset means limited. Archived is a limited client that is functionally dead. */
export function clientAccessStatus(
  org: Pick<Doc<"organizations">, "clientAccessStatus">,
): ClientAccessStatus {
  return org.clientAccessStatus ?? "limited";
}
