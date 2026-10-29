import type { StatusPresentation } from "@claritylabs-inc/ui/components/status-tag";

export type NetworkStatus = "prospect" | "active" | "inactive" | "blacklisted";

export const NETWORK_STATUS_LABELS: Record<NetworkStatus, string> = {
  prospect: "Cold",
  active: "Active Relationship",
  inactive: "Inactive relationship",
  blacklisted: "Do Not Contact",
};

export const NETWORK_STATUS_PRESENTATION: Record<
  NetworkStatus,
  StatusPresentation
> = {
  prospect: { tone: "neutral", indicator: "draft" },
  active: { tone: "success", indicator: "complete" },
  inactive: { tone: "warning", indicator: "waiting" },
  blacklisted: { tone: "danger", indicator: "cancelled" },
};
