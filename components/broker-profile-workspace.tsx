"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { Input } from "@/components/ui/input";
import { TokenListField } from "@/components/broker-network/token-list-field";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
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
          Broker profile not found.
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
      getUserFacingErrorMessage(error, "Could not save the broker profile"),
  });
  const disabled = !canEdit;
  async function uploadLogo(file: File) {
    if (!brokerOrgId) return;
    setSaving(true);
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
      toast.success("Broker logo saved");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not save the broker logo"),
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
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center overflow-hidden rounded-md border border-input bg-popover">
                {profile.broker.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.broker.iconUrl}
                    alt=""
                    className="size-full object-contain"
                  />
                ) : (
                  <ImagePlus className="size-4 text-muted-foreground" />
                )}
              </div>
              {canEdit ? (
                <PillButton
                  variant="secondary"
                  disabled={saving}
                  onClick={() =>
                    document.getElementById("broker-logo-upload")?.click()
                  }
                >
                  Upload logo
                </PillButton>
              ) : null}
              <input
                id="broker-logo-upload"
                className="hidden"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadLogo(file);
                  event.currentTarget.value = "";
                }}
              />
            </div>
          </Field>
          <Field label="Primary office address">
            <Input
              disabled={disabled}
              value={line1}
              onChange={(event) => setLine1(event.target.value)}
              placeholder="Address line 1"
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
          <Field
            label="USPS writing states"
            help="Press Enter or comma to add."
          >
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
