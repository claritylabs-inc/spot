"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { isValidPhoneNumber } from "react-phone-number-input";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@claritylabs-inc/ui/components/fade-in";
import { Loader2, Mail } from "lucide-react";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Label } from "@claritylabs-inc/ui/components/label";
import { SelfEmailChangeDrawer } from "@/components/settings/change-email-drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { PhoneInput } from "@claritylabs-inc/ui/components/marketing/phone-input";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { StreamingPreference } from "@/components/profile/streaming-preference";
import { ThemeModeSelector } from "@/components/ui/theme-mode-selector";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useViewerCacheActions } from "@/lib/sync/spot-cached-queries";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  cachedQueryResult,
  useCachedQuery,
} from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";
import {
  ImessagePrivacySettings,
  ProfileSectionTabs,
} from "@/components/profile/imessage-history-privacy";

const inputClass = `h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-input transition-colors ${typeStyle("body.default")}`;
const labelClass = `text-muted-foreground block mb-1.5 ${typeStyle("caption.medium")}`;

type ProfileValues = {
  name: string;
  title: string;
  phone: string;
};

type Viewer = FunctionReturnType<typeof api.users.viewer>;
type ProactiveChannelChoice = "email" | "imessage" | "both";
type ProactiveChannelPreferences = {
  email: boolean;
  imessage: boolean;
  configured: boolean;
};

const PROACTIVE_CHANNEL_LABELS: Record<ProactiveChannelChoice, string> = {
  email: "Email",
  imessage: "Text (iMessage)",
  both: "Email and text (iMessage)",
};

function isProactiveChannelChoice(
  value: unknown,
): value is ProactiveChannelChoice {
  return value === "email" || value === "imessage" || value === "both";
}

function proactiveChannelChoice(
  preferences: ProactiveChannelPreferences | undefined,
): ProactiveChannelChoice | null {
  if (!preferences) return null;
  if (preferences.email && preferences.imessage) return "both";
  if (preferences.imessage) return "imessage";
  if (preferences.email) return "email";
  return null;
}

function valuesEqual(a: ProfileValues | null, b: ProfileValues) {
  return a?.name === b.name && a.title === b.title && a.phone === b.phone;
}

