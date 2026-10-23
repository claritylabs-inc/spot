"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SidebarMenuItem } from "@/components/app-sidebar/nav-item";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

/**
 * The current operator's test mode: emails they cause go to them and only test
 * providers are eligible for their outreach. Clients are never affected.
 */
export function OperatorTestModeAction({ collapsed }: { collapsed: boolean }) {
  const testMode = useQuery(api.testMode.get, {});
  const setTestMode = useMutation(api.testMode.set);
  const [busy, setBusy] = useState(false);
  const enabled = Boolean(testMode);

  async function toggle() {
    setBusy(true);
    try {
      await setTestMode({ enabled: !enabled });
      toast.success(
        enabled
          ? "Test mode off: your emails go to real recipients"
          : "Test mode on: emails you send go to you",
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not change test mode"),
      );
    } finally {
      setBusy(false);
    }
  }

  const label = testMode
    ? `Test mode on · ${testMode.recipientEmail}`
    : "Test mode";
  const icon = busy ? Loader2 : FlaskConical;
  const Icon = icon;

  if (collapsed) {
    return (
      <SidebarMenuItem
        label={label}
        icon={icon}
        collapsed
        active={enabled}
        disabled={testMode === undefined || busy}
        onClick={() => void toggle()}
      />
    );
  }

  return (
    <PillButton
      type="button"
      size="compact"
      variant={enabled ? "primary" : "secondary"}
      label={label}
      aria-pressed={enabled}
      disabled={testMode === undefined || busy}
      className="w-full"
      onClick={() => void toggle()}
    >
      <Icon className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
      <span className="truncate">{label}</span>
    </PillButton>
  );
}
