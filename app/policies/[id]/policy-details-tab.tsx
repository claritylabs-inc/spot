"use client";

import { FadeIn } from "@claritylabs-inc/ui/components/fade-in";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { policyLobCodes } from "@/convex/lib/linesOfBusiness";
import type { Id } from "@/convex/_generated/dataModel";
import { resolvePolicyPartyContext } from "@/convex/lib/policyPartyContext";
import type { CarrierIdentity } from "@/convex/lib/carrierIdentity";
import { isNonInsuranceDocument } from "@/convex/lib/policyDocumentGate";
import { typeStyle } from "@/lib/typography";

import { PolicySummary } from "./policy-summary";
import { PolicyPartiesPanel } from "./policy-parties-panel";
import type { PolicyDetailsEditSection } from "./policy-details-editor";

export function PolicyDetailsTab({
  policy,
  fileUrl,
  canEdit = false,
  onEdit,
}: {
  policy: Record<string, unknown> & {
    _id: Id<"policies">;
    policyNumber?: string;
    carrier?: string;
    carrierIdentity?: CarrierIdentity;
    insuredName?: string;
    effectiveDate?: string;
    expirationDate?: string;
    policyTermType?: string;
    premium?: string;
    totalCost?: string;
    taxesAndFees?: Array<{ amount?: string; amountValue?: number }>;
    summary?: string;
    isRenewal?: boolean;
    programName?: string;
    productIdentity?: unknown;
    pipelineStatus?: string;
    pipelineError?: string;
  };
  fileUrl?: string | null;
  canEdit?: boolean;
  onEdit?: (section: PolicyDetailsEditSection) => void;
  }) {
  const linesOfBusiness = policyLobCodes(policy as { linesOfBusiness?: string[] });
  const isProvisional =
    policy.extractionDataStage === "preview" &&
    policy.pipelineStatus !== "complete";
  const partyContext = resolvePolicyPartyContext(policy);

  if (
    policy.pipelineStatus === "error" &&
    isNonInsuranceDocument(policy.pipelineError)
  ) {
    return (
      <OperationalPanel className="p-5">
        <StatusTag tone="warning">Not a policy</StatusTag>
        <p className={`mt-3 text-muted-foreground ${typeStyle("body.default")}`}>
          {policy.pipelineError}
        </p>
      </OperationalPanel>
    );
  }

  return (
    <FadeIn when={true} staggerIndex={1} duration={0.5}>
      {isProvisional ? (
        <OperationalPanel as="div" className="mb-4">
          <OperationalPanelHeader
            title="Extraction complete"
            description="Enrichment is running. Certificates, policy changes, and source-backed edits unlock when it finishes."
            action={
              <StatusTag tone="info">
                Enriching
              </StatusTag>
            }
            className="border-b-0"
          />
        </OperationalPanel>
      ) : null}
      <PolicySummary
        carrier={policy.carrier}
        carrierDisplayName={partyContext.carrierDisplayName}
        carrierIdentity={policy.carrierIdentity}
        policyNumber={policy.policyNumber}
        productIdentity={policy.productIdentity}
        programName={policy.programName}
        effectiveDate={policy.effectiveDate}
        expirationDate={policy.expirationDate}
        policyTermType={policy.policyTermType}
        premium={policy.premium}
        totalCost={policy.totalCost}
        taxesAndFees={policy.taxesAndFees}
        linesOfBusiness={linesOfBusiness}
        operationsDescription={partyContext.operationsDescription}
        isRenewal={policy.isRenewal}
        pdfUrl={fileUrl ?? undefined}
        isExtracting={
          !policy.deletedAt &&
          (policy.pipelineStatus === "idle" || policy.pipelineStatus === "running")
        }
        onEdit={canEdit && onEdit ? () => onEdit("overview") : undefined}
      />
      <PolicyPartiesPanel
        key={policy._id}
        policy={policy}
        canEdit={canEdit}
        onEdit={onEdit}
      />
    </FadeIn>
  );
}
