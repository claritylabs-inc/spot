"use client";
import { ArrowRight } from "lucide-react";
import { IntakeLoadingState } from "./loading-state";
import { toast } from "sonner";
import { initializeIntakeGoogleAds, trackIntakeContactSaved } from "@/lib/google-ads";
import { captureAnalytics } from "@/lib/analytics";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
} from "@claritylabs-inc/ui/components/card";
import dayjs from "dayjs";
import { ActionSurfaceButton } from "@claritylabs-inc/ui/components/action-surface";
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
import { withQuoteProvider } from "@/lib/quote-provider";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { OtpField } from "@/components/ui/otp-field";
import { PhoneInput } from "@claritylabs-inc/ui/components/marketing/phone-input";
import { Input } from "@claritylabs-inc/ui/components/input";
import { PillButton } from "@/components/ui/pill-button";
import { completeOtpSignIn } from "@/lib/auth-sign-in";
import { AuthEntryPage } from "@/components/auth-entry-page";

export function IntakeSignup() {
  const params = useSearchParams();
  if (params.get("next") || params.get("source") === "vendor-invite")
    return <AuthEntryPage mode="signup" role="client" />;
  return <SignupForm />;
}
function SignupForm() {
  useEffect(() => {
    initializeIntakeGoogleAds();
    captureAnalytics("intake_contact_viewed");
  }, []);
  const contactStarted = useRef(false);
  const params = useSearchParams();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [handoffTransition, setHandoffTransition] = useState(false);
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
  // The phone primitive uses undefined for an empty value. Keep that exact
  // controlled value instead of feeding an empty string back into its effects.
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (error)
      toast.error(
        getUserFacingErrorMessage(
          new Error(error),
          "Could not continue. Please try again.",
        ),
        { id: "intake-signup-error" },
      );
    else toast.dismiss("intake-signup-error");
    return () => {
      toast.dismiss("intake-signup-error");
    };
  }, [error]);

  const [recoverableIds, setRecoverable] = useState<string[] | null>(null);
  const recoverable = recoverableIds ?? [];
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
        setRecoverable([]);
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
        setPhone(handoff.phone || undefined);
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
      .then((id) => {
        queueMicrotask(() => setHandoffTransition(true));
        router.replace(withQuoteProvider(`/intake?request=${id}`, params.get("provider")));
      })
      .catch((e) => {
        captureAnalytics("intake_contact_failed", { stage: "claim" });
        setError(
          getUserFacingErrorMessage(e, "Could not complete this action"),
        );
        advancing.current = false;
        setHandoffTransition(false);
      });
  }, [isAuthenticated, token, handoff, claim, router, params]);
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
    if (!handoff.existingAccount && !handoff.claimed)
      queueMicrotask(() => setHandoffTransition(true));
    queueMicrotask(() => setBusy(true));
    void (
      handoff.existingAccount || handoff.claimed
        ? signIn("resend-otp", { email: handoff.email }).then(() => {
            setCodeSent(true);
            captureAnalytics("intake_verification_sent");
          })
        : signIn("intake", { token })
    )
      .catch((e) => {
        captureAnalytics("intake_contact_failed", { stage: "authentication" });
        setHandoffTransition(false);
        setError(getUserFacingErrorMessage(e, "Could not continue"));
      })
      .finally(() => setBusy(false));
  }, [isLoading, isAuthenticated, token, handoff, busy, signIn]);
  async function continueSignup() {
    autoHandoff.current = true;
    setBusy(true);
    setError("");
    captureAnalytics("intake_contact_submission_started");
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
            phone: phone ?? "",
            handoffKey: handoffKey.current,
            intakeGoal: "quote",
          }),
        });
        const outcome = await response.json();
        if (!response.ok) throw new Error(outcome.error);
        captureAnalytics("intake_contact_saved");
        // Match the former landing form: count accepted contact details, not
        // a page visit, an email-only redirect, or a failed signup attempt.
        void trackIntakeContactSaved(handoffKey.current);
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
        captureAnalytics("intake_verification_sent");
      } else {
        setHandoffTransition(true);
        router.prefetch("/intake");
        await signIn("intake", { token: activeToken });
      }
    } catch (e) {
      captureAnalytics("intake_contact_failed");
      setHandoffTransition(false);
      setError(getUserFacingErrorMessage(e, "Could not continue"));
    } finally {
      setBusy(false);
    }
  }
  async function newRequest() {
    setBusy(true);
    setError("");
    try {
      const id = await start({ orgId: org?.org?._id });
      router.push(withQuoteProvider(`/intake?request=${id}`, params.get("provider")));
    } catch (e) {
      setError(getUserFacingErrorMessage(e, "Could not create request"));
      setBusy(false);
    }
  }
  const autoStart = useRef(false);
  const orgReady =
    viewer !== undefined &&
    (!viewer?.emailVerificationTime || !!viewer.intakeRestricted || org !== undefined);
  useEffect(() => {
    if (
      autoStart.current ||
      !isAuthenticated ||
      token ||
      handoffTransition ||
      !orgReady ||
      recoverableIds === null ||
      drafts === undefined ||
      submitted === undefined ||
      drafts.length ||
      submitted.length ||
      recoverableIds.length
    )
      return;
    autoStart.current = true;
    void newRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token, handoffTransition, orgReady, recoverableIds, drafts, submitted]);
  async function verify() {
    setBusy(true);
    setError("");
    try {
      await completeOtpSignIn(email, code);
      captureAnalytics("intake_verification_succeeded");
      window.location.assign(`/signup?intake=${encodeURIComponent(token)}`);
    } catch (e) {
      captureAnalytics("intake_verification_failed");
      setError(getUserFacingErrorMessage(e, "Could not verify"));
      setBusy(false);
    }
  }
  return (
    <IntakeFrame
      compact
      showSteps={!(isAuthenticated && !token && !handoffTransition)}
      status={busy || handoffTransition ? "Continuing…" : undefined}
      footer={
        isAuthenticated && !token && !handoffTransition ? (
          <>
            <PillButton
              size="large"
              variant="secondary"
              disabled={busy}
              onClick={() => void newRequest()}
            >
              New application
            </PillButton>
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
                  router.push(withQuoteProvider(`/intake?request=${id}`, params.get("provider")));
                } catch (e) {
                  setError(
                    getUserFacingErrorMessage(e, "Could not open request"),
                  );
                  setBusy(false);
                }
              }}
            >
              {busy ? "Continuing…" : "Continue"}
              {!busy && <ArrowRight aria-hidden="true" className="size-4" />}
            </PillButton>
          </>
        ) : (
          <>
            <p className={`text-muted-foreground ${typeStyle("body.root")}`}>
              <span className="hidden sm:inline">
                Already have an account?{" "}
              </span>
              <a href="/login" className="underline">
                Log in
              </a>
            </p>
            <PillButton
              size="large"
              type="submit"
              form="intake-contact"
              disabled={
                busy ||
                handoffTransition ||
                (!!token && handoff === undefined) ||
                (codeSent && code.length !== 6)
              }
            >
              {busy
                ? "Continuing…"
                : codeSent
                  ? "Confirm and continue"
                  : "Continue"}
              {!busy && <ArrowRight aria-hidden="true" className="size-4" />}
            </PillButton>
          </>
        )
      }
    >
      <h1 className={`text-wrap-pretty ${typeStyle("heading.page")}`}>
        {codeSent
          ? "Can you confirm your work email?"
          : isAuthenticated && !token && !handoffTransition
            ? "Which application would you like to view?"
            : "What are your contact details?"}
      </h1>
      <div className="h-7" />
      {token && handoff === null && !handoffTransition && (
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
      {(isLoading && !handoffTransition) ||
      (isAuthenticated &&
        !token &&
        (drafts === undefined || submitted === undefined)) ? (
        <IntakeLoadingState title="Loading your requests" description="Getting your saved drafts and submitted applications ready." />
      ) : isAuthenticated && !token && !handoffTransition ? (
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
                submitted: null,
              })),
          ].map((request) => (
            <ActionSurfaceButton
              key={request.id}
              type="button"
              aria-pressed={selectedRequest === request.id}
              aria-label={`${request.submitted ? "View" : "Resume"} ${request.coverage || "insurance request"} for ${request.insuredName || "business not provided"}${request.effectiveDate ? ` starting ${dayjs(request.effectiveDate).format("MMMM D, YYYY")}` : ""}`}
              onClick={() => setSelectedRequest(request.id)}
              className="block w-full overflow-hidden rounded-xl border-0 bg-transparent p-0"
            >
              <Card
                className={`border ring-0 ${selectedRequest === request.id ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <CardHeader>
                  <span className="flex items-start justify-between gap-4">
                    <CardTitle
                      className={`text-wrap-pretty ${typeStyle("body.root")}`}
                    >
                      {request.coverage || "Coverage not selected"}
                    </CardTitle>
                    <StatusTag tone={request.submitted ? "success" : "neutral"}>
                      {request.submitted === null
                        ? "Saved request"
                        : request.submitted
                          ? request.coverage === "Policy savings review"
                            ? "Policies received"
                            : "Submitted"
                          : "Draft"}
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
        </div>
      ) : (
        <form
          id="intake-contact"
          className="space-y-5"
          onChange={() => {
            if (codeSent || contactStarted.current) return;
            contactStarted.current = true;
            captureAnalytics("intake_contact_started");
          }}
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
                  className={typeStyle("body.large")}
                >
                  Full name
                </FieldLabel>
                <Input
                  placeholder="Enter your full name"
                  id="signup-name"
                  className="mt-1.5 h-11"
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
                  className={typeStyle("body.large")}
                >
                  Work email
                </FieldLabel>
                <Input
                  placeholder="you@company.com"
                  id="signup-email"
                  className="mt-1.5 h-11"
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
                  className={typeStyle("body.large")}
                >
                  Phone number
                </FieldLabel>
                <PhoneInput
                  id="signup-phone"
                  className="min-h-11"
                  autoComplete="tel"
                  placeholder="Phone number"
                  value={phone}
                  onChange={setPhone}
                  required
                  readOnly={!!token}
                />
              </Field>
            </>
          )}
        </form>
      )}
    </IntakeFrame>
  );
}
