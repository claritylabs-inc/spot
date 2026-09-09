"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { ChevronRight, Mail, MessageSquareText } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { FormSection } from "@/components/ui/form-section";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import {
  getEffectiveChannelDefault,
  getNotificationSettingsRows,
  isProactiveNotificationType,
  NOTIFICATION_SEVERITY,
  PROACTIVE_PREFERENCE_TYPE,
  type NotificationChannel,
  type NotificationSettingsRow,
} from "@/convex/lib/notificationTypes";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

interface NotificationPreferencesSectionProps {
  orgId: Id<"organizations">;
  orgType: "broker" | "client";
}

function prefKey(type: string, channel: NotificationChannel) {
  return `${type}:${channel}`;
}

function channelSummary(email: boolean, text: boolean) {
  if (email && text) return "Email and text";
  if (email) return "Email";
  if (text) return "Text";
  return "Off";
}

function DefaultNotificationRow({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
  label,
  disabled,
  onReset,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: () => void;
  label: string;
  disabled: boolean;
  onReset?: () => void;
}) {
  return (
    <OperationalPanel as="div">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-foreground">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className={`text-foreground ${typeStyle("body.medium")}`}>
              {title}
            </p>
            <p
              className={`mt-0.5 text-muted-foreground ${typeStyle("body.default")}`}
            >
              {description}
            </p>
          </div>
        </div>
        <SettingsSwitch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          label={label}
        />
      </div>
      {onReset ? (
        <div className="px-5 pb-4">
          <PillButton variant="secondary" disabled={disabled} onClick={onReset}>
            Use Spot defaults
          </PillButton>
        </div>
      ) : null}
    </OperationalPanel>
  );
}

function NotificationPreferenceDrawer({
  orgId,
  row,
  initialEmail,
  initialText,
  usesDefaults,
  onOpenChange,
  onSaved,
  onReset,
}: {
  orgId: Id<"organizations">;
  row: NotificationSettingsRow;
  initialEmail: boolean;
  initialText: boolean;
  usesDefaults: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (type: string, email: boolean, text: boolean) => void;
  onReset: (type: string) => void;
}) {
  const setChannels = useMutation(api.notificationPreferences.setChannels);
  const resetChannels = useMutation(api.notificationPreferences.resetChannels);
  const [resetting, setResetting] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [text, setText] = useState(initialText);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "notificationPreferences.setChannels",
    args: { email, imessage: text },
    flush: async (channels) => {
      await setChannels({ orgId, type: row.type, ...channels });
      onSaved(row.type, channels.email, channels.imessage);
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(
        error,
        "Failed to save notification preference",
      ),
  });

  async function restoreDefaults() {
    setResetting(true);
    try {
      if (!(await autoSave.saveNow())) return;
      await resetChannels({ orgId, type: row.type });
      onReset(row.type);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to restore defaults"),
      );
    } finally {
      setResetting(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open)
          void autoSave.saveNow().then((saved) => {
            if (saved) onOpenChange(false);
          });
      }}
      title={row.label}
      actions={<AutoSaveStatus status={autoSave.status} />}
      footer={
        !usesDefaults ? (
          <PillButton
            variant="secondary"
            disabled={resetting}
            onClick={() => void restoreDefaults()}
          >
            Use defaults
          </PillButton>
        ) : undefined
      }
    >
      <FormSection
        title="Delivery channels"
        description={
          usesDefaults
            ? "This event currently follows your default delivery settings."
            : "This event has custom delivery settings."
        }
        divided={false}
      >
        <OperationalPanel as="div" className="divide-y divide-border">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                Email
              </p>
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Send this event to your account email.
              </p>
            </div>
            <SettingsSwitch
              checked={email}
              disabled={resetting}
              onCheckedChange={() => setEmail((current) => !current)}
              label={`${row.label} email`}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                Text
              </p>
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Send this event to your profile phone number.
              </p>
            </div>
            <SettingsSwitch
              checked={text}
              disabled={resetting}
              onCheckedChange={() => setText((current) => !current)}
              label={`${row.label} text message`}
            />
          </div>
        </OperationalPanel>
      </FormSection>
    </SettingsDrawer>
  );
}

