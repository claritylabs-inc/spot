"use client";

import {
  useCallback,
  useLayoutEffect,
  useId,
  useMemo,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import { useAction, useMutation } from "convex/react";
import dayjs from "dayjs";
import {
  AlertTriangle,
  Check,
  Loader2,
  Plug,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AUTOMATION_ENABLED,
  AutomationToggleRows,
  configuredAutomation,
  EmailScopeSelect,
  formatMailboxActivity,
  GoogleLogo,
  MicrosoftLogo,
  type ConnectedEmailAccountRow,
  type EmailScope,
  type MailboxAutomation,
} from "@/components/settings/email-connection-ui";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormSection } from "@/components/ui/form-section";
import { Label } from "@/components/ui/label";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { typeStyle } from "@/lib/typography";

type EmailProviderPreset = {
  id: string;
  name: string;
  detail: string;
  host: string;
  port: string;
  secure: boolean;
  passwordLabel: string;
  note: string;
  setupHref?: string;
  setupLinkLabel?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const PROVIDER_PRESETS: EmailProviderPreset[] = [
  {
    id: "google",
    name: "Google Workspace",
    detail: "Gmail / Workspace",
    host: "imap.gmail.com",
    port: "993",
    secure: true,
    passwordLabel: "App password",
    note: "Use an app password when two-step verification is enabled.",
    setupHref: "https://myaccount.google.com/apppasswords",
    setupLinkLabel: "Create a Google app password",
    icon: GoogleLogo,
  },
  {
    id: "outlook",
    name: "Outlook",
    detail: "Microsoft 365 / Exchange Online",
    host: "outlook.office365.com",
    port: "993",
    secure: true,
    passwordLabel: "Password or app password",
    note: "IMAP must be enabled for the mailbox. Some tenants require OAuth instead of password login.",
    icon: MicrosoftLogo,
  },
];

const CUSTOM_PRESET: EmailProviderPreset = {
  id: "custom",
  name: "Other IMAP",
  detail: "Any IMAP server",
  host: "",
  port: "993",
  secure: true,
  passwordLabel: "Password or app password",
  note: "Use the IMAP host and port from your mail provider.",
  icon: Plug,
};

export function AddMailboxDrawer({
  open,
  orgId,
  ownerUserId,
  canManageOrgMailboxes,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  orgId?: Id<"organizations">;
  ownerUserId?: Id<"users">;
  canManageOrgMailboxes: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (account: ConnectedEmailAccountRow) => Promise<void>;
}) {
  const connectEmail = useAction(api.actions.connectedEmail.connect);
  const formId = useId();
  const [selectedPresetId, setSelectedPresetId] = useState("google");
  const selectedPreset = useMemo(
    () =>
      PROVIDER_PRESETS.find((preset) => preset.id === selectedPresetId) ??
      CUSTOM_PRESET,
    [selectedPresetId],
  );
  const [form, setForm] = useState({
    emailAddress: "",
    host: PROVIDER_PRESETS[0].host,
    port: PROVIDER_PRESETS[0].port,
    secure: PROVIDER_PRESETS[0].secure,
    password: "",
    scope: "user" as EmailScope,
    automation: AUTOMATION_ENABLED,
  });
  const [connecting, setConnecting] = useState(false);

  const canConnect =
    !!orgId &&
    !!form.emailAddress.trim() &&
    !!form.host.trim() &&
    !!form.port &&
    !!form.password &&
    !connecting;

  function selectPreset(preset: EmailProviderPreset) {
    setSelectedPresetId(preset.id);
    setForm((current) => ({
      ...current,
      host: preset.host,
      port: preset.port,
      secure: preset.secure,
    }));
  }

  async function handleConnectEmail() {
    if (!orgId) return;
    const emailAddress = form.emailAddress.trim().toLowerCase();
    const scope = canManageOrgMailboxes ? form.scope : "user";
    setConnecting(true);
    try {
      const accountId = await connectEmail({
        orgId,
        emailAddress,
        host: form.host.trim(),
        port: Number(form.port),
        secure: form.secure,
        username: form.emailAddress.trim(),
        password: form.password,
        scope,
        automation: form.automation,
      });
      const now = dayjs().valueOf();
      await onConnected({
        _id: accountId,
        orgId,
        userId: ownerUserId,
        scope,
        emailAddress,
        host: form.host.trim(),
        port: Number(form.port),
        secure: form.secure,
        username: form.emailAddress.trim(),
        status: "active",
        lastTestedAt: now,
        automation: form.automation,
        automationConfigured: true,
        createdAt: now,
        updatedAt: now,
      });
      setForm({
        emailAddress: "",
        host: selectedPreset.host,
        port: selectedPreset.port,
        secure: selectedPreset.secure,
        password: "",
        scope: "user",
        automation: AUTOMATION_ENABLED,
      });
      toast.success("Mailbox connected");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to connect mailbox"),
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Add mailbox"
      footer={
        <>
          <PillButton
            variant="secondary"
            disabled={connecting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </PillButton>
          <PillButton type="submit" form={formId} disabled={!canConnect}>
            {connecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {connecting ? "Connecting…" : "Connect mailbox"}
          </PillButton>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canConnect) void handleConnectEmail();
        }}
      >
        <div className="grid gap-2">
          {[...PROVIDER_PRESETS, CUSTOM_PRESET].map((preset) => {
            const Icon = preset.icon;
            const selected = selectedPreset.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                  selected
                    ? "border-border-focus bg-foreground/5"
                    : "border-input hover:border-border-hover hover:bg-foreground/3"
                }`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-foreground ${typeStyle("body.medium")}`}
                  >
                    {preset.name}
                  </span>
                  <span
                    className={`block text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {preset.detail}
                  </span>
                </span>
                {selected ? <Check className="size-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="mailbox-email">Email address</Label>
            <Input
              id="mailbox-email"
              type="email"
              required
              value={form.emailAddress}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  emailAddress: event.target.value,
                }))
              }
              placeholder="name@example.com"
            />
          </div>

          {selectedPreset.id === "custom" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mailbox-host">IMAP host</Label>
                <Input
                  id="mailbox-host"
                  required
                  value={form.host}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      host: event.target.value,
                    }))
                  }
                  placeholder="imap.example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mailbox-port">Port</Label>
                <Input
                  id="mailbox-port"
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  required
                  value={form.port}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      port: event.target.value,
                    }))
                  }
                  inputMode="numeric"
                />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-3 py-3">
                <div>
                  <p className={`text-foreground ${typeStyle("body.medium")}`}>
                    Use TLS
                  </p>
                  <p
                    className={`text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    Recommended for IMAP on port 993.
                  </p>
                </div>
                <SettingsSwitch
                  checked={form.secure}
                  onCheckedChange={() =>
                    setForm((current) => ({
                      ...current,
                      secure: !current.secure,
                    }))
                  }
                  label="Use TLS"
                />
              </div>
            </>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="mailbox-password">
              {selectedPreset.passwordLabel}
            </Label>
            <Input
              id="mailbox-password"
              type="password"
              required
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label>Available to</Label>
            <EmailScopeSelect
              value={form.scope}
              onValueChange={(scope) =>
                setForm((current) => ({ ...current, scope }))
              }
              allowOrgScope={canManageOrgMailboxes}
              disabled={!canManageOrgMailboxes}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <p className={`text-foreground ${typeStyle("body.medium")}`}>
              Start monitoring
            </p>
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Spot will monitor all three sources by default.
            </p>
          </div>
          <AutomationToggleRows
            value={form.automation}
            onChange={(automation) =>
              setForm((current) => ({ ...current, automation }))
            }
          />
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Imported policies, requirements, and company facts become workspace
            data visible to the organization, even when mailbox access is set to
            Just me.
          </p>
        </div>

        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          {selectedPreset.note}
          {selectedPreset.setupHref ? (
            <>
              {" "}
              <a
                href={selectedPreset.setupHref}
                target="_blank"
                rel="noreferrer"
                className={`text-foreground underline-offset-3 hover:underline ${typeStyle("control.button")}`}
              >
                {selectedPreset.setupLinkLabel}
              </a>
            </>
          ) : null}
        </p>
      </form>
    </SettingsDrawer>
  );
}

export function MailboxSettingsDrawer({
  account,
  canManageMailbox,
  canManageOrgMailboxes,
  onOpenChange,
  onSaved,
  onDisconnected,
  onSaveBarrierChange,
}: {
  account: ConnectedEmailAccountRow;
  canManageMailbox: boolean;
  canManageOrgMailboxes: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (
    accountId: Id<"connectedEmailAccounts">,
    scope: EmailScope,
    automation: MailboxAutomation,
  ) => Promise<void>;
  onDisconnected: (accountId: Id<"connectedEmailAccounts">) => Promise<void>;
  onSaveBarrierChange: (
    barrier: (() => Promise<boolean>) | null,
  ) => void;
}) {
  const updateSettings = useMutation(api.connectedEmail.updateSettings);
  const revokeConnectedEmail = useMutation(api.connectedEmail.revoke);
  const scanMailboxRange = useAction(api.actions.connectedEmailScan.scanMailboxRange);
  const initialAutomation = configuredAutomation(account);
  const [scope, setScope] = useState(account.scope);
  const [automation, setAutomation] = useState(initialAutomation);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanFrom, setScanFrom] = useState(() =>
    dayjs().subtract(30, "day").format("YYYY-MM-DD"),
  );
  const [scanTo, setScanTo] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [scanning, setScanning] = useState(false);
  const [configurationSaved, setConfigurationSaved] = useState(
    account.automationConfigured,
  );

  const settingsChanged =
    scope !== account.scope ||
    automation.policyImports !== initialAutomation.policyImports ||
    automation.requirementImports !== initialAutomation.requirementImports ||
    automation.companyMemory !== initialAutomation.companyMemory;
  const needsConfiguration = !configurationSaved;
  const error = account.lastScanError ?? account.lastError;
  const healthy = account.status === "active" && !error;
  const scanDatesOutOfOrder =
    Boolean(scanFrom && scanTo) &&
    dayjs(scanFrom).isAfter(dayjs(scanTo), "day");
  const settingsAutoSave = useLocalFirstAutoSave({
    mutationName: `settings.email.update.${account._id}`,
    args: { accountId: account._id, scope, automation },
    enabled: canManageMailbox,
    canSave: canManageMailbox,
    flush: async (args) => {
      await updateSettings(args);
      await onSaved(args.accountId, args.scope, args.automation);
    },
    onFlushed: () => setConfigurationSaved(true),
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Mailbox settings could not be saved."),
  });
  const saveSettings = settingsAutoSave.saveNow;
  const saveSettingsBeforeAction = useCallback(
    () => {
      if (!canManageMailbox) return Promise.resolve(true);
      return saveSettings({
        force: needsConfiguration && !settingsChanged,
      });
    },
    [canManageMailbox, needsConfiguration, saveSettings, settingsChanged],
  );
  useLayoutEffect(() => {
    onSaveBarrierChange(saveSettingsBeforeAction);
    return () => onSaveBarrierChange(null);
  }, [onSaveBarrierChange, saveSettingsBeforeAction]);
  const savingSettings = settingsAutoSave.saving;
  const canScan =
    Boolean(scanFrom && scanTo) &&
    !scanDatesOutOfOrder &&
    !savingSettings &&
    !scanning;

  async function handleDrawerOpenChange(open: boolean) {
    if (!open && canManageMailbox) {
      const saved = await saveSettingsBeforeAction();
      if (!saved) return;
    }
    onOpenChange(open);
  }

  async function runManualScan() {
    setScanning(true);
    try {
      const saved = await saveSettingsBeforeAction();
      if (!saved) return;

      const result = await scanMailboxRange({
        accountId: account._id,
        dateFrom: scanFrom,
        dateTo: scanTo,
      });
      if (result.matchedCount === 0) {
        setScanDialogOpen(false);
        toast.info("No emails were found in that date range");
        return;
      }
      const parts = [
        `Scanned ${result.scannedCount} email${result.scannedCount === 1 ? "" : "s"}`,
      ];
      if (result.alreadyProcessedCount > 0) {
        parts.push(`${result.alreadyProcessedCount} already handled`);
      }
      if (result.attentionCount > 0) {
        parts.push(`${result.attentionCount} need${result.attentionCount === 1 ? "s" : ""} attention`);
      }
      toast.success(parts.join(" · "), {
        description: result.truncated
          ? `The date range matched ${result.matchedCount} emails; the newest ${result.scannedCount} were scanned.`
          : "Results appear in a Spot thread when there is something to review.",
      });
      setScanDialogOpen(false);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to scan the mailbox"));
    } finally {
      setScanning(false);
    }
  }

  async function disconnectMailbox() {
    setDisconnecting(true);
    try {
      if (!(await saveSettingsBeforeAction())) return;
      await revokeConnectedEmail({ accountId: account._id });
      await onDisconnected(account._id);
      toast.success("Mailbox disconnected");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to disconnect mailbox"),
      );
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={handleDrawerOpenChange}
      title={account.emailAddress}
      footer={
        confirmDisconnect ? (
          <>
            <PillButton
              variant="secondary"
              disabled={disconnecting}
              onClick={() => setConfirmDisconnect(false)}
            >
              Keep mailbox
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={disconnecting}
              onClick={() => void disconnectMailbox()}
            >
              {disconnecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {disconnecting ? "Disconnecting…" : "Disconnect mailbox"}
            </PillButton>
          </>
        ) : canManageMailbox ? (
          <>
            <PillButton
              variant="secondary"
              disabled={savingSettings || scanning}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect
            </PillButton>
            <PillButton
              disabled={scanning}
              onClick={() => setScanDialogOpen(true)}
            >
              Scan mailbox
            </PillButton>
          </>
        ) : undefined
      }
    >
      {canManageMailbox ? (
        <AutoSaveStatus
          status={
            needsConfiguration && !settingsChanged
              ? "unsaved"
              : settingsAutoSave.status
          }
        />
      ) : null}
      {confirmDisconnect ? (
        <OperationalPanel as="div" className="border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                Disconnect this mailbox?
              </p>
              <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
                Spot will stop searching and monitoring it. Imported documents and
                saved company context remain in Spot.
              </p>
            </div>
          </div>
        </OperationalPanel>
      ) : (
        <div className="space-y-5">
          <FormSection title="Connection health" divided={false}>
            <OperationalLabelValueList>
              <OperationalLabelValueRow
                label="Status"
                value={healthy ? "Connected" : "Needs attention"}
              />
              <OperationalLabelValueRow
                label="Last checked"
                value={formatMailboxActivity(
                  account.lastScanAt ?? account.lastTestedAt,
                )}
              />
              {error ? (
                <OperationalLabelValueRow label="Issue" value={error} />
              ) : null}
            </OperationalLabelValueList>
          </FormSection>

          <FormSection title="Organization sharing">
            <OperationalPanel as="div" className="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label>Available to</Label>
                <EmailScopeSelect
                  value={scope}
                  onValueChange={setScope}
                  allowOrgScope={canManageOrgMailboxes}
                  disabled={!canManageMailbox}
                />
              </div>
              <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                Imported policies, requirements, and company facts become workspace
                data visible to the organization, even when mailbox access is set to
                Just me.
              </p>
            </OperationalPanel>
          </FormSection>

          <FormSection title="Proactive monitoring">
            {!account.automationConfigured ? (
              <p className={`rounded-lg border border-border bg-foreground/3 px-3 py-2 text-muted-foreground ${typeStyle("body.default")}`}>
                {account.scope === "org"
                  ? "This legacy mailbox is limited to attention alerts."
                  : "Proactive monitoring is off for this legacy mailbox."}
              </p>
            ) : null}
            <AutomationToggleRows
              value={automation}
              onChange={setAutomation}
              disabled={!canManageMailbox}
            />
          </FormSection>
        </div>
      )}

      <Dialog
        open={scanDialogOpen}
        onOpenChange={(open) => {
          if (!scanning) setScanDialogOpen(open);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Scan mailbox</DialogTitle>
            <DialogDescription>
              Choose a date range to scan in{" "}
              <strong>{account.emailAddress}</strong>. Spot uses the saved
              monitoring settings and skips emails it has already processed.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="manual-scan-from">From</Label>
              <Input
                id="manual-scan-from"
                type="date"
                value={scanFrom}
                max={scanTo}
                disabled={scanning}
                aria-invalid={scanDatesOutOfOrder}
                onChange={(event) => setScanFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-scan-to">To</Label>
              <Input
                id="manual-scan-to"
                type="date"
                value={scanTo}
                min={scanFrom}
                disabled={scanning}
                aria-invalid={scanDatesOutOfOrder}
                onChange={(event) => setScanTo(event.target.value)}
              />
            </div>
          </div>

          {scanDatesOutOfOrder ? (
            <p className={`text-destructive ${typeStyle("body.default")}`}>
              The end date must be on or after the start date.
            </p>
          ) : null}

          <DialogFooter>
            <PillButton
              variant="secondary"
              disabled={scanning}
              onClick={() => setScanDialogOpen(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              disabled={!canScan}
              onClick={() => void runManualScan()}
            >
              {scanning ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {scanning ? "Scanning…" : "Scan mailbox"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsDrawer>
  );
}
