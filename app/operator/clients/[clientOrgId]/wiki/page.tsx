"use client";

import { useCallback, useRef, useState } from "react";
import { useFollowedState } from "@/hooks/use-followed-state";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { InlineCollectionActionsContext } from "@/components/ui/inline-fields";
import { Loader2, Plus, RefreshCw, StickyNote } from "lucide-react";

import { useMutation, useQuery } from "convex/react";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { api } from "@/convex/_generated/api";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { AppShellPortal } from "@/components/app-shell-slots";
import { DeleteOrganizationButton } from "@/components/operator/delete-organization-button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@claritylabs-inc/ui/components/tabs";
import {
  IntakeCompanyReview,
  IntakeReviewCompact,
} from "@/components/insurance-intake/company-review";
import { IntakeApplicationFields } from "@/components/insurance-intake/application-fields";
import { detailsFromAnswers } from "@/lib/insurance-intake-details";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  ClientAccountSection,
  type ClientAccountDraft,
} from "../client-account-section";
import type { OperatorClientRow } from "../../client-model";
import { AppShell } from "@/components/app-shell";
import { OperatorPageContextRegistration } from "@/components/operator-agent/operator-page-context";
import { CompanyWikiSection } from "@/components/settings/company-wiki-section";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { useWebsiteTechScan, WebsiteTechSection } from "./website-tech-section";

