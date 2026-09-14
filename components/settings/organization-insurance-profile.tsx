"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useSyncStore } from "@claritylabs/cl-sync";

import { api } from "@/convex/_generated/api";
import { AddressAutofillInput } from "@/components/ui/address-autofill-input";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  IRS_ENTITY_TYPES,
  type IrsEntityType,
} from "@/convex/lib/entityTypes";
import { resolveEffectiveOrganizationProfile } from "@/convex/lib/orgProfileFacts";
import { patchCachedViewerOrg } from "@/lib/sync/spot-cached-queries";
import { useLiveRecordDraft } from "@/lib/sync/use-live-record-draft";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { typeStyle } from "@/lib/typography";

type Address = {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  formatted?: string;
};

export type OrganizationProfile = {
  mailingAddress: Address;
  entityType: IrsEntityType | "";
  fein: string;
  businessNumber: string;
  operationsDescription: string;
};

export type OrganizationInsuranceProfileRecord = {
  _id: string;
  name?: string;
  profileOverrides?: Partial<OrganizationProfile>;
  profileFacts?: Record<string, unknown>;
  mailingAddress?: Address;
};

const entityTypeOptions = IRS_ENTITY_TYPES.map((option) => ({ ...option }));

export function feinValidationError(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^\d{2}-?\d{7}$/.test(trimmed)) return undefined;
  return "Enter a 9-digit FEIN.";
}

export function businessNumberValidationError(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^\d{9}(?:\s*[A-Za-z]{2}\s*\d{4})?$/.test(trimmed)) {
    return undefined;
  }
  return "Enter 9 digits, optionally followed by a program account.";
}

