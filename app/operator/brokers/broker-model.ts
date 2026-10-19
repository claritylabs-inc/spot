import type { StatusPresentation } from "@claritylabs-inc/ui/components/status-tag";

export type NetworkStatus = "prospect" | "active" | "inactive" | "blacklisted";

export const NETWORK_STATUS_LABELS: Record<NetworkStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  blacklisted: "Restricted",
};

export const NETWORK_STATUS_PRESENTATION: Record<
  NetworkStatus,
  StatusPresentation
> = {
  prospect: { tone: "warning", indicator: "draft" },
  active: { tone: "success", indicator: "complete" },
  inactive: { tone: "neutral", indicator: "inactive" },
  blacklisted: { tone: "danger", indicator: "cancelled" },
};
