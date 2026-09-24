"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { FeatureFlagToggleRow } from "@/components/settings/feature-flag-toggle-row";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  betaFeatureFlagsForOrgType,
  getFeatureFlagOrgType,
  isFeatureEnabled,
  setFeatureFlagPatch,
  type FeatureFlagId,
} from "@/convex/lib/featureFlags";
import {
  patchCachedViewerOrg,
  useCachedViewerOrg,
} from "@/lib/sync/spot-cached-queries";
import { useSyncStore } from "@claritylabs/cl-sync";
import { typeStyle } from "@/lib/typography";

export function BetaFeaturesSection() {
  const viewer = useQuery(api.users.viewer, {});
  const orgData = useCachedViewerOrg();
  const store = useSyncStore();
  const router = useRouter();
  const { setRightPanel } = useSettingsActions();
  const setFeatureFlag = useMutation(api.orgs.setFeatureFlag);
  const restartOnboarding = useMutation(api.users.restartOnboarding);
  const resetAccount = useMutation(api.users.resetAccount);
  const org = orgData?.org;
  const flags = betaFeatureFlagsForOrgType(getFeatureFlagOrgType(org));
  const [restarting, setRestarting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  async function updateFeatureFlag(flagId: FeatureFlagId, enabled: boolean) {
    if (!org) return;
    const previousFlags = org.featureFlags;
    const nextFlags = setFeatureFlagPatch(previousFlags, flagId, enabled);
    patchCachedViewerOrg(store, { featureFlags: nextFlags });
    try {
      await setFeatureFlag({ flagId, enabled });
    } catch {
      patchCachedViewerOrg(store, { featureFlags: previousFlags });
      toast.error("Failed to update beta features");
    }
  }

  async function handleRestartOnboarding() {
    if (restarting || resetting) return;
    setRestarting(true);
    try {
      await restartOnboarding();
      toast.success("Restarting onboarding...");
      router.replace("/onboarding");
    } catch {
      toast.error("Failed to restart onboarding");
      setRestarting(false);
    }
  }

  async function handleReset() {
    if (resetting || restarting) return;
    setResetting(true);
    try {
      await resetAccount();
    } catch {
      toast.error("Failed to reset account");
      setResetting(false);
      return;
    }
    setShowResetDialog(false);
    toast.success("Account reset successfully");
    router.replace("/onboarding");
  }

  useEffect(() => {
    setRightPanel(
      <SettingsDrawer
        open={showResetDialog}
        onOpenChange={setShowResetDialog}
        title="Reset organization"
        footer={
          <>
            <PillButton
              variant="secondary"
              onClick={() => setShowResetDialog(false)}
              disabled={resetting}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={handleReset}
              disabled={resetting || restarting}
            >
              {resetting ? "Resetting…" : "Yes, reset everything"}
            </PillButton>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" />
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            This will permanently delete all policies (including stored files),
            emails, connections, and conversations for your organization. This
            action cannot be undone.
          </p>
        </div>
      </SettingsDrawer>,
    );
    return () => setRightPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restarting, resetting, showResetDialog]);

  return (
    <div className="w-full space-y-4">
      {flags.length ? (
        <div className="space-y-3">
          {flags.map((flag) => (
            <FeatureFlagToggleRow
              key={flag.id}
              flag={flag}
              enabled={isFeatureEnabled(org, flag.id)}
              onChange={(enabled) => void updateFeatureFlag(flag.id, enabled)}
            />
          ))}
        </div>
      ) : null}

      <OperationalPanel>
        <OperationalPanelHeader title="Onboarding" className="px-5 py-3.5" />
        <OperationalPanelBody className="px-5 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                Re-run Setup
              </p>
              <p className={`mt-0.5 text-muted-foreground ${typeStyle("caption.default")}`}>
                Walk through the onboarding steps again. Your existing data will
                not be affected.
              </p>
            </div>
            <PillButton
              variant="secondary"
              onClick={() => void handleRestartOnboarding()}
              disabled={restarting || resetting}
            >
              {restarting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              {restarting ? "Restarting…" : "Re-run"}
            </PillButton>
          </div>
        </OperationalPanelBody>
      </OperationalPanel>

      {viewer?.isAdmin ? (
        <div className="rounded-lg border border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/30">
          <div className="border-b border-red-200 px-5 py-3.5 dark:border-red-900/50">
            <h2 className={`text-red-900 dark:text-red-400 ${typeStyle("heading.micro")}`}>
              Danger Zone
            </h2>
          </div>
          <div className="px-5 py-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Reset Organization
                </p>
                <p className={`mt-0.5 text-muted-foreground ${typeStyle("caption.default")}`}>
                  Delete all policies, emails, connections, and conversations.
                  This cannot be undone.
                </p>
              </div>
              <PillButton
                variant="destructive"
                disabled={resetting || restarting}
                onClick={() => setShowResetDialog(true)}
              >
                Reset
              </PillButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
