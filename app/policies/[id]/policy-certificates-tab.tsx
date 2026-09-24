"use client";

import { useEffect } from "react";
import { BadgeCheck, Copy, Eye, Mail } from "lucide-react";
import { toast } from "sonner";

import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import {
  CertificatesTable,
  CERTIFICATE_PANEL_CONTAINER_CLASS,
  formatCertificateTime,
  type PolicyCertificateRecord,
} from "@/components/certificates/certificate-workspace";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

import { usePdf } from "@/components/pdf-context";
import { typeStyle } from "@/lib/typography";

export function ViewPdfButton({
  url,
  disabled = false,
}: {
  url?: string | null;
  disabled?: boolean;
}) {
  const { isPdfOpen, togglePdf, openWithUrl } = usePdf();
  if (!url) return null;
  return (
    <PillButton
      variant="secondary"
      size="compact"
      label={isPdfOpen ? "Hide PDF" : "View PDF"}
      expandLabel
      disabled={disabled}
      onClick={() => (isPdfOpen ? togglePdf() : openWithUrl(url))}
      className="hidden lg:inline-flex"
    >
      <Eye className="size-3.5" />
    </PillButton>
  );
}

type CertificateHoldRow = Record<string, unknown> & {
  _id: Id<"certificateRequestHolds">;
  createdAt: number;
  holderName?: string;
  certificateHolderName?: string;
  certificateHolder?: string;
  reasonMessage?: string;
  source?: string;
  emailDraft?: BrokerEmailDraft;
};

type BrokerEmailDraft = {
  subject: string;
  body: string;
  recipientEmail?: string;
  recipientName?: string;
};

function brokerEmailDraft(value: unknown): BrokerEmailDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.subject !== "string" || typeof record.body !== "string") {
    return undefined;
  }
  return {
    subject: record.subject,
    body: record.body,
    recipientEmail:
      typeof record.recipientEmail === "string" ? record.recipientEmail : undefined,
    recipientName:
      typeof record.recipientName === "string" ? record.recipientName : undefined,
  };
}

function mailtoHref(draft: BrokerEmailDraft) {
  return `mailto:${encodeURIComponent(draft.recipientEmail ?? "")}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

function copyDraft(draft: BrokerEmailDraft) {
  void navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
  toast.success("Broker email copied");
}

function CertificateHoldActivityRow({ row }: { row: CertificateHoldRow }) {
  const holderName = String(
    row.certificateHolderName ??
      row.holderName ??
      "Certificate holder",
  );
  const reason = String(
    row.reasonMessage ??
      row.certificateHolder ??
      "Certificate request is on hold",
  );
  const draft = brokerEmailDraft(row.emailDraft);
  return (
    <OperationalItem>
      <div className="flex min-w-0 flex-col gap-2 @xl/certificates-panel:flex-row @xl/certificates-panel:items-start @xl/certificates-panel:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className={`min-w-0 max-w-full truncate text-foreground ${typeStyle("body.medium")}`}>
              {holderName}
            </p>
            <StatusTag tone="warning">
              Held
            </StatusTag>
          </div>
          <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
            {reason}
          </p>
          {draft ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <PillButton
                type="button"
                size="compact"
                variant="secondary"
                onClick={() => copyDraft(draft)}
              >
                <Copy className="size-3.5" />
                Copy broker email
              </PillButton>
              <PillButton href={mailtoHref(draft)} size="compact" variant="ghost">
                <Mail className="size-3.5" />
                Email
              </PillButton>
            </div>
          ) : null}
        </div>
        <p className={`shrink-0 text-muted-foreground/70 @xl/certificates-panel:pt-0.5 ${typeStyle("caption.default")}`}>
          {formatCertificateTime(row.createdAt)}
        </p>
      </div>
    </OperationalItem>
  );
}

export function CertificatesTab({
  policyId,
  selectedCertificateId,
  onSelectCertificate,
}: {
  policyId: Id<"policies">;
  selectedCertificateId?: Id<"policyCertificates"> | null;
  onSelectCertificate?: (certificate: PolicyCertificateRecord | null) => void;
}) {
  const certificates = useCachedQuery(
    "certificateLifecycle.listByPolicy",
    api.certificateLifecycle.listByPolicy,
    { policyId },
  ) as PolicyCertificateRecord[] | undefined;
  const activity = useCachedQuery(
    "certificates.listActivityByPolicy",
    api.certificates.listActivityByPolicy,
    { policyId },
  );

  useEffect(() => {
    if (!certificates || !selectedCertificateId) return;
    const selected = certificates.find((row) => row._id === selectedCertificateId);
    if (selected) onSelectCertificate?.(selected);
  }, [certificates, onSelectCertificate, selectedCertificateId]);

  if (certificates === undefined || activity === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const activeCertificates = certificates
    .filter((row) => row.status === "active")
    .sort(
      (left, right) =>
        Number(right.lastIssuedAt ?? right.currentVersion?.createdAt ?? 0) -
        Number(left.lastIssuedAt ?? left.currentVersion?.createdAt ?? 0),
    );
  const holds = ((activity.holds ?? []) as CertificateHoldRow[]).sort(
    (left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
  );

  if (activeCertificates.length === 0 && holds.length === 0) {
    return (
      <OperationalPanel as="div">
        <OperationalPanelBody className="px-4 py-8 text-center">
          <BadgeCheck className="mx-auto mb-3 h-5 w-5 text-muted-foreground/50" />
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            No certificates yet
          </p>
          <p className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}>
            Generate a COI from the page header to store it here.
          </p>
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  return (
    <div className="space-y-3">
      {activeCertificates.length > 0 ? (
        <CertificatesTable
          rows={activeCertificates}
          selectedCertificateId={selectedCertificateId}
          showPolicyColumn={false}
          onSelectCertificate={(row) => onSelectCertificate?.(row)}
        />
      ) : null}
      {holds.length > 0 ? (
        <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
          {holds.map((row) => (
            <CertificateHoldActivityRow key={row._id} row={row} />
          ))}
        </OperationalPanel>
      ) : null}
    </div>
  );
}