function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  placeholder?: string;
  error?: string;
}) {
  const errorId = `${id}-error`;

  return (
    <label htmlFor={id} className="block min-w-0">
      <span className={`mb-1.5 block text-muted-foreground ${typeStyle("caption.medium")}`}>
        {label}
      </span>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <span
          id={errorId}
          className={`mt-1.5 block text-destructive ${typeStyle("caption.default")}`}
          aria-live="polite"
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function OrganizationInsuranceProfile({
  org,
  disabled = false,
  onSaveProfile,
  onAutoSaveChange,
  onResetActionChange,
}: {
  org: OrganizationInsuranceProfileRecord;
  disabled?: boolean;
  onSaveProfile?: (
    profile: Partial<OrganizationProfile> | null,
  ) => Promise<OrganizationProfile | null>;
  onAutoSaveChange?: (
    status: "saved" | "saving" | "unsaved" | "error",
    saveNow: (() => Promise<boolean>) | null,
  ) => void;
  onResetActionChange?: (resetToExtracted: (() => Promise<void>) | null) => void;
}) {
  const draft = useLiveRecordDraft(
    org._id,
    resolveEffectiveOrganizationProfile(org),
  );
  const profile = draft.value;
  const setProfile = draft.setValue;
  const hasOverride = Boolean(org.profileOverrides);
  const [touchedIdentifiers, setTouchedIdentifiers] = useState({
    fein: false,
    businessNumber: false,
  });
  const updateOrganizationProfile = useMutation(api.orgs.updateOrganizationProfile);
  const store = useSyncStore();
  const feinError = feinValidationError(profile.fein);
  const businessNumberError = businessNumberValidationError(profile.businessNumber);
  const saveProfile = useCallback(
    (nextProfile: Partial<OrganizationProfile> | null) =>
      onSaveProfile
        ? onSaveProfile(nextProfile)
        : updateOrganizationProfile({ profile: nextProfile }),
    [onSaveProfile, updateOrganizationProfile],
  );

  const autoSave = useLocalFirstAutoSave({
    mutationName: `settings.organization.insuranceProfile.${org._id}`,
    args: { profile: draft.patch, revision: draft.revision },
    valueKey: String(draft.revision),
    resetKey: org._id,
    enabled: !disabled,
    canSave: !disabled && !feinError && !businessNumberError,
    autoSave: false,
    flush: async (args) => {
      const saved = await saveProfile(args.profile);
      draft.acknowledge(args.revision);
      return saved;
    },
    errorMessage: "The organization insurance profile could not be saved.",
  });
  const saveProfileNow = autoSave.saveNow;

  const saveAfterChange = useCallback(() => {
    requestAnimationFrame(() => {
      void saveProfileNow();
    });
  }, [saveProfileNow]);

  useEffect(() => {
    onAutoSaveChange?.(autoSave.status, saveProfileNow);
    return () => onAutoSaveChange?.("saved", null);
  }, [autoSave.status, onAutoSaveChange, saveProfileNow]);

  const resetToExtracted = useCallback(async () => {
    if (!(await saveProfileNow())) return;
    await saveProfile(null);
    if (!onSaveProfile) {
      patchCachedViewerOrg(store, {
        profileOverrides: undefined,
        profileOverridesUpdatedAt: undefined,
        profileOverridesUpdatedByUserId: undefined,
      });
    }
  }, [onSaveProfile, saveProfile, saveProfileNow, store]);

  useEffect(() => {
    onResetActionChange?.(hasOverride ? resetToExtracted : null);
    return () => onResetActionChange?.(null);
  }, [hasOverride, onResetActionChange, resetToExtracted]);

  const country = profile.mailingAddress.country?.trim().toLowerCase() ?? "";
  const isCanada = country === "ca" || country === "can" || country === "canada";

  return (
    <fieldset disabled={disabled}>
      <FormSection title="Insurance profile" className="space-y-4">
        <label className="block min-w-0">
          <span className={`mb-1.5 block text-muted-foreground ${typeStyle("caption.medium")}`}>
            Mailing address
          </span>
          <AddressAutofillInput
            id="organization-mailing-address"
            value={profile.mailingAddress}
            onChange={(mailingAddress) =>
              setProfile((current) => ({
                ...current,
                mailingAddress,
              }))
            }
            onBlur={saveAfterChange}
            onRetrieve={saveAfterChange}
            placeholder="Search for the organization’s mailing address"
            autoComplete="organization street-address"
            disabled={disabled}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className={`mb-1.5 block text-muted-foreground ${typeStyle("caption.medium")}`}>
              Entity type
            </span>
            <SearchableSelect
              options={entityTypeOptions}
              value={profile.entityType}
              onChange={(entityType) => {
                setProfile((current) => ({
                  ...current,
                  entityType: entityType as IrsEntityType,
                }));
                saveAfterChange();
              }}
              placeholder="Select entity type"
              disabled={disabled}
            />
          </label>
          <Field
            id="organization-fein"
            label="FEIN"
            value={profile.fein}
            onChange={(fein) =>
              setProfile((current) => ({ ...current, fein }))
            }
            onBlur={() => {
              setTouchedIdentifiers((current) => ({ ...current, fein: true }));
              void saveProfileNow();
            }}
            placeholder="XX-XXXXXXX"
            error={touchedIdentifiers.fein ? feinError : undefined}
          />
          {isCanada ? (
            <Field
              id="organization-business-number"
              label="Business number"
              value={profile.businessNumber}
              onChange={(businessNumber) =>
                setProfile((current) => ({
                  ...current,
                  businessNumber,
                }))
              }
              onBlur={() => {
                setTouchedIdentifiers((current) => ({
                  ...current,
                  businessNumber: true,
                }));
                void saveProfileNow();
              }}
              placeholder="123456789 or 123456789 RC 0001"
              error={
                touchedIdentifiers.businessNumber
                  ? businessNumberError
                  : undefined
              }
            />
          ) : null}
        </div>

        <label className="block">
          <span className={`mb-1.5 block text-muted-foreground ${typeStyle("caption.medium")}`}>
            Description of operations
          </span>
          <textarea
            value={profile.operationsDescription}
            onChange={(event) =>
              setProfile((current) => ({
                ...current,
                operationsDescription: event.target.value,
              }))
            }
            onBlur={() => void saveProfileNow()}
            rows={4}
            placeholder="Describe the organization’s current business operations"
            className={`w-full resize-y rounded-lg border border-input bg-popover px-3 py-2 placeholder:text-muted-foreground/40 focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-input ${typeStyle("control.input")}`}
          />
        </label>
      </FormSection>
    </fieldset>
  );
}
