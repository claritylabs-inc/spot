"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useState,
} from "react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { Archive, ArchiveRestore, Loader2, Pencil, RefreshCw } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { AddressAutofillInput } from "@/components/ui/address-autofill-input";
import { StatusTag } from "@/components/ui/status-tag";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OperationalItem,
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";

export type CertificateHolderRecord = {
  _id: Id<"certificateHolders">;
  displayName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: {
    formatted?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
};

export type CertificatePolicyRecord = {
  _id: Id<"policies">;
  carrier?: string;
  security?: string;
  mga?: string;
  policyNumber?: string;
  insuredName?: string;
  effectiveDate?: string;
  expirationDate?: string;
};

export type CertificateVersionRecord = {
  _id: Id<"certificateVersions">;
  versionNumber: number;
  status: string;
  fileId?: Id<"_storage">;
  fileName?: string;
  fileSize?: number;
  requestKind?: string;
  additionalInsuredName?: string;
  descriptionOfOperations?: string;
  requirementIds?: Id<"insuranceRequirements">[];
  requirementSnapshots?: Array<{ requirementId?: string; title?: string }>;
  generationBatchId?: string;
  formCode?:
    | "acord25"
    | "acord24"
    | "acord27"
    | "acord28"
    | "acord29"
    | "acord30"
    | "acord31";
  issuedAt?: number;
  createdAt: number;
  url?: string | null;
};

export type CertificateHolderDraft = {
  displayName: string;
  contactName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type PolicyCertificateRecord = {
  _id: Id<"policyCertificates">;
  policyId: Id<"policies">;
  holderId: Id<"certificateHolders">;
  status: string;
  lastIssuedAt?: number;
  archivedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  holder?: CertificateHolderRecord | null;
  policy?: CertificatePolicyRecord | null;
  currentVersion?: CertificateVersionRecord | null;
  latestIssuedVersion?: CertificateVersionRecord | null;
  versions?: CertificateVersionRecord[];
  url?: string | null;
};

export const CERTIFICATE_PANEL_CONTAINER_CLASS = "@container/certificates-panel";

const CERTIFICATE_ROW_CLICKABLE_CLASS =
  "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-inset";

export function certificatePolicyLabel(policy?: CertificatePolicyRecord | null) {
  return [
    policy?.policyNumber,
    policy?.carrier ?? policy?.security,
  ].filter(Boolean).join(" · ") || "Policy";
}

export function certificateHolderAddress(holder?: CertificateHolderRecord | null) {
  const address = holder?.address;
  if (!address) return null;
  const cityLine = [
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  return address.formatted ||
    [address.line1, address.line2, cityLine, address.country].filter(Boolean).join("\n") ||
    null;
}

export function certificateHolderActionAddress(
  holder?: Pick<CertificateHolderRecord, "address"> | null,
) {
  const address = holder?.address;
  const formattedLines = address?.formatted
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean) ?? [];
  const hasStructuredAddress = Boolean(
    address?.line1 ||
    address?.line2 ||
    address?.city ||
    address?.state ||
    address?.postalCode ||
    address?.country,
  );
  return {
    addressLine1: address?.line1 ?? formattedLines[0],
    addressLine2: address?.line2 ?? (
      hasStructuredAddress ? undefined : formattedLines.slice(1).join(", ") || undefined
    ),
    city: address?.city,
    state: address?.state,
    postalCode: address?.postalCode,
    country: address?.country,
  };
}

export function certificateHolderDraft(
  holder?: CertificateHolderRecord | null,
): CertificateHolderDraft {
  const address = certificateHolderActionAddress(holder);
  return {
    displayName: holder?.displayName ?? "",
    contactName: holder?.contactName ?? "",
    email: holder?.email ?? "",
    phone: holder?.phone ?? "",
    addressLine1: address.addressLine1 ?? "",
    addressLine2: address.addressLine2 ?? "",
    city: address.city ?? "",
    state: address.state ?? "",
    postalCode: address.postalCode ?? "",
    country: address.country ?? "",
  };
}

function optionalDraftValue(value: string) {
  return value.trim() || undefined;
}

export function certificateVersionActionInput(
  row: PolicyCertificateRecord,
  draft?: CertificateHolderDraft,
) {
  const holder = row.holder;
  const address = draft ?? certificateHolderDraft(holder);
  const currentVersion = row.currentVersion ?? row.latestIssuedVersion;
  const isAdditionalInsured = currentVersion?.requestKind === "additional_insured";
  return {
    policyId: row.policyId,
    certificateId: row._id,
    holderName: draft?.displayName.trim() || holder?.displayName || "",
    holderContactName: optionalDraftValue(draft?.contactName ?? holder?.contactName ?? ""),
    holderEmail: optionalDraftValue(draft?.email ?? holder?.email ?? ""),
    holderPhone: optionalDraftValue(draft?.phone ?? holder?.phone ?? ""),
    addressLine1: optionalDraftValue(address.addressLine1),
    addressLine2: optionalDraftValue(address.addressLine2),
    city: optionalDraftValue(address.city),
    state: optionalDraftValue(address.state),
    postalCode: optionalDraftValue(address.postalCode),
    country: optionalDraftValue(address.country),
    additionalInsuredName: isAdditionalInsured
      ? currentVersion?.additionalInsuredName
      : undefined,
    requestedEndorsements: isAdditionalInsured
      ? ["additional_insured"]
      : undefined,
    descriptionOfOperations: currentVersion?.descriptionOfOperations,
    formCode: currentVersion?.formCode,
    forceReissue: true,
    updateHolderDetails: Boolean(draft),
  };
}

export function formatCertificateTime(value?: number) {
  return formatDisplayDateTime(value, "Not issued");
}

function versionTag(version?: CertificateVersionRecord | null) {
  if (!version) return { label: "No version", tone: "neutral" as const };
  if (version.status === "issued") return { label: "Issued", tone: "success" as const };
  if (version.status === "void") return { label: "Void", tone: "danger" as const };
  return {
    label: version.status.replace(/_/g, " "),
    tone: "neutral" as const,
  };
}

function sortedVersions(row: PolicyCertificateRecord) {
  return [...(row.versions?.length ? row.versions : row.currentVersion ? [row.currentVersion] : [])]
    .sort((left, right) => right.versionNumber - left.versionNumber);
}

function openOnKeyboard(
  event: KeyboardEvent<HTMLDivElement>,
  action: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function openTableRowOnKeyboard(
  event: KeyboardEvent<HTMLTableRowElement>,
  action: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function certificateCarrier(row: PolicyCertificateRecord) {
  return row.policy?.carrier ?? row.policy?.security;
}

function certificateHolderAddressDisplay(row: PolicyCertificateRecord) {
  const address = row.holder?.address;
  const formattedLines = certificateHolderAddress(row.holder)
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean) ?? [];
  const street = [address?.line1, address?.line2].filter(Boolean).join(", ") ||
    (formattedLines.length > 1
      ? formattedLines.slice(0, -1).join(", ")
      : formattedLines[0]);
  const statePostal = [address?.state, address?.postalCode].filter(Boolean).join(" ");
  const locality = [address?.city, statePostal, address?.country].filter(Boolean).join(", ") ||
    (formattedLines.length > 1 ? formattedLines[formattedLines.length - 1] : undefined);
  return { street, locality };
}

function certificateContactSummary(row: PolicyCertificateRecord) {
  const contactName = row.holder?.contactName?.trim();
  const email = row.holder?.email?.trim();
  const phone = row.holder?.phone?.trim();
  const primary = contactName ?? email ?? phone ?? "No contact";
  const secondary = contactName ? email : undefined;
  return { primary, secondary };
}

export function CertificatesTable({
  rows,
  selectedCertificateId,
  onSelectCertificate,
  showPolicyColumn = true,
}: {
  rows: PolicyCertificateRecord[];
  selectedCertificateId?: Id<"policyCertificates"> | null;
  onSelectCertificate: (row: PolicyCertificateRecord) => void;
  showPolicyColumn?: boolean;
}) {
  return (
    <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
      <Table
        className={showPolicyColumn ? "min-w-[1040px]" : "min-w-[760px]"}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead
              className={`${showPolicyColumn ? "w-[22%]" : "w-[25%]"} px-4`}
            >
              Holder
            </TableHead>
            <TableHead className={showPolicyColumn ? "w-[24%]" : "w-[30%]"}>
              Address
            </TableHead>
            <TableHead className={showPolicyColumn ? "w-[18%]" : "w-[25%]"}>
              Contact
            </TableHead>
            {showPolicyColumn ? (
              <TableHead className="w-[24%]">Policy</TableHead>
            ) : null}
            <TableHead
              className={`${showPolicyColumn ? "w-[12%]" : "w-[20%]"} px-4`}
            >
              Issued
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const contact = certificateContactSummary(row);
            const address = certificateHolderAddressDisplay(row);
            const currentVersion = row.currentVersion;
            const selected = row._id === selectedCertificateId;
            const issuedAt =
              row.lastIssuedAt ??
              currentVersion?.issuedAt ??
              currentVersion?.createdAt;
            const carrier = certificateCarrier(row);

            return (
              <TableRow
                key={row._id}
                aria-label={`Open certificate details for ${row.holder?.displayName ?? "certificate holder"}`}
                aria-selected={selected}
                className="cursor-pointer"
                data-state={selected ? "selected" : undefined}
                onClick={() => onSelectCertificate(row)}
                onKeyDown={(event) =>
                  openTableRowOnKeyboard(event, () => onSelectCertificate(row))
                }
                tabIndex={0}
              >
                <TableCell className="max-w-64 px-4">
                  <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
                    {row.holder?.displayName ?? "Certificate holder"}
                  </p>
                </TableCell>
                <TableCell className="max-w-72">
                  {address.street ? (
                    <>
                      <p className="truncate text-foreground">
                        {address.street}
                      </p>
                      {address.locality ? (
                        <p className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                          {address.locality}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">No address</span>
                  )}
                </TableCell>
                <TableCell className="max-w-56">
                  <p
                    className={
                      contact.primary === "No contact"
                        ? "truncate text-muted-foreground"
                        : "truncate text-foreground"
                    }
                  >
                    {contact.primary}
                  </p>
                  {contact.secondary ? (
                    <p className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                      {contact.secondary}
                    </p>
                  ) : null}
                </TableCell>
                {showPolicyColumn ? (
                  <TableCell className="max-w-72">
                    <p className="truncate text-foreground">
                      {row.policy?.policyNumber ?? "Policy"}
                    </p>
                    {carrier ? (
                      <p className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                        {carrier}
                      </p>
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell className="px-4">
                  <p className="text-foreground">
                    {formatCertificateTime(issuedAt)}
                  </p>
                  {currentVersion ? (
                    <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                      Version {currentVersion.versionNumber}
                    </p>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

function CertificatePdfItem({
  url,
  ariaLabel,
  children,
}: {
  url?: string | null;
  ariaLabel: string;
  children: ReactNode;
}) {
  const { openWithUrl } = usePdf();
  const canOpen = Boolean(url);
  const openCertificate = () => {
    if (url) openWithUrl(url);
  };

  return (
    <OperationalItem
      aria-disabled={canOpen ? undefined : true}
      aria-label={canOpen ? ariaLabel : undefined}
      className={canOpen ? CERTIFICATE_ROW_CLICKABLE_CLASS : undefined}
      onClick={canOpen ? openCertificate : undefined}
      onKeyDown={canOpen ? (event) => openOnKeyboard(event, openCertificate) : undefined}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
    >
      {children}
    </OperationalItem>
  );
}

function CertificateDetailCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    value?: ReactNode;
  }>;
}) {
  return (
    <OperationalLabelValueList title={title}>
      {rows.map((row) => (
        <OperationalLabelValueRow
          key={row.label}
          label={row.label}
          value={row.value}
        />
      ))}
    </OperationalLabelValueList>
  );
}

function CertificateVersionRow({
  version,
  isCurrent,
}: {
  version: CertificateVersionRecord;
  isCurrent: boolean;
}) {
  const tag = versionTag(version);
  return (
    <CertificatePdfItem
      url={version.url}
      ariaLabel={`Open certificate version ${version.versionNumber} PDF`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
            Version {version.versionNumber}
          </p>
          <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
            {formatCertificateTime(version.issuedAt ?? version.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {isCurrent ? (
            <StatusTag tone="success">
              Current
            </StatusTag>
          ) : null}
          <StatusTag tone={tag.tone} className={`${typeStyle("label.tag")}`}>
            {tag.label}
          </StatusTag>
        </div>
      </div>
    </CertificatePdfItem>
  );
}

export function CertificateDetailPanel({
  row,
  onClose,
  onReissue,
  onEditHolder,
  onArchive,
  onUnarchive,
  reissuing,
  savingHolder,
  archiving,
  unarchiving,
  actionPresentation = "icons",
}: {
  row: PolicyCertificateRecord | null;
  onClose: () => void;
  onReissue?: (row: PolicyCertificateRecord) => void;
  onEditHolder?: (
    row: PolicyCertificateRecord,
    draft: CertificateHolderDraft,
  ) => Promise<boolean>;
  onArchive?: (row: PolicyCertificateRecord) => void;
  onUnarchive?: (row: PolicyCertificateRecord) => void;
  reissuing?: boolean;
  savingHolder?: boolean;
  archiving?: boolean;
  unarchiving?: boolean;
  actionPresentation?: "icons" | "labels";
}) {
  const { openWithUrl } = usePdf();
  const [holderEdit, setHolderEdit] = useState<{
    certificateId: Id<"policyCertificates">;
    draft: CertificateHolderDraft;
  } | null>(null);
  const versions = row ? sortedVersions(row) : [];
  const currentVersion = row?.currentVersion;
  const currentUrl = row?.url ?? currentVersion?.url;
  const holderName = row?.holder?.displayName ?? "Certificate holder";
  const holderAddressText = row ? certificateHolderAddress(row.holder) : null;
  const isArchived = row?.status === "archived";
  const activeDraft = row && holderEdit?.certificateId === row._id
    ? holderEdit.draft
    : null;
  const holderNameInvalid = Boolean(activeDraft && !activeDraft.displayName.trim());
  const holderEmailInvalid = Boolean(
    activeDraft?.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(activeDraft.email.trim()),
  );
  const holderPhoneInvalid = Boolean(
    activeDraft?.phone.trim() && !isValidPhoneNumber(activeDraft.phone),
  );
  const holderDraftInvalid =
    holderNameInvalid || holderEmailInvalid || holderPhoneInvalid;

  const updateDraft = (patch: Partial<CertificateHolderDraft>) => {
    setHolderEdit((current) =>
      current ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );
  };

  const submitHolderEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!row || !activeDraft || !onEditHolder || holderDraftInvalid) return;
    if (await onEditHolder(row, activeDraft)) {
      setHolderEdit(null);
    }
  };

  return (
    <SettingsDrawer
      open={Boolean(row)}
      onOpenChange={(open) => {
        if (!open && !savingHolder) {
          setHolderEdit(null);
          onClose();
        }
      }}
      title={activeDraft ? "Edit certificate" : holderName}
      footer={
        row && activeDraft ? (
          <>
            <PillButton
              type="button"
              variant="secondary"
              onClick={() => setHolderEdit(null)}
              disabled={savingHolder}
            >
              Cancel
            </PillButton>
            <PillButton
              type="submit"
              form="certificate-holder-edit-form"
              variant="primary"
              disabled={savingHolder || holderDraftInvalid}
            >
              {savingHolder ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Generate new version
            </PillButton>
          </>
        ) : row ? (
          <>
            {isArchived && onUnarchive ? (
              <PillButton
                type="button"
                variant="secondary"
                onClick={() => onUnarchive(row)}
                disabled={unarchiving}
              >
                <ArchiveRestore className="size-3.5" />
                Restore
              </PillButton>
            ) : null}
            {!isArchived && onArchive ? (
              <PillButton
                type="button"
                variant="destructive"
                size="compact"
                {...(actionPresentation === "icons"
                  ? { iconOnly: true as const, label: "Archive" }
                  : { iconOnly: false as const, label: "Archive" })}
                onClick={() => onArchive(row)}
                disabled={archiving}
              >
                {actionPresentation === "icons" ? (
                  <Archive className="size-4 shrink-0" />
                ) : archiving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                {actionPresentation === "labels" ? "Archive" : null}
              </PillButton>
            ) : null}
            {!isArchived && onReissue ? (
              <PillButton
                type="button"
                variant={actionPresentation === "labels" ? "secondary" : "icon"}
                size="compact"
                label="Reissue"
                className={
                  actionPresentation === "icons"
                    ? "!h-7 !min-h-7 !w-7 !p-0"
                    : undefined
                }
                onClick={() => onReissue(row)}
                disabled={reissuing}
              >
                {actionPresentation === "icons" ? (
                  <RefreshCw
                    className={`size-4 shrink-0 ${reissuing ? "animate-spin" : ""}`}
                  />
                ) : reissuing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                {actionPresentation === "labels" ? "Reissue" : null}
              </PillButton>
            ) : null}
            {!isArchived && onEditHolder ? (
              <PillButton
                type="button"
                variant={actionPresentation === "labels" ? "secondary" : "icon"}
                size="compact"
                label="Edit"
                className={
                  actionPresentation === "icons"
                    ? "!h-7 !min-h-7 !w-7 !p-0"
                    : undefined
                }
                onClick={() => setHolderEdit({
                  certificateId: row._id,
                  draft: certificateHolderDraft(row.holder),
                })}
                disabled={reissuing || archiving || unarchiving}
              >
                {actionPresentation === "icons" ? (
                  <Pencil className="size-4 shrink-0" />
                ) : null}
                {actionPresentation === "labels" ? "Edit holder" : null}
              </PillButton>
            ) : null}
            {currentUrl ? (
              <PillButton
                type="button"
                variant="primary"
                onClick={() => openWithUrl(currentUrl)}
              >
                View PDF
              </PillButton>
            ) : null}
          </>
        ) : null
      }
    >
      {row && activeDraft ? (
        <form
          id="certificate-holder-edit-form"
          className="space-y-4"
          onSubmit={submitHolderEdit}
        >
            <div className="space-y-2">
              <Label htmlFor="certificate-edit-holder-name">Certificate holder</Label>
              <Input
                id="certificate-edit-holder-name"
                value={activeDraft.displayName}
                onChange={(event) => updateDraft({ displayName: event.target.value })}
                placeholder="Company or individual name"
                autoComplete="organization"
                autoFocus
                disabled={savingHolder}
                aria-invalid={holderNameInvalid}
              />
              {holderNameInvalid ? (
                <p className={`text-destructive ${typeStyle("caption.default")}`}>
                  Enter a certificate holder name.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificate-edit-contact">Holder contact</Label>
              <Input
                id="certificate-edit-contact"
                value={activeDraft.contactName}
                onChange={(event) => updateDraft({ contactName: event.target.value })}
                placeholder="Attention contact"
                autoComplete="name"
                disabled={savingHolder}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificate-edit-email">Holder email</Label>
              <Input
                id="certificate-edit-email"
                type="email"
                value={activeDraft.email}
                onChange={(event) => updateDraft({ email: event.target.value })}
                placeholder="certificates@example.com"
                autoComplete="email"
                disabled={savingHolder}
                aria-invalid={holderEmailInvalid}
              />
              {holderEmailInvalid ? (
                <p className={`text-destructive ${typeStyle("caption.default")}`}>
                  Enter a valid email address.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificate-edit-phone">Holder phone</Label>
              <PhoneInput
                id="certificate-edit-phone"
                value={activeDraft.phone || undefined}
                onChange={(phone) => updateDraft({ phone: phone ?? "" })}
                defaultCountry="US"
                autoComplete="tel"
                disabled={savingHolder}
                aria-invalid={holderPhoneInvalid}
              />
              {holderPhoneInvalid ? (
                <p className={`text-destructive ${typeStyle("caption.default")}`}>
                  Enter a valid phone number with country code.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificate-edit-address-1">Address</Label>
              <AddressAutofillInput
                id="certificate-edit-address-1"
                value={{
                  street1: activeDraft.addressLine1,
                  street2: activeDraft.addressLine2,
                  city: activeDraft.city,
                  state: activeDraft.state,
                  zip: activeDraft.postalCode,
                  country: activeDraft.country,
                }}
                onChange={(address) => updateDraft({
                  addressLine1: address.street1 ?? "",
                  addressLine2: address.street2 ?? "",
                  city: address.city ?? "",
                  state: address.state ?? "",
                  postalCode: address.zip ?? "",
                  country: address.country ?? "",
                })}
                display="street1"
                placeholder="Search for an address"
                autoComplete="section-certificate-edit address-line1"
                disabled={savingHolder}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificate-edit-address-2">Address line 2</Label>
              <Input
                id="certificate-edit-address-2"
                value={activeDraft.addressLine2}
                onChange={(event) => updateDraft({ addressLine2: event.target.value })}
                placeholder="Suite, floor, attention line"
                autoComplete="section-certificate-edit address-line2"
                disabled={savingHolder}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_72px_96px]">
              <div className="space-y-2">
                <Label htmlFor="certificate-edit-city">City</Label>
                <Input
                  id="certificate-edit-city"
                  value={activeDraft.city}
                  onChange={(event) => updateDraft({ city: event.target.value })}
                  autoComplete="section-certificate-edit address-level2"
                  disabled={savingHolder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="certificate-edit-state">State</Label>
                <Input
                  id="certificate-edit-state"
                  value={activeDraft.state}
                  onChange={(event) => updateDraft({ state: event.target.value })}
                  autoComplete="section-certificate-edit address-level1"
                  disabled={savingHolder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="certificate-edit-postal-code">ZIP</Label>
                <Input
                  id="certificate-edit-postal-code"
                  value={activeDraft.postalCode}
                  onChange={(event) => updateDraft({ postalCode: event.target.value })}
                  autoComplete="section-certificate-edit postal-code"
                  disabled={savingHolder}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificate-edit-country">Country</Label>
              <Input
                id="certificate-edit-country"
                value={activeDraft.country}
                onChange={(event) => updateDraft({ country: event.target.value })}
                placeholder="United States"
                autoComplete="section-certificate-edit country-name"
                disabled={savingHolder}
              />
            </div>
        </form>
      ) : row ? (
        <div className="flex flex-col gap-5">
          <CertificateDetailCard
            title="Holder"
            rows={[
              { label: "Name", value: row.holder?.displayName },
              { label: "Contact", value: row.holder?.contactName },
              { label: "Email", value: row.holder?.email },
              { label: "Phone", value: row.holder?.phone },
              {
                label: "Address",
                value: holderAddressText ? (
                  <span className="whitespace-pre-line">
                    {holderAddressText}
                  </span>
                ) : undefined,
              },
            ]}
          />

          <CertificateDetailCard
            title="Policy"
            rows={[
              { label: "Policy no.", value: row.policy?.policyNumber },
              {
                label: "Carrier",
                value: row.policy?.carrier ?? row.policy?.security,
              },
              { label: "Insured", value: row.policy?.insuredName },
            ]}
          />

          {currentVersion?.requirementSnapshots?.length ? (
            <CertificateDetailCard
              title="Requirements"
              rows={[
                {
                  label: "Selected",
                  value: currentVersion.requirementSnapshots
                    .map((requirement) => requirement.title)
                    .filter(Boolean)
                    .join(", "),
                },
              ]}
            />
          ) : null}

          <OperationalPanel as="div" className={CERTIFICATE_PANEL_CONTAINER_CLASS}>
            <OperationalPanelHeader title="Versions" />
            {versions.length > 0 ? (
              versions.map((version) => (
                <CertificateVersionRow
                  key={version._id}
                  version={version}
                  isCurrent={version._id === currentVersion?._id}
                />
              ))
            ) : (
              <OperationalPanelBody className="px-4 py-6">
                <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                  No versions recorded.
                </p>
              </OperationalPanelBody>
            )}
          </OperationalPanel>
        </div>
      ) : null}
    </SettingsDrawer>
  );
}
