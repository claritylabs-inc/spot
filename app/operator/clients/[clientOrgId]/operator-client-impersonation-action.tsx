"use client";

import { useState } from "react";
import { Loader2, LogOut, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import { useStartOperatorImpersonation } from "@/hooks/use-start-operator-impersonation";
import { useStopOperatorImpersonation } from "@/hooks/use-stop-operator-impersonation";
import type { OperatorImpersonationTarget } from "@/lib/operator-navigation";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type OperatorClientImpersonationActionProps = {
  clientOrgId: Id<"organizations"> | string;
  activeImpersonation: OperatorImpersonationTarget | null | undefined;
  disabled?: boolean;
  collapsed: boolean;
};

export function OperatorClientImpersonationAction({
  clientOrgId,
  activeImpersonation,
  disabled = false,
  collapsed,
}: OperatorClientImpersonationActionProps) {
  const { startImpersonation, status: startStatus } =
    useStartOperatorImpersonation();
  const stopOperatorImpersonation =
    useStopOperatorImpersonation(activeImpersonation);
  const [busy, setBusy] = useState(false);
  const isImpersonating = Boolean(activeImpersonation);

  async function toggleImpersonation() {
    setBusy(true);
    try {
      if (isImpersonating) {
        await stopOperatorImpersonation();
        toast.success("Impersonation stopped");
        return;
      }

      await startImpersonation({
        targetOrgId: clientOrgId as Id<"organizations">,
        targetRole: "admin",
        destination: "/policies",
        failureMessage: "Failed to impersonate client",
      });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          isImpersonating
            ? "Failed to stop impersonating"
            : "Failed to impersonate client",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? isImpersonating
      ? "Stopping…"
      : "Starting…"
    : isImpersonating
      ? "Stop impersonating"
      : startStatus === "retry"
        ? "Retry impersonation"
        : "Impersonate";
  const icon = busy ? Loader2 : isImpersonating ? LogOut : UserRoundCog;
  const Icon = icon;

  if (collapsed) {
    return (
      <PillButton
        type="button"
        size="compact"
        variant="secondary"
        iconOnly
        label={label}
        disabled={disabled || busy}
        onClick={() => void toggleImpersonation()}
      >
        <Icon className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
      </PillButton>
    );
  }

  return (
    <PillButton
      type="button"
      size="compact"
      variant="secondary"
      label={label}
      disabled={disabled || busy}
      className="w-full"
      onClick={() => void toggleImpersonation()}
    >
      <Icon className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
      {label}
    </PillButton>
  );
}
