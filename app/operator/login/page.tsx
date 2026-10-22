"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { OperatorSecondFactor } from "@/components/operator/operator-second-factor";
import { OtpField } from "@/components/ui/otp-field";
import { PillButton } from "@/components/ui/pill-button";
import { completeOtpSignIn } from "@/lib/auth-sign-in";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { ConvexError } from "convex/values";
import { ArrowRight, Loader2 } from "lucide-react";
import { typeStyle } from "@/lib/typography";

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("not authorized")) return "This email is not authorized for operator access.";
  if (lower.includes("customer accounts")) return "This email is already associated with a customer account.";
  if (lower.includes("could not verify code") || lower.includes("invalid code")) return "That code didn't work.";
  if (lower.includes("expired")) return "This code has expired.";
  if (lower.includes("too many") || lower.includes("rate limit")) {
    const seconds = lower.match(/try again in (\d+) seconds/)?.[1];
    return seconds
      ? `Too many code requests. Try again in ${seconds} seconds.`
      : "Too many code requests. Please wait a moment and try again.";
  }
  return "Could not sign in to the operator console.";
}

// Convex redacts thrown messages to "Server Error"; ConvexError data survives.
function errorText(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") return err.data;
  return getUserFacingErrorMessage(err, "");
}

export default function OperatorLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const bootstrap = useMutation(api.operator.bootstrapViewer);
  const [step, setStep] = useState<"email" | "code" | "bootstrapped" | "second-factor">("email");
  // Fixed when the challenge opens, so finishing enrollment keeps the
  // recovery codes on screen after the session becomes verified.
  const [enrolled, setEnrolled] = useState(false);
  const secondFactor = useQuery(
    api.operatorSecondFactor.status,
    step === "bootstrapped" ? {} : "skip",
  );
  if (step === "bootstrapped" && secondFactor !== undefined && !secondFactor?.verified) {
    setEnrolled(!!secondFactor?.enrolled);
    setStep("second-factor");
  }
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bootstrappingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || bootstrappingRef.current) return;
    bootstrappingRef.current = true;
    bootstrap({})
      .then(() => setStep((current) => (current === "second-factor" ? current : "bootstrapped")))
      .catch(async (err: unknown) => {
        setError(friendlyError(errorText(err)));
        await signOut();
        setStep("email");
      })
      .finally(() => {
        bootstrappingRef.current = false;
      });
  }, [bootstrap, isAuthenticated, router, signOut]);

  // Only an already-verified session skips the challenge.
  useEffect(() => {
    if (step === "bootstrapped" && secondFactor?.verified) router.replace("/operator");
  }, [router, secondFactor, step]);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await signIn("resend-otp", { email: normalizedEmail });
      setEmail(normalizedEmail);
      setStep("code");
    } catch (err) {
      setError(friendlyError(errorText(err)));
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await completeOtpSignIn(email, code);
      window.location.reload();
    } catch (err) {
      setError(friendlyError(errorText(err)));
      setLoading(false);
    }
  }

  return (
    <AuthMinimalShell>
      <AuthCard
        title={step === "second-factor" ? "Two-factor authentication" : "Operator login"}
        subtitle="For Tools for Enlightenment team members."
        logo={<BrandWordmark />}
      >
        {step === "bootstrapped" ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : step === "second-factor" ? (
          <div className="space-y-4">
            <OperatorSecondFactor enrolled={enrolled} onDone={() => router.replace("/operator")} />
            <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
              Wrong account?{" "}
              <button
                type="button"
                onClick={() => {
                  void signOut().then(() => setStep("email"));
                }}
                className={`text-foreground hover:opacity-70 ${typeStyle("control.buttonCompact")}`}
              >
                Sign out
              </button>
            </p>
          </div>
        ) : step === "email" ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}>
                Operator email
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@claritylabs.inc"
                required
                autoFocus
                className={`h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-input ${typeStyle("control.input")}`}
              />
            </div>
            {error ? <p className={`text-muted-foreground ${typeStyle("body.default")}`}>{error}</p> : null}
            <PillButton type="submit" disabled={loading || !email} className="justify-center">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Sending code..." : "Continue"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
            <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
              Looking for Spot?{" "}
              <Link href="/login" className={`text-foreground hover:opacity-70 ${typeStyle("control.buttonCompact")}`}>
                Go to the main login
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4">
            <div>
              <label htmlFor="operator-verification-code" className={`mb-2 block text-muted-foreground ${typeStyle("label.field")}`}>
                Verification Code
              </label>
              <OtpField id="operator-verification-code" value={code} onValueChange={setCode} autoFocus required />
              <p className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}>
                We sent a 6-digit code to <span className={`text-foreground ${typeStyle("body.medium")}`}>{email}</span>
              </p>
            </div>
            {error ? <p className={`text-muted-foreground ${typeStyle("body.default")}`}>{error}</p> : null}
            <PillButton type="submit" disabled={loading || code.length < 6} className="justify-center">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Verifying..." : "Verify and continue"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
            <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
              Not an operator?{" "}
              <Link href="/login" className={`text-foreground hover:opacity-70 ${typeStyle("control.buttonCompact")}`}>
                Go to the main login
              </Link>
            </p>
          </form>
        )}
      </AuthCard>
    </AuthMinimalShell>
  );
}
