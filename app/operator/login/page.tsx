"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { OtpField } from "@/components/ui/otp-field";
import { PillButton } from "@/components/ui/pill-button";
import { completeOtpSignIn } from "@/lib/otp-auth";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { ArrowRight, Loader2 } from "lucide-react";
import { typeStyle } from "@/lib/typography";

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("not authorized")) return "This email is not authorized for operator access.";
  if (lower.includes("customer accounts")) return "This email is already associated with a customer account.";
  if (lower.includes("could not verify code") || lower.includes("invalid code")) return "That code didn't work.";
  if (lower.includes("expired")) return "This code has expired.";
  return "Could not sign in to the operator console.";
}

export default function OperatorLoginPage() {
  const router = useRouter();
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bootstrap = useMutation((api as any).operator.bootstrapViewer);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bootstrappingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || bootstrappingRef.current) return;
    bootstrappingRef.current = true;
    bootstrap({})
      .then(() => router.replace("/operator"))
      .catch(async (err: unknown) => {
        setError(friendlyError(getUserFacingErrorMessage(err, "")));
        await signOut();
        setStep("email");
      })
      .finally(() => {
        bootstrappingRef.current = false;
      });
  }, [bootstrap, isAuthenticated, router, signOut]);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn("resend-otp", { email });
      setStep("code");
    } catch (err) {
      setError(friendlyError(getUserFacingErrorMessage(err, "")));
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
      setError(friendlyError(getUserFacingErrorMessage(err, "")));
      setLoading(false);
    }
  }

  return (
    <AuthMinimalShell>
      <AuthCard
        title="Operator login"
        subtitle="For Clarity Labs team members."
        logo={<BrandWordmark />}
      >
        {step === "email" ? (
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
            <PillButton type="submit" disabled={loading || !email} className={`justify-center ${typeStyle("control.button")}`}>
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
            <PillButton type="submit" disabled={loading || code.length < 6} className={`justify-center ${typeStyle("control.button")}`}>
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
