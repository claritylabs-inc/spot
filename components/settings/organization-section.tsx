"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Globe2, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { INDUSTRIES } from "@/convex/lib/industries";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  patchCachedViewerOrg,
  useCachedViewerOrg,
} from "@/lib/sync/spot-cached-queries";
import { useSyncStore } from "@claritylabs/cl-sync";
import {
  AutoSaveStatus,
  combineAutoSaveStatuses,
} from "@/components/ui/auto-save-status";
import type { AutoSaveStatus as AutoSaveStatusValue } from "@/lib/sync/use-local-first-auto-save";
import {
  OrganizationInsuranceProfile,
  type OrganizationInsuranceProfileRecord,
} from "@/components/settings/organization-insurance-profile";
import { typeStyle } from "@/lib/typography";

type OrgSettingsArgs = {
  name?: string;
  website?: string;
  context?: string;
  industry?: string;
  industryVertical?: string;
  relatedLegalEntities?: RelatedLegalEntity[];
};

type RelatedLegalEntity = {
  legalName: string;
};

export function OrganizationSection() {
  const orgData = useCachedViewerOrg();
  const store = useSyncStore();
  const updateOrg = useMutation(api.orgs.updateOrg);
  const extractCompanyInfo = useAction(
    api.actions.extractCompanyInfo.extractCompanyInfo,
  );

  const org = orgData?.org;

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [industryVertical, setIndustryVertical] = useState("");
  const [relatedLegalEntities, setRelatedLegalEntities] = useState<
    RelatedLegalEntity[]
  >([]);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [profileAutoSaveStatus, setProfileAutoSaveStatus] =
    useState<AutoSaveStatusValue>("saved");
  const [profileCanReset, setProfileCanReset] = useState(false);
  const [restoringProfile, setRestoringProfile] = useState(false);
  const profileResetRef = useRef<(() => Promise<void>) | null>(null);
  const handleProfileAutoSaveChange = useCallback(
    (status: AutoSaveStatusValue) => {
      setProfileAutoSaveStatus(status);
    },
    [],
  );
  const handleProfileResetActionChange = useCallback(
    (resetToExtracted: (() => Promise<void>) | null) => {
      profileResetRef.current = resetToExtracted;
      setProfileCanReset(Boolean(resetToExtracted));
    },
    [],
  );
  const [extracting, setExtracting] = useState(false);
  const hydratedRef = useRef(false);

  const { setActions } = useSettingsActions();

  useEffect(() => {
    if (org && !hydratedRef.current) {
      setName(org.name ?? "");
      setWebsite(org.website ?? "");
      setIndustry(org.industry ?? "");
      setIndustryVertical(org.industryVertical ?? "");
      setRelatedLegalEntities(org.relatedLegalEntities ?? []);
      hydratedRef.current = true;
      setSettingsHydrated(true);
    }
  }, [org]);

  const orgSettingsArgs: OrgSettingsArgs = {
    name: name.trim(),
    website: website || undefined,
    industry: industry || undefined,
    industryVertical: industryVertical || undefined,
    relatedLegalEntities: relatedLegalEntities
      .map((entity) => ({
        legalName: entity.legalName.trim(),
      }))
      .filter((entity) => entity.legalName),
  };
  const saveOrgSettings = useCallback(
    async (args: OrgSettingsArgs) => {
      await updateOrg(args);
    },
    [updateOrg],
  );

  const orgAutoSave = useLocalFirstAutoSave({
    mutationName: "settings.organization.updateOrg",
    args: orgSettingsArgs,
    enabled: settingsHydrated,
    canSave: Boolean(name.trim()),
    autoSave: false,
    applyLocal: (store, args) => patchCachedViewerOrg(store, args),
    flush: saveOrgSettings,
    errorMessage: "Organization settings could not be saved.",
  });
  const saveOrgSettingsNow = orgAutoSave.saveNow;

  const saveOrgSettingsAfterChange = useCallback(() => {
    requestAnimationFrame(() => {
      void saveOrgSettingsNow();
    });
  }, [saveOrgSettingsNow]);

  const organizationSaveStatus = combineAutoSaveStatuses(
    orgAutoSave.status,
    profileAutoSaveStatus,
  );

  const handleUseExtracted = useCallback(async () => {
    const resetToExtracted = profileResetRef.current;
    if (!resetToExtracted) return;
    setRestoringProfile(true);
    try {
      await resetToExtracted();
    } catch {
      toast.error("Extracted profile could not be restored");
    } finally {
      setRestoringProfile(false);
    }
  }, []);

  useEffect(() => {
    setActions(
      <>
        <AutoSaveStatus status={organizationSaveStatus} />
        {profileCanReset ? (
          <PillButton
            type="button"
            variant="secondary"
            size="compact"
            label={restoringProfile ? "Restoring…" : "Use extracted"}
            expandLabel
            onClick={() => void handleUseExtracted()}
            disabled={restoringProfile || profileAutoSaveStatus === "saving"}
          >
            {restoringProfile ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
          </PillButton>
        ) : null}
        <PillButton
          variant="secondary"
          size="compact"
          label={extracting ? "Extracting…" : "Extract from website"}
          expandLabel
          onClick={handleExtract}
          disabled={extracting || !website}
        >
          {extracting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Globe2 className="size-3.5" />
          )}
        </PillButton>
      </>,
    );
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    organizationSaveStatus,
    extracting,
    handleUseExtracted,
    profileAutoSaveStatus,
    profileCanReset,
    restoringProfile,
    website,
  ]);

  async function handleExtract() {
    if (!website) return;
    setExtracting(true);
    try {
      let url = website;
      if (!url.startsWith("http")) url = "https://" + url;
      // Persist the current website immediately so the server-side extract
      // and the re-fetched org reflect what the user actually typed.
      await updateOrg({ website: url });
      setWebsite(url);
      // Synchronous await is intentional — website scrape typically < 5s.
      // Not a long-running pipeline; cl-pipelines not required here.
      const result = await extractCompanyInfo({ url });
      const extractedFields: OrgSettingsArgs = {
        context: result.companyContext || undefined,
        industry: result.industry || undefined,
        industryVertical: result.industryVertical || undefined,
      };
      await updateOrg(extractedFields);
      patchCachedViewerOrg(store, extractedFields);
      if (result.industry) {
        setIndustry(result.industry);
        setIndustryVertical(result.industryVertical ?? "");
      }
      toast.success("Company info extracted");
    } catch {
      toast.error("Failed to extract company info");
    } finally {
      setExtracting(false);
    }
  }

  function updateRelatedLegalEntity(
    index: number,
    patch: Partial<RelatedLegalEntity>,
  ) {
    setRelatedLegalEntities((current) =>
      current.map((entity, entityIndex) =>
        entityIndex === index ? { ...entity, ...patch } : entity,
      ),
    );
  }

  function addRelatedLegalEntity() {
    setRelatedLegalEntities((current) => [...current, { legalName: "" }]);
  }

  function removeRelatedLegalEntity(index: number) {
    setRelatedLegalEntities((current) =>
      current.filter((_, entityIndex) => entityIndex !== index),
    );
    saveOrgSettingsAfterChange();
  }

  if (orgData === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Organization info */}
      <div>
        <>
          <OperationalPanel className="mb-4">
            <OperationalPanelHeader
              title="Organization"
              className="px-5 py-3.5"
            />
            <OperationalPanelBody className="space-y-4 px-5 py-5">
              <div>
                <label
                  htmlFor="organization-name"
                  className={`text-muted-foreground block mb-1.5 ${typeStyle("label.field")}`}
                >
                  Organization Name
                </label>
                <input
                  id="organization-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => void saveOrgSettingsNow()}
                  placeholder="Organization name"
                  aria-invalid={settingsHydrated && !name.trim()}
                  aria-describedby={
                    !name.trim() ? "organization-name-error" : undefined
                  }
                  className={`h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-input transition-colors ${typeStyle("control.input")}`}
                />
                {settingsHydrated && !name.trim() ? (
                  <p
                    id="organization-name-error"
                    role="alert"
                    className={`mt-1.5 text-destructive ${typeStyle("body.default")}`}
                  >
                    Enter an organization name.
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  className={`text-muted-foreground block mb-1.5 ${typeStyle("label.field")}`}
                >
                  Website
                </label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  onBlur={() => void saveOrgSettingsNow()}
                  placeholder="https://example.com"
                  className={`h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-input transition-colors ${typeStyle("control.input")}`}
                />
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-popover px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label
                      className={`text-muted-foreground block ${typeStyle("label.field")}`}
                    >
                      Legal names and related entities
                    </label>
                  </div>
                  <PillButton
                    type="button"
                    size="compact"
                    variant="secondary"
                    onClick={addRelatedLegalEntity}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </PillButton>
                </div>
                {relatedLegalEntities.length === 0 ? (
                  <p
                    className={`text-muted-foreground/70 ${typeStyle("body.default")}`}
                  >
                    No related legal entities listed.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {relatedLegalEntities.map((entity, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={entity.legalName}
                          onChange={(event) =>
                            updateRelatedLegalEntity(index, {
                              legalName: event.target.value,
                            })
                          }
                          onBlur={() => void saveOrgSettingsNow()}
                          placeholder="Alternate legal name, DBA, FKA, parent, subsidiary, or affiliate"
                          className={`h-9 min-w-0 flex-1 rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-input transition-colors ${typeStyle("control.input")}`}
                        />
                        <PillButton
                          type="button"
                          variant="destructive"
                          iconOnly
                          label="Remove legal entity"
                          onClick={() => removeRelatedLegalEntity(index)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </PillButton>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    className={`text-muted-foreground block mb-1.5 ${typeStyle("label.field")}`}
                  >
                    Industry
                  </label>
                  <SearchableSelect
                    options={INDUSTRIES.map((ind) => ({
                      value: ind.value,
                      label: ind.label,
                    }))}
                    value={industry}
                    onChange={(v) => {
                      setIndustry(v);
                      setIndustryVertical("");
                      saveOrgSettingsAfterChange();
                    }}
                    placeholder="Select industry..."
                  />
                </div>
                <div>
                  <label
                    className={`text-muted-foreground block mb-1.5 ${typeStyle("label.field")}`}
                  >
                    Vertical
                  </label>
                  <SearchableSelect
                    options={
                      INDUSTRIES.find(
                        (i) => i.value === industry,
                      )?.verticals.map((v) => ({
                        value: v.value,
                        label: v.label,
                      })) ?? []
                    }
                    value={industryVertical}
                    onChange={(value) => {
                      setIndustryVertical(value);
                      saveOrgSettingsAfterChange();
                    }}
                    placeholder="Select vertical..."
                    disabled={!industry}
                  />
                </div>
              </div>

              {org ? (
                <OrganizationInsuranceProfile
                  key={String(org._id)}
                  org={org as unknown as OrganizationInsuranceProfileRecord}
                  disabled={orgData.membership.role !== "admin"}
                  onAutoSaveChange={handleProfileAutoSaveChange}
                  onResetActionChange={handleProfileResetActionChange}
                />
              ) : null}
            </OperationalPanelBody>
          </OperationalPanel>

          <OrganizationLogoCard website={website} />
        </>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Organization logo
// ─────────────────────────────────────────────────────────────────────────────

const logoLabelClass = `text-muted-foreground block mb-1.5 ${typeStyle("caption.medium")}`;

function OrganizationLogoCard({ website }: { website: string }) {
  const currentOrg = useCurrentOrg();
  const store = useSyncStore();
  const org = currentOrg?.org as
    | {
        iconStorageId?: string;
        iconUrl?: string | null;
      }
    | undefined;
  const orgId = currentOrg?.orgId as Id<"organizations"> | undefined;

  const generateUploadUrl = useMutation(
    api.organizations.generateOrgLogoUploadUrl,
  );
  const updateOrgLogo = useMutation(api.organizations.updateOrgLogo);
  const importOrgLogo = useAction(
    api.actions.extractCompanyInfo.importOrgLogoFromWebsite,
  );

  const [dragActive, setDragActive] = useState(false);
  const [importingLogo, setImportingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLogoUpload(file: File) {
    if (!orgId) return;
    try {
      const uploadUrl = await generateUploadUrl({ orgId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type },
      });
      const { storageId } = await res.json();
      await updateOrgLogo({ orgId, logoStorageId: storageId });
      patchCachedViewerOrg(store, { iconStorageId: storageId });
    } catch {
      toast.error("Failed to upload logo");
    }
  }

  async function handlePullLogo() {
    if (!orgId || !website.trim()) {
      toast.error("Add a website first");
      return;
    }
    setImportingLogo(true);
    try {
      const result = await importOrgLogo({ orgId, url: website });
      if (!result.success || !result.iconStorageId) {
        throw new Error(result.error ?? "Logo not found");
      }
      patchCachedViewerOrg(store, { iconStorageId: result.iconStorageId });
      toast.success("Logo pulled from website");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to pull logo"));
    } finally {
      setImportingLogo(false);
    }
  }

  const logoUrl = org?.iconUrl
    ? org.iconUrl
    : org?.iconStorageId
      ? `/api/storage/${org.iconStorageId}`
      : null;

  return (
    <OperationalPanel as="div" className="mb-4">
      <OperationalPanelHeader
        title="Organization logo"
        className="px-5 py-3.5"
      />
      <OperationalPanelBody className="space-y-5 px-5 py-5">
        {/* Logo */}
        <div>
          <label className={logoLabelClass}>Logo</label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleLogoUpload(file);
            }}
            className={`flex w-full items-center gap-4 rounded-lg border border-dashed px-4 py-3 text-left transition-colors ${
              dragActive
                ? "border-border-focus bg-foreground/3"
                : "border-border-emphasized bg-popover hover:border-border-focus"
            }`}
          >
            <div className="h-10 w-10 rounded-md border border-input bg-white flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt="Logo"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span
                  className={`text-muted-foreground/60 ${typeStyle("caption.default")}`}
                >
                  —
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-foreground ${typeStyle("body.medium")}`}>
                {logoUrl ? "Replace logo" : "Upload logo"}
              </div>
              <div
                className={`text-muted-foreground/70 ${typeStyle("caption.default")}`}
              >
                Drop an image, click to browse, or pull it from the website.
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleLogoUpload(file);
              }}
            />
          </button>
          <div className="mt-3">
            <PillButton
              variant="secondary"
              onClick={handlePullLogo}
              disabled={importingLogo}
            >
              {importingLogo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Pull from website
            </PillButton>
          </div>
        </div>
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
