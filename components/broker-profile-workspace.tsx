"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { AddressAutofillInput } from "@/components/ui/address-autofill-input";
import { Input } from "@/components/ui/input";
import { TokenListField } from "@/components/broker-network/token-list-field";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { FileDropZone } from "@/components/ui/file-drop";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useCurrentOrg } from "@/hooks/use-current-org";
import type { Id } from "@/convex/_generated/dataModel";

export function BrokerProfileWorkspace() {
  const currentOrg = useCurrentOrg();
  const brokerOrgId = currentOrg?.orgId as Id<"organizations"> | undefined;
  const profile = useQuery(
    api.brokerProfiles.get,
    brokerOrgId ? { brokerOrgId } : "skip",
  );
  if (profile === undefined) {
    return (
      <OperationalPanel className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }
  if (!profile) {
    return (
      <OperationalPanel>
        <OperationalPanelBody
          className={`text-muted-foreground ${typeStyle("body.default")}`}
        >
          Insurance provider profile not found.
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  return (
    <BrokerProfileEditor
      key={brokerOrgId}
      profile={profile}
      canEdit={currentOrg?.role === "admin"}
    />
  );
}

function BrokerProfileEditor({
  profile,
  canEdit,
}: {
  profile: NonNullable<FunctionReturnType<typeof api.brokerProfiles.get>>;
  canEdit: boolean;
}) {
  const brokerOrgId = profile.broker._id;
  const update = useMutation(api.brokerProfiles.upsert);
  const generateLogoUploadUrl = useMutation(
    api.brokerProfiles.generateLogoUploadUrl,
  );
  const [website, setWebsite] = useState(profile.broker.website ?? "");
  const [line1, setLine1] = useState(
    profile.profile?.officeAddress?.street1 ?? "",
  );
  const [line2, setLine2] = useState(
    profile.profile?.officeAddress?.street2 ?? "",
  );
  const [country, setCountry] = useState(
    profile.profile?.officeAddress?.country ?? "",
  );
  const [city, setCity] = useState(profile.profile?.officeAddress?.city ?? "");
  const [state, setState] = useState(
    profile.profile?.officeAddress?.state ?? "",
  );
  const [postalCode, setPostalCode] = useState(
    profile.profile?.officeAddress?.postalCode ?? "",
  );
  const [writingStates, setWritingStates] = useState(
    profile.profile?.writingStates ?? [],
  );
  const [lines, setLines] = useState(
    profile.profile?.lineOfBusinessCodes ?? [],
  );
  const [saving, setSaving] = useState(false);
  const values = {
    website,
    line1,
    line2,
    country,
    city,
    state,
    postalCode,
    writingStates,
    lines,
  };
  const savedValues = useRef(values);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "brokerProfiles.upsert",
    args: values,
    enabled: canEdit,
    flush: async (next) => {
      const previous = savedValues.current;
      const officeChanged =
        next.country !== previous.country ||
        next.line1 !== previous.line1 ||
        next.line2 !== previous.line2 ||
        next.city !== previous.city ||
        next.state !== previous.state ||
        next.postalCode !== previous.postalCode;
      await update({
        brokerOrgId,
        website:
          next.website !== previous.website
            ? next.website.trim() || null
            : undefined,
        officeAddress: officeChanged
          ? {
              country:
                next.country !== previous.country
                  ? next.country.trim()
                  : undefined,
              street1:
                next.line1 !== previous.line1 ? next.line1.trim() : undefined,
              street2:
                next.line2 !== previous.line2 ? next.line2.trim() : undefined,
              city: next.city !== previous.city ? next.city.trim() : undefined,
              state:
                next.state !== previous.state
                  ? next.state.trim().toUpperCase()
                  : undefined,
              postalCode:
                next.postalCode !== previous.postalCode
                  ? next.postalCode.trim()
                  : undefined,
            }
          : undefined,
        writingStates:
          next.writingStates !== previous.writingStates
            ? next.writingStates
            : undefined,
        lineOfBusinessCodes:
          next.lines !== previous.lines ? next.lines : undefined,
      });
      savedValues.current = next;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not save the provider profile"),
  });
  const disabled = !canEdit;
  async function uploadLogo(file: File) {
    if (!brokerOrgId || !canEdit) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB");
      return;
    }
    setSaving(true);
    const notification = toast.loading("Uploading logo…");
    try {
      const uploadUrl = await generateLogoUploadUrl({ brokerOrgId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await update({
        brokerOrgId,
        iconStorageId: storageId,
      });
      toast.success("Provider logo saved", { id: notification });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not save the provider logo"),
        { id: notification },
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      <AutoSaveStatus status={autoSave.status} />
      <OperationalPanel>
        <OperationalPanelHeader title={profile.broker.name} />
        <OperationalPanelBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Website">
            <Input
              disabled={disabled}
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://example.com"
            />
          </Field>
          <Field label="Logo">
            <div className="space-y-2.5">
              <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-muted/20 p-3">
                <OrgBrandIcon
                  name={profile.broker.name}
                  iconUrl={profile.broker.iconUrl}
                  website={profile.broker.website}
                  size="xl"
                  className="rounded-lg"
                />
                <div className="min-w-0">
                  <p className={typeStyle("body.medium")}>
                    {profile.broker.name}
                  </p>
                  <p
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    {profile.broker.iconUrl
                      ? "Current logo"
                      : "No logo uploaded yet"}
                  </p>
                </div>
              </div>
              {canEdit ? (
                <FileDropZone
                  accept="image/*"
                  disabled={saving}
                  idleLabel="Upload a logo"
                  activeLabel="Drop logo to upload"
                  hint="PNG, JPG, or SVG · Max 5 MB"
                  padding="px-4 py-3"
                  className="min-h-24"
                  onFile={(file) => void uploadLogo(file)}
                />
              ) : null}
            </div>
          </Field>
          <Field label="Primary office address">
            <AddressAutofillInput
              id="broker-profile-office-address"
              disabled={disabled}
              display="street1"
              value={{
                street1: line1,
                street2: line2,
                city,
                state,
                zip: postalCode,
                country,
              }}
              onChange={(next) => {
                setLine1(next.street1 ?? "");
                setCountry(next.country ?? "");
                setLine2(next.street2 ?? "");
                setCity(next.city ?? "");
                setState(next.state ?? "");
                setPostalCode(next.zip ?? "");
              }}
            />
          </Field>
          <Field label="Address line 2">
            <Input
              disabled={disabled}
              value={line2}
              onChange={(event) => setLine2(event.target.value)}
              placeholder="Suite or unit"
            />
          </Field>
          <Field label="City">
            <Input
              disabled={disabled}
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </Field>
          <Field label="State">
            <Input
              disabled={disabled}
              maxLength={2}
              value={state}
              onChange={(event) => setState(event.target.value)}
            />
          </Field>
          <Field label="Postal code">
            <Input
              disabled={disabled}
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
            />
          </Field>
        </OperationalPanelBody>
      </OperationalPanel>
      <OperationalPanel>
        <OperationalPanelBody className="grid gap-5 sm:grid-cols-2">
          <Field label="States serviced" help="Press Enter or comma to add.">
            <TokenListField
              value={writingStates}
              onChange={setWritingStates}
              placeholder="CA, NV, OR"
              ariaLabel="Add writing state"
              disabled={disabled}
            />
          </Field>
          <Field
            label="ACORD lines of business"
            help="Press Enter or comma to add exact LOBCd values."
          >
            <TokenListField
              value={lines}
              onChange={setLines}
              placeholder="CGL, PROP, UMBRC"
              ariaLabel="Add ACORD line"
              disabled={disabled}
            />
          </Field>
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
      >
        {label}
      </span>
      {children}
      {help ? (
        <span
          className={`mt-1.5 block text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {help}
        </span>
      ) : null}
    </label>
  );
}
