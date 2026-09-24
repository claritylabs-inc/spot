"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Upload } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { PolicyListItem } from "@/components/policy-list-item";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePolicyUpload } from "@/hooks/use-policy-upload";
import {
  useCachedPolicyList,
  useCachedViewerOrg,
} from "@/lib/sync/spot-cached-queries";
import { typeStyle } from "@/lib/typography";
import type { CarrierIdentity } from "@/convex/lib/carrierIdentity";

type PolicyRow = {
  _id: Id<"policies">;
  fileName?: string | null;
  documentType?: string | null;
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
  const archivedPolicies = useCachedPolicyList(true);
  const hasArchivedPolicies = (archivedPolicies?.length ?? 0) > 0;
  const archivedRequested = searchParams.get("view") === "archived";
  const showArchived = archivedRequested && archivedPolicies?.length !== 0;

  useEffect(() => {
    if (archivedRequested && archivedPolicies?.length === 0) {
      router.replace("/policies");
    }
  }, [archivedRequested, archivedPolicies, router]);
  const policies = useCachedPolicyList(showArchived);
  const rows = (policies ?? []) as PolicyRow[];
  const viewerOrg = useCachedViewerOrg();
  const orgId = viewerOrg?.org?._id;
  const createClientUpload = useMutation(api.policies.createClientUpload);
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const { upload, uploading } = usePolicyUpload({
    orgId,
    registerUpload: useCallback(
      async (args) => {
        if (!orgId) throw new Error("Organization required");
        return await createClientUpload({ ...args, orgId, documentType: "policy" });
      },
      [createClientUpload, orgId],
    ),
    rows: showArchived ? undefined : (policies as PolicyRow[] | undefined),
    onOpenPolicy: useCallback(
      (policyId: Id<"policies">) => router.push(`/policies/${policyId}`),
      [router],
    ),
  });

  return (
    <AppShell
      actions={
        showArchived ? null : (
          <PillButton
            type="button"
            size="compact"
            variant="primary"
            onClick={() => setUploaderOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload policy
          </PillButton>
        )
      }
      rightPanel={
        uploaderOpen && !showArchived ? (
          <PolicyUploadDrawer
            open
            onClose={() => setUploaderOpen(false)}
            onUpload={upload}
            uploading={uploading}
          />
        ) : null
      }
    >
      <div className="space-y-4">
        {hasArchivedPolicies ? (
          <Tabs
            value={showArchived ? "archived" : "active"}
            onValueChange={(value) =>
              router.push(
                value === "archived" ? "/policies?view=archived" : "/policies",
              )
            }
          >
            <TabsList variant="pill">
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {policies === undefined ? (
          <div className="min-h-32" aria-hidden="true" />
        ) : rows.length === 0 && !showArchived ? (
          <PolicyEmptyState uploading={uploading} onUpload={upload} />
        ) : rows.length === 0 ? (
          <div
            className={`py-16 text-center text-muted-foreground/50 ${typeStyle("body.default")}`}
          >
            No archived policies
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
