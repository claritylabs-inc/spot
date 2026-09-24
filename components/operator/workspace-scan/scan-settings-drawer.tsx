"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import {
  GOOGLE_WORKSPACE_SCAN_INTERVALS,
  type GoogleWorkspaceScanConfig,
  type GoogleWorkspaceScanInterval,
  type GoogleWorkspaceScanSettingsInput,
} from "@/convex/lib/googleWorkspaceScan";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

export const SCAN_INTERVAL_LABELS: Record<GoogleWorkspaceScanInterval, string> =
  {
    15: "Every 15 minutes",
    30: "Every 30 minutes",
    60: "Hourly",
    360: "Every 6 hours",
    1440: "Daily",
  };

export function ScanSettingsDrawer({
  config,
  currentOperatorId,
  ready,
  onSave,
  onClose,
}: {
  config: GoogleWorkspaceScanConfig;
  currentOperatorId: Id<"users">;
  ready: boolean;
  onSave: (input: GoogleWorkspaceScanSettingsInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const [interval, setInterval] = useState(config.intervalMinutes);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function save(enable: boolean) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        enabled: enable,
        expectedAuthorizationRevision: config.authorizationRevision,
        expectedSettingsUpdatedAt: config.settingsUpdatedAt,
        intervalMinutes: interval,
        ...(enable && !config.enabled
          ? { authorizingOperatorId: currentOperatorId }
          : {}),
      });
      toast.success(
        enable && !config.enabled
          ? "Automatic updates enabled"
          : "Scan schedule saved",
      );
      onClose();
    } catch (cause) {
      setError(
        getUserFacingErrorMessage(cause, "Scan settings could not be saved."),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Automatic updates"
      contentClassName="gap-4"
      footer={
        <PillButton disabled={busy || !ready} onClick={() => void save(true)}>
          {busy
            ? "Saving…"
            : config.enabled
              ? "Save schedule"
              : "Authorize and enable"}
        </PillButton>
      }
    >
      <p className={`text-foreground ${typeStyle("body.default")}`}>
        Spot reads received, sent and archived company mail to create and update
        clients, brokers and requests, and import bound-policy PDFs. The first
        scan covers the past 90 days.
      </p>
      <p className={`text-foreground ${typeStyle("body.default")}`}>
        New requests are immediately visible to the client. Clear newer email
        evidence can replace manual edits. Ambiguous evidence appears in Needs
        attention.
      </p>
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        Enabling authorizes automatic changes under your operator account until
        paused. Scanning sends no messages or invitations and grants no account
        access.
      </p>
      <OperationalLabelValueList>
        <OperationalLabelValueRow
          label="Authorized by"
          value={config.authorizingOperatorLabel ?? "No authorization yet"}
        />
        <OperationalLabelValueRow
          label="Mailboxes"
          value="All eligible Workspace mailboxes"
        />
        <OperationalLabelValueRow
          label="Excluded"
          value="Drafts, spam and trash"
        />
      </OperationalLabelValueList>
      <label className="space-y-2">
        <span
          className={`block text-muted-foreground ${typeStyle("label.field")}`}
        >
          Schedule
        </span>
        <Select
          value={String(interval)}
          onValueChange={(value) => {
            const selected = GOOGLE_WORKSPACE_SCAN_INTERVALS.find(
              (candidate) => String(candidate) === value,
            );
            if (selected) setInterval(selected);
          }}
          disabled={busy}
        >
          <SelectTrigger aria-label="Scan schedule">
            <SelectValue>{SCAN_INTERVAL_LABELS[interval]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {GOOGLE_WORKSPACE_SCAN_INTERVALS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {SCAN_INTERVAL_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {!config.enabled &&
      config.authorizingOperatorId &&
      config.authorizingOperatorId !== currentOperatorId ? (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          Enabling reassigns authorization to you.
        </p>
      ) : null}
      {!ready ? (
        <p
          role="status"
          className={`text-muted-foreground ${typeStyle("body.default")}`}
        >
          Enable Directory mailbox access and configure the connection before
          starting automatic updates.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className={`text-destructive ${typeStyle("body.default")}`}
        >
          {error}
        </p>
      ) : null}
    </SettingsDrawer>
  );
}
