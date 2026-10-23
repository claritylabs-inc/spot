"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@claritylabs-inc/ui/components/fade-in";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { ChatAvatar } from "@/components/chat/chat-message";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { OperatorSecondFactorSettings } from "@/components/operator/operator-second-factor";
import { PasswordSettings } from "@/components/profile/password-settings";
import { StreamingPreference } from "@/components/profile/streaming-preference";
import { ThemeModeSelector } from "@/components/ui/theme-mode-selector";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OPERATOR_EMAIL_ADDRESS } from "@/convex/lib/operatorEmailAddress";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type OperatorCurrent = FunctionReturnType<typeof api.operator.current>;

function OperatorProfileShell({
  actions,
  rightPanel,
  children,
}: {
  actions?: React.ReactNode;
  rightPanel?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AppShell
      actions={actions}
      rightPanel={rightPanel}
    >
      {children}
    </AppShell>
  );
}

type TeamEmailSettingsData = Extract<
  NonNullable<FunctionReturnType<typeof api.operatorEmailSettings.get>>,
  { configured: true }
>;

function TeamEmailSettings() {
  const settings = useQuery(api.operatorEmailSettings.get, {});
  if (settings === undefined) return null;
  if (!settings.configured) {
    return (
      <div className="mt-4">
        <InlineFieldCard title="Team email">
          <InlineFieldRow label="Team address">
            <span className="text-muted-foreground">
              Team email is not configured for this environment
            </span>
          </InlineFieldRow>
        </InlineFieldCard>
      </div>
    );
  }
  return <TeamEmailFields settings={settings} />;
}

