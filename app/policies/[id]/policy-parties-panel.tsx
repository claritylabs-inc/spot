"use client";

import {
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  resolvePolicyPartyContext,
  type PolicyPartyAddress,
} from "@/convex/lib/policyPartyContext";
import {
  formatCarrierLegalNames,
  sameCarrierIdentityName,
} from "@/convex/lib/carrierIdentity";
import { Pencil } from "lucide-react";

import type { PolicyDetailsEditSection } from "./policy-details-editor";

function addressLines(address: PolicyPartyAddress | undefined) {
  if (!address) return [];
  if (typeof address === "string") {
    return address.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  const structured = [
    address.street1,
    address.street2,
    [address.city, address.state, address.zip].filter(Boolean).join(" "),
    address.country,
  ].map((line) => line?.trim()).filter((line): line is string => Boolean(line));

  return structured.length > 0
    ? structured
    : address.formatted?.split("\n").map((line: string) => line.trim()).filter(Boolean) ?? [];
}

function MultilineValue({ lines }: { lines: string[] }) {
  return lines.map((line, index) => (
    <span key={`${line}-${index}`} className="block">{line}</span>
  ));
}

function PartyCard({
  title,
  hasDetails,
  onEdit,
  children,
}: {
  title: string;
  hasDetails: boolean;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <OperationalPanel as="div">
      <OperationalPanelHeader
        title={title}
        action={onEdit ? (
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
            Edit
          </PillButton>
        ) : undefined}
      />
      <dl>
        {hasDetails ? children : (
          <OperationalLabelValueRow
            label="Status"
            value="No details recorded."
          />
        )}
      </dl>
    </OperationalPanel>
  );
}

export function PolicyPartiesPanel({
  policy,
  canEdit = false,
  onEdit,
}: {
  policy: Record<string, unknown>;
  canEdit?: boolean;
  onEdit?: (section: PolicyDetailsEditSection) => void;
}) {
  const context = resolvePolicyPartyContext(policy);
  const insuredAddress = addressLines(context.insuredAddress);
  const producerAddress = addressLines(context.producerAddress);
  const insurerAddress = addressLines(context.insurerAddress);
  const generalAgentAddress = addressLines(context.generalAgentAddress);
  const distinctLegalNames = context.insurerLegalNames.filter(
    (name) => !sameCarrierIdentityName(name, context.carrierDisplayName),
  );
  const legalEntityDisplay = formatCarrierLegalNames(
    distinctLegalNames,
    context.carrierLegalEntityRelationship,
  );
  const hasInsured = Boolean(
    context.insuredName || insuredAddress.length || context.additionalNamedInsureds.length,
  );
  const hasProducer = Boolean(
    context.producerName ||
    producerAddress.length ||
    context.producerContactName ||
    context.producerLicenseNumber ||
    context.producerPhone ||
    context.producerEmail,
  );
  const hasInsurer = Boolean(
    context.carrierDisplayName ||
    context.insurerName ||
    distinctLegalNames.length ||
    insurerAddress.length ||
    context.insurerNaicNumber,
  );
  const hasGeneralAgent = Boolean(
    context.generalAgentName ||
    generalAgentAddress.length ||
    context.generalAgentLicenseNumber,
  );
  const hasParties = hasInsured || hasProducer || hasInsurer || hasGeneralAgent;

  if (!hasParties && !canEdit) {
    return (
      <PartyCard title="Policy parties" hasDetails>
        <OperationalLabelValueRow
          label="Status"
          value="No party information was found in the extracted policy."
        />
      </PartyCard>
    );
  }

  return (
    <section
      aria-label="Policy parties"
      className="mb-6 @container/policy-parties"
    >
      <div className="grid gap-4 @3xl/policy-parties:grid-cols-2 @5xl/policy-parties:grid-cols-3">
        {hasInsured || canEdit ? (
          <PartyCard
            title="Insured"
            hasDetails={hasInsured}
            onEdit={canEdit && onEdit ? () => onEdit("insured") : undefined}
          >
            <OperationalLabelValueRow label="Name" value={context.insuredName} />
            <OperationalLabelValueRow
              label="Address"
              value={insuredAddress.length > 0 ? <MultilineValue lines={insuredAddress} /> : undefined}
            />
            <OperationalLabelValueRow
              label="Additional named insureds"
              value={context.additionalNamedInsureds.length > 0
                ? <MultilineValue lines={context.additionalNamedInsureds} />
                : undefined}
            />
          </PartyCard>
        ) : null}

        {hasProducer || canEdit ? (
          <PartyCard
            title="Producer"
            hasDetails={hasProducer}
            onEdit={canEdit && onEdit ? () => onEdit("producer") : undefined}
          >
            <OperationalLabelValueRow label="Name" value={context.producerName} />
            <OperationalLabelValueRow
              label="Address"
              value={producerAddress.length > 0 ? <MultilineValue lines={producerAddress} /> : undefined}
            />
            <OperationalLabelValueRow label="Contact" value={context.producerContactName} />
            <OperationalLabelValueRow
              label="License number"
              value={context.producerLicenseNumber}
            />
            <OperationalLabelValueRow label="Phone" value={context.producerPhone} />
            <OperationalLabelValueRow label="Email" value={context.producerEmail} />
          </PartyCard>
        ) : null}

        {hasInsurer || canEdit ? (
          <PartyCard
            title="Carrier"
            hasDetails={hasInsurer}
            onEdit={canEdit && onEdit ? () => onEdit("insurer") : undefined}
          >
            <OperationalLabelValueRow
              label={context.carrierOperatingName ? "Operating name" : "Name"}
              value={context.carrierDisplayName}
            />
            <OperationalLabelValueRow
              label={distinctLegalNames.length === 1 ? "Legal entity" : "Legal entities"}
              value={legalEntityDisplay}
            />
            <OperationalLabelValueRow
              label="NAIC number"
              value={context.insurerNaicNumber}
            />
            <OperationalLabelValueRow
              label="Address"
              value={insurerAddress.length > 0 ? <MultilineValue lines={insurerAddress} /> : undefined}
            />
          </PartyCard>
        ) : null}

        {hasGeneralAgent || canEdit ? (
          <PartyCard
            title="General Agent"
            hasDetails={hasGeneralAgent}
            onEdit={canEdit && onEdit ? () => onEdit("generalAgent") : undefined}
          >
            <OperationalLabelValueRow label="Name" value={context.generalAgentName} />
            <OperationalLabelValueRow
              label="License number"
              value={context.generalAgentLicenseNumber}
            />
            <OperationalLabelValueRow
              label="Address"
              value={generalAgentAddress.length > 0
                ? <MultilineValue lines={generalAgentAddress} />
                : undefined}
            />
          </PartyCard>
        ) : null}
      </div>
    </section>
  );
}
