"use client";

import { useSyncStore } from "@claritylabs/cl-sync";

import { useEffect, useRef, useState } from "react";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCurrentOrg } from "@/hooks/use-current-org";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Globe2, Loader2 } from "lucide-react";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { useLiveRecordDraft } from "@/lib/sync/use-live-record-draft";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  patchCachedViewerOrg,
  useCachedViewerOrg,
} from "@/lib/sync/spot-cached-queries";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { typeStyle } from "@/lib/typography";

export function OrganizationSection() {
  const orgData = useCachedViewerOrg();
  const updateOrg = useMutation(api.orgs.updateOrg);
  const extractCompanyInfo = useAction(
    api.actions.extractCompanyInfo.extractCompanyInfo,
  );

  const org = orgData?.org;

  const draft = useLiveRecordDraft(org?._id ?? "loading", {
    name: org?.name ?? "",
    website: org?.website ?? "",
  });
  const { name, website } = draft.value;
  const setName = draft.field("name");
  const setWebsite = draft.field("website");
  const settingsHydrated = Boolean(org);
  const [extracting, setExtracting] = useState(false);

  const { setActions } = useSettingsActions();

  const orgSettingsArgs = {
    ...draft.patch,
    ...(draft.patch.name !== undefined ? { name: name.trim() } : {}),
  };
  const orgAutoSave = useLocalFirstAutoSave({
    mutationName: "settings.organization.updateOrg",
    args: { patch: orgSettingsArgs, revision: draft.revision },
    valueKey: String(draft.revision),
    resetKey: org?._id ?? "loading",
    enabled: settingsHydrated,
    canSave: Boolean(name.trim()),
    autoSave: false,
    applyLocal: (store, args) => patchCachedViewerOrg(store, args.patch),
    flush: async ({ patch, revision }) => {
      await updateOrg(patch);
      draft.acknowledge(revision);
    },
    errorMessage: "Organization settings could not be saved.",
  });
  const saveOrgSettingsNow = orgAutoSave.saveNow;

  useEffect(() => {
    setActions(
      <>
        <AutoSaveStatus status={orgAutoSave.status} />
        <PillButton
          variant="secondary"
          size="compact"
          label={extracting ? "Queuing…" : "Research company"}
          expandLabel
          onClick={handleExtract}
          disabled={extracting || org?.type === "broker"}
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
    orgAutoSave.status,
    extracting,
    org?.type,
    website,
  ]);

  async function handleExtract() {
    setExtracting(true);
    try {
      if (website.trim()) {
        const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
        await updateOrg({ website: url });
        setWebsite(url);
      }
      const result = await extractCompanyInfo({});
      toast.success(result.status === "running" ? "Company research already running" : "Company research queued");
    } catch {
      toast.error("Could not queue company research");
    } finally {
      setExtracting(false);
    }
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
  const store = useSyncStore();
  const currentOrg = useCurrentOrg();
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
