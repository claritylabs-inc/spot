"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { PolicyListItem } from "@/components/policy-list-item";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";

function VendorPoliciesLoadingSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-44 w-full rounded-xl" />
      ))}
    </div>
  );
}

export default function ConnectedVendorPoliciesPage({
  params,
}: {
  params: Promise<{ vendorOrgId: string }>;
}) {
  const { vendorOrgId } = use(params);
  const router = useRouter();
  const vendorOrg = useCachedQuery("orgs.getById.vendorPolicies", api.orgs.getById, {
    orgId: vendorOrgId as Id<"organizations">,
  });
  const policies = useCachedQuery(
    "policies.listForOrg.vendorPolicies",
    api.policies.listForOrg,
    {
      orgId: vendorOrgId as Id<"organizations">,
      documentType: "policy",
    },
  );

  const rows = policies ?? [];
  const vendorName =
    (vendorOrg as { name?: string } | null | undefined)?.name?.trim() ||
    "Vendor";

  return (
    <AppShell
      breadcrumbDetail={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-muted-foreground/80">{vendorName}</span>
          <span className={`text-muted-foreground/30 ${typeStyle("body.default")}`}>/</span>
          <span className="truncate">Policies</span>
        </span>
      }
    >
      <div className="space-y-4">
        {policies === undefined ? (
          <VendorPoliciesLoadingSkeleton />
        ) : rows.length === 0 ? (
          <OperationalPanel as="div">
            <OperationalPanelBody className="px-5 py-6">
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                No policies yet
              </p>
              <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
                Uploaded vendor insurance records will appear here when available.
              </p>
            </OperationalPanelBody>
          </OperationalPanel>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((policy) => (
              <PolicyListItem
                key={policy._id}
                carrier={policy.carrier}
                carrierIdentity={policy.carrierIdentity}
                policyDetailOverrides={policy.policyDetailOverrides}
                generalAgent={policy.generalAgent?.agencyName ?? policy.mga}
                policyNumber={policy.policyNumber}
                productIdentity={policy.productIdentity}
                programName={policy.programName}
                linesOfBusiness={policy.linesOfBusiness}
                effectiveDate={policy.effectiveDate}
                expirationDate={policy.expirationDate}
                policyTermType={policy.policyTermType}
                pipelineStatus={policy.pipelineStatus}
                extractionDataStage={policy.extractionDataStage}
                uploadedBySide={policy.uploadedBySide}
                onClick={() =>
                  router.push(
                    `/connect/vendors/${vendorOrgId}/policies/${policy._id}`,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
