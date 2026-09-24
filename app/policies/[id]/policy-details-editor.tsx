"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { isValidPhoneNumber } from "react-phone-number-input";
import { Plus, Trash2 } from "lucide-react";

import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  AddressAutofillInput,
  type AutofillAddress,
} from "@/components/ui/address-autofill-input";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { FormSection } from "@claritylabs-inc/ui/components/form-section";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Label } from "@claritylabs-inc/ui/components/label";
import { PhoneInput } from "@claritylabs-inc/ui/components/marketing/phone-input";
import { PillButton } from "@/components/ui/pill-button";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { resolvePolicyPartyContext } from "@/convex/lib/policyPartyContext";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  cachedQueryResult,
} from "@/lib/sync/use-cached-query";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { typeStyle } from "@/lib/typography";

dayjs.extend(customParseFormat);

export type PolicyDetailsEditSection =
  | "overview"
  | "insured"
  | "producer"
  | "insurer"
  | "generalAgent";

type PolicyDetailUpdate =
  | {
      section: "overview";
      policyNumber: string;
      effectiveDate: string;
      expirationDate: string;
      premium: string;
      operationsDescription: string;
    }
  | {
      section: "insured";
      name: string;
      address: AutofillAddress;
      additionalNamedInsureds: string[];
    }
  | {
      section: "producer";
      name: string;
      address: AutofillAddress;
      contactName: string;
      licenseNumber: string;
      phone: string;
      email: string;
    }
  | {
      section: "insurer";
      name: string;
      address: AutofillAddress;
      naicNumber: string;
    }
  | {
      section: "generalAgent";
      name: string;
      address: AutofillAddress;
      licenseNumber: string;
    };

type PolicyDetailsDraft = {
  policyNumber: string;
  effectiveDate: string;
  expirationDate: string;
  premium: string;
  operationsDescription: string;
  insuredName: string;
  insuredAddress: AutofillAddress;
  additionalNamedInsureds: string[];
  producerName: string;
  producerAddress: AutofillAddress;
  producerContactName: string;
  producerLicenseNumber: string;
  producerPhone: string;
  producerEmail: string;
  insurerName: string;
  insurerAddress: AutofillAddress;
  insurerNaicNumber: string;
  generalAgentName: string;
  generalAgentAddress: AutofillAddress;
  generalAgentLicenseNumber: string;
};

