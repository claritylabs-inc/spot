"use client";

import { normalizeWebsiteUrl } from "@claritylabs-inc/ui/lib/website";
import { WebsiteInput } from "@claritylabs-inc/ui/components/website-input";
import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { AppShellPortal } from "@/components/app-shell-slots";
import { ProviderContacts } from "@/components/broker-network/provider-contacts";
import { ProviderSubmissionDefaults } from "@/components/broker-network/provider-submission-defaults";
import { BrokerActivity } from "@/components/broker-network/broker-activity";
import {
  AppetiteCountriesField,
  AppetiteNationwideField,
  AppetiteRegionsField,
} from "@/components/broker-network/appetite-geography-fields";
import {
  brokerWritingCountries,
  brokerRegionCountry,
} from "@/convex/lib/brokerProfileValidation";
import { AcordLinesField } from "@/components/broker-network/acord-lines-field";
import { AddressAutofillInput } from "@/components/ui/address-autofill-input";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { PillButton } from "@/components/ui/pill-button";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { StatusLabel } from "@claritylabs-inc/ui/components/status-tag";
import { TabsContent, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { PageTabs, PageTabsList } from "@/components/ui/folder-tabs";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { useFollowedState } from "@/hooks/use-followed-state";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  NETWORK_STATUS_LABELS,
  NETWORK_STATUS_PRESENTATION,
  type NetworkStatus,
} from "../broker-model";

type BrokerRow = NonNullable<FunctionReturnType<typeof api.brokerProfiles.get>>;

export default function OperatorBrokerPage() {
  const { brokerOrgId } = useParams<{ brokerOrgId: string }>();
  const row = useQuery(api.brokerProfiles.get, {
    brokerOrgId: brokerOrgId as Id<"organizations">,
  });

  return (
    <AppShell breadcrumbDetail={row?.broker.name ?? "Provider"}>
      {row === undefined ? (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      ) : row === null ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Provider not found" />
          <OperationalPanelBody>
            <PillButton href="/operator/brokers" variant="secondary">
              Back to providers
            </PillButton>
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <BrokerEditor key={row.broker._id} row={row} />
      )}
    </AppShell>
  );
}

function brokerValues(row: BrokerRow) {
  const office = row.profile?.officeAddress;
  return {
    name: row.broker.name,
    website: row.broker.website ?? "",
    status: row.profile?.networkStatus ?? ("prospect" as NetworkStatus),
    isTest: row.profile?.isTest ?? false,
    address: office?.street1 ?? "",
    address2: office?.street2 ?? "",
    country: office?.country ?? "",
    city: office?.city ?? "",
    state: office?.state ?? "",
    postalCode: office?.postalCode ?? "",
    countries: brokerWritingCountries(row.profile),
    states: row.profile?.writingStates ?? [],
    nationwide: row.profile?.nationwideCountries ?? [],
    excluded: row.profile?.excludedStates ?? [],
    lines: row.profile?.lineOfBusinessCodes ?? [],
  };
}

