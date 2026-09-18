"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PolicyListItem } from "@/components/policy-list-item";
import { StatusLabel } from "@/components/ui/status-tag";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCachedPolicyList } from "@/lib/sync/spot-cached-queries";
import { typeStyle } from "@/lib/typography";
import type { CarrierIdentity } from "@/convex/lib/carrierIdentity";

type PolicyRow = {
  _id: string;
  carrier?: string | null;
  carrierIdentity?: CarrierIdentity | null;
  policyDetailOverrides?: unknown;
  generalAgent?: { agencyName?: string } | null;
  mga?: string | null;
  policyNumber?: string | null;
  productIdentity?: unknown;
  programName?: string | null;
  linesOfBusiness?: readonly string[];
  effectiveDate?: string | null;
  expirationDate?: string | null;
  policyTermType?: string | null;
  pipelineStatus?: string;
  extractionDataStage?: string | null;
  uploadedBySide?:
    | "broker"
    | "client"
    | "operator"
    | "email_scan"
    | "agent_email";
};

export default function PoliciesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showArchived = searchParams.get("view") === "archived";
  const policies = useCachedPolicyList(showArchived);
  const rows = (policies ?? []) as PolicyRow[];

  return (
    <AppShell>
      <div className="space-y-4">
        <Tabs
          value={showArchived ? "archived" : "active"}
          onValueChange={(value) =>
            router.push(
              value === "archived" ? "/policies?view=archived" : "/policies",
            )
          }
        >
          <TabsList variant="pill">
            <TabsTrigger value="active"><StatusLabel tone="success">Active</StatusLabel></TabsTrigger>
            <TabsTrigger value="archived"><StatusLabel indicator="inactive">Archived</StatusLabel></TabsTrigger>
          </TabsList>
        </Tabs>

        {policies === undefined ? (
          <div className="min-h-32" aria-hidden="true" />
        ) : rows.length === 0 ? (
          <div
            className={`py-16 text-center text-muted-foreground/50 ${typeStyle("body.default")}`}
          >
            No {showArchived ? "archived" : "active"} policies
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((policy) => (
              <PolicyListItem
                key={policy._id}
                carrier={policy.carrier ?? "Carrier not identified"}
                carrierIdentity={policy.carrierIdentity}
                policyDetailOverrides={policy.policyDetailOverrides}
                generalAgent={
                  policy.generalAgent?.agencyName ?? policy.mga ?? undefined
                }
                policyNumber={
                  policy.policyNumber ?? "Policy number unavailable"
                }
                productIdentity={policy.productIdentity}
                programName={policy.programName ?? undefined}
                linesOfBusiness={policy.linesOfBusiness}
                effectiveDate={policy.effectiveDate ?? undefined}
                expirationDate={policy.expirationDate ?? undefined}
                policyTermType={policy.policyTermType ?? undefined}
                pipelineStatus={policy.pipelineStatus}
                extractionDataStage={policy.extractionDataStage ?? undefined}
                uploadedBySide={policy.uploadedBySide}
                href={`/policies/${policy._id}`}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
