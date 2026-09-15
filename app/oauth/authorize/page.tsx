"use client";

import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import { useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AuthCard, AuthShell } from "@/components/auth-shell";
import { OtpField } from "@/components/ui/otp-field";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, ArrowLeft, ArrowRight, X } from "lucide-react";
import { completeOtpSignIn } from "@/lib/otp-auth";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("could not verify code") || lower.includes("invalid code"))
    return "That code didn't work. Please double-check and try again.";
  if (lower.includes("expired"))
    return "This code has expired. Please request a new one.";
  if (lower.includes("too many") || lower.includes("rate limit"))
    return "Too many attempts. Please wait a moment and try again.";
  return "Something went wrong. Please try again.";
}

function authorizationServerIssuer(resource?: string) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  try {
    return configuredSiteUrl
      ? new URL(configuredSiteUrl).origin
      : resource
        ? new URL(resource).origin
        : undefined;
  } catch {
    return undefined;
  }
}

export default function OAuthAuthorizePage() {
  const searchParams = useSearchParams();
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();

  // Parse OAuth params
  const clientId = searchParams.get("client_id") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const codeChallenge = searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "";
  const state = searchParams.get("state") ?? "";
  const responseType = searchParams.get("response_type") ?? "";
  const scope = searchParams.get("scope") ?? undefined;
  const resource = searchParams.get("resource") ?? undefined;

  // Validate required params
  const paramsValid =
    responseType === "code" &&
    clientId &&
    redirectUri &&
    codeChallenge &&
    codeChallengeMethod === "S256";

  // Login state
  const [loginStep, setLoginStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  // Consent state
  const [authorizing, setAuthorizing] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState("");

  // Load client info (only when authenticated)
  const clientInfo = useCachedQuery(
    "oauth.getClientInfo",
    api.oauth.getClientInfo,
    isAuthenticated && clientId && redirectUri
      ? { clientId, redirectUri }
      : "skip",
  );
  const createAuthCode = useMutation(api.oauth.createAuthorizationCode);

  function redirectWithError(errorCode: string) {
    try {
      const url = new URL(redirectUri);
      url.searchParams.set("error", errorCode);
      if (state) url.searchParams.set("state", state);
      const issuer = authorizationServerIssuer(resource);
      if (issuer) url.searchParams.set("iss", issuer);
      window.location.assign(url.toString());
    } catch {
      // Invalid redirect URI — just show error
      setError(`Authorization failed: ${errorCode}`);
    }
  }

  // Login handlers
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSendingCode(true);
    setError("");
    try {
      await signIn("resend-otp", { email });
      setLoginStep("code");
    } catch (err: unknown) {
      setError(friendlyError(getUserFacingErrorMessage(err, "")));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setError("");
    try {
      await completeOtpSignIn(email, code);
      window.location.reload();
    } catch (err: unknown) {
      setError(friendlyError(getUserFacingErrorMessage(err, "")));
      setVerifying(false);
    }
  }

  // Consent handlers
  async function handleAllow() {
    setAuthorizing(true);
    setError("");
    try {
      const authCode = await createAuthCode({
        clientId,
        redirectUri,
        codeChallenge,
        scope,
        resource,
      });
      const url = new URL(redirectUri);
      url.searchParams.set("code", authCode);
      if (state) url.searchParams.set("state", state);
      const issuer = authorizationServerIssuer(resource);
      if (issuer) url.searchParams.set("iss", issuer);
      const target = url.toString();
      setRedirectUrl(target);
      setRedirecting(true);
      window.location.assign(target);
    } catch (err: unknown) {
      setError(getUserFacingErrorMessage(err, "Failed to authorize"));
      setAuthorizing(false);
    }
  }

  function handleDeny() {
    redirectWithError("access_denied");
  }

  // Invalid params
  if (!paramsValid) {
    return (
      <AuthShell>
        <AuthCard
          title="Invalid request"
          subtitle="This authorization request could not be completed."
        >
          <div className="text-center">
            <X className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              This authorization request is missing required parameters.
            </p>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  // Loading auth state
  if (authLoading) {
    return (
      <AuthShell>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </AuthShell>
    );
  }

  // Not authenticated — show login
  if (!isAuthenticated) {
    return (
      <AuthShell>
        <AuthCard
          title="Authorize app"
          subtitle="Sign in to connect your Spot account."
        >
          {loginStep === "email" ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label
                  className={`text-muted-foreground block mb-1.5 ${typeStyle("label.field")}`}
                >
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoFocus
                  className={`h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-input transition-colors ${typeStyle("control.input")}`}
                />
              </div>
              {error && (
                <p
                  className={`px-1 py-1 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {error}
                </p>
              )}
              <PillButton
                type="submit"
                disabled={sendingCode || !email}
                className="w-full"
                size="large"
              >
                {sendingCode ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {sendingCode ? "Sending code..." : "Send verification code"}
                {!sendingCode ? <ArrowRight className="h-4 w-4" /> : null}
              </PillButton>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="oauth-verification-code"
                  className={`text-muted-foreground block mb-2 ${typeStyle("label.field")}`}
                >
                  Verification Code
                </label>
                <OtpField
                  id="oauth-verification-code"
                  value={code}
                  onValueChange={setCode}
                  autoFocus
                  required
                />
                <p
                  className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  We sent a 6-digit code to{" "}
                  <span
                    className={`text-foreground ${typeStyle("body.medium")}`}
                  >
                    {email}
                  </span>
                </p>
              </div>
              {error && (
                <p
                  className={`px-1 py-1 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {error}
                </p>
              )}
              <div className="flex flex-col gap-3 pt-1">
                <PillButton
                  type="submit"
                  disabled={verifying || code.length < 6}
                  className="w-full"
                  size="large"
                >
                  {verifying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {verifying ? "Verifying..." : "Verify and continue"}
                  {!verifying ? <ArrowRight className="h-4 w-4" /> : null}
                </PillButton>
                <PillButton
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setLoginStep("email");
                    setCode("");
                    setError("");
                  }}
                  className="w-full"
                  size="large"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Use a different email
                </PillButton>
              </div>
            </form>
          )}
        </AuthCard>
      </AuthShell>
    );
  }

  // Authenticated — show consent screen
  const cardTitle = redirecting ? "Connected" : "Authorize app";
  const cardSubtitle =
    redirecting && clientInfo
      ? `Redirecting you back to ${clientInfo.clientName}...`
      : clientInfo
        ? clientInfo.principalKind === "operator"
          ? `${clientInfo.clientName} wants secure access to the internal Spot operator.`
          : `${clientInfo.clientName} wants to access your Spot account.`
        : "Review this request before continuing.";

  return (
    <AuthShell>
      <AuthCard title={cardTitle} subtitle={cardSubtitle}>
        {clientInfo === undefined ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : clientInfo === null ? (
          <div className="text-center py-4">
            <X className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h2
              className={`mb-1 text-foreground ${typeStyle("heading.section")}`}
            >
              Unknown application
            </h2>
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              This application is not registered or the redirect URI
              doesn&apos;t match.
            </p>
          </div>
        ) : redirecting ? (
          <div className="space-y-4">
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              If you&apos;re not redirected automatically,{" "}
              <a
                href={redirectUrl}
                className={`text-foreground hover:underline ${typeStyle("control.button")}`}
              >
                click here
              </a>
              . You can also close this window.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div
              className={`text-muted-foreground ${typeStyle("body.default")}`}
            >
              <p className={`mb-2 text-foreground ${typeStyle("body.medium")}`}>
                This will allow the app to:
              </p>
              <ul
                className={`space-y-1.5 text-muted-foreground ${typeStyle("body.default")}`}
              >
                {clientInfo.principalKind === "operator" ? (
                  <>
                    <li className="flex items-start gap-2">
                      <span className="text-foreground/30 mt-0.5">
                        &#x2022;
                      </span>
                      Inspect organizations, policies, extraction, routing, and
                      channel health
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-foreground/30 mt-0.5">
                        &#x2022;
                      </span>
                      Run durable operator tasks and continue them across
                      environments
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-foreground/30 mt-0.5">
                        &#x2022;
                      </span>
                      Propose protected changes for your explicit confirmation
                    </li>
                    {resource ? (
                      <li className="flex items-start gap-2">
                        <span className="text-foreground/30 mt-0.5">
                          &#x2022;
                        </span>
                        Use credentials bound only to {resource}
                      </li>
                    ) : null}
                  </>
                ) : (
                  <>
                    <li className="flex items-start gap-2">
                      <span className="text-foreground/30 mt-0.5">
                        &#x2022;
                      </span>
                      Read your policies
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-foreground/30 mt-0.5">
                        &#x2022;
                      </span>
                      Access conversation threads
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-foreground/30 mt-0.5">
                        &#x2022;
                      </span>
                      Ask questions via Spot AI
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-foreground/30 mt-0.5">
                        &#x2022;
                      </span>
                      {(scope ?? "").split(/\s+/).includes("write")
                        ? "Read and update your company wiki"
                        : "Read your company wiki"}
                    </li>
                  </>
                )}
                {(scope ?? "").split(" ").includes("write") && (
                  <li className="flex items-start gap-2">
                    <span className="text-foreground/30 mt-0.5">&#x2022;</span>
                    Modify your insurance data (write access)
                  </li>
                )}
              </ul>
              {scope && (
                <p
                  className={`mt-2 text-muted-foreground/60 ${typeStyle("caption.default")}`}
                >
                  Requested scopes: {scope}
                </p>
              )}
            </div>

            {error && (
              <p
                className={`px-1 py-1 text-muted-foreground ${typeStyle("body.default")}`}
              >
                {error}
              </p>
            )}

            <div className="flex flex-col gap-3">
              <PillButton
                type="button"
                onClick={handleAllow}
                disabled={authorizing}
                className="w-full"
                size="large"
              >
                {authorizing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {authorizing ? "Authorizing..." : "Allow"}
              </PillButton>
              <PillButton
                type="button"
                variant="secondary"
                onClick={handleDeny}
                disabled={authorizing}
                className="w-full"
                size="large"
              >
                Deny
              </PillButton>
            </div>
          </div>
        )}
      </AuthCard>
    </AuthShell>
  );
}
