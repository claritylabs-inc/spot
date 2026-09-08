"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useAction } from "convex/react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { AlertTriangle, BadgeCheck, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AddressAutofillInput } from "@/components/ui/address-autofill-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { PillButton } from "@/components/ui/pill-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { StatusTag, type StatusTagTone } from "@/components/ui/status-tag";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type GenerationMode = "policy" | "requirements";

type CertificatePolicyOption = {
  _id: Id<"policies">;
  policyNumber?: string | null;
  carrier?: string | null;
  security?: string | null;
  pipelineStatus?: string | null;
  extractionDataStage?: string | null;
};

type CertificateRequirementSourceOption = {
  _id: Id<"requirementSourceDocuments">;
  orgId: Id<"organizations">;
  title: string;
  dealName?: string;
  dealType?: string;
  requirementCount: number;
  requirements: Array<{
    requirementId: Id<"insuranceRequirements">;
    title: string;
    status: string;
    reasons: string[];
    summary?: string;
  }>;
  holder?: {
    displayName: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      formatted?: string;
    };
  } | null;
};

type CertificateBatchItem = {
  policyId: Id<"policies">;
  requirementIds?: Id<"insuranceRequirements">[];
  status?: string;
  url?: string | null;
  fileName?: string;
  message?: string;
  reasonMessage?: string;
};

type CertificateBatchGap = {
  requirementId: Id<"insuranceRequirements">;
  title: string;
  status: string;
  reasons: string[];
  summary?: string;
};

type CertificateBatchResult = {
  status: "completed" | "partial" | "held" | "blocked";
  results: CertificateBatchItem[];
  gaps: CertificateBatchGap[];
};

function policyReadyForCertificate(policy: CertificatePolicyOption) {
  if (policy.extractionDataStage === "final") return true;
  return !policy.extractionDataStage && policy.pipelineStatus === "complete";
}

function policyLabel(policy: CertificatePolicyOption) {
  const number = policy.policyNumber?.trim() || "Policy";
  const carrier = policy.carrier?.trim() || policy.security?.trim();
  return carrier ? `${number} · ${carrier}` : number;
}

function sourceLabel(source: CertificateRequirementSourceOption) {
  const context = source.dealName?.trim() || source.holder?.displayName?.trim();
  return context && context !== source.title ? `${source.title} · ${context}` : source.title;
}