export default function ProfilePage() {
  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const currentOrg = useCurrentOrg();
  const updateProfile = useMutation(api.users.updateProfile);
  const setProactiveChannels = useMutation(
    api.notificationPreferences.setProactiveChannels,
  );
  const proactivePreferences = useCachedQuery(
    "notificationPreferences.getProactiveChannels",
    api.notificationPreferences.getProactiveChannels,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as ProactiveChannelPreferences | undefined;
  const { patchViewer } = useViewerCacheActions();

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [debouncedPhone, setDebouncedPhone] = useState("");
  const [emailDrawerOpen, setEmailDrawerOpen] = useState(false);
  const [pendingProactiveChoice, setPendingProactiveChoice] =
    useState<ProactiveChannelChoice | null>(null);
  const [savingProactiveChannels, setSavingProactiveChannels] = useState(false);
  const [profileSection, setProfileSection] = useState<"profile" | "privacy">(
    "profile",
  );
  const [persistedValues, setPersistedValues] = useState<ProfileValues | null>(
    null,
  );

  useEffect(() => {
    if (!viewer || persistedValues) return;
    const initial = {
      name: viewer.name ?? "",
      title: viewer.title ?? "",
      phone: viewer.phone ?? "",
    };
    queueMicrotask(() => {
      setName(initial.name);
      setTitle(initial.title);
      setPhone(initial.phone);
      setDebouncedPhone(initial.phone);
      setPersistedValues(initial);
    });
  }, [persistedValues, viewer]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPhone(phone.trim()), 300);
    return () => clearTimeout(timer);
  }, [phone]);

  const currentPhone = persistedValues?.phone ?? "";
  const trimmedPhone = phone.trim();
  const phoneChanged = trimmedPhone !== currentPhone;
  const phoneHasDigits = /\d/.test(trimmedPhone);
  const phoneValid =
    trimmedPhone.length > 0 && isValidPhoneNumber(trimmedPhone);
  const phoneInvalid =
    phoneHasDigits &&
    !phoneValid &&
    trimmedPhone.replace(/\D/g, "").length >= 7;
  const shouldCheckPhone = phoneChanged && phoneValid;
  const phoneAvailability = useQuery(
    api.users.checkPhoneAvailability,
    shouldCheckPhone && debouncedPhone === trimmedPhone
      ? { phone: debouncedPhone }
      : "skip",
  );
  const phoneChecking =
    shouldCheckPhone &&
    (debouncedPhone !== trimmedPhone || phoneAvailability === undefined);
  const phoneUnavailable =
    shouldCheckPhone && phoneAvailability?.available === false;
  const phoneBlocked = phoneInvalid || phoneChecking || phoneUnavailable;

  const currentValues: ProfileValues = {
    name: name.trim(),
    title: title.trim(),
    phone: trimmedPhone,
  };
  const hasChanges =
    persistedValues !== null && !valuesEqual(persistedValues, currentValues);

  const saveProfile = useCallback(
    async (next: ProfileValues) => {
      await updateProfile({
        name: next.name,
        title: next.title,
        phone: next.phone,
      });
    },
    [updateProfile],
  );

  const profileAutoSave = useLocalFirstAutoSave({
    mutationName: "profile.update",
    args: currentValues,
    valueKey: JSON.stringify(currentValues),
    enabled: persistedValues !== null,
    canSave: !phoneBlocked,
    applyLocal: (store, next) => {
      const collection = cachedQueryCollectionFor<Viewer>("users.viewer");
      const argsKey = cachedQueryArgsKey({});
      const current = store.getCollection(collection, argsKey)?.[0]?.value;
      if (!current) return;
      void store.upsertCollection(collection, argsKey, [
        cachedQueryResult(argsKey, {
          ...current,
          name: next.name,
          title: next.title,
          phone: next.phone,
        }),
      ]);
    },
    flush: saveProfile,
    onFlushed: (_result, next) => setPersistedValues(next),
    errorMessage: (err) => {
      const message = getUserFacingErrorMessage(err, "Failed to save profile");
      return message.includes("This phone number is already used")
        ? "This phone number is already used by another user."
        : message.includes("Enter a valid phone number")
          ? "Enter a valid phone number with country code."
          : message;
    },
  });

  const saving = profileAutoSave.saving;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasChanges || phoneBlocked || saving) return;
    void profileAutoSave.saveNow();
  }

  async function saveProactiveChannels(nextChoice: ProactiveChannelChoice) {
    if (!currentOrg?.orgId) return;
    const includesImessage = nextChoice === "imessage" || nextChoice === "both";
    if (includesImessage && !viewer?.phone) {
      toast.error("Add a mobile number before choosing iMessage");
      return;
    }
    setPendingProactiveChoice(nextChoice);
    setSavingProactiveChannels(true);
    try {
      await setProactiveChannels({
        orgId: currentOrg.orgId,
        email: nextChoice === "email" || nextChoice === "both",
        imessage: includesImessage,
      });
      toast.success("Proactive contact method updated");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Failed to update proactive contact method",
        ),
      );
    } finally {
      setPendingProactiveChoice(null);
      setSavingProactiveChannels(false);
    }
  }

  if (viewer === undefined) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  const effectiveProactiveChoice = proactiveChannelChoice(proactivePreferences);
  const displayedProactiveChoice =
    pendingProactiveChoice ?? effectiveProactiveChoice;
  const headerActions = (
    <>
      <AutoSaveStatus status={profileAutoSave.status} />
      <PillButton
        size="compact"
        variant="iconLabel"
        label="Change email"
        onClick={() => setEmailDrawerOpen(true)}
      >
        <Mail className="h-3.5 w-3.5" />
      </PillButton>
    </>
  );

  return (
    <AppShell
      actions={headerActions}
      rightPanel={
        <SelfEmailChangeDrawer
          open={emailDrawerOpen}
          onOpenChange={setEmailDrawerOpen}
          currentEmail={viewer?.email}
          onConfirmed={(email) => patchViewer({ email })}
        />
      }
    >
      <ProfileSectionTabs
        active={profileSection}
        onChange={setProfileSection}
      />
      {profileSection === "profile" ? (
        <>
          <FadeIn when={true} staggerIndex={1} duration={0.6}>
            <form onSubmit={handleSubmit}>
              <OperationalPanel className="mb-4">
                <OperationalPanelHeader
                  title="Account"
                  className="px-5 py-3.5"
                />
                <OperationalPanelBody className="space-y-4 px-5 py-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Email</label>
                      <input
                        type="email"
                        value={viewer?.email ?? ""}
                        disabled
                        className={`h-9 w-full rounded-lg border border-input bg-foreground/[0.02] px-3 text-muted-foreground/60 cursor-not-allowed ${typeStyle("control.input")}`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Risk Manager, CFO"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Mobile number</label>
                    <PhoneInput
                      value={phone || undefined}
                      onChange={(value) => setPhone(value ?? "")}
                      defaultCountry="US"
                      placeholder="Enter phone number"
                    />
                    <p
                      className={`text-muted-foreground/60 mt-1.5 flex items-center gap-1.5 ${typeStyle("caption.default")}`}
                    >
                      {phoneInvalid ? (
                        <span className="text-red-500/80">
                          Enter a valid phone number with country code.
                        </span>
                      ) : phoneChecking ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Checking phone number
                        </>
                      ) : phoneUnavailable ? (
                        <span className="text-red-500/80">
                          This phone number is already used by another user.
                        </span>
                      ) : shouldCheckPhone && phoneAvailability?.available ? (
                        "Phone number is available"
                      ) : (
                        "Used for iMessage access to your Spot agent."
                      )}
                    </p>
                  </div>
                </OperationalPanelBody>
              </OperationalPanel>

              <p
                className={`text-muted-foreground/50 mt-2 ${typeStyle("caption.default")}`}
              >
                Company settings and team management are in{" "}
                <Link
                  href="/settings"
                  className="text-foreground/60 hover:text-foreground underline"
                >
                  Organization Settings
                </Link>
                .
              </p>
            </form>
          </FadeIn>

          <FadeIn when={true} staggerIndex={2} duration={0.6}>
            <OperationalPanel className="mt-4">
              <OperationalPanelHeader
                title="Proactive conversations"
                className="px-5 py-3.5"
              />
              <OperationalPanelBody className="px-5 py-5">
                <div className="max-w-lg">
                  <Label
                    htmlFor="proactive-contact-method"
                    className="mb-1.5 text-muted-foreground"
                  >
                    Preferred contact method
                  </Label>
                  <Select
                    value={displayedProactiveChoice ?? ""}
                    disabled={
                      proactivePreferences === undefined ||
                      savingProactiveChannels ||
                      !currentOrg?.orgId
                    }
                    onValueChange={(value) => {
                      if (isProactiveChannelChoice(value)) {
                        void saveProactiveChannels(value);
                      }
                    }}
                  >
                    <SelectTrigger
                      id="proactive-contact-method"
                      className="w-full"
                    >
                      <SelectValue
                        placeholder={
                          proactivePreferences === undefined
                            ? "Loading contact method"
                            : "In-app only"
                        }
                      >
                        {displayedProactiveChoice
                          ? PROACTIVE_CHANNEL_LABELS[displayedProactiveChoice]
                          : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="imessage" disabled={!viewer?.phone}>
                        Text (iMessage)
                      </SelectItem>
                      <SelectItem value="both" disabled={!viewer?.phone}>
                        Email and text (iMessage)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </OperationalPanelBody>
            </OperationalPanel>
          </FadeIn>

          <FadeIn when={true} staggerIndex={3} duration={0.6}>
            <OperationalPanel className="mt-4">
              <OperationalPanelHeader
                title="Appearance"
                className="px-5 py-3.5"
              />
              <OperationalPanelBody className="px-5 py-5">
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
        </>
      ) : (
        <FadeIn when={true} staggerIndex={1} duration={0.4}>
          <ImessagePrivacySettings />
        </FadeIn>
      )}
    </AppShell>
  );
}