function ProfileContent({
  client,
  readOnly,
}: {
  client: OperatorClientRow;
  readOnly: boolean;
}) {
  const wiki = useQuery(api.orgWiki.getForOperator, { orgId: client._id });
  const support = useQuery(api.operator.getClientSupportDetails, {
    clientOrgId: client._id,
  });
  return wiki && support ? (
    <LoadedProfile
      key={client._id}
      client={client}
      readOnly={readOnly}
      wiki={wiki}
      support={support}
    />
  ) : (
    <Loader2 className="size-5 animate-spin" />
  );
}
function LoadedProfile({
  client,
  readOnly,
  wiki,
  support,
}: {
  client: OperatorClientRow;
  readOnly: boolean;
  wiki: NonNullable<
    import("convex/server").FunctionReturnType<
      typeof api.orgWiki.getForOperator
    >
  >;
  support: NonNullable<
    import("convex/server").FunctionReturnType<
      typeof api.operator.getClientSupportDetails
    >
  >;
}) {
  const router = useRouter();
  const update = useMutation(api.orgWiki.updateBusinessProfileForOperator);
  const [profileTab, setProfileTab] = useFollowedState(
    `clients:${client._id}:profile:tab`,
    "Business details",
  );
  const account = {
    name: support.name,
    website: support.website ?? "",
    status: support.clientAccessStatus ?? "limited",
  } as ClientAccountDraft;
  const [draftAccount, setDraftAccount] = useState(account);
  const [answers, setAnswers] = useState(
    wiki.businessProfile?.answers ?? {
      legalName: support.name,
      website: support.website ?? "",
    },
  );
  const [details, setDetails] = useState(
    wiki.businessProfile?.details ?? detailsFromAnswers(answers),
  );
  const version = useRef({
    version: wiki.businessProfile?.submittedAt ?? 0,
    account,
  });
  const techScan = useWebsiteTechScan(client._id, profileTab === "Tech stack");
  const updateTechStack = useCallback(
    (patch: Pick<typeof details, "techStack" | "techStackScanFilledAt">) =>
      setDetails((current) => ({ ...current, ...patch })),
    [],
  );
  const [notesOpen, setNotesOpen] = useFollowedState(
    `clients:${client._id}:profile:notes-open`,
    false,
  );
  const [notesToolbar, setNotesToolbar] = useState<HTMLDivElement | null>(null);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "orgWiki.updateBusinessProfileForOperator",
    args: { account: draftAccount, answers, details },
    enabled: !readOnly,
    canSave: !!draftAccount.name.trim(),
    flush: async (next) => {
      const result = await update({
        orgId: client._id,
        expectedVersion: version.current.version,
        expectedName: version.current.account.name,
        expectedWebsite: version.current.account.website,
        expectedStatus: version.current.account.status,
        ...next.account,
        answers: next.answers,
        details: next.details,
      });
      version.current = result;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update profile"),
  });
  return (
    <div data-operator-form data-operator-inline-fields className="space-y-5">
      {notesOpen && (
        <AppShellPortal slot="rightPanel">
          <SettingsDrawer
            open
            title="Notes"
            onOpenChange={setNotesOpen}
            actions={
              <div ref={setNotesToolbar} className="flex items-center gap-2" />
            }
          >
            <CompanyWikiSection
              clientOrgId={client._id}
              operator
              notesOnly
              sidebar
              readOnly={readOnly}
              toolbarTarget={notesToolbar}
            />
          </SettingsDrawer>
        </AppShellPortal>
      )}
      {
        <AppShellPortal slot="actions">
          <PillButton
            variant="secondary"
            size="compact"
            onClick={() => setNotesOpen(true)}
          >
            <StickyNote className="size-4" />
            Notes
          </PillButton>
          {!readOnly && <AutoSaveStatus status={autoSave.status} />}
          {!readOnly && profileTab === "Tech stack" && techScan.canRescan && (
            <PillButton
              variant="secondary"
              size="compact"
              disabled={techScan.scanning}
              onClick={techScan.rescan}
            >
              {techScan.scanning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Rescan
            </PillButton>
          )}
          {!readOnly && profileTab === "Related legal entities" && (
            <PillButton
              variant="secondary"
              size="compact"
              disabled={details.relatedEntities.length >= 30}
              onClick={() =>
                setDetails({
                  ...details,
                  hasRelatedEntities: "yes",
                  relatedEntities: [
                    ...details.relatedEntities,
                    { legalName: "", relationship: "", insured: "" },
                  ],
                })
              }
            >
              <Plus className="size-4" />
              Add entity
            </PillButton>
          )}
          {!readOnly && profileTab === "Locations" && (
            <PillButton
              variant="secondary"
              size="compact"
              disabled={details.locations.length >= 30}
              onClick={() =>
                setDetails({
                  ...details,
                  locations: [
                    ...details.locations,
                    {
                      address: {},
                      details: answers.description ?? "",
                      activitiesPrefilled: !!answers.description,
                    },
                  ],
                })
              }
            >
              <Plus className="size-4" />
              Add location
            </PillButton>
          )}
          {!readOnly && (
            <DeleteOrganizationButton
              orgId={client._id}
              name={client.name}
              type="client"
              beforeDelete={async () => true}
              onDeleted={() => router.push("/operator/clients")}
            />
          )}
        </AppShellPortal>
      }
      <IntakeReviewCompact.Provider value={true}>
        <Tabs
          value={profileTab}
          onValueChange={(value) => setProfileTab(String(value))}
          className="gap-5"
        >
          <TabsList
            variant="pill"
            aria-label="Client profile"
            className="max-w-full flex-wrap"
          >
            {[
              ["Account", "Account"],
              ["Business details", "Business"],
              ["Addresses", "Addresses"],
              ["Related legal entities", "Related entities"],
              ["Revenue", "Revenue"],
              ["Locations", "Locations"],
              ["Tech stack", "Tech stack"],
            ].map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={profileTab}>
            {profileTab === "Tech stack" ? (
              <WebsiteTechSection
                scan={techScan}
                details={details}
                onChange={updateTechStack}
                readOnly={readOnly}
              />
            ) : profileTab === "Account" ? (
              <ClientAccountSection
                client={client}
                editing={!readOnly}
                value={draftAccount}
                onChange={(next) => {
                  setDraftAccount(next);
                  setAnswers((current) => ({
                    ...current,
                    legalName: next.name,
                    website: next.website,
                  }));
                }}
                disabled={readOnly}
              />
            ) : !readOnly ? (
              <fieldset disabled={readOnly}>
                <InlineCollectionActionsContext.Provider value={true}>
                  <IntakeApplicationFields
                    companyOnly
                    activeSection={profileTab}
                    answers={answers}
                    details={details}
                    onAnswersChange={(next) => {
                      setAnswers(next);
                      setDraftAccount((current) => ({
                        ...current,
                        name: next.legalName ?? current.name,
                        website: next.website ?? current.website,
                      }));
                    }}
                    onDetailsChange={setDetails}
                  />
                </InlineCollectionActionsContext.Provider>
              </fieldset>
            ) : (
              <IntakeCompanyReview
                answers={
                  wiki.businessProfile?.answers ?? {
                    legalName: support.name,
                    website: support.website ?? "",
                  }
                }
                details={
                  wiki.businessProfile?.details ?? detailsFromAnswers({})
                }
                section={profileTab}
                hideHeading
              />
            )}
          </TabsContent>
        </Tabs>
      </IntakeReviewCompact.Provider>
    </div>
  );
}

export default function OperatorClientWikiPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const client = clients?.find((row) => row._id === clientOrgId) ?? null;
  const activeImpersonation = current?.activeImpersonation ?? null;

  return (
    <AppShell
      breadcrumbDetail={
        <span className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/operator/clients/${clientOrgId}`}
            className="truncate text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            {client ? (client.dba ?? client.name) : "Client"}
          </Link>
          <span
            className={`text-muted-foreground/30 ${typeStyle("body.default")}`}
            aria-hidden="true"
          >
            /
          </span>
          <span className="truncate">Profile</span>
        </span>
      }
    >
      <OperatorPageContextRegistration
        context={{
          pageType: "operator_client_wiki",
          entityId: clientOrgId,
          summary: client
            ? `Profile for ${client.dba ?? client.name}`
            : "Current client profile",
        }}
      />
      {clients === undefined ? (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      ) : !client ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Client not found" />
          <OperationalPanelBody>
            <PillButton href="/operator/clients" variant="secondary">
              Back to clients
            </PillButton>
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <main className="w-full space-y-6">
          <ProfileContent
            client={client}
            readOnly={Boolean(activeImpersonation)}
          />
        </main>
      )}
    </AppShell>
  );
}