function sourceContext(source: CertificateRequirementSourceOption) {
  return [
    source.holder?.displayName,
    source.dealType,
    source.dealName,
    `${source.requirementCount} requirement${source.requirementCount === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
}

function resultMessage(result: CertificateBatchItem) {
  if (result.status === "held_policy_change_required") {
    return result.reasonMessage ?? result.message ?? "A policy change is required before this certificate can be issued.";
  }
  if (result.status === "existing") return "Existing matching certificate";
  if (result.status === "generated") return "Certificate generated";
  return result.message ?? result.status?.replaceAll("_", " ") ?? "Certificate unavailable";
}

function complianceStatusPresentation(status: string): {
  label: string;
  tone: StatusTagTone;
} {
  if (status === "met") return { label: "Met", tone: "success" };
  if (status === "expiring_soon") {
    return { label: "Expiring soon", tone: "warning" };
  }
  if (status === "not_met") return { label: "Not met", tone: "danger" };
  if (status === "expired") return { label: "Expired", tone: "danger" };
  return { label: "Needs evidence", tone: "warning" };
}

function gapReason(reason: string) {
  const labels: Record<string, string> = {
    no_matching_policy: "No matching current policy was found.",
    insured_name_mismatch: "The named insured does not match.",
    deductible_unverifiable: "The policy does not show a structured deductible.",
    deductible_above_required: "The deductible is above the permitted maximum.",
    coverage_form_unverifiable: "The policy does not confirm occurrence or claims-made form.",
    coverage_form_mismatch: "The policy coverage form does not match.",
    retroactive_date_unverifiable: "The policy does not show a structured retroactive date.",
    retroactive_date_after_required: "The policy retroactive date is later than permitted.",
    agent_review: "A deeper review could not verify this requirement.",
  };
  if (labels[reason]) return labels[reason];
  if (reason.startsWith("limit_unverifiable:")) {
    return `${reason.split(":")[1]?.replaceAll("_", " ")} limit is not structured on the policy.`;
  }
  if (reason.startsWith("limit_below_required:")) {
    return `${reason.split(":")[1]?.replaceAll("_", " ")} limit is below the requirement.`;
  }
  if (reason.startsWith("required_form_missing:")) {
    return `Required form ${reason.split(":").slice(1).join(":")} is not confirmed.`;
  }
  if (reason.startsWith("provision_missing:")) {
    return `${reason.split(":")[1]?.replaceAll("_", " ")} is not confirmed.`;
  }
  return reason.replaceAll("_", " ");
}

function gapDetails(reasons: string[], summary?: string) {
  return [
    reasons.length ? reasons.map(gapReason).join(" ") : undefined,
    summary?.trim(),
  ].filter(Boolean).join(" ");
}

export function CertificateGeneratePanel({
  open,
  onOpenChange,
  orgId,
  initialPolicyId,
  policyLocked = false,
  initialRequirementSourceId,
  initialRequirementId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: Id<"organizations">;
  initialPolicyId?: Id<"policies">;
  policyLocked?: boolean;
  initialRequirementSourceId?: Id<"requirementSourceDocuments">;
  initialRequirementId?: Id<"insuranceRequirements">;
}) {
  const generateCertificates = useAction(api.certificates.generateBatchForPolicy);
  const { openWithUrl } = usePdf();
  const policies = useCachedQuery(
    "policies.listForOrg.certificateGeneration",
    api.policies.listForOrg,
    { orgId, documentType: "policy" },
  ) as CertificatePolicyOption[] | undefined;
  const requirementSources = useCachedQuery(
    "compliance.listCertificateRequirementSources",
    api.compliance.listCertificateRequirementSources,
    { orgId },
  ) as CertificateRequirementSourceOption[] | undefined;
  const selectableRequirementSources = useMemo(
    () => (requirementSources ?? []).filter((source) => Boolean(source.holder)),
    [requirementSources],
  );
  const initialMode: GenerationMode =
    initialRequirementSourceId || initialRequirementId ? "requirements" : "policy";
  const [mode, setMode] = useState<GenerationMode>(initialMode);
  const [policyId, setPolicyId] = useState<string>(initialPolicyId ?? "");
  const [requirementSourceId, setRequirementSourceId] = useState<string>(initialRequirementSourceId ?? "");
  const [holderName, setHolderName] = useState("");
  const [holderContactName, setHolderContactName] = useState("");
  const [holderEmail, setHolderEmail] = useState("");
  const [holderPhone, setHolderPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [generating, setGenerating] = useState(false);
  const [batchResult, setBatchResult] = useState<CertificateBatchResult | null>(null);

  const readyPolicies = useMemo(
    () => (policies ?? []).filter(policyReadyForCertificate),
    [policies],
  );
  const selectedSource = useMemo(
    () => requirementSources?.find((source) => source._id === requirementSourceId) ?? null,
    [requirementSourceId, requirementSources],
  );
  const selectedRequirements = useMemo(
    () => (selectedSource?.requirements ?? []).filter(
      (requirement) =>
        !initialRequirementId || requirement.requirementId === initialRequirementId,
    ),
    [initialRequirementId, selectedSource],
  );
  const readyRequirementCount = selectedRequirements.filter(
    (requirement) =>
      requirement.status === "met" || requirement.status === "expiring_soon",
  ).length;
  const holderPhoneInvalid = Boolean(
    holderPhone.trim() && !isValidPhoneNumber(holderPhone),
  );
  const canGenerate = mode === "policy"
    ? Boolean(policyId && holderName.trim() && !holderPhoneInvalid)
    : Boolean(
        requirementSourceId &&
        selectedSource?.holder &&
        readyRequirementCount > 0,
      );

  const reset = () => {
    setMode(initialMode);
    setPolicyId(initialPolicyId ?? "");
    setRequirementSourceId(initialRequirementSourceId ?? "");
    setHolderName("");
    setHolderContactName("");
    setHolderEmail("");
    setHolderPhone("");
    setAddressLine1("");
    setAddressLine2("");
    setCity("");
    setState("");
    setPostalCode("");
    setCountry("");
    setBatchResult(null);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canGenerate) {
      toast.error(mode === "policy" ? "Select a policy and add a certificate holder" : "Select a requirements source with holder details");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateCertificates(mode === "policy" ? {
        orgId,
        primaryPolicyId: policyId as Id<"policies">,
        holderName: holderName.trim(),
        holderContactName: holderContactName.trim() || undefined,
        holderEmail: holderEmail.trim() || undefined,
        holderPhone: holderPhone.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        country: country.trim() || undefined,
      } : initialRequirementId ? {
        orgId,
        requirementId: initialRequirementId,
      } : {
        orgId,
        requirementSourceDocumentId: requirementSourceId as Id<"requirementSourceDocuments">,
      }) as CertificateBatchResult;
      const available = result.results.filter((item) => item.url);
      if (result.status === "completed" && available.length === 1) {
        toast.success(result.results[0]?.status === "existing" ? "Existing certificate returned" : "Certificate generated");
        close();
        openWithUrl(available[0].url as string);
        return;
      }
      setBatchResult(result);
      if (available.length > 0) {
        toast.success(`${available.length} certificate${available.length === 1 ? "" : "s"} ready`);
      } else {
        toast.message("Certificate generation needs review");
      }
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not generate certificates"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => {
        if (generating) return;
        if (value) onOpenChange(true);
        else close();
      }}
      title="Generate certificate"
      footer={batchResult ? (
        <PillButton variant="secondary" size="compact" onClick={() => setBatchResult(null)}>
          Back to request
        </PillButton>
      ) : (
        <PillButton
          type="submit"
          form="certificate-generate-form"
          size="compact"
          disabled={generating || !canGenerate}
        >
          {generating ? <Loader2 className="size-3.5 animate-spin" /> : <BadgeCheck className="size-3.5" />}
          Generate{mode === "requirements" ? " certificates" : ""}
        </PillButton>
      )}
    >
      {batchResult ? (
        <div className="space-y-5">
          <div>
            <p className={`text-foreground ${typeStyle("body.medium")}`}>
              {batchResult.results.filter((item) => item.url).length} certificate{batchResult.results.filter((item) => item.url).length === 1 ? "" : "s"} ready
            </p>
            <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
              Requirement-backed files include only the coverage lines needed from each supporting policy.
            </p>
          </div>
          <div className="space-y-2">
            {batchResult.results.map((item) => {
              const policy = readyPolicies.find((row) => row._id === item.policyId);
              return (
                <div key={item.policyId} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
                        {policy ? policyLabel(policy) : "Policy"}
                      </p>
                      <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
                        {resultMessage(item)}
                      </p>
                    </div>
                    {item.url ? (
                      <PillButton size="compact" variant="secondary" onClick={() => openWithUrl(item.url as string)}>
                        <FileText className="size-3.5" />
                        View
                      </PillButton>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {batchResult.gaps.length ? (
            <div className="rounded-lg border border-warning/20 bg-warning/5 p-3">
              <div className="flex items-center gap-2 text-foreground">
                <AlertTriangle className="size-4 text-warning" />
                <p className={typeStyle("body.medium")}>Requirement gaps</p>
              </div>
              <div className="mt-2 space-y-2">
                {batchResult.gaps.map((gap) => (
                  <div key={gap.requirementId}>
                    <p className={`text-foreground ${typeStyle("body.default")}`}>{gap.title}</p>
                    <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                      {gapDetails(gap.reasons, gap.summary) || gap.status.replaceAll("_", " ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <form id="certificate-generate-form" onSubmit={handleSubmit} className="space-y-6">
          {!policyLocked && !initialRequirementSourceId ? (
            <section className="space-y-3">
              <Tabs value={mode} onValueChange={(value) => setMode(value as GenerationMode)}>
                <TabsList variant="pill">
                  <TabsTrigger value="policy">Policy</TabsTrigger>
                  <TabsTrigger value="requirements">Requirements source</TabsTrigger>
                </TabsList>
              </Tabs>
            </section>
          ) : null}

          {mode === "policy" ? (
            <>
              <section className="space-y-2">
                <SearchableSelect
                  ariaLabel="Policy"
                  options={readyPolicies.map((policy) => ({ value: policy._id, label: policyLabel(policy) }))}
                  value={policyId}
                  onChange={setPolicyId}
                  placeholder={policies === undefined ? "Loading policies…" : "Select a policy"}
                  disabled={generating || policyLocked || policies === undefined}
                />
                {policies !== undefined && readyPolicies.length === 0 ? (
                  <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                    No fully extracted policies are ready for certificate generation.
                  </p>
                ) : null}
              </section>

              <section className="space-y-4 border-t border-border pt-5">
                <div className="space-y-2">
                  <Label htmlFor="certificate-holder-name">Certificate holder</Label>
                  <Input id="certificate-holder-name" value={holderName} onChange={(event) => setHolderName(event.target.value)} placeholder="Company or individual name" autoComplete="organization" disabled={generating} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="certificate-holder-contact">Holder contact</Label>
                  <Input id="certificate-holder-contact" value={holderContactName} onChange={(event) => setHolderContactName(event.target.value)} placeholder="Attention contact" autoComplete="name" disabled={generating} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="certificate-holder-email">Holder email</Label>
                  <Input id="certificate-holder-email" type="email" value={holderEmail} onChange={(event) => setHolderEmail(event.target.value)} placeholder="certificates@example.com" autoComplete="email" disabled={generating} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="certificate-holder-phone">Holder phone</Label>
                  <PhoneInput id="certificate-holder-phone" value={holderPhone || undefined} onChange={(value) => setHolderPhone(value ?? "")} defaultCountry="US" placeholder="Enter phone number" autoComplete="tel" disabled={generating} aria-invalid={holderPhoneInvalid} />
                  {holderPhoneInvalid ? <p className={`text-destructive ${typeStyle("caption.default")}`}>Enter a valid phone number with country code.</p> : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="certificate-address-1">Address</Label>
                  <AddressAutofillInput
                    id="certificate-address-1"
                    value={{ street1: addressLine1, street2: addressLine2, city, state, zip: postalCode, country }}
                    onChange={(address) => {
                      setAddressLine1(address.street1 ?? "");
                      setAddressLine2(address.street2 ?? "");
                      setCity(address.city ?? "");
                      setState(address.state ?? "");
                      setPostalCode(address.zip ?? "");
                      setCountry(address.country ?? "");
                    }}
                    display="street1"
                    placeholder="Search for an address"
                    autoComplete="section-certificate address-line1"
                    disabled={generating}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="certificate-address-2">Address line 2</Label>
                  <Input id="certificate-address-2" value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} placeholder="Suite, floor, attention line" autoComplete="section-certificate address-line2" disabled={generating} />
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_72px_96px] gap-2">
                  <div className="space-y-2"><Label htmlFor="certificate-city">City</Label><Input id="certificate-city" value={city} onChange={(event) => setCity(event.target.value)} autoComplete="section-certificate address-level2" disabled={generating} /></div>
                  <div className="space-y-2"><Label htmlFor="certificate-state">State</Label><Input id="certificate-state" value={state} onChange={(event) => setState(event.target.value)} autoComplete="section-certificate address-level1" disabled={generating} /></div>
                  <div className="space-y-2"><Label htmlFor="certificate-postal">ZIP</Label><Input id="certificate-postal" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} autoComplete="section-certificate postal-code" disabled={generating} /></div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="certificate-country">Country</Label>
                  <Input id="certificate-country" value={country} onChange={(event) => setCountry(event.target.value)} autoComplete="section-certificate country-name" disabled={generating} />
                </div>
              </section>
            </>
          ) : (
            <section className="space-y-3">
              <SearchableSelect
                ariaLabel="Requirements source"
                options={selectableRequirementSources.map((source) => ({ value: source._id, label: sourceLabel(source) }))}
                value={requirementSourceId}
                onChange={setRequirementSourceId}
                placeholder={requirementSources === undefined ? "Loading sources…" : "Select a requirements source"}
                disabled={generating || Boolean(initialRequirementSourceId) || requirementSources === undefined}
              />
              {requirementSources !== undefined && selectableRequirementSources.length === 0 ? (
                <p className={`rounded-lg border border-border p-3 text-muted-foreground ${typeStyle("body.default")}`}>
                  No requirements sources with certificate-holder details are available yet. Complete a source in Compliance first.
                </p>
              ) : null}
              {selectedSource ? (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div>
                    <p className={`text-foreground ${typeStyle("body.medium")}`}>
                      {selectedSource.holder?.displayName ?? "Holder details needed"}
                    </p>
                    <p className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}>
                      {selectedSource.holder
                        ? sourceContext(selectedSource)
                        : "Add the holder, contact, and address to this source in Compliance before generating."}
                    </p>
                  </div>
                  {selectedRequirements.length ? (
                    <div className="space-y-3 border-t border-border pt-3">
                      {selectedRequirements.map((requirement) => {
                        const status = complianceStatusPresentation(requirement.status);
                        return (
                          <div key={requirement.requirementId} className="space-y-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className={`min-w-0 text-foreground ${typeStyle("body.default")}`}>
                                {requirement.title}
                              </p>
                              <StatusTag tone={status.tone}>{status.label}</StatusTag>
                            </div>
                            {requirement.reasons.length || requirement.summary ? (
                              <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                                {gapDetails(requirement.reasons, requirement.summary)}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {selectedRequirements.length > 0 && readyRequirementCount === 0 ? (
                    <p className={`border-t border-border pt-3 text-muted-foreground ${typeStyle("body.default")}`}>
                      No certificate can be generated until at least one requirement is met by a fully extracted policy.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          )}
        </form>
      )}
    </SettingsDrawer>
  );
}
