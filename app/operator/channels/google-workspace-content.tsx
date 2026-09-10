"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import {
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceMailboxMode,
  type OperatorGoogleWorkspaceStatus,
  type OperatorGoogleWorkspaceVerificationResult,
} from "@/convex/lib/googleWorkspace";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import {
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusTag, type StatusTagTone } from "@/components/ui/status-tag";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const GOOGLE_DOMAIN_WIDE_DELEGATION_URL =
  "https://admin.google.com/ac/owl/domainwidedelegation";
const GOOGLE_SERVICE_ACCOUNT_DOCS_URL =
  "https://developers.google.com/identity/protocols/oauth2/service-account";
type StatusPresentation = { label: string; tone: StatusTagTone };

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <PillButton
      variant="secondary"
      size="compact"
      onClick={() => void copy()}
      aria-label={label}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </PillButton>
  );
}

function TechnicalValue({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <code
        className={`min-w-0 break-all text-foreground ${typeStyle("technical.codeCompact")}`}
      >
        {value}
      </code>
      <CopyValueButton value={value} label={label} />
    </div>
  );
}

function verificationPresentation(
  result: OperatorGoogleWorkspaceVerificationResult,
): StatusPresentation {
  if (result.status === "verified" && result.completeness === "complete") {
    return { label: "Verified", tone: "success" };
  }
  if (result.status === "failed") {
    return { label: "Verification failed", tone: "danger" };
  }
  return { label: "Partially verified", tone: "warning" };
}

function DirectoryDiagnostic({
  result,
}: {
  result: OperatorGoogleWorkspaceVerificationResult;
}) {
  const diagnostic = result.directory;
  if (diagnostic.status === "not_required") return null;

  const presentation: StatusPresentation =
    diagnostic.status === "verified"
      ? { label: "Verified", tone: "success" }
      : diagnostic.status === "failed"
        ? { label: "Failed", tone: "danger" }
        : { label: "Partial", tone: "warning" };
  const count =
    diagnostic.totalMailboxCount === null
      ? `${diagnostic.discoveredMailboxCount.toLocaleString()} discovered in this check`
      : `${diagnostic.totalMailboxCount.toLocaleString()} eligible ${diagnostic.totalMailboxCount === 1 ? "mailbox" : "mailboxes"}`;

  return (
    <div className="border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-foreground ${typeStyle("body.medium")}`}>
          Workspace directory
        </p>
        <StatusTag tone={presentation.tone}>{presentation.label}</StatusTag>
      </div>
      <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
        {diagnostic.adminEmail ? `${diagnostic.adminEmail} · ` : ""}
        {count}
        {diagnostic.hasMore ? " · More remain" : ""}
      </p>
      {diagnostic.error ? (
        <p className={`mt-1 text-destructive ${typeStyle("caption.default")}`}>
          {diagnostic.error}
        </p>
      ) : null}
    </div>
  );
}

