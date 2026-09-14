"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";

export function ScanMatchFields({
  activityId,
  selectedOrgId,
  selectedRequestId,
  onOrganizationChange,
  onRequestChange,
  disabled,
}: {
  activityId: string;
  selectedOrgId?: Id<"organizations">;
  selectedRequestId?: Id<"procurementRequests">;
  onOrganizationChange: (id: Id<"organizations">) => void;
  onRequestChange: (id: Id<"procurementRequests">) => void;
  disabled: boolean;
}) {
  const organizations = usePaginatedQuery(
    api.operatorGoogleWorkspaceScanActivity.listActivityCandidates,
    { activityId, kind: "organization" },
    { initialNumItems: 20 },
  );
  const requests = usePaginatedQuery(
    api.operatorGoogleWorkspaceScanActivity.listActivityCandidates,
    selectedOrgId ? { activityId, kind: "request", selectedOrgId } : "skip",
    { initialNumItems: 20 },
  );

  if (
    organizations.status === "Exhausted" &&
    organizations.results.length === 0
  )
    return null;

  return (
    <div className="space-y-3">
      <SearchableSelect
        ariaLabel="Match organization"
        placeholder={
          organizations.status === "LoadingFirstPage"
            ? "Loading organizations…"
            : "Choose the exact organization"
        }
        value={selectedOrgId ?? ""}
        disabled={disabled || organizations.status === "LoadingFirstPage"}
        options={organizations.results.map((candidate) => ({
          value: candidate.id,
          label: candidate.label,
          icon: <OrgBrandIcon name={candidate.label} size="xs" />,
        }))}
        onChange={(id) => {
          const candidate = organizations.results.find(
            (item) => item.id === id,
          );
          if (candidate)
            onOrganizationChange(candidate.id as Id<"organizations">);
        }}
      />
      {organizations.status === "CanLoadMore" ||
      organizations.status === "LoadingMore" ? (
        <PillButton
          variant="secondary"
          size="compact"
          disabled={disabled || organizations.status === "LoadingMore"}
          onClick={() => organizations.loadMore(50)}
        >
          {organizations.status === "LoadingMore"
            ? "Loading organizations…"
            : "Load more organizations"}
        </PillButton>
      ) : null}
      {selectedOrgId &&
      (requests.status !== "Exhausted" || requests.results.length > 0) ? (
        <>
          <SearchableSelect
            ariaLabel="Match request"
            placeholder={
              requests.status === "LoadingFirstPage"
                ? "Loading requests…"
                : "Choose the exact request, if needed"
            }
            value={selectedRequestId ?? ""}
            disabled={disabled || requests.status === "LoadingFirstPage"}
            options={requests.results.map((candidate) => ({
              value: candidate.id,
              label: candidate.label,
            }))}
            onChange={(id) => {
              const candidate = requests.results.find((item) => item.id === id);
              if (candidate)
                onRequestChange(candidate.id as Id<"procurementRequests">);
            }}
          />
          {requests.status === "CanLoadMore" ||
          requests.status === "LoadingMore" ? (
            <PillButton
              variant="secondary"
              size="compact"
              disabled={disabled || requests.status === "LoadingMore"}
              onClick={() => requests.loadMore(50)}
            >
              {requests.status === "LoadingMore"
                ? "Loading requests…"
                : "Load more requests"}
            </PillButton>
          ) : null}
        </>
      ) : null}
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        Choosing a match queues another assessment. Without a match, a note
        resolves this finding without changing records.
      </p>
    </div>
  );
}