export function NotificationPreferencesSection({
  orgId,
  orgType,
}: NotificationPreferencesSectionProps) {
  const prefs = useCachedQuery(
    "notificationPreferences.getForUser",
    api.notificationPreferences.getForUser,
    { orgId },
  );
  const setAllEmail = useMutation(api.notificationPreferences.setAllEmail);
  const setAllChannel = useMutation(api.notificationPreferences.setAllChannel);
  const resetChannels = useMutation(api.notificationPreferences.resetChannels);
  const { setRightPanel } = useSettingsActions();
  const [localPrefs, setLocalPrefs] = useState<Record<string, boolean>>({});
  const [savingDefault, setSavingDefault] =
    useState<NotificationChannel | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const visibleRows = getNotificationSettingsRows(orgType);
  const groups = Array.from(new Set(visibleRows.map((row) => row.group)));
  const storedPrefs = prefs ?? [];

  function explicitPreference(type: string, channel: NotificationChannel) {
    const local = localPrefs[prefKey(type, channel)];
    if (local !== undefined) return local;
    return storedPrefs.find(
      (pref) => pref.type === type && pref.channel === channel,
    )?.enabled;
  }

  // The `__all__` row is an explicit override. When it does not exist, the
  // backend falls back to severity-based defaults per event, so there is no
  // single on/off state to show here.
  function defaultOverride(channel: NotificationChannel) {
    return explicitPreference("__all__", channel);
  }

  function effectivePreference(
    type: NotificationSettingsRow["type"],
    channel: NotificationChannel,
  ) {
    const explicit = explicitPreference(type, channel);
    if (explicit !== undefined) return explicit;

    if (isProactiveNotificationType(type)) {
      const proactiveDefault = explicitPreference(
        PROACTIVE_PREFERENCE_TYPE,
        channel,
      );
      if (proactiveDefault !== undefined) return proactiveDefault;
    }

    const defaultOverride = explicitPreference("__all__", channel);
    if (defaultOverride !== undefined) return defaultOverride;

    return getEffectiveChannelDefault(channel, NOTIFICATION_SEVERITY[type]);
  }

  function setLocalPreference(
    type: string,
    channel: NotificationChannel,
    enabled: boolean,
  ) {
    setLocalPrefs((current) => ({
      ...current,
      [prefKey(type, channel)]: enabled,
    }));
  }

  const saveEventLocally = useCallback(
    (type: string, email: boolean, text: boolean) => {
      setLocalPrefs((current) => ({
        ...current,
        [prefKey(type, "email")]: email,
        [prefKey(type, "imessage")]: text,
      }));
    },
    [],
  );

  const clearLocalPreference = useCallback(
    (type: string, channel?: NotificationChannel) => {
      setLocalPrefs((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) =>
            channel
              ? key !== prefKey(type, channel)
              : !key.startsWith(`${type}:`),
          ),
        ),
      );
    },
    [],
  );

  async function restoreDefault(channel: NotificationChannel) {
    setSavingDefault(channel);
    try {
      await resetChannels({ orgId, type: "__all__", channel });
      clearLocalPreference("__all__", channel);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to restore defaults"),
      );
    } finally {
      setSavingDefault(null);
    }
  }

  async function toggleDefault(channel: NotificationChannel) {
    const previous = defaultOverride(channel);
    const next = !(previous ?? false);
    setLocalPreference("__all__", channel, next);
    setSavingDefault(channel);
    try {
      if (channel === "email") {
        await setAllEmail({ orgId, enabled: next });
      } else {
        await setAllChannel({ orgId, channel, enabled: next });
      }
    } catch (error) {
      if (previous === undefined) {
        setLocalPrefs((current) => {
          const { [prefKey("__all__", channel)]: _removed, ...rest } = current;
          return rest;
        });
      } else {
        setLocalPreference("__all__", channel, previous);
      }
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Failed to update notification default",
        ),
      );
    } finally {
      setSavingDefault(null);
    }
  }

  const selectedRow = visibleRows.find((row) => row.type === selectedType);
  const selectedEmail = selectedRow
    ? effectivePreference(selectedRow.type, "email")
    : false;
  const selectedText = selectedRow
    ? effectivePreference(selectedRow.type, "imessage")
    : false;
  const selectedUsesDefaults = selectedRow
    ? explicitPreference(selectedRow.type, "email") === undefined &&
      explicitPreference(selectedRow.type, "imessage") === undefined
    : true;

  useEffect(() => {
    setRightPanel(
      selectedRow ? (
        <NotificationPreferenceDrawer
          key={selectedRow.type}
          orgId={orgId}
          row={selectedRow}
          initialEmail={selectedEmail}
          initialText={selectedText}
          usesDefaults={selectedUsesDefaults}
          onOpenChange={(open) => {
            if (!open) setSelectedType(null);
          }}
          onSaved={saveEventLocally}
          onReset={clearLocalPreference}
        />
      ) : null,
    );
    return () => setRightPanel(null);
  }, [
    orgId,
    saveEventLocally,
    clearLocalPreference,
    selectedEmail,
    selectedRow,
    selectedText,
    selectedUsesDefaults,
    setRightPanel,
  ]);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <DefaultNotificationRow
          icon={Mail}
          title="Default email delivery"
          description={
            defaultOverride("email") === undefined
              ? "Set a default for all events. Events currently follow Spot defaults by importance."
              : "Overrides the Spot default for events without a custom email setting."
          }
          checked={defaultOverride("email") ?? false}
          disabled={savingDefault !== null}
          onCheckedChange={() => void toggleDefault("email")}
          label="Default email delivery"
          onReset={
            defaultOverride("email") !== undefined
              ? () => void restoreDefault("email")
              : undefined
          }
        />
        <DefaultNotificationRow
          icon={MessageSquareText}
          title="Default text delivery"
          description={
            defaultOverride("imessage") === undefined
              ? "Set a default for all events. Events currently follow Spot defaults by importance."
              : "Overrides the Spot default for events without a custom text setting."
          }
          checked={defaultOverride("imessage") ?? false}
          disabled={savingDefault !== null}
          onCheckedChange={() => void toggleDefault("imessage")}
          label="Default text delivery"
          onReset={
            defaultOverride("imessage") !== undefined
              ? () => void restoreDefault("imessage")
              : undefined
          }
        />
      </div>

      {groups.map((group) => (
        <OperationalPanel key={group}>
          <OperationalPanelHeader title={group} className="px-5 py-3.5" />
          <div className="divide-y divide-border">
            {visibleRows
              .filter((row) => row.group === group)
              .map((row) => {
                const email = effectivePreference(row.type, "email");
                const text = effectivePreference(row.type, "imessage");
                const usesDefaults =
                  explicitPreference(row.type, "email") === undefined &&
                  explicitPreference(row.type, "imessage") === undefined;
                return (
                  <button
                    key={row.type}
                    type="button"
                    onClick={() => setSelectedType(row.type)}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-foreground/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-emphasized"
                  >
                    <span
                      className={`min-w-0 flex-1 text-foreground ${typeStyle("body.medium")}`}
                    >
                      {row.label}
                    </span>
                    <span
                      className={`shrink-0 text-muted-foreground ${typeStyle("body.default")}`}
                    >
                      {usesDefaults ? "Default · " : ""}
                      {channelSummary(email, text)}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                  </button>
                );
              })}
          </div>
        </OperationalPanel>
      ))}
    </div>
  );
}