function VerificationDiagnostics({
  result,
}: {
  result: OperatorGoogleWorkspaceVerificationResult;
}) {
  const presentation = verificationPresentation(result);
  const count =
    result.totalMailboxCount === null
      ? `${result.checkedMailboxCount.toLocaleString()} checked in this bounded run`
      : `${result.checkedMailboxCount.toLocaleString()} of ${result.totalMailboxCount.toLocaleString()} checked`;

  return (
    <OperationalPanel aria-label="Connection diagnostics">
      <OperationalPanelHeader
        title="Connection diagnostics"
        action={
          <StatusTag tone={presentation.tone}>{presentation.label}</StatusTag>
        }
      />
      <div>
        <div className="px-4 py-3">
          <p className={`text-foreground ${typeStyle("body.default")}`}>
            {count}
          </p>
          <p
            className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Checked {formatDisplayDateTime(result.verifiedAt, "Unknown time")}
            {result.completeness === "partial"
              ? `. This run is capped at ${result.maxMailboxChecks.toLocaleString()} mailboxes and does not establish company-wide access.`
              : "."}
          </p>
        </div>
        <DirectoryDiagnostic result={result} />
        {result.mailboxes.map((diagnostic) => (
          <div
            key={diagnostic.mailbox}
            className="border-t border-border px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className={`min-w-0 break-all text-foreground ${typeStyle("body.medium")}`}
              >
                {diagnostic.mailbox}
              </p>
              <StatusTag
                tone={diagnostic.status === "verified" ? "success" : "danger"}
              >
                {diagnostic.status === "verified" ? "Verified" : "Failed"}
              </StatusTag>
            </div>
            {diagnostic.error ? (
              <p
                className={`mt-1 text-destructive ${typeStyle("caption.default")}`}
              >
                {diagnostic.error}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </OperationalPanel>
  );
}

export function OperatorGoogleWorkspaceContent({
  onConfigure,
}: {
  onConfigure: () => void;
}) {
  const status = useQuery(api.operatorGoogleWorkspace.getStatus, {});
  const verifyConnection = useAction(
    api.actions.operatorGoogleWorkspace.verifyConnection,
  );
  const [verifying, setVerifying] = useState(false);

  if (status === undefined) {
    return (
      <OperationalPanel className="flex min-h-32 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  const config = status.config;
  const verification = status.savedVerification;
  const readyToVerify = Boolean(config?.enabled && status.credentials.present);
  const presentation: StatusPresentation = verification
    ? verificationPresentation(verification)
    : !config
      ? { label: "Not configured", tone: "neutral" }
      : !config.enabled
        ? { label: "Disabled", tone: "neutral" }
        : !status.credentials.present
          ? { label: "Credential missing", tone: "warning" }
          : { label: "Ready to verify", tone: "info" };
  const roster = !config
    ? "Not configured"
    : config.mailboxMode === "directory"
      ? `Workspace directory via ${config.directoryAdminEmail ?? "missing administrator"}`
      : `${config.mailboxes.length.toLocaleString()} manual ${config.mailboxes.length === 1 ? "mailbox" : "mailboxes"}`;
  const scopes = status.requiredScopes.join(",");

  async function verify() {
    setVerifying(true);
    try {
      const result = await verifyConnection({});
      const resultPresentation = verificationPresentation(result);
      if (resultPresentation.tone === "success") {
        toast.success("Google Workspace connection verified");
      } else if (resultPresentation.tone === "warning") {
        toast.warning("Google Workspace verification is partial");
      } else {
        toast.error("Google Workspace verification failed");
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Google Workspace verification could not run",
        ),
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <section className="space-y-3" aria-label="Google Workspace channel">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Company mailbox access"
          action={
            <StatusTag tone={presentation.tone}>{presentation.label}</StatusTag>
          }
        />
        <OperationalLabelValueRow label="Mailbox roster" value={roster} />
        <OperationalLabelValueRow
          label="Backend credential"
          value={status.credentials.present ? "Configured" : "Missing"}
        />
        <OperationalLabelValueRow
          label="Service account"
          value={status.credentials.serviceAccountEmail ?? "Unavailable"}
        />
        <OperationalLabelValueRow
          label="OAuth client ID"
          value={status.credentials.clientId ?? "Unavailable"}
        />
        <OperationalLabelValueRow
          label="Required scopes"
          value={
            status.requiredScopes.length
              ? status.requiredScopes.join(", ")
              : "Unavailable"
          }
        />
        <OperationalLabelValueRow
          label="Last verification"
          value={
            verification
              ? formatDisplayDateTime(verification.verifiedAt, "Unknown time")
              : "Not verified"
          }
        />
        <div className="flex flex-col-reverse items-stretch gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
          <PillButton variant="secondary" onClick={onConfigure}>
            <Pencil className="size-3.5" />
            Configure
          </PillButton>
          <PillButton
            onClick={() => void verify()}
            disabled={!readyToVerify || verifying}
          >
            {verifying ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            {verifying ? "Verifying…" : "Verify connection"}
          </PillButton>
        </div>
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader title="Google Admin setup" />
        <OperationalPanelBody className="space-y-4">
          <ol
            className={`list-decimal space-y-2 pl-4 text-muted-foreground ${typeStyle("body.default")}`}
          >
            <li>
              Enable the Gmail API in the service account’s Google Cloud
              project. Directory mode also requires the Admin SDK API.
            </li>
            <li>
              Create a dedicated service account with domain-wide delegation. In
              Google Admin, authorize its numeric client ID with the exact
              scopes below.
            </li>
            <li>
              Store the complete JSON key in Convex as{" "}
              <code className={typeStyle("technical.codeCompact")}>
                GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON
              </code>
              . A normal administrator OAuth connection is not a substitute.
            </li>
            <li>
              Configure the mailbox list, save it, then verify the connection
              here.
            </li>
          </ol>

          <div className="border-t border-border pt-4">
            <p
              className={`mb-1.5 text-muted-foreground ${typeStyle("label.metadata")}`}
            >
              Convex secret command
            </p>
            <TechnicalValue
              value="npx convex env set --deployment <deployment> GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON < /secure/path/spot-google-workspace.json"
              label="Copy Convex secret command"
            />
          </div>

          {status.credentials.clientId ? (
            <div>
              <p
                className={`mb-1.5 text-muted-foreground ${typeStyle("label.metadata")}`}
              >
                Client ID
              </p>
              <TechnicalValue
                value={status.credentials.clientId}
                label="Copy Google OAuth client ID"
              />
            </div>
          ) : null}

          {scopes ? (
            <div className="border-t border-border pt-4">
              <p
                className={`mb-1.5 text-muted-foreground ${typeStyle("label.metadata")}`}
              >
                Comma-delimited scopes
              </p>
              <TechnicalValue
                value={scopes}
                label="Copy Google Workspace scopes"
              />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <PillButton
              variant="secondary"
              href={GOOGLE_DOMAIN_WIDE_DELEGATION_URL}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-3.5" />
              Open Google Admin
            </PillButton>
            <PillButton
              variant="secondary"
              href={GOOGLE_SERVICE_ACCOUNT_DOCS_URL}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-3.5" />
              Service account guide
            </PillButton>
          </div>
        </OperationalPanelBody>
      </OperationalPanel>

      {verification ? <VerificationDiagnostics result={verification} /> : null}
    </section>
  );
}

export function OperatorGoogleWorkspaceSettingsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useQuery(
    api.operatorGoogleWorkspace.getStatus,
    open ? {} : "skip",
  );

  if (status === undefined) {
    return (
      <SettingsDrawer
        open={open}
        onOpenChange={onOpenChange}
        title="Configure Google Workspace"
      >
        <div className="flex min-h-32 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      </SettingsDrawer>
    );
  }

  return (
    <LoadedGoogleWorkspaceSettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      status={status}
    />
  );
}

function LoadedGoogleWorkspaceSettingsDrawer({
  open,
  onOpenChange,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: OperatorGoogleWorkspaceStatus;
}) {
  const updateSettings = useMutation(
    api.operatorGoogleWorkspace.updateSettings,
  );
  const [enabled, setEnabled] = useState(status.config?.enabled ?? false);
  const [mailboxMode, setMailboxMode] =
    useState<OperatorGoogleWorkspaceMailboxMode>(
      status.config?.mailboxMode ?? "manual",
    );
  const [mailboxes, setMailboxes] = useState(
    status.config?.mailboxes.join("\n") ?? "",
  );
  const [directoryAdminEmail, setDirectoryAdminEmail] = useState(
    status.config?.directoryAdminEmail ?? "",
  );
  const [saving, setSaving] = useState(false);

  const mailboxList = mailboxes
    .split(/\r?\n/)
    .map((mailbox) => mailbox.trim())
    .filter(Boolean);
  const canSave =
    !saving &&
    mailboxList.length <= GOOGLE_WORKSPACE_LIMITS.maxConfiguredMailboxes &&
    (!enabled ||
      (mailboxMode === "manual"
        ? mailboxList.length > 0
        : Boolean(directoryAdminEmail.trim())));

  function close() {
    if (!saving) onOpenChange(false);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await updateSettings({
        enabled,
        mailboxMode,
        mailboxes: mailboxMode === "manual" ? mailboxList : [],
        directoryAdminEmail:
          mailboxMode === "directory" ? directoryAdminEmail.trim() : undefined,
      });
      toast.success("Google Workspace settings saved");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Google Workspace settings could not be saved",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      title="Configure Google Workspace"
      footer={
        <PillButton
          type="submit"
          form="operator-google-workspace-settings"
          disabled={!canSave}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {saving ? "Saving…" : "Save settings"}
        </PillButton>
      }
    >
      <form
        id="operator-google-workspace-settings"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <OperationalPanel as="div">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                Operator mailbox access
              </p>
              <p
                className={`mt-0.5 text-muted-foreground ${typeStyle("caption.default")}`}
              >
                Active operators can search and read every configured mailbox.
              </p>
            </div>
            <SettingsSwitch
              checked={enabled}
              onCheckedChange={() => setEnabled((current) => !current)}
              label="Enable operator Google Workspace access"
              disabled={saving}
            />
          </div>
        </OperationalPanel>

        <FormSection
          title="Mailbox roster"
          description="Choose a manual mailbox list or enumerate eligible users across the Workspace customer."
        >
          <label className="block">
            <span
              className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
            >
              Roster mode
            </span>
            <Select
              value={mailboxMode}
              onValueChange={(value) => {
                if (value === "manual" || value === "directory") {
                  setMailboxMode(value);
                }
              }}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {mailboxMode === "manual"
                    ? "Manual mailboxes"
                    : "Workspace directory"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual mailboxes</SelectItem>
                <SelectItem value="directory">Workspace directory</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {mailboxMode === "manual" ? (
            <label className="block">
              <span
                className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
              >
                Company mailboxes
              </span>
              <Textarea
                value={mailboxes}
                onChange={(event) => setMailboxes(event.target.value)}
                placeholder={"operations@example.com\nclaims@example.com"}
                rows={6}
                disabled={saving}
                aria-describedby="operator-google-workspace-mailbox-help"
              />
              <span
                id="operator-google-workspace-mailbox-help"
                className={`mt-1.5 block text-muted-foreground ${typeStyle("caption.default")}`}
              >
                One primary Workspace address per line; aliases belong in search
                queries · {mailboxList.length.toLocaleString()} of{" "}
                {GOOGLE_WORKSPACE_LIMITS.maxConfiguredMailboxes.toLocaleString()}
              </span>
            </label>
          ) : (
            <label className="block">
              <span
                className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
              >
                Directory administrator
              </span>
              <Input
                type="email"
                value={directoryAdminEmail}
                onChange={(event) => setDirectoryAdminEmail(event.target.value)}
                placeholder="workspace-admin@example.com"
                autoComplete="off"
                disabled={saving}
              />
              <span
                className={`mt-1.5 block text-muted-foreground ${typeStyle("caption.default")}`}
              >
                Spot uses this active Workspace administrator only as the
                delegated Directory API subject. The roster covers all domains
                in `customer=my_customer` and discovers each user’s primary
                address.
              </span>
            </label>
          )}
        </FormSection>
      </form>
    </SettingsDrawer>
  );
}
