"use client";
import dayjs from "dayjs";
import { ActionSurfaceButton } from "@claritylabs-inc/ui/components/action-surface";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@claritylabs-inc/ui/components/card";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { useEffect, useRef, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { IntakeFrame } from "./frame";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { OtpField } from "@/components/ui/otp-field";
import { PhoneInput } from "@claritylabs-inc/ui/components/marketing/phone-input";
import { Input } from "@claritylabs-inc/ui/components/input";
import { PillButton } from "@/components/ui/pill-button";
import { completeOtpSignIn } from "@/lib/otp-auth";
import { AuthEntryPage } from "@/components/auth-entry-page";

export function IntakeSignup() {
  const params = useSearchParams();
  if (params.get("next") || params.get("source") === "vendor-invite")
    return <AuthEntryPage mode="signup" role="client" />;
  return <SignupForm />;
}
function SignupForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [token, setToken] = useState(params.get("intake") ?? "");
  const handoff = useQuery(
    api.requestIntake.inspectHandoff,
    token ? { token } : "skip",
  );
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const org = useQuery(
    api.orgs.viewerOrg,
    isAuthenticated && viewer?.emailVerificationTime && !viewer.intakeRestricted
      ? {}
      : "skip",
  );
  const drafts = useQuery(
    api.requestIntake.drafts,
    isAuthenticated ? {} : "skip",
  );
  const submitted = useQuery(
    api.requestIntake.submitted,
    isAuthenticated ? {} : "skip",
  );
  const claim = useMutation(api.requestIntake.claimHandoff);
  const start = useMutation(api.requestIntake.start);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoverable, setRecoverable] = useState<string[]>([]);
  useEffect(() => {
    if (!isAuthenticated) return;
    queueMicrotask(() => {
      try {
        setRecoverable(
          Object.keys(localStorage)
            .filter((key) => key.startsWith("spot:intake-proof:"))
            .map((key) => key.slice("spot:intake-proof:".length)),
        );
      } catch {
        /* Recovery is unavailable on this browser. */
      }
    });
  }, [isAuthenticated]);
  const advancing = useRef(false);
  const handoffKey = useRef("");
  useEffect(() => {
    if (handoff) {
      queueMicrotask(() => {
        setName(handoff.name);
        setEmail(handoff.email);
        setPhone(handoff.phone);
      });
    }
  }, [handoff]);
  useEffect(() => {
    if (
      !isAuthenticated ||
      !token ||
      handoff === undefined ||
      advancing.current
    )
      return;
    advancing.current = true;
    void claim({ token })
      .then((id) => router.replace(`/intake?request=${id}`))
      .catch((e) => {
        setError(
          getUserFacingErrorMessage(e, "Could not complete this action"),
        );
        advancing.current = false;
      });
  }, [isAuthenticated, token, handoff, claim, router]);
  const autoHandoff = useRef(false);
  useEffect(() => {
    if (
      isLoading ||
      isAuthenticated ||
      !token ||
      !handoff ||
      autoHandoff.current ||
      busy
    )
      return;
    autoHandoff.current = true;
    queueMicrotask(() => setBusy(true));
    void (
      handoff.existingAccount || handoff.claimed
        ? signIn("resend-otp", { email: handoff.email }).then(() =>
            setCodeSent(true),
          )
        : signIn("intake", { token })
    )
      .catch((e) =>
        setError(getUserFacingErrorMessage(e, "Could not continue")),
      )
      .finally(() => setBusy(false));
  }, [isLoading, isAuthenticated, token, handoff, busy, signIn]);
  async function continueSignup() {
    autoHandoff.current = true;
    setBusy(true);
    setError("");
    try {
      let activeToken = token;
      let existing = handoff?.existingAccount;
      if (!activeToken) {
        if (!handoffKey.current)
          handoffKey.current =
            crypto.randomUUID().replaceAll("-", "") +
            crypto.randomUUID().replaceAll("-", "");
        const response = await fetch("/api/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            phone,
            handoffKey: handoffKey.current,
          }),
        });
        const outcome = await response.json();
        if (!response.ok) throw new Error(outcome.error);
        activeToken = handoffKey.current;
        existing = outcome.existingAccount;
        setToken(activeToken);
        window.history.replaceState(
          null,
          "",
          `/signup?intake=${encodeURIComponent(activeToken)}`,
        );
      }
      if (existing || handoff?.claimed) {
        await signIn("resend-otp", { email });
        setCodeSent(true);
      } else await signIn("intake", { token: activeToken });
    } catch (e) {
      setError(getUserFacingErrorMessage(e, "Could not continue"));
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      await completeOtpSignIn(email, code);
      window.location.assign(`/signup?intake=${encodeURIComponent(token)}`);
    } catch (e) {
      setError(getUserFacingErrorMessage(e, "Could not verify"));
      setBusy(false);
    }
  }
  return (
    <IntakeFrame
      status={busy ? "Continuing…" : undefined}
      footer={
        isAuthenticated && !token ? (
          <>
            <span />
            <PillButton
              size="large"
              disabled={
                !selectedRequest ||
                busy ||
                (selectedRequest === "new" && org === undefined)
              }
              onClick={async () => {
                if (!selectedRequest) return;
                setBusy(true);
                try {
                  const id =
                    selectedRequest === "new"
                      ? await start({ orgId: org?.org?._id })
                      : selectedRequest;
                  router.push(`/intake?request=${id}`);
                } catch (e) {
                  setError(
                    getUserFacingErrorMessage(e, "Could not open request"),
                  );
                  setBusy(false);
                }
              }}
            >
              {busy ? "Continuing…" : "Continue"}
            </PillButton>
          </>
        ) : (
          <>
            <span />
            <PillButton
              size="large"
              type="submit"
              form="intake-contact"
              disabled={
                busy ||
                (!!token && handoff === undefined) ||
                (codeSent && code.length !== 6)
              }
            >
              {busy
                ? "Continuing…"
                : codeSent
                  ? "Confirm and continue"
                  : "Continue"}
            </PillButton>
          </>
        )
      }
    >
      <h1 className={`text-wrap-pretty ${typeStyle("heading.display")}`}>
        {codeSent
          ? "Can you confirm your work email?"
          : isAuthenticated && !token
            ? "Which request would you like to view?"
            : "What are your contact details?"}
      </h1>
      <div className="h-10" />
      {error && (
        <p
          role="alert"
          className={`mb-5 text-destructive ${typeStyle("body.root")}`}
        >
          {error}
        </p>
      )}
      {token && handoff === null && (
        <div className="mb-5 space-y-3">
          <p>
            This link expired. Start a new application or log in to resume a
            saved draft.
          </p>
          <PillButton
            variant="secondary"
            onClick={() => {
              setToken("");
              setError("");
              handoffKey.current = "";
              autoHandoff.current = false;
              window.history.replaceState(null, "", "/signup");
            }}
          >
            Start again
          </PillButton>
        </div>
      )}
      {isLoading ? (
        <p>Loading…</p>
      ) : isAuthenticated && !token ? (
        <div className="space-y-4">
          {[
            ...(submitted ?? []).map((request) => ({
              ...request,
              submitted: true,
            })),
            ...(drafts ?? []).map((request) => ({
              ...request,
              submitted: false,
            })),
            ...recoverable
              .filter(
                (id) =>
                  !drafts?.some((d) => d.id === id) &&
                  !submitted?.some((d) => d.id === id),
              )
              .map((id) => ({
                id,
                coverage: "",
                insuredName: "",
                effectiveDate: "",
                submitted: false,
              })),
          ].map((request) => (
            <ActionSurfaceButton
              key={request.id}
              type="button"
              aria-pressed={selectedRequest === request.id}
              aria-label={`${request.submitted ? "View" : "Resume"} ${request.coverage || "insurance request"} for ${request.insuredName || "business not provided"}${request.effectiveDate ? ` starting ${dayjs(request.effectiveDate).format("MMMM D, YYYY")}` : ""}`}
              onClick={() => setSelectedRequest(request.id)}
              className={`block w-full overflow-hidden p-0 ${selectedRequest === request.id ? "border-primary/60 bg-primary/5 ring-1 ring-primary/40" : ""}`}
            >
              <Card className="bg-transparent ring-0">
                <CardHeader>
                  <span className="flex items-start justify-between gap-4">
                    <CardTitle
                      className={`text-wrap-pretty ${typeStyle("body.root")}`}
                    >
                      {request.coverage || "Coverage not selected"}
                    </CardTitle>
                    <StatusTag tone="neutral">
                      {request.submitted ? "Submitted" : "Draft"}
                    </StatusTag>
                  </span>
                </CardHeader>
                <CardContent>
                  <OperationalLabelValueList className="[&>dl>div]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] [&_dd]:text-right">
                    <OperationalLabelValueRow
                      align="right"
                      label="Start date"
                      value={
                        request.effectiveDate
                          ? dayjs(request.effectiveDate).format("MMMM D, YYYY")
                          : "Not set"
                      }
                    />
                    <OperationalLabelValueRow
                      align="right"
                      label="For"
                      value={request.insuredName || "Not provided"}
                    />
                  </OperationalLabelValueList>
                </CardContent>
              </Card>
            </ActionSurfaceButton>
          ))}
          {!viewer?.intakeRestricted && (
            <ActionSurfaceButton
              type="button"
              aria-pressed={selectedRequest === "new"}
              onClick={() => setSelectedRequest("new")}
              className={`block w-full p-5 ${selectedRequest === "new" ? "border-primary/60 bg-primary/5 ring-1 ring-primary/40" : ""}`}
            >
              <span
                className={`flex items-center justify-between gap-4 ${typeStyle("body.root")}`}
              >
                New insurance request
              </span>
            </ActionSurfaceButton>
          )}
        </div>
      ) : (
        <form
          id="intake-contact"
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void (codeSent ? verify() : continueSignup());
          }}
        >
          {codeSent ? (
            <>
              <p className={typeStyle("body.root")}>
                Enter the code sent to {email} to access your existing account.
              </p>
              <Field>
                <FieldLabel
                  htmlFor="signup-code"
                  className={typeStyle("body.root")}
                >
                  Email code
                </FieldLabel>
                <OtpField
                  id="signup-code"
                  label="Email code"
                  value={code}
                  onValueChange={setCode}
                  autoFocus
                  required
                />
              </Field>
            </>
          ) : (
            <>
              <Field>
                <FieldLabel
                  htmlFor="signup-name"
                  className={typeStyle("body.root")}
                >
                  Full name
                </FieldLabel>
                <Input
                  placeholder="Enter your full name"
                  id="signup-name"
                  className="mt-2 h-12"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  readOnly={!!token}
                />
              </Field>
              <Field>
                <FieldLabel
                  htmlFor="signup-email"
                  className={typeStyle("body.root")}
                >
                  Work email
                </FieldLabel>
                <Input
                  placeholder="you@company.com"
                  id="signup-email"
                  className="mt-2 h-12"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  readOnly={!!token}
                />
              </Field>
              <Field>
                <FieldLabel
                  htmlFor="signup-phone"
                  className={typeStyle("body.root")}
                >
                  Phone number
                </FieldLabel>
                <PhoneInput
                  id="signup-phone"
                  className="min-h-12"
                  autoComplete="tel"
                  placeholder="Phone number"
                  value={phone}
                  onChange={(value) => setPhone(value ?? "")}
                  required
                  readOnly={!!token}
                />
              </Field>
            </>
          )}
          <p className={`text-muted-foreground ${typeStyle("body.root")}`}>
            Already have an account?{" "}
            <a href="/login" className="underline">
              Log in
            </a>
          </p>
        </form>
      )}
    </IntakeFrame>
  );
}
