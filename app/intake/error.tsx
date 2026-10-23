"use client";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { IntakeFrame } from "@/components/insurance-intake/frame";
import { typeStyle } from "@/lib/typography";
import { PillButton } from "@/components/ui/pill-button";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
export default function IntakeError({ reset }: { reset: () => void }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const pathname = usePathname();
  const params = useSearchParams();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const returnPath = `${pathname}${params.size ? `?${params.toString()}` : ""}`;
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;
  async function switchAccount() {
    setSwitching(true);
    setError("");
    try {
      await signOut();
      window.location.assign(loginHref);
    } catch (cause) {
      setError(
        getUserFacingErrorMessage(
          cause,
          "Could not sign out. Please try again.",
        ),
      );
      setSwitching(false);
    }
  }
  if (isLoading)
    return (
      <IntakeFrame showSteps={false}>
        <p role="status">Checking your account…</p>
      </IntakeFrame>
    );
  return (
    <IntakeFrame
      showSteps={false}
      footer={
        <>
          <div className="flex flex-wrap items-center gap-3">
            <PillButton href="/signup" variant="ghost" size="large">
              Find my drafts
            </PillButton>
            <PillButton
              onClick={reset}
              variant="secondary"
              size="large"
              disabled={switching}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Try again
            </PillButton>
          </div>
          {isAuthenticated ? (
            <PillButton
              onClick={() => void switchAccount()}
              size="large"
              disabled={switching}
            >
              {switching ? "Signing out…" : "Switch account"}
              <ArrowRight aria-hidden="true" className="size-4" />
            </PillButton>
          ) : (
            <PillButton href={loginHref} size="large">
              Sign in
              <ArrowRight aria-hidden="true" className="size-4" />
            </PillButton>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <h1 className={`text-wrap-pretty ${typeStyle("heading.page")}`}>
          {isAuthenticated
            ? "We couldn’t open this application"
            : "Sign in to open this application"}
        </h1>
        <p
          className={`text-muted-foreground text-wrap-pretty ${typeStyle("body.root")}`}
        >
          {isAuthenticated
            ? "If this application belongs to another account, switch accounts to open it. Your saved progress remains in the account that started it."
            : "Use the account that received this form or started the application. Your saved progress will be there when you sign in."}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
    </IntakeFrame>
  );
}