const SECTION_TITLES: Record<PolicyDetailsEditSection, string> = {
  overview: "Edit policy overview",
  insured: "Edit insured",
  producer: "Edit producer",
  insurer: "Edit insurer",
  generalAgent: "Edit General Agent",
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function addressValue(value: unknown): AutofillAddress {
  if (typeof value === "string") {
    return value.trim()
      ? { street1: value.trim(), formatted: value.trim() }
      : {};
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AutofillAddress)
    : {};
}

function normalizedDateInput(value: string) {
  if (!value || value.toLowerCase() === "unknown") return "";
  const parsed = dayjs(
    value,
    [
      "YYYY-MM-DD",
      "MM/DD/YYYY",
      "M/D/YYYY",
      "YYYY/M/D",
      "MMM D, YYYY",
      "MMMM D, YYYY",
    ],
    true,
  );
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : "";
}

function storedDateValue(value: string) {
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.format("MM/DD/YYYY") : "";
}

function moneyAmount(value: string) {
  const match = value.trim().match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/);
  if (!match) return undefined;
  const amount = Number.parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function formattedMoney(value: string) {
  const amount = moneyAmount(value);
  if (amount === undefined) return value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function draftFromPolicy(policy: Record<string, unknown>): PolicyDetailsDraft {
  const context = resolvePolicyPartyContext(policy);
  return {
    policyNumber: stringValue(policy.policyNumber),
    effectiveDate: stringValue(policy.effectiveDate),
    expirationDate: stringValue(policy.expirationDate),
    premium: stringValue(policy.premium),
    operationsDescription: context.operationsDescription ?? "",
    insuredName: context.insuredName ?? "",
    insuredAddress: addressValue(context.insuredAddress),
    additionalNamedInsureds: context.additionalNamedInsureds,
    producerName: context.producerName ?? "",
    producerAddress: addressValue(context.producerAddress),
    producerContactName: context.producerContactName ?? "",
    producerLicenseNumber: context.producerLicenseNumber ?? "",
    producerPhone: context.producerPhone ?? "",
    producerEmail: context.producerEmail ?? "",
    insurerName: context.insurerName ?? "",
    insurerAddress: addressValue(context.insurerAddress),
    insurerNaicNumber: context.insurerNaicNumber ?? "",
    generalAgentName: context.generalAgentName ?? "",
    generalAgentAddress: addressValue(context.generalAgentAddress),
    generalAgentLicenseNumber: context.generalAgentLicenseNumber ?? "",
  };
}

function updateFromDraft(
  section: PolicyDetailsEditSection,
  draft: PolicyDetailsDraft,
): PolicyDetailUpdate {
  switch (section) {
    case "overview":
      return {
        section,
        policyNumber: draft.policyNumber,
        effectiveDate: draft.effectiveDate,
        expirationDate: draft.expirationDate,
        premium: draft.premium,
        operationsDescription: draft.operationsDescription,
      };
    case "insured":
      return {
        section,
        name: draft.insuredName,
        address: draft.insuredAddress,
        additionalNamedInsureds: draft.additionalNamedInsureds,
      };
    case "producer":
      return {
        section,
        name: draft.producerName,
        address: draft.producerAddress,
        contactName: draft.producerContactName,
        licenseNumber: draft.producerLicenseNumber,
        phone: draft.producerPhone,
        email: draft.producerEmail,
      };
    case "insurer":
      return {
        section,
        name: draft.insurerName,
        address: draft.insurerAddress,
        naicNumber: draft.insurerNaicNumber,
      };
    case "generalAgent":
      return {
        section,
        name: draft.generalAgentName,
        address: draft.generalAgentAddress,
        licenseNumber: draft.generalAgentLicenseNumber,
      };
  }
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function applyUpdateToPolicy(
  current: Record<string, unknown>,
  update: PolicyDetailUpdate,
) {
  const overrides = recordValue(current.policyDetailOverrides);
  switch (update.section) {
    case "overview":
      return {
        ...current,
        policyNumber: update.policyNumber,
        effectiveDate: update.effectiveDate,
        expirationDate: update.expirationDate,
        premium: update.premium,
        policyDetailOverrides: {
          ...overrides,
          operationsDescription: update.operationsDescription,
        },
      };
    case "insured":
      return {
        ...current,
        policyDetailOverrides: {
          ...overrides,
          insured: {
            name: update.name,
            address: update.address,
            additionalNamedInsureds: update.additionalNamedInsureds,
          },
        },
      };
    case "producer":
      return {
        ...current,
        policyDetailOverrides: {
          ...overrides,
          producer: {
            name: update.name,
            address: update.address,
            contactName: update.contactName,
            licenseNumber: update.licenseNumber,
            phone: update.phone,
            email: update.email,
          },
        },
      };
    case "insurer":
      return {
        ...current,
        policyDetailOverrides: {
          ...overrides,
          insurer: {
            name: update.name,
            address: update.address,
            naicNumber: update.naicNumber,
          },
        },
      };
    case "generalAgent":
      return {
        ...current,
        policyDetailOverrides: {
          ...overrides,
          generalAgent: {
            name: update.name,
            address: update.address,
            licenseNumber: update.licenseNumber,
          },
        },
      };
  }
}

function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  autoComplete,
  placeholder,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  type?: "text" | "email" | "date";
  autoComplete?: string;
  placeholder?: string;
  error?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={`text-muted-foreground ${typeStyle("label.field")}`}>
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className={`text-destructive ${typeStyle("caption.default")}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AddressEditor({
  idPrefix,
  label,
  value,
  onChange,
  onCommit,
}: {
  idPrefix: string;
  label: string;
  value: AutofillAddress;
  onChange: (address: AutofillAddress) => void;
  onCommit: () => void;
}) {
  const setField = (field: keyof AutofillAddress, nextValue: string) => {
    onChange({ ...value, [field]: nextValue, formatted: undefined });
  };

  return (
    <FormSection title={label}>
      <div className="space-y-1.5">
        <Label
          htmlFor={`${idPrefix}-address-line-1`}
          className={`text-muted-foreground ${typeStyle("label.field")}`}
        >
          Address line 1
        </Label>
        <AddressAutofillInput
          id={`${idPrefix}-address-line-1`}
          value={value}
          onChange={onChange}
          onBlur={onCommit}
          onRetrieve={onCommit}
          display="street1"
          placeholder="Search for an address"
          autoComplete={`section-${idPrefix} address-line1`}
        />
      </div>
      <TextField
        id={`${idPrefix}-address-line-2`}
        label="Address line 2"
        value={value.street2 ?? ""}
        onChange={(nextValue) => setField("street2", nextValue)}
        onBlur={onCommit}
        autoComplete={`section-${idPrefix} address-line2`}
        placeholder="Suite, floor, or unit"
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_72px_96px]">
        <TextField
          id={`${idPrefix}-city`}
          label="City"
          value={value.city ?? ""}
          onChange={(nextValue) => setField("city", nextValue)}
          onBlur={onCommit}
          autoComplete={`section-${idPrefix} address-level2`}
        />
        <TextField
          id={`${idPrefix}-state`}
          label="State"
          value={value.state ?? ""}
          onChange={(nextValue) => setField("state", nextValue)}
          onBlur={onCommit}
          autoComplete={`section-${idPrefix} address-level1`}
        />
        <TextField
          id={`${idPrefix}-postal-code`}
          label="ZIP"
          value={value.zip ?? ""}
          onChange={(nextValue) => setField("zip", nextValue)}
          onBlur={onCommit}
          autoComplete={`section-${idPrefix} postal-code`}
        />
      </div>
      <TextField
        id={`${idPrefix}-country`}
        label="Country"
        value={value.country ?? ""}
        onChange={(nextValue) => setField("country", nextValue)}
        onBlur={onCommit}
        autoComplete={`section-${idPrefix} country-name`}
        placeholder="United States"
      />
    </FormSection>
  );
}

export function PolicyDetailsEditor({
  policy,
  section,
  open,
  onOpenChange,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  section: PolicyDetailsEditSection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updatePolicyDetails = useMutation(api.policies.updatePolicyDetails);
  const [draft, setDraft] = useState(() => draftFromPolicy(policy));
  const update = useMemo(() => updateFromDraft(section, draft), [draft, section]);
  const producerEmailInvalid = Boolean(
    section === "producer" &&
      draft.producerEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.producerEmail.trim()),
  );
  const producerPhoneInvalid = Boolean(
    section === "producer" &&
      draft.producerPhone.trim() &&
      !isValidPhoneNumber(draft.producerPhone),
  );

  const autoSave = useLocalFirstAutoSave({
    mutationName: `policy.updatePolicyDetails.${policy._id}.${section}`,
    args: { id: policy._id, update },
    valueKey: JSON.stringify(update),
    resetKey: `${policy._id}:${section}`,
    canSave: !producerEmailInvalid && !producerPhoneInvalid,
    autoSave: false,
    flush: (args) => updatePolicyDetails(args),
    applyLocal: (store, args) => {
      for (const cacheName of ["policies.get", "policies.getSummary"]) {
        const collection = cachedQueryCollectionFor<Record<
          string,
          unknown
        > | null>(cacheName);
        const argsKey = cachedQueryArgsKey({ id: args.id });
        const current = store.getCollection(collection, argsKey)?.[0]?.value;
        if (!current || typeof current !== "object") continue;
        void store.upsertCollection(collection, argsKey, [
          cachedQueryResult(argsKey, applyUpdateToPolicy(current, args.update)),
        ]);
      }
    },
    errorMessage: "The policy details could not be saved.",
  });
  const saveNow = autoSave.saveNow;
  const saveAfterChange = useCallback(() => {
    requestAnimationFrame(() => {
      void saveNow();
    });
  }, [saveNow]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    void saveNow().then((saved) => {
      if (saved) onOpenChange(false);
    });
  }

  const renderOverview = () => (
    <div className="space-y-4">
      <TextField
        id="policy-overview-number"
        label="Policy number"
        value={draft.policyNumber}
        onChange={(policyNumber) =>
          setDraft((current) => ({ ...current, policyNumber }))
        }
        onBlur={() => void saveNow()}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="policy-overview-effective-date"
          label="Effective date"
          type="date"
          value={normalizedDateInput(draft.effectiveDate)}
          onChange={(value) => {
            setDraft((current) => ({
              ...current,
              effectiveDate: storedDateValue(value),
            }));
            saveAfterChange();
          }}
          onBlur={() => void saveNow()}
        />
        <TextField
          id="policy-overview-expiration-date"
          label="Expiration date"
          type="date"
          value={normalizedDateInput(draft.expirationDate)}
          onChange={(value) => {
            setDraft((current) => ({
              ...current,
              expirationDate: storedDateValue(value),
            }));
            saveAfterChange();
          }}
          onBlur={() => void saveNow()}
        />
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="policy-overview-premium"
          className={`text-muted-foreground ${typeStyle("label.field")}`}
        >
          Premium
        </Label>
        <Input
          id="policy-overview-premium"
          inputMode="decimal"
          value={draft.premium}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              premium: event.target.value,
            }))
          }
          onBlur={() => {
            setDraft((current) => ({
              ...current,
              premium: formattedMoney(current.premium),
            }));
            saveAfterChange();
          }}
          placeholder="$0"
        />
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="policy-overview-operations"
          className={`text-muted-foreground ${typeStyle("label.field")}`}
        >
          Description of operations
        </Label>
        <Textarea
          id="policy-overview-operations"
          value={draft.operationsDescription}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              operationsDescription: event.target.value,
            }))
          }
          onBlur={() => void saveNow()}
          rows={5}
          placeholder="Describe the insured’s operations for this policy"
        />
      </div>
    </div>
  );

  const renderInsured = () => (
    <div className="space-y-4">
      <TextField
        id="policy-insured-name"
        label="Named insured"
        value={draft.insuredName}
        onChange={(insuredName) =>
          setDraft((current) => ({ ...current, insuredName }))
        }
        onBlur={() => void saveNow()}
        autoComplete="organization"
      />
      <AddressEditor
        idPrefix="policy-insured"
        label="Insured mailing address"
        value={draft.insuredAddress}
        onChange={(insuredAddress) =>
          setDraft((current) => ({ ...current, insuredAddress }))
        }
        onCommit={saveAfterChange}
      />
      <FormSection
        title="Additional named insureds"
        action={
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={() => {
              setDraft((current) => ({
                ...current,
                additionalNamedInsureds: [
                  ...current.additionalNamedInsureds,
                  "",
                ],
              }));
              saveAfterChange();
            }}
          >
            <Plus className="size-3.5" />
            Add
          </PillButton>
        }
      >
        {draft.additionalNamedInsureds.map((name, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={`Additional named insured ${index + 1}`}
              value={name}
              onChange={(event) => {
                const next = [...draft.additionalNamedInsureds];
                next[index] = event.target.value;
                setDraft((current) => ({
                  ...current,
                  additionalNamedInsureds: next,
                }));
              }}
              onBlur={() => void saveNow()}
              placeholder="Organization name"
              autoComplete="organization"
            />
            <PillButton
              type="button"
              size="compact"
              variant="icon"
              label={`Remove ${name || "additional named insured"}`}
              onClick={() => {
                setDraft((current) => ({
                  ...current,
                  additionalNamedInsureds:
                    current.additionalNamedInsureds.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                }));
                saveAfterChange();
              }}
            >
              <Trash2 className="size-3.5" />
            </PillButton>
          </div>
        ))}
      </FormSection>
    </div>
  );

  const renderProducer = () => (
    <div className="space-y-4">
      <TextField
        id="policy-producer-name"
        label="Producer"
        value={draft.producerName}
        onChange={(producerName) =>
          setDraft((current) => ({ ...current, producerName }))
        }
        onBlur={() => void saveNow()}
        autoComplete="organization"
      />
      <TextField
        id="policy-producer-contact"
        label="Contact"
        value={draft.producerContactName}
        onChange={(producerContactName) =>
          setDraft((current) => ({ ...current, producerContactName }))
        }
        onBlur={() => void saveNow()}
        autoComplete="name"
      />
      <TextField
        id="policy-producer-license"
        label="License number"
        value={draft.producerLicenseNumber}
        onChange={(producerLicenseNumber) =>
          setDraft((current) => ({ ...current, producerLicenseNumber }))
        }
        onBlur={() => void saveNow()}
      />
      <div className="space-y-1.5">
        <Label
          htmlFor="policy-producer-phone"
          className={`text-muted-foreground ${typeStyle("label.field")}`}
        >
          Phone
        </Label>
        <PhoneInput
          id="policy-producer-phone"
          value={draft.producerPhone || undefined}
          onChange={(producerPhone) =>
            setDraft((current) => ({
              ...current,
              producerPhone: producerPhone ?? "",
            }))
          }
          onBlur={saveAfterChange}
          defaultCountry="US"
          autoComplete="tel"
          aria-invalid={producerPhoneInvalid}
        />
        {producerPhoneInvalid ? (
          <p className={`text-destructive ${typeStyle("caption.default")}`}>
            Enter a valid phone number with country code.
          </p>
        ) : null}
      </div>
      <TextField
        id="policy-producer-email"
        label="Email"
        type="email"
        value={draft.producerEmail}
        onChange={(producerEmail) =>
          setDraft((current) => ({ ...current, producerEmail }))
        }
        onBlur={() => void saveNow()}
        autoComplete="email"
        placeholder="producer@example.com"
        error={producerEmailInvalid ? "Enter a valid email address." : undefined}
      />
      <AddressEditor
        idPrefix="policy-producer"
        label="Producer address"
        value={draft.producerAddress}
        onChange={(producerAddress) =>
          setDraft((current) => ({ ...current, producerAddress }))
        }
        onCommit={saveAfterChange}
      />
    </div>
  );

  const renderParty = (party: "insurer" | "generalAgent") => {
    const isInsurer = party === "insurer";
    const name = isInsurer ? draft.insurerName : draft.generalAgentName;
    const partyAddress = isInsurer
      ? draft.insurerAddress
      : draft.generalAgentAddress;
    const identifier = isInsurer
      ? draft.insurerNaicNumber
      : draft.generalAgentLicenseNumber;
    return (
      <div className="space-y-4">
        <TextField
          id={`policy-${party}-name`}
          label={isInsurer ? "Carrier / insurer" : "General Agent"}
          value={name}
          onChange={(nextName) =>
            setDraft((current) =>
              isInsurer
                ? { ...current, insurerName: nextName }
                : { ...current, generalAgentName: nextName },
            )
          }
          onBlur={() => void saveNow()}
          autoComplete="organization"
        />
        <TextField
          id={`policy-${party}-identifier`}
          label={isInsurer ? "NAIC number" : "License number"}
          value={identifier}
          onChange={(nextIdentifier) =>
            setDraft((current) =>
              isInsurer
                ? { ...current, insurerNaicNumber: nextIdentifier }
                : { ...current, generalAgentLicenseNumber: nextIdentifier },
            )
          }
          onBlur={() => void saveNow()}
        />
        <AddressEditor
          idPrefix={`policy-${party}`}
          label={
            isInsurer
              ? "Carrier / insurer address"
              : "General Agent address"
          }
          value={partyAddress}
          onChange={(nextAddress) =>
            setDraft((current) =>
              isInsurer
                ? { ...current, insurerAddress: nextAddress }
                : { ...current, generalAgentAddress: nextAddress },
            )
          }
          onCommit={saveAfterChange}
        />
      </div>
    );
  };

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={handleOpenChange}
      title={SECTION_TITLES[section]}
    >
      <AutoSaveStatus status={autoSave.status} />
      {section === "overview" ? renderOverview() : null}
      {section === "insured" ? renderInsured() : null}
      {section === "producer" ? renderProducer() : null}
      {section === "insurer" ? renderParty("insurer") : null}
      {section === "generalAgent" ? renderParty("generalAgent") : null}
    </SettingsDrawer>
  );
}
