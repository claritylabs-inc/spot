"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { OtpField } from "@/components/ui/otp-field";
import { PillButton } from "@/components/ui/pill-button";
import { completeOtpSignIn } from "@/lib/otp-auth";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { ArrowRight, Loader2 } from "lucide-react";
import { typeStyle } from "@/lib/typography";
import {
  agentSubmitEvent,
  respondToAgent,
  useWebMcpToolActivated,
  webMcpError,
  webMcpFormAttributes,
  webMcpParamAttributes,
  type WebMcpResult,
} from "@/lib/webmcp/runtime";

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("could not verify code") || lower.includes("invalid code")) {
    return "That code didn't work. Please double-check and try again.";
  }
  if (lower.includes("expired")) return "This code has expired. Please request a new one.";
  if (lower.includes("too many") || lower.includes("rate limit")) {
    const seconds = lower.match(/try again in (\d+) seconds/)?.[1];
    return seconds
      ? `Too many attempts. Please wait ${seconds} seconds and try again.`
      : "Too many attempts. Please wait a moment and try again.";
  }
  if (lower.includes("failed to send") || lower.includes("failed to deliver")) {
    return "We couldn't send the verification email. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

export function AuthEntryPage({
  mode,
  role = "client",
}: {
  mode: "login" | "signup";
  role?: "broker" | "client";
}) {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isBroker = role === "broker";
  const nextPath = searchParams.get("next");
  const isSignup = mode === "signup";
  const defaultPostLogin = isSignup
    ? isBroker
      ? "/onboarding?type=broker"
      : "/onboarding"
    : "/";
  const requestCodeTool = isSignup ? "request_signup_code" : "request_login_code";
  const verifyCodeTool = isSignup ? "verify_signup_code" : "verify_login_code";
  const postLoginPath =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : defaultPostLogin;

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated) router.replace(postLoginPath);
  }, [isAuthenticated, postLoginPath, router]);

  useWebMcpToolActivated(requestCodeTool, () => {
    const input = document.querySelector<HTMLInputElement>(
      `form[toolname="${requestCodeTool}"] input[name="email"]`,
    );
    if (input) setEmail(input.value);
  });

  if (isAuthenticated) return null;

  async function requestCode(nextEmail: string): Promise<WebMcpResult> {
    setLoading(true);
    setError("");
    try {
      await signIn("resend-otp", { email: nextEmail });
      setEmail(nextEmail);
      setStep("code");
      return {
        status: "code_sent",
        email: nextEmail,
        message: `Spot emailed a 6-digit verification code to ${nextEmail}. It expires in 15 minutes. Ask the account owner for the code (or read it from a mailbox you are authorized to access); never guess it.`,
        next_tool: verifyCodeTool,
      };
    } catch (err: unknown) {
      const message = friendlyError(getUserFacingErrorMessage(err, ""));
      setError(message);
      return webMcpError(message, { next_tool: requestCodeTool });
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(nextCode: string): Promise<WebMcpResult> {
    setLoading(true);
    setError("");
    try {
      await completeOtpSignIn(email, nextCode);
      return {
        status: "signed_in",
        email,
        next_url: postLoginPath,
        message: isSignup
          ? "Verified. Spot is opening account setup; new accounts continue with submit_user_profile."
          : "Verified. Spot is opening the workspace.",
        ...(isSignup && !isBroker ? { next_tool: "submit_user_profile" } : {}),
      };
    } catch (err: unknown) {
      const message = friendlyError(getUserFacingErrorMessage(err, ""));
      setError(message);
      setLoading(false);
      return webMcpError(message, { next_tool: verifyCodeTool });
    }
  }

  function handleEmailSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const agentEvent = agentSubmitEvent(e);
    const submitted = agentEvent
      ? String(new FormData(e.currentTarget).get("email") ?? "").trim()
      : email;
    const result = submitted
      ? requestCode(submitted)
      : Promise.resolve(webMcpError("Provide a work email address."));
    respondToAgent(agentEvent, result);
  }

  function handleCodeSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const agentEvent = agentSubmitEvent(e);
    const submitted = agentEvent
      ? String(new FormData(e.currentTarget).get("code") ?? "").replace(/\D/g, "")
      : code;
    if (agentEvent) setCode(submitted);
    const result =
      submitted.length === 6
        ? verifyCode(submitted)
        : Promise.resolve(
            webMcpError("The verification code must be exactly 6 digits.", {
              next_tool: verifyCodeTool,
            }),
          );
    respondToAgent(agentEvent, result);
    void result.then((outcome) => {
      if (outcome.status === "signed_in") window.location.assign(postLoginPath);
    });
  }

  const title = isSignup
    ? isBroker
      ? "Create your brokerage account"
      : "Create account"
    : "Log in";
  const subtitle = isSignup
    ? isBroker
      ? "Set up your brokerage on Spot."
      : "Use your work email to get started."
    : "Use your work email to continue.";
  const alternateHref = isSignup ? "/login" : "/signup";
  const alternateLabel = isSignup ? "Log in" : "Sign up";
  const alternateText = isSignup ? "Already have an account?" : "Need an account?";

  return (
    <AuthMinimalShell>
      <AuthCard
        title={title}
        subtitle={subtitle}
        logo={<BrandWordmark />}
      >
        {step === "email" ? (
          <form
            key={requestCodeTool}
            onSubmit={handleEmailSubmit}
            className="space-y-4"
            {...webMcpFormAttributes(requestCodeTool)}
          >
            <div>
              <label htmlFor="auth-email" className={`text-muted-foreground block mb-1.5 ${typeStyle("label.field")}`}>
                Email Address
              </label>
              <input
                id="auth-email"
                {...webMcpParamAttributes(requestCodeTool, "email")}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                autoFocus
                className={`h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-input transition-colors ${typeStyle("control.input")}`}
              />
            </div>

            {error && <p className={`px-1 py-1 text-muted-foreground ${typeStyle("body.default")}`}>{error}</p>}

            <PillButton type="submit" disabled={loading || !email} className="w-full justify-center shadow-none sm:w-auto">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Sending code..." : "Continue"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>

            <div className={`pt-1 text-muted-foreground ${typeStyle("caption.default")}`}>
              <span>{alternateText} </span>
              <button
                type="button"
                onClick={() => router.replace(alternateHref)}
                className={`text-foreground transition hover:opacity-70 ${typeStyle("control.buttonCompact")}`}
              >
                {alternateLabel}
              </button>
            </div>
          </form>
        ) : (
          <form
            key={verifyCodeTool}
            onSubmit={handleCodeSubmit}
            className="space-y-4"
            {...webMcpFormAttributes(verifyCodeTool)}
          >
            <div>
              <label htmlFor="auth-verification-code" className={`text-muted-foreground block mb-2 ${typeStyle("label.field")}`}>
                Verification Code
              </label>
              <OtpField
                id="auth-verification-code"
                name="code"
                paramDescription={webMcpParamAttributes(verifyCodeTool, "code").toolparamdescription}
                value={code}
                onValueChange={setCode}
                autoFocus
                required
              />
              <p className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}>
                We sent a 6-digit code to <span className={`text-foreground ${typeStyle("body.medium")}`}>{email}</span>
              </p>
            </div>

            {error && <p className={`px-1 py-1 text-muted-foreground ${typeStyle("body.default")}`}>{error}</p>}

            <div className="flex flex-col items-start gap-5 pt-6">
              <PillButton
                type="submit"
                disabled={loading || code.length < 6}
                className="w-full justify-center shadow-none sm:w-auto"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? "Verifying..." : "Verify and continue"}
                {!loading ? <ArrowRight className="h-4 w-4" /> : null}
              </PillButton>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError("");
                }}
                className={`self-center text-muted-foreground transition-colors hover:text-foreground sm:self-start ${typeStyle("control.button")}`}
              >
                Use a different email
              </button>
            </div>
          </form>
        )}
      </AuthCard>
    </AuthMinimalShell>
  );
}
