"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  AuthCard,
  AuthMinimalShell,
  BrandWordmark,
} from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export default function BrokerOnboardingPage() {
  const router = useRouter();
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function continueToProfile() {
    setBusy(true);
    setError("");
    try {
      await completeOnboarding();
      router.replace("/broker");
    } catch (cause) {
      setError(
        getUserFacingErrorMessage(cause, "Could not open the provider workspace"),
      );
      setBusy(false);
    }
  }

  return (
    <AuthMinimalShell>
      <AuthCard
        title="Welcome to Spot"
        subtitle="Review your provider profile and team after you continue."
        logo={<BrandWordmark />}
      >
        <div className="space-y-4">
          {error ? (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <PillButton
            type="button"
            disabled={busy}
            onClick={() => void continueToProfile()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Continue to provider profile
          </PillButton>
        </div>
      </AuthCard>
    </AuthMinimalShell>
  );
}
