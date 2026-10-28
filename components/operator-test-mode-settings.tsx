"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { api } from "@/convex/_generated/api";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

/**
 * The current operator's test mode: emails they cause go to them and only test
 * providers are eligible for their outreach. Clients are never affected.
 */
export function OperatorTestModeSettings({ disabled }: { disabled?: boolean }) {
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

  return (
    <OperationalPanel className="mt-4">
      <OperationalPanelHeader title="Test mode" />
      <OperationalPanelBody>
        <div className="flex items-start justify-between gap-4">
          <p
            className={`min-w-0 text-muted-foreground ${typeStyle("body.default")}`}
          >
            {testMode
              ? `On: emails you send go to ${testMode.recipientEmail}, and your outreach only reaches test providers.`
              : "Send emails to yourself instead of real recipients, and limit your outreach to test providers. Clients are never affected."}
          </p>
          <SettingsSwitch
            label="Test mode"
            checked={enabled}
            disabled={disabled || testMode === undefined || busy}
            onCheckedChange={() => void toggle()}
          />
        </div>
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