function TeamEmailFields({ settings }: { settings: TeamEmailSettingsData }) {
  const saveTeamAddress = useMutation(api.operatorEmailSettings.saveTeamAddress);
  const saveAlwaysCc = useMutation(api.operatorEmailSettings.saveAlwaysCc);
  const ensureInbox = useAction(api.operatorEmailSettings.ensureInbox);
  // A blank address field means "use the default".
  const [localpart, setLocalpart] = useState(
    settings.customLocalpart ? settings.localpart : "",
  );
  const [alwaysCc, setAlwaysCc] = useState(settings.alwaysCcEmail ?? "");
  const [localpartError, setLocalpartError] = useState<string | null>(null);
  const [alwaysCcError, setAlwaysCcError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{
    state: "idle" | "running" | "failed";
    message?: string;
  }>({ state: "idle" });
  // Only the newest attempt reports, so a late failure never hides a newer save.
  const latestSetup = useRef(0);

  const runSetup = useCallback(async () => {
    const attempt = ++latestSetup.current;
    setSetup({ state: "running" });
    try {
      const result = await ensureInbox({});
      if (attempt !== latestSetup.current) return;
      setSetup(
        result.status === "failed"
          ? { state: "failed", message: result.message }
          : { state: "idle" },
      );
    } catch (error) {
      if (attempt !== latestSetup.current) return;
      setSetup({
        state: "failed",
        message: getUserFacingErrorMessage(
          error,
          "Your team inbox could not be set up.",
        ),
      });
    }
  }, [ensureInbox]);

  // A default address must work for forwarding before any edit or send. A
  // failure shows Retry and is never retried automatically.
  const needsSetup = settings.status === "needs_setup" && !!settings.address;
  const autoSetupStarted = useRef(false);
  useEffect(() => {
    if (!needsSetup || autoSetupStarted.current) return;
    autoSetupStarted.current = true;
    void runSetup();
  }, [needsSetup, runSetup]);

  const nextLocalpart = localpart.trim().toLowerCase();
  const addressAutoSave = useLocalFirstAutoSave({
    mutationName: "operator.teamEmail.address",
    args: { localpart: nextLocalpart },
    valueKey: nextLocalpart,
    autoSave: false,
    flush: async ({ localpart: value }) => {
      const result = await saveTeamAddress({ localpart: value });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onFlushed: (result) => {
      setLocalpartError(null);
      if (result?.changed) void runSetup();
    },
    onError: (error) =>
      setLocalpartError(
        getUserFacingErrorMessage(error, "Your team address could not be saved."),
      ),
  });
  const alwaysCcAutoSave = useLocalFirstAutoSave({
    mutationName: "operator.teamEmail.alwaysCc",
    args: { value: alwaysCc.trim() },
    valueKey: alwaysCc.trim(),
    autoSave: false,
    flush: async ({ value }) => {
      const result = await saveAlwaysCc({ value });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onFlushed: () => setAlwaysCcError(null),
    onError: (error) =>
      setAlwaysCcError(
        getUserFacingErrorMessage(error, "Always CC could not be saved."),
      ),
  });

  const statusText =
    setup.state === "running"
      ? "Setting up your inbox…"
      : setup.state === "failed"
        ? (setup.message ?? "Your team inbox could not be set up.")
        : !settings.address
          ? "Enter a team address"
          : settings.status === "ready"
            ? "Ready"
            : settings.status === "captured"
              ? "Local capture mode: no inbox is created"
              : settings.status === "needs_name"
                ? "Add your full name above to set up your inbox"
                : "Inbox not set up yet";
  const canRetry =
    !!settings.address &&
    (setup.state === "failed" ||
      (setup.state === "idle" && settings.status === "needs_setup"));
  const saveOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  return (
    <div className="mt-4">
      <InlineFieldCard title="Team email">
        <InlineFieldRow label="Team address">
          <div className="space-y-1">
            <div className="flex min-w-0 items-center gap-1">
              <Input
                aria-label="Team address"
                aria-invalid={localpartError ? true : undefined}
                value={localpart}
                onChange={(event) => {
                  setLocalpart(event.target.value);
                  setLocalpartError(null);
                }}
                onBlur={() => void addressAutoSave.saveNow()}
                onKeyDown={saveOnEnter}
                placeholder={settings.defaultLocalpart ?? "your-name"}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1"
              />
              <span className="shrink-0 text-muted-foreground">
                @{settings.domain}
              </span>
            </div>
            {localpartError ? (
              <p role="alert" className="text-destructive">
                {localpartError}
              </p>
            ) : (
              <p className="flex flex-wrap items-center gap-x-3 text-muted-foreground">
                {statusText}
                {canRetry ? (
                  <PillButton
                    type="button"
                    variant="ghost"
                    size="compact"
                    onClick={() => void runSetup()}
                  >
                    {setup.state === "failed" ? "Retry" : "Set up"}
                  </PillButton>
                ) : null}
                {settings.previousAddress ? (
                  <span className="w-full">
                    Mail to {settings.previousAddress} still arrives
                  </span>
                ) : null}
              </p>
            )}
          </div>
        </InlineFieldRow>
        <InlineFieldRow label="Always CC">
          <div className="space-y-1">
            <Input
              aria-label="Always CC"
              aria-invalid={alwaysCcError ? true : undefined}
              type="email"
              value={alwaysCc}
              onChange={(event) => {
                setAlwaysCc(event.target.value);
                setAlwaysCcError(null);
              }}
              onBlur={() => void alwaysCcAutoSave.saveNow()}
              onKeyDown={saveOnEnter}
              placeholder="Optional: copied on every email you send"
              autoComplete="off"
            />
            {alwaysCcError ? (
              <p role="alert" className="text-destructive">
                {alwaysCcError}
              </p>
            ) : null}
          </div>
        </InlineFieldRow>
        <InlineFieldRow label="Command email">
          <span
            className="break-all"
            title="Email this address to run the operator agent"
          >
            {settings.commandAddress}
          </span>
        </InlineFieldRow>
      </InlineFieldCard>
    </div>
  );
}

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

function OperatorAvatarField({ current }: { current: OperatorCurrent }) {
  const generateUploadUrl = useMutation(api.operator.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.operator.setAvatar);
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const name = current.user.name?.trim() || current.user.email || "Operator";

  async function save(file: File | null) {
    if (file && (!file.type.startsWith("image/") || file.size > AVATAR_MAX_BYTES)) {
      toast.error("Choose an image smaller than 5 MB");
      return;
    }
    setSaving(true);
    try {
      let storageId: Id<"_storage"> | null = null;
      if (file) {
        const response = await fetch(await generateUploadUrl({}), {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!response.ok) throw new Error("Upload failed");
        ({ storageId } = (await response.json()) as {
          storageId: Id<"_storage">;
        });
      }
      await setAvatar({ storageId });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Your photo could not be saved."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <ChatAvatar name={name} imageUrl={current.user.avatarUrl} className="size-8" />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void save(file);
        }}
      />
      <PillButton
        type="button"
        variant="ghost"
        size="compact"
        disabled={saving}
        onClick={() => inputRef.current?.click()}
      >
        {saving ? "Saving…" : current.user.hasUploadedAvatar ? "Replace" : "Upload"}
      </PillButton>
      {current.user.hasUploadedAvatar ? (
        <PillButton
          type="button"
          variant="ghost"
          size="compact"
          disabled={saving}
          onClick={() => void save(null)}
        >
          Use Gravatar
        </PillButton>
      ) : null}
    </div>
  );
}

function OperatorProfileContent({ current }: { current: OperatorCurrent }) {
  const updateProfile = useMutation(api.users.updateProfile);
  const [name, setName] = useState(current.user.name ?? "");
  const [phone, setPhone] = useState(current.user.phone ?? "");
  const email = current.user.email ?? current.profile.email;
  const loginEmails = current.user.loginEmails ?? [email];
  const accessLevel = current.profile.role === "owner" ? "Owner" : "Operator";

  const saveProfile = useCallback(
    async ({
      name: nextName,
      phone: nextPhone,
    }: {
      name: string;
      phone: string;
    }) => {
      await updateProfile({ name: nextName, phone: nextPhone });
    },
    [updateProfile],
  );
  const profileAutoSave = useLocalFirstAutoSave({
    mutationName: `operator.profile.${current.user._id}`,
    args: { name: name.trim(), phone: phone.trim() },
    valueKey: JSON.stringify([name.trim(), phone.trim()]),
    autoSave: false,
    flush: saveProfile,
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Your profile could not be saved."),
  });

  return (
    <OperatorProfileShell
      actions={<AutoSaveStatus status={profileAutoSave.status} />}
    >
      <div className="w-full">
        <FadeIn when={true} staggerIndex={1} duration={0.4}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void profileAutoSave.saveNow();
            }}
          >
            <InlineFieldCard title="Account">
              <InlineFieldRow label="Photo">
                <OperatorAvatarField current={current} />
              </InlineFieldRow>
              <InlineFieldRow label="Name">
                <Input
                  aria-label="Name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => void profileAutoSave.saveNow()}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </InlineFieldRow>
              <InlineFieldRow label="iMessage phone">
                <Input
                  aria-label="iMessage phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  onBlur={() => void profileAutoSave.saveNow()}
                  placeholder="+1 202 555 0100"
                  autoComplete="tel"
                  title="Messages from this number can use the operator agent"
                />
              </InlineFieldRow>
              <InlineFieldRow label="Access level">{accessLevel}</InlineFieldRow>
              <InlineFieldRow label="Login emails">
                <ul className="space-y-0.5 py-1.5 break-all">
                  {loginEmails.map((loginEmail) => (
                    <li key={loginEmail}>{loginEmail}</li>
                  ))}
                </ul>
              </InlineFieldRow>
              <InlineFieldRow label="Operator email">
                <span
                  className="break-all"
                  title="Email from a login address; replies land in your operator threads"
                >
                  {OPERATOR_EMAIL_ADDRESS}
                </span>
              </InlineFieldRow>
            </InlineFieldCard>
          </form>
          <TeamEmailSettings />
        </FadeIn>

        <FadeIn when={true} staggerIndex={2} duration={0.4}>
          <PasswordSettings />
          <OperatorSecondFactorSettings />
          <OperationalPanel className="mt-4">
            <OperationalPanelHeader title="Appearance" />
            <OperationalPanelBody>
              <ThemeModeSelector className="max-w-lg" />
            </OperationalPanelBody>
          </OperationalPanel>
          <OperationalPanel className="mt-4">
            <OperationalPanelHeader title="Chat" />
            <OperationalPanelBody>
              <StreamingPreference />
            </OperationalPanelBody>
          </OperationalPanel>
        </FadeIn>
      </div>
    </OperatorProfileShell>
  );
}

export default function OperatorProfilePage() {
  const current = useCachedOperatorCurrent();

  if (!current) {
    return (
      <OperatorProfileShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </OperatorProfileShell>
    );
  }

  return <OperatorProfileContent key={current.user._id} current={current} />;
}