function BrokerEditor({ row }: { row: BrokerRow }) {
  const update = useMutation(api.brokerProfiles.upsert);
  const [tab, setTab] = useFollowedState(
    `brokers:${row.broker._id}:tab`,
    "profile",
  );
  const saved = brokerValues(row);
  const [values, setValues] = useState(saved);
  const set = <K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  const savedValues = useRef(values);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "brokerProfiles.upsert",
    args: values,
    canSave: !!values.name.trim(),
    flush: async (next) => {
      const previous = savedValues.current;
      const changed = (key: keyof typeof values) => next[key] !== previous[key];
      const trimmed = (
        key: Exclude<
          keyof typeof values,
          | "countries"
          | "states"
          | "lines"
          | "nationwide"
          | "excluded"
          | "isTest"
        >,
      ) => (changed(key) ? next[key].trim() : undefined);
      const officeChanged = (
        [
          "address",
          "address2",
          "country",
          "city",
          "state",
          "postalCode",
        ] as const
      ).some(changed);
      await update({
        brokerOrgId: row.broker._id,
        name: trimmed("name"),
        website: changed("website")
          ? normalizeWebsiteUrl(next.website) || next.website.trim() || null
          : undefined,
        networkStatus: changed("status") ? next.status : undefined,
        isTest: changed("isTest") ? next.isTest : undefined,
        officeAddress: officeChanged
          ? {
              street1: trimmed("address"),
              street2: trimmed("address2"),
              country: trimmed("country"),
              city: trimmed("city"),
              state: trimmed("state"),
              postalCode: trimmed("postalCode"),
            }
          : undefined,
        writingCountries: changed("countries") ? next.countries : undefined,
        writingStates: changed("states") ? next.states : undefined,
        nationwideCountries: changed("nationwide")
          ? next.nationwide
          : undefined,
        excludedStates: changed("excluded") ? next.excluded : undefined,
        lineOfBusinessCodes: changed("lines") ? next.lines : undefined,
      });
      savedValues.current = next;
    },
    // Edits from the Spot agent or an MCP client show up as they are saved.
    source: saved,
    adopt: (next) => {
      setValues(next);
      savedValues.current = saved;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not save the provider"),
  });

  return (
    <main
      data-operator-form
      data-operator-inline-fields
      className="w-full space-y-5"
    >
      <AppShellPortal slot="actions">
        <AutoSaveStatus status={autoSave.status} />
      </AppShellPortal>
      <PageTabs value={tab} onValueChange={setTab}>
        <PageTabsList aria-label="Provider">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="appetite">Appetite</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="submission-defaults">
            Submission defaults
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </PageTabsList>
        <TabsContent value="profile" className="space-y-5">
          <InlineFieldCard>
            <InlineFieldRow label="Provider name">
              <Input
                aria-label="Provider name"
                aria-invalid={!values.name.trim()}
                value={values.name}
                onChange={(event) => set("name", event.target.value)}
                onBlur={() => void autoSave.saveNow()}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Website">
              <WebsiteInput
                aria-label="Website"
                value={values.website}
                onChange={(website) => set("website", website)}
                onBlur={() => void autoSave.saveNow()}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Logo">
              <BrokerLogoField row={row} />
            </InlineFieldRow>
            <InlineFieldRow label="Network status">
              <Select
                value={values.status}
                items={NETWORK_STATUS_LABELS}
                onValueChange={(value) => {
                  if (value && value in NETWORK_STATUS_LABELS)
                    set("status", value as NetworkStatus);
                }}
              >
                <SelectTrigger className="w-full" aria-label="Network status">
                  <SelectValue>
                    <StatusLabel
                      {...NETWORK_STATUS_PRESENTATION[values.status]}
                    >
                      {NETWORK_STATUS_LABELS[values.status]}
                    </StatusLabel>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(NETWORK_STATUS_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        <StatusLabel
                          {...NETWORK_STATUS_PRESENTATION[
                            value as NetworkStatus
                          ]}
                        >
                          {label}
                        </StatusLabel>
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </InlineFieldRow>
            <InlineFieldRow label="Test provider">
              <SettingsSwitch
                checked={values.isTest}
                onCheckedChange={() => set("isTest", !values.isTest)}
                label="Test provider"
              />
            </InlineFieldRow>
          </InlineFieldCard>
          <InlineFieldCard title="Primary office">
            <InlineFieldRow label="Street address">
              <AddressAutofillInput
                id="broker-office-address"
                display="street1"
                value={{
                  street1: values.address,
                  street2: values.address2,
                  city: values.city,
                  state: values.state,
                  zip: values.postalCode,
                  country: values.country,
                }}
                onChange={(next) =>
                  setValues((current) => ({
                    ...current,
                    address: next.street1 ?? "",
                    address2: next.street2 ?? "",
                    country: next.country ?? "",
                    city: next.city ?? "",
                    state: next.state ?? "",
                    postalCode: next.zip ?? "",
                  }))
                }
                onBlur={() => void autoSave.saveNow()}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Suite or unit">
              <Input
                aria-label="Suite or unit"
                value={values.address2}
                onChange={(event) => set("address2", event.target.value)}
                onBlur={() => void autoSave.saveNow()}
              />
            </InlineFieldRow>
            <InlineFieldRow label="City">
              <Input
                aria-label="City"
                value={values.city}
                onChange={(event) => set("city", event.target.value)}
                onBlur={() => void autoSave.saveNow()}
              />
            </InlineFieldRow>
            <InlineFieldRow label="State">
              <Input
                aria-label="State"
                maxLength={2}
                value={values.state}
                onChange={(event) =>
                  set("state", event.target.value.toUpperCase())
                }
                onBlur={() => void autoSave.saveNow()}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Postal code">
              <Input
                aria-label="Postal code"
                value={values.postalCode}
                onChange={(event) => set("postalCode", event.target.value)}
                onBlur={() => void autoSave.saveNow()}
              />
            </InlineFieldRow>
          </InlineFieldCard>
        </TabsContent>
        <TabsContent value="appetite" className="space-y-5">
          <InlineFieldCard>
            <InlineFieldRow label="Countries serviced">
              <AppetiteCountriesField
                value={values.countries}
                onChange={(countries) =>
                  setValues((current) => ({
                    ...current,
                    countries,
                    nationwide: current.nationwide.filter((code) =>
                      countries.includes(code),
                    ),
                    excluded: current.excluded.filter((code) =>
                      countries.includes(brokerRegionCountry(code)),
                    ),
                    states: current.states.filter((code) =>
                      countries.includes(brokerRegionCountry(code)),
                    ),
                  }))
                }
              />
            </InlineFieldRow>
            <InlineFieldRow label="Nationwide service">
              <AppetiteNationwideField
                countries={values.countries}
                value={values.nationwide}
                onChange={(nationwide) =>
                  setValues((current) => ({
                    ...current,
                    nationwide,
                    excluded: current.excluded.filter((code) =>
                      nationwide.includes(brokerRegionCountry(code)),
                    ),
                  }))
                }
              />
            </InlineFieldRow>
            <InlineFieldRow label="States / provinces serviced">
              <AppetiteRegionsField
                countries={values.countries}
                value={values.states}
                onChange={(states) => set("states", states)}
              />
            </InlineFieldRow>
            {!!values.nationwide.length && (
              <InlineFieldRow label="Excluded states / provinces">
                <AppetiteRegionsField
                  countries={values.nationwide}
                  ariaLabel="Excluded states / provinces"
                  value={values.excluded}
                  onChange={(excluded) =>
                    setValues((current) => ({
                      ...current,
                      excluded,
                      states: current.states.filter(
                        (code) => !excluded.includes(code),
                      ),
                    }))
                  }
                />
              </InlineFieldRow>
            )}
          </InlineFieldCard>
          <InlineFieldCard>
            <InlineFieldRow label="ACORD lines">
              <AcordLinesField
                value={values.lines}
                onChange={(lines) => set("lines", lines)}
              />
            </InlineFieldRow>
          </InlineFieldCard>
        </TabsContent>
        <TabsContent value="contacts">
          <ProviderContacts brokerOrgId={row.broker._id} />
        </TabsContent>
        <TabsContent value="submission-defaults">
          <ProviderSubmissionDefaults
            brokerOrgId={row.broker._id}
            brokerName={row.broker.name}
          />
        </TabsContent>
        <TabsContent value="activity">
          <BrokerActivity brokerOrgId={row.broker._id} />
        </TabsContent>
      </PageTabs>
    </main>
  );
}

function BrokerLogoField({ row }: { row: BrokerRow }) {
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(
    api.brokerProfiles.generateLogoUploadUrl,
  );
  const update = useMutation(api.brokerProfiles.upsert);

  async function upload(file: File) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB");
      return;
    }
    setBusy(true);
    const notification = toast.loading("Uploading logo…");
    try {
      const url = await generateUploadUrl({ brokerOrgId: row.broker._id });
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await update({ brokerOrgId: row.broker._id, iconStorageId: storageId });
      toast.success("Provider logo saved", { id: notification });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not save the provider logo"),
        { id: notification },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-9 w-full items-center justify-between gap-3 px-3">
      <OrgBrandIcon
        name={row.broker.name}
        iconUrl={row.broker.iconUrl}
        website={row.broker.website}
        size="md"
      />
      <PillButton
        variant="secondary"
        size="compact"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
        title="PNG, JPG, or SVG · Up to 5 MB"
      >
        {busy
          ? "Uploading…"
          : row.broker.iconUrl
            ? "Change logo"
            : "Upload logo"}
      </PillButton>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        aria-label="Upload provider logo"
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
