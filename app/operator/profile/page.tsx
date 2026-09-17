"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2 } from "lucide-react";

import { OperatorSidebar } from "@/app/operator/operator-sidebar";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { StreamingPreference } from "@/components/profile/streaming-preference";
import { ThemeModeSelector } from "@/components/ui/theme-mode-selector";
import { api } from "@/convex/_generated/api";
import { OPERATOR_EMAIL_ADDRESS } from "@/convex/lib/operatorEmailAddress";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

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
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="profile"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      actions={actions}
      rightPanel={rightPanel}
    >
      {children}
    </AppShell>
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
            <OperationalPanel>
              <OperationalPanelHeader title="Account" />
              <OperationalPanelBody className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="operator-profile-name" className="mb-1.5">
                    Name
                  </Label>
                  <Input
                    id="operator-profile-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => void profileAutoSave.saveNow()}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <Label htmlFor="operator-profile-phone" className="mb-1.5">
                    iMessage phone
                  </Label>
                  <Input
                    id="operator-profile-phone"
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    onBlur={() => void profileAutoSave.saveNow()}
                    placeholder="+1 202 555 0100"
                    autoComplete="tel"
                  />
                  <p
                    className={`mt-1.5 text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    Messages from this number can use the internal operator
                    agent.
                  </p>
                </div>
                <div className="min-w-0">
                  <p
                    id="operator-profile-login-emails"
                    className={`mb-1.5 ${typeStyle("label.field")}`}
                  >
                    Login emails
                  </p>
                  <ul
                    aria-labelledby="operator-profile-login-emails"
                    className={`space-y-1 break-all ${typeStyle("body.default")}`}
                  >
                    {loginEmails.map((loginEmail) => (
                      <li key={loginEmail}>{loginEmail}</li>
                    ))}
                  </ul>
                  <p
                    className={`mt-1.5 text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    Sign in with any of these addresses.
                  </p>
                </div>
                <div>
                  <Label htmlFor="operator-profile-access" className="mb-1.5">
                    Access level
                  </Label>
                  <Input
                    id="operator-profile-access"
                    value={accessLevel}
                    disabled
                  />
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <p className={`mb-1.5 ${typeStyle("label.field")}`}>
                    Operator email
                  </p>
                  <p className={`break-all ${typeStyle("body.default")}`}>
                    {OPERATOR_EMAIL_ADDRESS}
                  </p>
                  <p
                    className={`mt-1.5 text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    Send or forward emails from a login address above. Spot
                    replies by email and saves the conversation in your private
                    operator threads.
                  </p>
                </div>
              </OperationalPanelBody>
            </OperationalPanel>
          </form>
        </FadeIn>

        <FadeIn when={true} staggerIndex={2} duration={0.4}>
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
