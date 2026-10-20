"use client";
import { intakeSubmissionProblems } from "@/lib/intake-submission";
import { driverQuestion, DRIVER_FIELDS, isDriverStep, hasCommercialAuto, newIntakeDriver, driverFieldValid } from "@/lib/intake-drivers";
import { vinError } from "@/lib/intake-vehicles";
import { IntakeAutoQuoteFields } from "./auto-quote-fields";
import { autoVehicles, estimatedVehicleValueError } from "@/lib/intake-auto-quote";
import { IntakeDriverFields } from "./driver-fields";
import { INTAKE_STEP_FIELDS } from "@/lib/intake-question-history";
import { IntakeFollowups } from "./followups";
import { personalizeIntakeQuestion, followupQuestionVisible, expandIntakeFollowupQuestion, type IntakeFollowupQuestion } from "@/lib/intake-followups";
import { captureAnalytics } from "@/lib/analytics";
import dayjs from "dayjs";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@claritylabs-inc/ui/components/card";
import {
  IntakeRadioChoices,
  IntakeCountInput,
  IntakeRevenueFields,
  IntakeRegistration,
  IntakeAdditionalCoverages,
  IntakeCoverageScope,
  IntakeCheckboxCard,
  IntakeCoverageSelection,
  IntakeCoverageLimits,
  IntakeDateFields,
  IntakeMailingAddress,
  IntakeLocations,
  IntakeRelatedEntities,
} from "./details-fields";
import {
  addressText,
  detailsAnswers,
  detailsFromAnswers,
  coverageOption,
  coverageRequestLabel,
  validCoverageLimit,
  validCoverageScope,
  needsCoverageScope,
  shouldRequestLossRuns,
  type IntakeDetails,
  type CoverageRequest,
} from "@/lib/insurance-intake-details";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { toast } from "sonner";
import { INDUSTRIES } from "@/lib/insurance-intake-industries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  useConvexAuth,
  useConvexConnectionState,
  useMutation,
  useQuery,
} from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  COMPANY_INTAKE_FIELDS,
  INTAKE_FIELDS,
  INTAKE_REASONS,
  SAVINGS_INTAKE_REASON,
  hasIntakeRequirements,
  INTAKE_STEPS,
  INTAKE_VERSION,
  type IntakeAnswers,
  type IntakeField,
} from "@/lib/insurance-intake";
import { IntakeSavedBusinessSummary } from "./company-review";
import { IntakeFrame } from "./frame";
import { withQuoteProvider } from "@/lib/quote-provider";
import { IntakeTracking } from "./tracking";
import {
  Field,
  FieldLabel,
  FieldDescription,
} from "@claritylabs-inc/ui/components/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@claritylabs-inc/ui/components/select";
import { OtpField } from "@/components/ui/otp-field";
import { FileDropZone } from "@claritylabs-inc/ui/components/file-drop";
import { PhoneInput } from "@claritylabs-inc/ui/components/marketing/phone-input";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { PillButton } from "@/components/ui/pill-button";
import { Button } from "@claritylabs-inc/ui/components/button";
import { completeOtpSignIn } from "@/lib/auth-sign-in";
import { useBackgroundTasks } from "@claritylabs-inc/ui/components/background-tasks";
import { ChevronLeft, Circle, Loader2, X } from "lucide-react";

type Recovery = {
  answers: IntakeAnswers;
  step: number;
  revision: number;
  dirty: boolean;
  version?: number;
  details?: IntakeDetails;
  skippedStep?: number;
};
// Keep the cursor used for validation and persistence aligned with the record
// rendered by the collection fields, including older saved drafts.
function normalizeIntakeCursors(details: IntakeDetails): IntakeDetails {
  const clamp = (index: number | undefined, length: number) =>
    Math.min(Math.max(0, typeof index === "number" && Number.isInteger(index) ? index : 0), Math.max(0, length - 1));
  return {
    ...details,
    coverageIndex: clamp(details.coverageIndex, details.coverages.length),
    driverIndex: clamp(details.driverIndex, details.drivers?.length ?? 0),
    autoVehicleIndex: clamp(details.autoVehicleIndex, autoVehicles(details).length),
  };
}
function IntakeApplicationLoading() {
  return (
    <IntakeFrame
      disabled
      footer={
        <div className="flex justify-between">
          <Skeleton className="h-12 w-20 rounded-full" />
          <Skeleton className="h-12 w-28 rounded-full" />
        </div>
      }
    >
      <div
        role="status"
        aria-label="Loading your application"
        aria-busy="true"
        className="space-y-10"
      >
        <span className="sr-only">Loading your application</span>
        <Skeleton className="h-10 w-4/5" />
        <div className="space-y-6" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <div key={item} className="space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </IntakeFrame>
  );
}

export function InsuranceIntake() {
  const params = useSearchParams();
  const router = useRouter();
  const requestId = params.get("request") as Id<"procurementRequests"> | null;
  const requestedStep = params.get("step");
  const reviewStep =
    requestedStep !== null &&
    Number.isInteger(Number(requestedStep)) &&
    Number(requestedStep) >= 0 &&
    Number(requestedStep) < INTAKE_STEPS.length
      ? Number(requestedStep)
      : undefined;
  const reviewSection = Number(
    params.get("section") ??
      (reviewStep === undefined
        ? 1
        : reviewStep < 6
          ? 1
          : reviewStep < 10
            ? 6
            : reviewStep < 20 || reviewStep === 27
              ? 10
              : reviewStep===41 || reviewStep===42 ? 41 : reviewStep===43 ? 43 : isDriverStep(reviewStep) ? 31 : reviewStep === 29 || reviewStep === 30 ? reviewStep : 20),
  );
  const reviewCoverageIndex = Number(params.get("coverageIndex") ?? 0);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const confirmOwnership = useMutation(
    api.requestIntake.confirmVerifiedOwnership,
  );
  const [confirmationError, setConfirmationError] = useState("");
  useEffect(() => {
    if (confirmationError)
      toast.error(
        getUserFacingErrorMessage(
          new Error(confirmationError),
          "Could not confirm your application. Please try again.",
        ),
        { id: "intake-confirmation-error" },
      );
    else toast.dismiss("intake-confirmation-error");
    return () => {
      toast.dismiss("intake-confirmation-error");
    };
  }, [confirmationError]);
  const verification = params.get("verify");
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const needsLogin = !isLoading && (!isAuthenticated || viewer === null);
  useEffect(() => {
    if (!requestId || !needsLogin) return;
    router.replace(`/login?next=${encodeURIComponent(`/intake?${params.toString()}`)}`);
  }, [requestId, needsLogin, router, params]);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    if (verification || !requestId || !isAuthenticated || viewer === undefined)
      return;
    let proof: string | null = null;
    try {
      proof = localStorage.getItem(`spot:intake-proof:${requestId}`);
    } catch {
      /* Server session remains usable. */
    }
    if (!proof || !viewer?.emailVerificationTime || viewer.intakeRestricted) {
      queueMicrotask(() => setRecovered(true));
      return;
    }
    void confirmOwnership({ requestId, token: proof })
      .then(() => {
        localStorage.removeItem(`spot:intake-proof:${requestId}`);
        setRecovered(true);
      })
      .catch((e) =>
        setConfirmationError(
          getUserFacingErrorMessage(e, "Could not confirm your application"),
        ),
      );
  }, [verification, requestId, isAuthenticated, viewer, confirmOwnership]);
  useEffect(() => {
    if (!verification || !requestId || !isAuthenticated) return;
    void confirmOwnership({ requestId, token: verification })
      .then(() => {
        try {
          localStorage.removeItem(`spot:intake-proof:${requestId}`);
        } catch {
          /* Ownership is already saved on the server. */
        }
        window.location.replace(withQuoteProvider(`/intake?request=${requestId}`, params.get("provider")));
      })
      .catch((e) => {
        setConfirmationError(
          getUserFacingErrorMessage(e, "Could not confirm your application"),
        );
      });
  }, [verification, requestId, isAuthenticated, confirmOwnership, params]);
  if (requestId && (isLoading || needsLogin))
    return <IntakeApplicationLoading />;
  if (verification)
    return (
      <IntakeFrame>
        <p>
          {confirmationError
            ? "Please reopen your saved application."
            : "Confirming your saved application…"}
        </p>
        {confirmationError && (
          <PillButton href={withQuoteProvider("/signup", params.get("provider"))}>Find my drafts</PillButton>
        )}
      </IntakeFrame>
    );
  if (!requestId) return null;
  if (confirmationError)
    return (
      <IntakeFrame>
        <p>Please reopen your saved application.</p>
        <PillButton href={withQuoteProvider("/signup", params.get("provider"))}>Find my drafts</PillButton>
      </IntakeFrame>
    );
  if (!recovered)
    return <IntakeFrame>Checking your saved application…</IntakeFrame>;
  return (
    <>
      <Application
        key={`${requestId}:${reviewStep ?? "application"}`}
        requestId={requestId}
        reviewStep={reviewStep}
        reviewSection={reviewSection}
        reviewCoverageIndex={reviewCoverageIndex}
      />
    </>
  );
}
function Application({
  requestId,
  reviewStep,
  reviewSection,
  reviewCoverageIndex,
}: {
  requestId: Id<"procurementRequests">;
  reviewStep?: number;
  reviewSection: number;
  reviewCoverageIndex: number;
}) {
  const params = useSearchParams();
  const connection = useConvexConnectionState();
  const data = useQuery(api.requestIntake.get, { requestId });
  const router = useRouter();
  const save = useMutation(api.requestIntake.save);
  const prepareFollowups = useMutation(api.requestIntake.prepareFollowups);
  const preparingFollowups = useRef<string | null>(null);
  const prepareVerification = useMutation(
    api.requestIntake.prepareVerification,
  );
  const submit = useMutation(api.requestIntake.submit);
  const removeUploadedFile = useMutation(api.requestIntake.removeFile);
  const selectNewCompany = useMutation(api.requestIntake.useNewCompany);
  const selectSavedCompany = useMutation(api.requestIntake.useSavedCompany);
  const { signIn } = useAuthActions();
  const { run } = useBackgroundTasks();
  const org = useQuery(api.orgs.viewerOrg, data?.verified ? {} : "skip");
  const [answers, setAnswers] = useState<IntakeAnswers>({});
  const isSavings =
    (answers.intakeGoal ?? data?.answers.intakeGoal) === "savings";
  const [details, setDetails] = useState<IntakeDetails>(detailsFromAnswers({}));
  const [step, setStep] = useState(0);
  const followupBatch =
    data?.followupBatches?.[step === 29 ? "acord" : "additional"];
  const followupWaitKey = `${step}:${followupBatch?.token ?? "initial"}`;
  const followupStartedAt = followupBatch?.startedAt;
  const [expiredFollowupKey, setExpiredFollowupKey] = useState<string | null>(
    null,
  );
  const followupWaitExpired = expiredFollowupKey === followupWaitKey;
  useEffect(() => {
    if (![29, 30].includes(step)) return;
    const remaining = Math.max(
      0,
      120000 - (followupStartedAt ? dayjs().valueOf() - followupStartedAt : 0),
    );
    const timer = setTimeout(
      () => setExpiredFollowupKey(followupWaitKey),
      remaining,
    );
    return () => clearTimeout(timer);
  }, [step, followupWaitKey, followupStartedAt]);
  const followupsPending =
    !data?.submitted &&
    [29, 30].includes(step) &&
    !followupWaitExpired &&
    (!followupBatch || followupBatch.status === "pending");
  const [editingReview, setEditingReview] = useState(
    reviewStep !== undefined && reviewStep !== 28,
  );
  const reviewScroll = useRef(0);
  const editingSection = useRef(reviewSection);
  const followupSection = step === 29 ? "acord" : "additional";
  const savedFollowupQuestions = (details.followups ?? []).filter(
    (row) => row.section === followupSection,
  ).flatMap((row) => data?.submitted || row.answer.trim() ? [row] : expandIntakeFollowupQuestion(row));
  const currentFollowupQuestions = data?.submitted
    ? []
    : (followupBatch?.questions ?? []).flatMap(expandIntakeFollowupQuestion);
  const followupQuestions = Array.from(new Map([
    ...currentFollowupQuestions,
    ...savedFollowupQuestions.filter(
      (saved) =>
        // Historical answers remain reviewable, but a new forward batch must
        // not turn previously answered/skipped questions into new pages again.
        (!!data?.submitted || editingReview) &&
        !currentFollowupQuestions.some((question) => question.id === saved.id),
    ),
  ].map((question) => [question.id, question])).values()).filter(question=>followupQuestionVisible(question,details.followups));
  const followupIndex = Math.min(
    details.followupProgress?.[followupSection] ?? 0,
    Math.max(0, followupQuestions.length - 1),
  );
  const followupQuestion = followupQuestions[followupIndex];
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [code, setCode] = useState("");
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const initialCodeAttempted = useRef(false);
  const verificationToken = useRef("");
  const intentionalRedirect = useRef(false);
  const state = useRef<Recovery>({
    answers: {},
    step: 0,
    revision: 0,
    dirty: false,
  });
  const initialized = useRef(false);
  const [editCompany, setEditCompany] = useState(false);
  const [showRequirementsPaste, setShowRequirementsPaste] = useState<
    boolean | null
  >(null);
  const [ready, setReady] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const running = useRef<Promise<boolean> | null>(null);
  const conflict = useRef(false);
  const key = `spot:request-intake:${requestId}`;
  const needsProof = !!data && !data.verified;
  useEffect(() => {
    if (!needsProof) return;
    let token: string;
    try {
      token =
        localStorage.getItem(`spot:intake-proof:${requestId}`) ||
        crypto.randomUUID().replaceAll("-", "") +
          crypto.randomUUID().replaceAll("-", "");
    } catch {
      token =
        crypto.randomUUID().replaceAll("-", "") +
        crypto.randomUUID().replaceAll("-", "");
    }
    verificationToken.current = token;
    void prepareVerification({ requestId, token })
      .then(() => {
        try {
          localStorage.setItem(`spot:intake-proof:${requestId}`, token);
        } catch {
          /* Finalization also carries a one-use proof in its redirect. */
        }
      })
      .catch((e) =>
        setError(
          getUserFacingErrorMessage(e, "Could not complete this action"),
        ),
      );
  }, [needsProof, requestId, prepareVerification]);
  useEffect(() => {
    const email = data?.answers.email;
    if (!needsProof || !email || initialCodeAttempted.current) return;
    initialCodeAttempted.current = true;
    const sentKey = `spot:intake-code-sent:${email.toLowerCase()}`;
    try {
      if (localStorage.getItem(sentKey)) {
        queueMicrotask(() => setCodeSent(true));
        return;
      }
    } catch {
      /* Use this mount’s one-shot guard. */
    }
    queueMicrotask(() => setSendingCode(true));
    void signIn("resend-otp", { email })
      .then(() => {
        setCodeSent(true);
        try {
          localStorage.setItem(sentKey, dayjs().toISOString());
        } catch {
          /* Sending succeeded. */
        }
      })
      .catch(() => {
        // Email confirmation never blocks intake; the inline form offers resend.
      })
      .finally(() => setSendingCode(false));
  }, [needsProof, data?.answers.email, signIn]);
  const cache = useCallback(() => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ ...state.current, version: INTAKE_VERSION }),
      );
    } catch {
      setStatus("Device recovery unavailable; waiting for server save");
    }
  }, [key]);
  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    let recovery: Recovery | null = null;
    try {
      recovery = JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      /* Use server data if recovery is malformed. */
    }
    if (recovery?.dirty) {
      state.current = {
        ...recovery,
        step:
          recovery.version === INTAKE_VERSION
            ? recovery.step
            : ([1, 6, 10, 20, 28][recovery.step] ?? 0),
      };
      if (recovery.revision !== data.revision) {
        conflict.current = true;
        queueMicrotask(() =>
          setError(
            "This application changed elsewhere. Your unsaved answers are retained below. Review the latest saved version before replacing it.",
          ),
        );
      }
    } else
      state.current = {
        answers: {
          ...data.answers,
          ...(data.answers.requirements === "None"
            ? { requirements: "No" }
            : {}),
        },
        step:
          data.submitted && reviewStep !== undefined ? reviewStep : data.step,
        revision: data.revision,
        dirty: false,
      };
    if (state.current.step === 27) state.current.step = 20;
    state.current.details = state.current.details ?? data.details;
    if (data.submitted && !recovery?.dirty)
      state.current.details = {
        ...data.details,
        coverageIndex: Math.max(
          0,
          Math.min(
            Number.isInteger(reviewCoverageIndex) ? reviewCoverageIndex : 0,
            data.details.coverages.length - 1,
          ),
        ),
      };
    state.current.answers = {
      ...state.current.answers,
      ...detailsAnswers(state.current.details),
    };
    if (state.current.answers.requirements === "None")
      state.current.answers.requirements = "No";
    state.current.details = normalizeIntakeCursors(state.current.details!);
    const savedSavings = state.current.answers.intakeGoal === "savings";
    const savedAuto = !savedSavings && hasCommercialAuto(state.current.details);
    if (savedSavings && [20, 22, 23, 24, 25, 26, 29, 30, 43].includes(state.current.step))
      state.current.step = data.files.some((file) => file.category === "policy") ? 28 : 21;
    else if (
      (savedSavings && [6, 7, 8, 9].includes(state.current.step)) ||
      (!savedAuto && ([41, 42].includes(state.current.step) || isDriverStep(state.current.step)))
    )
      state.current.step = 10;
    else if (state.current.step === 42 && !autoVehicles(state.current.details).length)
      state.current.step = 31;
    else if (isDriverStep(state.current.step) && state.current.step !== 31) {
      if (!state.current.details.drivers?.length) state.current.step = 31;
      else if ([32, 33].includes(state.current.step) && !state.current.details.collectSensitiveDriverDetails)
        state.current.step = 34;
      else if (state.current.step === 38 && state.current.details.drivers[state.current.details.driverIndex ?? 0].accidents !== "yes")
        state.current.step = 37;
      else if (state.current.step === 40 && state.current.details.drivers[state.current.details.driverIndex ?? 0].violations !== "yes")
        state.current.step = 39;
    }
    if (
      state.current.step === 3 ||
      (state.current.step === 4 &&
        !hasIntakeRequirements(state.current.answers))
    )
      state.current.step = hasIntakeRequirements(state.current.answers) ? 4 : 5;
    if (
      [7, 8].includes(state.current.step) &&
      state.current.details?.coverages[0]?.coverage === "unknown"
    )
      state.current.step = 9;
    if (state.current.step === 9 && !state.current.details.coverages.some((line) => needsCoverageScope(line.coverage)))
      state.current.step = 10;
    if (state.current.step === 26) state.current.step = state.current.answers.intakeGoal === "savings" ? 28 : 29;
    if (!savedSavings && state.current.step === 43) state.current.step = 23;
    if (!savedSavings && state.current.step === 22) state.current.step = 23;
    if (
      !savedSavings &&
      [21, 22].includes(state.current.step) &&
      state.current.answers.currentInsurance === "No"
    )
      state.current.step = 23;
    if (
      !savedSavings &&
      state.current.step === 24 &&
      !shouldRequestLossRuns(state.current.answers, state.current.details)
    )
      state.current.step = 25;
    queueMicrotask(() => {
      setDetails(state.current.details!);
      setReady(true);
      setHasConflict(conflict.current);
      setAnswers(state.current.answers);
      setStep(state.current.step);
      setStatus(
        state.current.dirty ? "Unsaved changes on this device" : "Saved",
      );
    });
  }, [data, key, reviewStep, reviewCoverageIndex]);
  const flush = useCallback(async (): Promise<boolean> => {
    if (running.current) {
      await running.current;
      if (!state.current.dirty) return true;
    }
    if (!initialized.current || conflict.current) return false;
    if (!state.current.dirty) return true;
    const work = async () => {
      while (state.current.dirty) {
        if (!navigator.onLine || !connection.isWebSocketConnected) {
          setStatus("Offline—changes saved on this device");
          return false;
        }
        const snapshot = {
          ...state.current,
          answers: { ...state.current.answers },
        };
        setStatus("Saving…");
        try {
          const revision = await save({
            requestId,
            answers: snapshot.answers,
            details: snapshot.details,
            step: snapshot.step,
            expectedRevision: snapshot.revision,
            skippedStep: snapshot.skippedStep,
          });
          const same =
            JSON.stringify(state.current.answers) ===
              JSON.stringify(snapshot.answers) &&
            state.current.step === snapshot.step &&
            JSON.stringify(state.current.details) ===
              JSON.stringify(snapshot.details);
          state.current = {
            ...state.current,
            revision,
            dirty: !same,
            skippedStep: undefined,
          };
          cache();
          setStatus(same ? "Saved" : "Saving…");
          setError("");
        } catch (e) {
          const message = getUserFacingErrorMessage(e, "Could not save");
          if (message.includes("another tab")) {
            conflict.current = true;
            setHasConflict(true);
          }
          setError(message);
          setStatus("Not saved to server—changes retained on this device");
          cache();
          return false;
        }
      }
      return true;
    };
    running.current = work();
    try {
      return await running.current;
    } finally {
      running.current = null;
    }
  }, [save, requestId, cache, connection.isWebSocketConnected]);
  useEffect(() => {
    if (!initialized.current || !state.current.dirty) return;
    const timer = setTimeout(() => {
      void flush();
    }, 500);
    return () => clearTimeout(timer);
  }, [answers, details, step, flush, data]);
  useEffect(() => {
    const online = () => {
      void flush();
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (intentionalRedirect.current) return;
      if (state.current.dirty || uploading) {
        cache();
        e.preventDefault();
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", unload);
    const retry = setInterval(() => {
      if (state.current.dirty && !conflict.current) void flush();
    }, 5000);
    return () => {
      clearInterval(retry);
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", unload);
    };
  }, [flush, cache, uploading]);
  useEffect(() => {
    if (!ready || !data || data.submitted || isSavings || ![29, 30].includes(step)) {
      // This latch covers one visit, not the lifetime of the application. A
      // later visit must let the server compare the latest context hash.
      preparingFollowups.current = null;
      return;
    }
    const section = step === 29 ? "acord" : "additional";
    const key = `${requestId}:${section}`;
    if (preparingFollowups.current === key) return;
    preparingFollowups.current = key;
    void (async () => {
      if (!(await flush())) {
        if (preparingFollowups.current === key) preparingFollowups.current = null;
        return;
      }
      if (state.current.step !== step) return;
      try { await prepareFollowups({ requestId, section }); }
      catch (error) { setError(getUserFacingErrorMessage(error, "We couldn’t prepare follow-up questions.")); }
    })();
  }, [ready, data, isSavings, step, requestId, flush, prepareFollowups]);
  function changeFollowup(question: IntakeFollowupQuestion, answer: string) {
    const current = state.current.details ?? details;
    const rows = current.followups ?? [];
    const updatedRows = rows.some((row) => row.id === question.id)
        ? rows.map((row) =>
            row.id === question.id ? { ...question, answer, skipped: false } : row,
          )
        : [...rows, { ...question, answer, skipped: false }];
    changeDetails({...current,followups:updatedRows.map(row=>followupQuestionVisible(row,updatedRows)?row:{...row,answer:"",skipped:true})});
  }
  function change(field: IntakeField, value: string) {
    setSubmissionConfirmed(false);
    if (field === "timingUnknown" && value === "yes") {
      const next = {
        ...details,
        dateInput: "",
        dateParts: { year: "", month: "", day: "" },
      };
      state.current.details = next;
      state.current.answers = { ...state.current.answers, effectiveDate: "" };
      setDetails(next);
    }
    state.current = {
      ...state.current,
      answers: {
        ...state.current.answers,
        ...(COMPANY_INTAKE_FIELDS.includes(field)
          ? { companyConfirmed: "" }
          : {}),
        ...(field === "industry" ? { industryVertical: "" } : {}),

        [field]: value,
        ...(field === "trigger"
          ? {
              intakeGoal: value === SAVINGS_INTAKE_REASON ? "savings" : "quote",
            }
          : {}),
      },
      dirty: true,
    };
    if (
      field === "trigger" &&
      /^(Yes—.* requirements|No|None|Both|Not sure)$/.test(
        answers.requirements ?? "",
      )
    )
      state.current.answers.requirements = "";
    cache();
    setAnswers(state.current.answers);
    setStatus(
      navigator.onLine ? "Saving…" : "Offline—changes saved on this device",
    );
  }
  function changeDetails(next: IntakeDetails) {
    setSubmissionConfirmed(false);
    next = normalizeIntakeCursors(next);
    const stored = state.current.details;
    if (
      next.scopeNote === undefined &&
      !stored?.coverages.some(
        (line) =>
          line.properties !== undefined ||
          line.vehicles !== undefined ||
          line.scopeDescription !== undefined,
      )
    )
      next = { ...next, scopeNote: state.current.answers.coverageScope ?? "" };
    if (
      next.additionalNote === undefined &&
      !stored?.coverages.some((line) => line.additionalCoverages !== undefined)
    )
      next = {
        ...next,
        additionalNote: state.current.answers.separateQuotes ?? "",
      };
    const previous =
      state.current.details ?? detailsFromAnswers(state.current.answers);
    const companyChanged =
      JSON.stringify([
        previous.mailingAddress,
        previous.locations,
        previous.relatedEntities,
        previous.relatedEntitiesNote,
        previous.hasRelatedEntities,
        previous.registrationCountry,
        previous.registrationState,
        previous.registrationAddress,
        previous.mailingSameAsRegistered,
      ]) !==
      JSON.stringify([
        next.mailingAddress,
        next.locations,
        next.relatedEntities,
        next.relatedEntitiesNote,
        next.hasRelatedEntities,
        next.registrationCountry,
        next.registrationState,
        next.registrationAddress,
        next.mailingSameAsRegistered,
      ]);
    state.current = {
      ...state.current,
      details: next,
      answers: {
        ...state.current.answers,
        ...detailsAnswers(next),
        ...(next.dateInput !== previous.dateInput ||
        JSON.stringify(next.dateParts) !== JSON.stringify(previous.dateParts)
          ? { timingUnknown: "" }
          : {}),
        ...(companyChanged ? { companyConfirmed: "" } : {}),
      },
      dirty: true,
    };
    cache();
    setDetails(next);
    setAnswers(state.current.answers);
    setStatus("Saving…");
  }
  useEffect(() => {
    if (!data || !ready || conflict.current) return;
    const current = state.current.details;
    if (!current) return;
    const sources = new Set(current.prefillSourceIds ?? []);
    const coverages = current.coverages.map((line) => ({
      ...line,
      limits: { ...line.limits },
    }));
    let applied = false;
    for (const file of data.files) {
      if (!file.prefillCoveragesJson || sources.has(file.id)) continue;
      const suggestions = JSON.parse(
        file.prefillCoveragesJson,
      ) as CoverageRequest[];
      const empty = coverages.length === 0;
      for (const suggestion of suggestions) {
        const existing = coverages.find(
          (line) => line.coverage === suggestion.coverage,
        );
        if (existing) {
          for (const [key, value] of Object.entries(suggestion.limits))
            if (!existing.limits[key]?.trim()) existing.limits[key] = value;
          if (
            !existing.additionalCoverages?.trim() &&
            suggestion.additionalCoverages?.trim()
          )
            existing.additionalCoverages = suggestion.additionalCoverages;
        } else if (empty) coverages.push(suggestion);
      }
      sources.add(file.id);
      applied = true;
    }
    if (!applied) return;
    const next = { ...current, coverages, prefillSourceIds: [...sources] };
    state.current = {
      ...state.current,
      details: next,
      answers: { ...state.current.answers, ...detailsAnswers(next) },
      dirty: true,
    };
    setDetails(next);
    setAnswers(state.current.answers);
    cache();
  }, [data, ready, cache]);

  useEffect(() => {
    const research = data?.companyResearch;
    if (!ready || !research?.suggestions || conflict.current) return;
    const current = state.current;
    if (
      !current.details ||
      current.details.companyResearchSource === research.fingerprint ||
      (current.answers.legalName?.trim() ?? "") !== research.name ||
      (current.answers.website?.trim() ?? "") !== research.website
    )
      return;
    const answers = { ...current.answers };
    for (const key of [
      "description",
      "yearStarted",
      "industry",
      "industryVertical",
    ] as const) {
      if (
        key === "industryVertical" &&
        answers.industry !== research.suggestions.industry
      )
        continue;
      if (!answers[key]?.trim() && research.suggestions[key])
        answers[key] = research.suggestions[key];
    }
    const next = {
      ...current.details,
      companyResearchSource: research.fingerprint,
    };
    state.current = { ...current, answers, details: next, dirty: true };
    setAnswers(answers);
    setDetails(next);
    cache();
  }, [data, ready, cache]);

  useEffect(() => {
    if (!ready || step !== 9 || conflict.current) return;
    const current = state.current.details;
    if (
      !current ||
      !current.coverages.some(
        (line) => line.coverage === "property" && !line.properties?.length,
      )
    )
      return;
    const next = {
      ...current,
      coverages: current.coverages.map((line) =>
        line.coverage === "property" && !line.properties?.length
          ? { ...line, properties: [{ address: {}, details: "" }] }
          : line,
      ),
    };
    state.current = {
      ...state.current,
      details: next,
      answers: { ...state.current.answers, ...detailsAnswers(next) },
      dirty: true,
    };
    setDetails(next);
    setAnswers(state.current.answers);
    cache();
  }, [ready, step, cache]);

  useEffect(() => {
    if (!ready || step !== 19 || conflict.current) return;
    const current = state.current.details;
    if (
      !current ||
      current.operatingLocationPrefilled ||
      !addressText(current.mailingAddress).trim()
    )
      return;
    const locations = current.locations.map((location) => ({ ...location }));
    if (!locations.length)
      locations.push({ address: { ...current.mailingAddress }, details: "" });
    else if (!addressText(locations[0].address).trim())
      locations[0].address = { ...current.mailingAddress };
    const next = { ...current, locations, operatingLocationPrefilled: true };
    state.current = {
      ...state.current,
      details: next,
      answers: { ...state.current.answers, ...detailsAnswers(next) },
      dirty: true,
    };
    setDetails(next);
    setAnswers(state.current.answers);
    cache();
  }, [ready, step, cache]);

  useEffect(() => {
    if (!ready || step !== 19 || conflict.current) return;
    const current = state.current.details;
    const description = state.current.answers.description?.trim();
    if (
      !current ||
      !description ||
      !current.locations.some((location) => !location.activitiesPrefilled)
    )
      return;
    const next = {
      ...current,
      locations: current.locations.map((location) =>
        location.activitiesPrefilled
          ? location
          : {
              ...location,
              details: location.details.trim() ? location.details : description,
              activitiesPrefilled: true,
            },
      ),
    };
    state.current = {
      ...state.current,
      details: next,
      answers: { ...state.current.answers, ...detailsAnswers(next) },
      dirty: true,
    };
    setDetails(next);
    setAnswers(state.current.answers);
    cache();
  }, [ready, step, answers.description, cache]);

  useEffect(() => {
    const id = `intake-error:${requestId}`;
    if (!error) {
      toast.dismiss(id);
      return;
    }
    toast.error(
      getUserFacingErrorMessage(
        new Error(error),
        "Could not save your answers. Please try again.",
      ),
      {
        id,
        duration: hasConflict ? Infinity : 6000,
        closeButton: !hasConflict,
        ...(hasConflict
          ? {
              action: {
                label: "Load saved version",
                onClick: () => {
                  intentionalRedirect.current = true;
                  localStorage.removeItem(key);
                  window.location.reload();
                },
              },
              cancel: {
                label: "Save my reviewed answers",
                onClick: () => {
                  if (!data) return;
                  state.current.revision = data.revision;
                  conflict.current = false;
                  setHasConflict(false);
                  setError("");
                  void flush();
                },
              },
            }
          : {}),
      },
    );
    return () => {
      toast.dismiss(id);
    };
  }, [error, hasConflict, requestId, key, data?.revision, flush]);

  async function navigate(
    next: number,
    confirmSave = false,
    skipped = false,
    fromReview = false,
  ) {
    if (busy || uploading) return;
    // Existing policies supply savings coverage; skip these questions on every
    // entry path, including review navigation and older saved step links.
    if (isSavings && !fromReview) {
      if (step === 1 && next === 2) next = 21;
      else if (step === 21 && next < 21) next = 1;
      else if (step === 21 && next > 21) next = 10;
      else if (step === 10 && next < 10) next = 21;
      else if ((step === 19 || step === 10) && next === 27) next = 28;
      else if (step === 0 && next === 1) next = 21;
    }
    if (isSavings && ([6, 7, 8, 9, 41, 42].includes(next) || isDriverStep(next))) next = 10;
    // Keep old saved step numbers compatible without showing the retired confirmation page.
    if (next === 27) next = step >= 20 ? 19 : 20;
    if (isSavings && [20, 22, 23, 24, 25, 26, 29, 30, 43].includes(next))
      next = data?.files.some((file) => file.category === "policy") ? 28 : 21;
    const previousStep = step;
    const previousDetails = state.current.details ?? details;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const requiresDocument = hasIntakeRequirements(state.current.answers);
      if (!fromReview) {
        if (step === 1 && next === 2) next = requiresDocument ? 4 : 2;
        else if (step === 4 && next === 5) next = 2;
        else if (step === 4 && next === 3) next = 1;
        else if (step === 2 && next === 1) next = requiresDocument ? 4 : 1;
        else if (step === 2 && next === 3) next = 5;
        else if (step === 5 && next === 4) next = 2;
      }
      if (next === 3) next = requiresDocument ? 4 : 2;
      if (next === 4 && !requiresDocument) next = 2;
      if (
        !isSavings &&
        [21, 22].includes(next) &&
        state.current.answers.currentInsurance === "No"
      )
        next = step > next ? 20 : 23;
      if (!isSavings && next === 22)
        next =
          editingReview && editingSection.current === 21
            ? 24
            : step > 22
              ? 21
              : 23;
      if (
        !isSavings &&
        next === 24 &&
        !shouldRequestLossRuns(state.current.answers, previousDetails)
      )
        next = step > 24 ? 23 : 25;
      if (!isSavings && next === 26) next = step > 26 ? 25 : 28;
      if (
        [7, 8].includes(next) &&
        previousDetails.coverages[0]?.coverage === "unknown"
      )
        next = step > 8 ? 6 : 9;
      let coverageIndex = previousDetails.coverageIndex;
      if (
        step === 7 &&
        next === 8 &&
        coverageIndex < previousDetails.coverages.length - 1
      ) {
        next = 7;
        coverageIndex++;
      } else if (step === 7 && next === 6 && coverageIndex > 0) {
        next = 7;
        coverageIndex--;
      } else if (next === 7)
        coverageIndex = step === 8 ? previousDetails.coverages.length - 1 : 0;
      if (
        next === 9 &&
        !previousDetails.coverages.some((line) =>
          needsCoverageScope(line.coverage),
        )
      )
        next = step > 9
          ? previousDetails.coverages[0]?.coverage === "unknown" ? 6 : 8
          : 10;
      if (
        next === 13 &&
        !["United States", "Canada"].includes(
          previousDetails.registrationCountry || "United States",
        )
      )
        next = step > 13 ? 12 : 14;
      let autoVehicleIndex = previousDetails.autoVehicleIndex ?? 0;
      let driverIndex = previousDetails.driverIndex ?? 0;
      const auto = !isSavings && hasCommercialAuto(previousDetails);
      if (!fromReview) {
        if (auto && step === 9 && next === 10) { next = 41; driverIndex = 0; autoVehicleIndex = 0; }
        else if (auto && step === 10 && next === 9) { driverIndex = Math.max(0,(previousDetails.drivers?.length??1)-1); next = previousDetails.drivers?.[driverIndex]?.violations === "yes" ? 40 : 39; }
        else if (isDriverStep(step)) {
          const driver = previousDetails.drivers?.[driverIndex];
          if (step === 31) { next = next > step ? (previousDetails.collectSensitiveDriverDetails ? 32 : 34) : (autoVehicles(previousDetails).length ? 42 : 41); autoVehicleIndex=Math.max(0,autoVehicles(previousDetails).length-1); driverIndex=0; }
          else if (next > step) {
            if (next === 32 && !previousDetails.collectSensitiveDriverDetails) next=34;
            if (next === 38 && driver?.accidents !== "yes") next=39;
            if (next === 40 && driver?.violations !== "yes") next=41;
            if (next === 41) { if(driverIndex < (previousDetails.drivers?.length??0)-1){next=previousDetails.collectSensitiveDriverDetails?32:34;driverIndex++;}else next=10; }
          } else {
            if(next===38 && driver?.accidents!=="yes")next=37;
            if(next===33 && !previousDetails.collectSensitiveDriverDetails)next=31;
            if(next===31 && driverIndex>0){driverIndex--;next=previousDetails.drivers?.[driverIndex]?.violations==="yes"?40:39;}
          }
        }
      }
      if (!fromReview) {
        if (step === 41) { next = next > step ? (autoVehicles(previousDetails).length ? 42 : 31) : 9; autoVehicleIndex=0; }
        else if (step === 42) {
          if(next > step) { if(autoVehicleIndex < autoVehicles(previousDetails).length-1){autoVehicleIndex++;next=42;}else{next=31;driverIndex=0;} }
          else if(autoVehicleIndex>0){autoVehicleIndex--;next=42;}else next=41;
        }
        if(!isSavings && step===20 && next===25 && state.current.answers.currentInsurance==="No") next=23;
        if(!isSavings && step===43)next=next>step?23:20;
        if(!isSavings && step===23 && next===22 && state.current.answers.currentInsurance==="No")next=20;
      }
      if (!isSavings && next === 43) next = 23;
      if ((isDriverStep(next) || next === 41 || next === 42) && !auto) next=10;
      if (next === 42 && !autoVehicles(previousDetails).length) next = 31;
      let mailingAddressStep = previousDetails.mailingAddressStep;
      if (
        step === 14 &&
        next === 15 &&
        previousDetails.mailingSameAsRegistered === "no" &&
        !mailingAddressStep
      ) {
        next = 14;
        mailingAddressStep = true;
      } else if (step === 14 && next < 14 && mailingAddressStep) {
        next = 14;
        mailingAddressStep = false;
      }
      let revenueStep = previousDetails.revenueStep;
      if (step === 18 && next === 19 && revenueStep !== "projected") {
        next = 18;
        revenueStep = "projected";
      } else if (step === 18 && next < 18 && revenueStep === "projected") {
        next = 18;
        revenueStep = "annual";
      } else if (step === 19 && next === 18) revenueStep = "projected";
      else if (next === 18 && step < 18) revenueStep = "annual";
      if (!isSavings && !data?.submitted && !editingReview && !fromReview && next === 28 && step !== 30) next = 29;
      let followupProgress = previousDetails.followupProgress ?? {
        acord: 0,
        additional: 0,
      };
      if (!fromReview && (step === 29 || step === 30)) {
        const forward = step === 29 ? next === 30 : next === 28;
        const backward = step === 29 ? next === 25 : next === 29;
        if (forward && (data?.submitted || followupBatch?.status === "ready") && followupIndex < followupQuestions.length - 1) {
          next = step;
          followupProgress = {
            ...followupProgress,
            [followupSection]: followupIndex + 1,
          };
        } else if (backward && (data?.submitted || followupBatch?.status === "ready") && followupIndex > 0) {
          next = step;
          followupProgress = {
            ...followupProgress,
            [followupSection]: followupIndex - 1,
          };
        } else if (forward && next === 30) {
          followupProgress = { ...followupProgress, additional: 0 };
        } else if (backward && next === 29) {
          followupProgress = {
            ...followupProgress,
            acord: Math.max(
              0,
              (data?.followupBatches?.acord?.questions.length ?? 1) - 1,
            ),
          };
        }
      } else if (next === 29 || next === 30) {
        followupProgress = {
          ...followupProgress,
          [next === 29 ? "acord" : "additional"]:
            step === 28 && !fromReview
              ? Math.max(0, (data?.followupBatches?.[next === 29 ? "acord" : "additional"]?.questions ?? [])
                  .flatMap(expandIntakeFollowupQuestion)
                  .filter((question) => followupQuestionVisible(question, previousDetails.followups)).length - 1)
              : 0,
        };
      }
      const nextDetails = {
        ...previousDetails,
        autoVehicleIndex,
        ...(step===42 ? {coverages: previousDetails.coverages.map(line=>line.coverage==="commercial_auto"?{...line,vehicles:line.vehicles?.map((vehicle,index)=>index===(previousDetails.autoVehicleIndex??0)?{...vehicle,estimatedValueSkipped:!!skipped && !vehicle.estimatedValue?.trim()}:vehicle)}:line)} : {}),
        ...(isDriverStep(next) || isDriverStep(step) ? {driverIndex, drivers: previousDetails.drivers?.length ? previousDetails.drivers : [newIntakeDriver()]} : {}),
        ...([29, 30].includes(step) &&
        followupQuestion &&
        !(previousDetails.followups ?? []).some(
          (row) => row.id === followupQuestion.id,
        )
          ? {
              followups: [
                ...(previousDetails.followups ?? []),
                { ...followupQuestion, answer: "", skipped: !!skipped },
              ],
            }
          : {}),
        ...([29, 30].includes(step) && followupQuestion && skipped && (previousDetails.followups ?? []).some((row) => row.id === followupQuestion.id)
          ? { followups: (previousDetails.followups ?? []).map((row) => row.id === followupQuestion.id ? { ...row, skipped: !row.answer.trim() } : row) }
          : {}),
        ...(skipped && step < 28 ? {
          skippedBaseFields: Array.from(new Set([
            ...(previousDetails.skippedBaseFields ?? []),
            ...(step === 18 ? [previousDetails.revenueStep === "projected" ? "projectedRevenue" : "trailingRevenue"] : INTAKE_STEP_FIELDS[step] ?? []),
          ])),
        } : {}),
        ...([29, 30].includes(step) || [29, 30].includes(next)
          ? { followupProgress }
          : {}),
        ...(revenueStep ? { revenueStep } : {}),
        coverageIndex,
        ...(mailingAddressStep !== undefined ? { mailingAddressStep } : {}),
      };
      if (editingReview && !fromReview) {
        const start = editingSection.current;
        const withinSection =
          start === 0
            ? next === 0
            : start === 1
              ? (next >= 1 && next <= 5) || (isSavings && next === 21)
              : start === 6
                ? next >= 6 && next <= 9 || isDriverStep(next) || next===41 || next===42
                : start === 10
                  ? (next >= 10 && next <= 19) || next === 27
                  : start === 20
                    ? next >= 20 && next <= 25 || next===43
                    : start===41 || start===42 ? next===41 || next===42
                    : isDriverStep(start) ? isDriverStep(next)
                    : start === 21
                      ? next === 21 || next === 24
                      : next === start;
        if (!withinSection) next = 28;
      }
      state.current = {
        ...state.current,
        step: next,
        details: nextDetails,
        skippedStep: skipped ? previousStep : undefined,
        dirty: true,
      };
      cache();
      if (!(await flush())) {
        state.current = {
          ...state.current,
          step: previousStep,
          details: previousDetails,
          dirty: true,
        };
        cache();
        return;
      }
      setStep(next);
      setDetails(nextDetails);
      if (data?.submitted && !editingReview && !fromReview)
        window.history.replaceState(
          null,
          "",
          withQuoteProvider(`/intake?request=${requestId}&step=${next}&section=${reviewSection}&coverageIndex=${coverageIndex}`, params.get("provider")),
        );
      if (confirmSave)
        toast.success("Your answers were saved", {
          id: "intake-answers-saved",
        });
      if (editingReview && next === 28) {
        setEditingReview(false);
        window.history.replaceState(null, "", withQuoteProvider(`/intake?request=${requestId}`, params.get("provider")));
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            window.scrollTo({ top: reviewScroll.current, behavior: "instant" }),
          ),
        );
      } else window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }
  async function startNewCompany() {
    if (busy || uploading) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const result = await selectNewCompany({
        requestId,
        expectedRevision: state.current.revision,
      });
      state.current = {
        ...state.current,
        answers: result.answers,
        details: result.details,
        revision: result.revision,
        step: 10,
        dirty: false,
      };
      setAnswers(result.answers);
      setDetails(result.details);
      setEditCompany(true);
      cache();
    } catch (error) {
      setError(
        getUserFacingErrorMessage(error, "Could not start company details"),
      );
    } finally {
      setBusy(false);
    }
  }
  async function restoreSavedCompany() {
    if (busy || uploading) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const result = await selectSavedCompany({
        requestId,
        expectedRevision: state.current.revision,
      });
      state.current = { ...state.current, ...result, step: 10, dirty: false };
      setAnswers(result.answers);
      setDetails(result.details);
      setEditCompany(false);
      cache();
    } catch (error) {
      setError(
        getUserFacingErrorMessage(error, "Could not restore saved company"),
      );
    } finally {
      setBusy(false);
    }
  }
  async function editFromReview(next: number) {
    setSubmissionConfirmed(false);
    reviewScroll.current = window.scrollY;
    editingSection.current = next;
    setEditingReview(true);
    await navigate(next, false, false, true);
  }
  async function returnToReview(confirmSave = false) {
    await navigate(28, confirmSave, false, true);
    if (state.current.step !== 28) return;
    setEditingReview(false);
    window.history.replaceState(null, "", withQuoteProvider(`/intake?request=${requestId}`, params.get("provider")));
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        window.scrollTo({ top: reviewScroll.current, behavior: "instant" }),
      ),
    );
  }
  async function returnToApplication(confirmSave = false) {
    if (busy || uploading) return;
    setBusy(true);
    if (await flush()) {
      if (confirmSave)
        toast.success("Your answers were saved", {
          id: "intake-answers-saved",
        });
      router.push(withQuoteProvider(`/intake?request=${requestId}`, params.get("provider")));
    } else setBusy(false);
  }
  async function removeFile(intakeFileId: Id<"requestIntakeFiles">) {
    if (busy || uploading) return;
    setUploading(true);
    setSubmissionConfirmed(false);
    setError("");
    try {
      await removeUploadedFile({ requestId, intakeFileId });
    } catch (error) {
      setError(getUserFacingErrorMessage(error, "Could not remove file"));
    } finally {
      setUploading(false);
    }
  }
  async function upload(
    file: File,
    category: "requirements" | "policy" | "loss_runs" | "supporting",
  ) {
    setUploading(true);
    setError("");
    try {
      const outcome = await run({
        id: `intake-upload:${requestId}:${file.name}`,
        title: `Uploading ${file.name}`,
        successTitle: "File attached",
        errorTitle: "Could not attach file",
        execute: async (report) => {
          report({ message: "Uploading and saving file" });
          const response = await fetch(
            `/api/intake/upload?request=${requestId}&category=${category}`,
            {
              method: "POST",
              headers: {
                "Content-Type": file.type,
                "X-Spot-Filename": encodeURIComponent(file.name),
              },
              body: file,
              signal: AbortSignal.timeout(45000),
            },
          );
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error ?? "Upload failed. Choose the file again to retry.",
            );
        },
      });
      captureAnalytics("intake_upload_finished", {
        category,
        success: outcome.status === "success",
      });
      if (outcome.status !== "success")
        setError(
          outcome.status === "error" && outcome.error instanceof Error
            ? outcome.error.name === "TimeoutError"
              ? "Upload timed out. Your answers are saved; choose the file again to retry."
              : outcome.error.message
            : "File was not attached. Choose it again to retry.",
        );
    } catch (e) {
      setError(getUserFacingErrorMessage(e, "Could not upload"));
    } finally {
      setUploading(false);
    }
  }
  async function resendEmailCode() {
    if (sendingCode) return;
    setSendingCode(true);
    setError("");
    try {
      await signIn("resend-otp", { email: answers.email! });
      setCodeSent(true);
      setCode("");
      try {
        localStorage.setItem(
          `spot:intake-code-sent:${answers.email!.toLowerCase()}`,
          dayjs().toISOString(),
        );
      } catch {
        /* Sending succeeded. */
      }
      toast.success("Confirmation code sent");
    } catch (e) {
      setError(
        getUserFacingErrorMessage(e, "Could not resend your confirmation code"),
      );
    } finally {
      setSendingCode(false);
    }
  }
  async function confirmEmail() {
    if (uploading) return;
    setBusy(true);
    setError("");
    try {
      if (!(await flush())) return;
      await prepareVerification({
        requestId,
        token: verificationToken.current,
      });
      await completeOtpSignIn(answers.email!, code);
      intentionalRedirect.current = true;
      window.location.assign(
        withQuoteProvider(`/intake?request=${requestId}&verify=${verificationToken.current}`, params.get("provider")),
      );
    } catch (e) {
      intentionalRedirect.current = false;
      setError(getUserFacingErrorMessage(e, "Could not confirm your email"));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (ready) captureAnalytics("intake_step_viewed", { step });
  }, [ready, step]);

  async function finalize() {
    if (!data) return;
    captureAnalytics("intake_submission_started", {
      resubmit: !!data.submitted,
    });
    setBusy(true);
    setError("");
    try {
      if (!(await flush())) return;
      await submit({
        requestId,
        orgId: data.orgId ?? org?.org?._id,
        resubmit: data.submitted,
        confirmedAccurateAndAuthorized: submissionConfirmed,
        expectedRevision: state.current.revision,
      });
      captureAnalytics(
        data.submitted ? "intake_resubmitted" : "intake_submitted",
      );
      try {
        localStorage.removeItem(key);
        if (data?.verified)
          localStorage.removeItem(`spot:intake-proof:${requestId}`);
      } catch {
        /* Submission is already saved. */
      }
      // Convex has already updated the mounted review. Keep it mounted rather
      // than reloading the document and showing the initial loading screen again.
      state.current = { ...state.current, step: 28, dirty: false };
      setStep(28);
      setEditingReview(false);
      setSubmissionConfirmed(false);
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (e) {
      intentionalRedirect.current = false;
      captureAnalytics("intake_submission_failed");
      setError(getUserFacingErrorMessage(e, "Could not finalize"));
    } finally {
      setBusy(false);
    }
  }
  const placeholders: Partial<Record<IntakeField, string>> = {
    name: "Enter your full name",
    email: "you@company.com",
    phone: "Enter your phone number",
    requestDetails: "Add anything else we should know",
    separateQuotes: "List any additional coverages you might need",
    coverageScope: "List the entities, locations, and activities to insure",
    legalName: "Enter your company’s legal name",
    website: "https://company.com",
    dba: "Enter your trading name",
    formation: "Enter the state or country",
    fein: "Enter your FEIN, e.g. 12-3456789",
    businessNumber: "Enter your Canadian business number, e.g. 123456789",
    description: "Describe what your business does",
    yearStarted: "YYYY",
    fullTime: "Number of full-time employees",
    partTime: "Number of part-time employees",
    contractors: "Number of contractors",
    trailingRevenue: "Enter revenue and reporting period",
    projectedRevenue: "Enter projected revenue and reporting period",
    currentInsuranceDetails:
      "List carriers, coverages, limits, and expiration dates",
    claims: "Describe your claims",
    cancellations: "Describe the cancellations or renewal declines",
  };

  const historyField = step === 23 ? "claims" : "cancellations";
  const historyChoiceKey = step === 23 ? "hasClaims" : "hasCancellations";
  const historyAnswer = answers[historyField]?.trim() || "";
  const historyChoice =
    details[historyChoiceKey] ||
    (historyAnswer
      ? /^(none|no|0)$/i.test(historyAnswer)
        ? "no"
        : "yes"
      : "");

  /* eslint-disable react-hooks/refs -- These render helpers only pass ref-backed callbacks to input events; they never invoke those callbacks during render. */
  function field(
    id: IntakeField,
    options?: {
      type?: string;
      multiline?: boolean;
      hint?: string;
      required?: boolean;
    },
  ) {
    const singleField = [1, 3, 5, 8, 9, 10, 13, 20, 22, 23, 25, 26].includes(
      step,
    );
    const placeholder = placeholders[id] ?? INTAKE_FIELDS[id];
    return (
      <Field key={id}>
        <FieldLabel
          className={singleField ? "sr-only" : typeStyle("body.root")}
          htmlFor={`intake-${id}`}
        >
          {INTAKE_FIELDS[id]}
          {options?.required && " *"}
        </FieldLabel>
        {options?.hint && !singleField && (
          <FieldDescription className={typeStyle("body.root")}>
            {options.hint}
          </FieldDescription>
        )}
        {options?.multiline ? (
          <Textarea
            readOnly={false}
            id={`intake-${id}`}
            className={`min-h-32 ${typeStyle("body.root")}`}
            rows={4}
            placeholder={
              singleField && options?.hint && id !== "separateQuotes"
                ? `${placeholder}. ${options.hint}`
                : placeholder
            }
            value={answers[id] ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (id === "fein") {
                const digits = raw.replace(/\D/g, "").slice(0, 9);
                change(
                  id,
                  digits.length > 2
                    ? `${digits.slice(0, 2)}-${digits.slice(2)}`
                    : digits,
                );
              } else if (id === "businessNumber" || id === "yearStarted")
                change(
                  id,
                  raw.replace(/\D/g, "").slice(0, id === "yearStarted" ? 4 : 9),
                );
              else if (["fullTime", "partTime", "contractors"].includes(id))
                change(id, raw.replace(/\D/g, ""));
              else change(id, raw);
            }}
            onBlur={() => void flush()}
          />
        ) : ["fullTime", "partTime", "contractors"].includes(id) ? (
          <IntakeCountInput
            id={`intake-${id}`}
            label={INTAKE_FIELDS[id]}
            value={answers[id] ?? ""}
            placeholder={placeholder}
            onChange={(value) => change(id, value)}
            onBlur={() => void flush()}
          />
        ) : id === "phone" ? (
          <PhoneInput
            readOnly={false}
            id={`intake-${id}`}
            className="min-h-12"
            placeholder={
              singleField && options?.hint
                ? `${placeholder}. ${options.hint}`
                : placeholder
            }
            value={answers[id] ?? ""}
            onChange={(value) => change(id, value ?? "")}
            onBlur={() => void flush()}
          />
        ) : (
          <Input
            id={`intake-${id}`}
            className={`h-12 ${typeStyle("body.root")}`}
            type={id === "yearStarted" ? "text" : (options?.type ?? "text")}
            inputMode={
              [
                "fein",
                "businessNumber",
                "yearStarted",
                "fullTime",
                "partTime",
                "contractors",
              ].includes(id)
                ? "numeric"
                : undefined
            }
            maxLength={
              id === "fein"
                ? 10
                : id === "businessNumber"
                  ? 9
                  : id === "yearStarted"
                    ? 4
                    : undefined
            }
            onInput={
              options?.type === "date"
                ? (event) => change(id, event.currentTarget.value)
                : undefined
            }
            placeholder={
              singleField && options?.hint && id !== "separateQuotes"
                ? `${placeholder}. ${options.hint}`
                : placeholder
            }
            value={answers[id] ?? ""}
            readOnly={id === "email"}
            onChange={(e) => {
              const raw = e.target.value;
              if (id === "fein") {
                const digits = raw.replace(/\D/g, "").slice(0, 9);
                change(
                  id,
                  digits.length > 2
                    ? `${digits.slice(0, 2)}-${digits.slice(2)}`
                    : digits,
                );
              } else if (id === "businessNumber" || id === "yearStarted")
                change(
                  id,
                  raw.replace(/\D/g, "").slice(0, id === "yearStarted" ? 4 : 9),
                );
              else if (["fullTime", "partTime", "contractors"].includes(id))
                change(id, raw.replace(/\D/g, ""));
              else change(id, raw);
            }}
            onBlur={() => void flush()}
          />
        )}
      </Field>
    );
  }
  function select(
    id: IntakeField,
    choices: string[],
    required = false,
    radio = false,
  ) {
    return (
      <Field>
        <FieldLabel
          className={
            [1, 3, 5, 8, 9, 10, 13, 20, 22, 23, 25, 26].includes(step)
              ? "sr-only"
              : typeStyle("body.root")
          }
          htmlFor={`intake-${id}`}
        >
          {INTAKE_FIELDS[id]}
          {required && " *"}
        </FieldLabel>
        {radio || choices.length < 4 ? (
          <IntakeRadioChoices
            label={INTAKE_FIELDS[id]}
            choices={choices}
            value={answers[id] || ""}
            onChange={(value) => change(id, value)}
          />
        ) : choices.length > 10 ? (
          <div
            className={`[&_button]:min-h-12 ${typeStyle("body.root")
              .split(" ")
              .map((token) => `[&_button]:${token}`)
              .join(" ")}`}
          >
            <SearchableSelect
              ariaLabel={INTAKE_FIELDS[id]}
              value={answers[id] || ""}
              options={choices.map((choice) => ({
                value: choice,
                label: choice,
              }))}
              onChange={(value) => change(id, value)}
              placeholder="Choose an option"
            />
          </div>
        ) : (
          <Select
            disabled={false}
            value={answers[id] || null}
            onValueChange={(value) => change(id, value ?? "")}
          >
            <SelectTrigger
              id={`intake-${id}`}
              className={`min-h-12 w-full ${typeStyle("body.root")}`}
            >
              <SelectValue>{answers[id] || "Choose an option"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem
                  key={choice}
                  value={choice}
                  className={typeStyle("body.root")}
                >
                  {choice}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
    );
  }
  /* eslint-enable react-hooks/refs */
  function files(
    category: "requirements" | "policy" | "loss_runs" | "supporting",
    label: string,
  ) {
    return (
      <Field>
        <div
          className={category === "requirements" ? "relative h-52" : undefined}
        >
          {category === "requirements" &&
          (showRequirementsPaste ?? !!answers.requirements?.trim()) ? (
            <>
              <FieldLabel htmlFor="intake-requirements" className="sr-only">
                Insurance requirements
              </FieldLabel>
              <Textarea
                id="intake-requirements"
                autoFocus={showRequirementsPaste === true}
                placeholder="Paste your insurance requirements here"
                value={answers.requirements || ""}
                onChange={(event) => change("requirements", event.target.value)}
                onBlur={() => void flush()}
                className={`h-full min-h-0 resize-none pb-14 ${typeStyle("body.root")}`}
              />
              <Button
                type="button"
                variant="link"
                className={`absolute bottom-4 left-1/2 h-auto -translate-x-1/2 whitespace-nowrap px-0 py-1 underline ${typeStyle("body.large")}`}
                onClick={() => setShowRequirementsPaste(false)}
              >
                or upload a document instead
              </Button>
            </>
          ) : (
            <>
              <FileDropZone
                idleLabel={
                  <span className={typeStyle("body.root")}>{label}</span>
                }
                busyLabel="Uploading…"
                disabled={uploading}
                accept={
                  isSavings && category === "policy"
                    ? ".pdf"
                    : ".pdf,.png,.jpg,.jpeg,.docx"
                }
                padding={
                  category === "requirements" ? "px-6 pt-6 pb-14" : "px-6 py-12"
                }
                className={`border-input ${category === "requirements" ? "h-full" : ""}`}
                hint={
                  <span className={typeStyle("body.root")}>
                    {isSavings && category === "policy"
                      ? "PDF · Up to 20 MB"
                      : "PDF, PNG, JPEG, or DOCX · Up to 20 MB"}
                  </span>
                }
                onFile={(file) => void upload(file, category)}
              />
              {category === "requirements" && (
                <Button
                  type="button"
                  variant="link"
                  className={`absolute bottom-5 left-1/2 h-auto -translate-x-1/2 whitespace-nowrap px-0 py-1 underline ${typeStyle("body.large")}`}
                  aria-controls="intake-requirements"
                  onClick={() => setShowRequirementsPaste(true)}
                >
                  or click to paste your requirements
                </Button>
              )}
            </>
          )}
        </div>
        {data?.files.some((file) => file.category === category) && (
          <ul className="mt-3 space-y-2">
            {data?.files
              .filter((f) => f.category === category)
              .map((f) => (
                <li
                  key={f.id}
                  className={`flex items-center gap-3 ${typeStyle("body.root")}`}
                >
                  <a
                    href={f.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 break-words underline"
                  >
                    {f.name}
                  </a>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    title={`Remove ${f.name}`}
                    className="ml-auto flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    disabled={busy || uploading}
                    onClick={() => void removeFile(f.id)}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Field>
    );
  }
  if (!data || !ready) return <IntakeApplicationLoading />;
  const showSavedCompany =
    !!data.orgId &&
    !!answers.description &&
    !!answers.locations &&
    !editCompany &&
    !data.submitted;
  const submissionProblems=intakeSubmissionProblems(answers,details);
  const missing=submissionProblems.map(problem=>problem.label);
  const completionSteps=Object.fromEntries(submissionProblems.map(problem=>[problem.label,problem.step]));
  if (isSavings && !data.files.some((file) => file.category === "policy"))
    missing.push("Current policy PDF");
  if (
    (data.submitted && reviewStep === undefined && !editingReview) ||
    step === 28
  )
    return (
      <IntakeTracking
        data={{ ...data, answers, details }}
        onEdit={
          isSavings && data.submitted
            ? undefined
            : (next) => void editFromReview(next)
        }
        confirmation={
          !data.submitted || data.hasUnsubmittedChanges ? (
            <div className="pt-4">
              <IntakeCheckboxCard
                id="submission-confirmation"
                label="I confirm that the information in this application is accurate and authorize Spot to shop for insurance on my behalf."
                checked={submissionConfirmed}
                disabled={busy || uploading}
                onCheckedChange={(checked) => setSubmissionConfirmed(checked)}
              />
            </div>
          ) : undefined
        }
        banner={
          data.submitted && !data.verified ? (
            <Card
              className="mb-6 border border-border ring-0"
              aria-label="Confirm your email"
            >
              <CardHeader>
                <CardTitle className={typeStyle("heading.item")}>
                  Confirm your email
                </CardTitle>
                <CardDescription className={typeStyle("body.large")}>
                  Enter the code sent to {answers.email}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <OtpField
                  className="w-fit gap-1.5 [&_input]:size-9 [&_input]:flex-none"
                  value={code}
                  onValueChange={setCode}
                  label="Email code"
                />
                <div className="flex items-center gap-3">
                  <PillButton
                    size="compact"
                    disabled={
                      busy || uploading || sendingCode || code.length !== 6
                    }
                    onClick={() => void confirmEmail()}
                  >
                    {busy ? "Confirming…" : "Confirm"}
                  </PillButton>
                  <PillButton
                    size="compact"
                    variant="ghost"
                    disabled={sendingCode || busy}
                    onClick={() => void resendEmailCode()}
                  >
                    {sendingCode ? "Sending…" : "Resend"}
                  </PillButton>
                </div>
              </CardContent>
            </Card>
          ) : !data.submitted && missing.length ? (
            <Card
              aria-label="Complete before submitting"
              className="gap-0 border border-border ring-0 py-0"
            >
              <CardHeader className="px-4 pt-4 pb-2">
                <CardTitle className={typeStyle("heading.item")}>
                  Complete before submitting
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-2">
                <ul className="divide-y divide-border">
                  {missing.map((item) => (
                    <li key={item}>
                      <Button
                        variant="ghost"
                        className="h-auto w-full justify-start gap-3 rounded-md px-0 py-3 text-left whitespace-normal hover:bg-muted focus-visible:ring-2"
                        disabled={busy || uploading}
                        aria-label={`Go to section: ${item}`}
                        onClick={() => {
                          const problem = submissionProblems.find(row => row.label === item);
                          if (problem?.coverageIndex !== undefined) {
                            changeDetails({
                              ...details,
                              coverageIndex: problem.coverageIndex,
                              ...(problem.vehicleIndex === undefined ? {} : { autoVehicleIndex: problem.vehicleIndex }),
                            });
                          }
                          void editFromReview(completionSteps[item] ?? (item === "Current policy PDF" ? 21 : 10));
                        }}
                      >
                        <Circle
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span
                          className={`min-w-0 flex-1 ${typeStyle("body.default")}`}
                        >
                          {item}
                        </span>
                        <Badge
                          variant="outline"
                          className={`shrink-0 rounded-full border-input px-3 py-1.5 ${typeStyle("label.field")}`}
                          aria-hidden="true"
                        >
                          Go to section
                        </Badge>
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : undefined
        }
        footer={
          isSavings && data.submitted ? (
            <PillButton size="large" variant="ghost" href={withQuoteProvider("/signup", params.get("provider"))}>
              All applications
            </PillButton>
          ) : !data.submitted ? (
            <>
              <PillButton
                size="large"
                variant="ghost"
                onClick={() => void navigate(isSavings ? 19 : 30)}
              >
                <ChevronLeft className="size-4" />
                Back
              </PillButton>
              <PillButton
                size="large"
                disabled={
                  busy ||
                  uploading ||
                  missing.length > 0 ||
                  !submissionConfirmed
                }
                onClick={() => void finalize()}
              >
                {busy ? "Submitting…" : "Submit"}
              </PillButton>
            </>
          ) : (
            <>
              <PillButton size="large" variant="ghost" href={withQuoteProvider("/signup", params.get("provider"))}>
                All applications
              </PillButton>
              <PillButton
                size="large"
                disabled={
                  busy ||
                  uploading ||
                  !data.hasUnsubmittedChanges ||
                  !submissionConfirmed ||
                  missing.length > 0
                }
                onClick={() => void finalize()}
              >
                {busy ? "Resubmitting…" : "Resubmit"}
              </PillButton>
            </>
          )
        }
      />
    );
  const canContinue =
    step===42 ? !estimatedVehicleValueError(autoVehicles(details)[details.autoVehicleIndex??0]?.estimatedValue) :
    isDriverStep(step) ? step === 31 ? !!details.drivers?.length && details.drivers.every(driver=>!!driver.name.trim()) : !!details.drivers?.[details.driverIndex??0] && driverFieldValid(details.drivers[details.driverIndex??0],step) :
    [29, 30].includes(step) ? !followupsPending : isSavings && step === 21
      ? data.files.some((file) => file.category === "policy")
      : step === 23 && details.hasClaims === "yes"
        ? !!answers.claims?.trim()
        : step === 25 && details.hasCancellations === "yes"
          ? !!answers.cancellations?.trim()
          : step === 1
            ? INTAKE_REASONS.includes(answers.trigger ?? "")
            : step === 2
              ? !!answers.effectiveDate &&
                answers.effectiveDate >= dayjs().format("YYYY-MM-DD")
              : step === 3
                ? !!answers.requirements
                : step === 6
                  ? details.coverages.length > 0 &&
                    details.coverages.every(
                      (line) =>
                        line.coverage !== "other" ||
                        (!!line.limits.coverage_description?.trim() &&
                          line.limits.coverage_description !== "I'm not sure"),
                    )
                  : step === 7
                    ? !!details.coverages[details.coverageIndex] &&
                      coverageOption(
                        details.coverages[details.coverageIndex].coverage,
                      ).limits.every((limit) =>
                        validCoverageLimit(
                          limit.key,
                          details.coverages[details.coverageIndex].limits[
                            limit.key
                          ],
                        ),
                      )
                    : step === 12
                      ? !!answers.entityType &&
                        !!details.registrationCountry &&
                        !!details.registrationState &&
                        !!details.registrationAddress?.street1
                      : step === 15
                        ? details.hasRelatedEntities === "no" ||
                          details.relatedEntities.every(
                            (entity) =>
                              !!entity.legalName.trim() &&
                              !!entity.relationship &&
                              !!entity.insured,
                          )
                        : step === 16
                          ? !!answers.description?.trim() &&
                            !!answers.industry &&
                            (!INDUSTRIES.find(
                              (industry) => industry.label === answers.industry,
                            )?.verticals.length ||
                              !!answers.industryVertical)
                          : step === 20
                            ? !!answers.currentInsurance
                            : step === 9
                              ? details.coverages.every((line) =>
                                  validCoverageScope(line, details.scopeNote, details.registrationCountry),
                                )
                              : step === 10
                                ? !!answers.legalName?.trim()
                                : step === 19
                                  ? !!answers.locations?.trim()
                                  : step === 13
                                    ? ((details.registrationCountry ||
                                        "United States") !== "United States" ||
                                        !answers.fein ||
                                        /^\d{2}-?\d{7}$/.test(
                                          answers.fein.trim(),
                                        )) &&
                                      (details.registrationCountry !==
                                        "Canada" ||
                                        !answers.businessNumber ||
                                        /^\d{9}$/.test(
                                          answers.businessNumber.trim(),
                                        ))
                                    : step === 18
                                      ? (() => {
                                          const projected =
                                            details.revenueStep === "projected";
                                          const period = projected
                                            ? details.revenue?.projectedPeriod
                                            : details.revenue?.annualPeriod;
                                          const amount =
                                            (projected
                                              ? details.revenue?.projectedAmount
                                              : details.revenue
                                                  ?.annualAmount) ?? "";
                                          return (
                                            !amount.trim() ||
                                            (!!period &&
                                              /^\d[\d,]*(?:\.\d{1,2})?$/.test(
                                                amount,
                                              ))
                                          );
                                        })()
                                      : step === 17
                                        ? [
                                            answers.fullTime,
                                            answers.partTime,
                                            answers.contractors,
                                          ].every(
                                            (value) =>
                                              !value ||
                                              /^\d+$/.test(value.trim()),
                                          )
                                        : true;
  const optionalValues: Record<number, string | boolean> = {
    41: details.freightHauled??"",
    42: autoVehicles(details)[details.autoVehicleIndex??0]?.estimatedValue??"",
    43: details.noCurrentInsuranceReason??"",
    29: (details.followups ?? []).find((row) => row.id === followupQuestion?.id)?.answer ?? "",
    30: (details.followups ?? []).find((row) => row.id === followupQuestion?.id)?.answer ?? "",
    4:
      data.files.some((file) => file.category === "requirements") ||
      !!answers.requirements?.trim(),
    5: answers.requestDetails?.trim() ?? "",
    8: details.coverages.some((line) => line.additionalCoverages?.trim())
      ? "answered"
      : "",
    11: [answers.website, answers.dba].join("").trim(),
    13:
      (details.registrationCountry || "United States") === "United States"
        ? answers.fein?.trim() || ""
        : answers.businessNumber?.trim() || "",
    14: details.mailingAddressStep
      ? answers.mailingAddress?.trim() || ""
      : details.mailingSameAsRegistered || "",
    15:
      !!details.hasRelatedEntities ||
      details.relatedEntities.length > 0 ||
      !!details.relatedEntitiesNote.trim(),
    17: [answers.fullTime, answers.partTime, answers.contractors]
      .join("")
      .trim(),
    18:
      details.revenueStep === "projected"
        ? details.revenue?.projectedAmount.trim() || ""
        : details.revenue?.annualAmount.trim() || "",
    21: data.files.some((file) => file.category === "policy"),
    23: details.hasClaims || answers.claims?.trim() || "",
    24: data.files.some((file) => file.category === "loss_runs"),
    25: details.hasCancellations || answers.cancellations?.trim() || "",
  };
  // Empty notes, extra coverage requests, and website/DBA are valid answers.
  const canSkipStep = !(step===42 && estimatedVehicleValueError(autoVehicles(details)[details.autoVehicleIndex??0]?.estimatedValue)) && !(isDriverStep(step) && (step === 31 || !driverFieldValid(details.drivers?.[details.driverIndex??0] ?? newIntakeDriver(), step))) && !(step === 9 && details.coverages.some(line=>(line.vehicles??[]).some(vehicle=>!!vinError(vehicle.vin, details.registrationCountry)))) && step !== 28 && !followupsPending && !(isSavings && step === 21);
  const driverValue = details.drivers?.[details.driverIndex??0]?.[DRIVER_FIELDS[step-31]];
  const skipStep =
    canSkipStep && !([29,30].includes(step) && (!followupQuestion || (!data.submitted && followupBatch?.status !== "ready"))) &&
    (!canContinue || (isDriverStep(step) && !driverValue?.trim()) || (step in optionalValues && !optionalValues[step]));
  return (
    <IntakeFrame
      showSteps={!isSavings}
      section={
        step===43 ? 3 : step===41 || step===42 || isDriverStep(step) ? 1 : step < 6
          ? 0
          : step < 10
            ? 1
            : step < 20 || step === 27
              ? 2
              : step === 29
                ? 4
                : step === 30
                  ? 5
                  : step < 28 ? 3 : 6
      }
      status={
        uploading
          ? "Uploading…"
          : !connection.isWebSocketConnected && status !== "Saved"
            ? "Saved on this device"
            : status
      }
      onSection={async (next) => {
        if (data.submitted) {
          if (await flush())
            window.location.assign(
              withQuoteProvider(`/intake?request=${requestId}&step=${next}&section=${next}`, params.get("provider")),
            );
        } else {
          const previousSection = editingSection.current;
          // Section navigation during a review edit adopts the new scope;
          // otherwise its first Continue would finish the old section's edit.
          if (editingReview) editingSection.current = next;
          await navigate(next, false, false, true);
          if (state.current.step === step && next !== step)
            editingSection.current = previousSection;
        }
      }}
      disabled={busy || uploading}
      footer={
        <>
          <PillButton
            size="large"
            variant="ghost"
            disabled={busy || uploading}
            onClick={() =>
              editingReview && step!==42 && !isDriverStep(step) && !([29, 30].includes(step) && followupIndex > 0)
                ? void returnToReview()
                : step === 1
                  ? void (async () => {
                      if (await flush()) router.push(withQuoteProvider("/signup", params.get("provider")));
                    })()
                  : void navigate(
                      step === 29 ? 25 : step === 30 ? 29 : step === 8 && details.coverages[0]?.coverage === "unknown"
                        ? 6
                        : step === 5
                          ? 2
                          : step === 25 && answers.currentInsurance === "No"
                            ? 23
                            : step === 25 &&
                                /^(none|no|0)$/i.test(
                                  answers.claims?.trim() ?? "",
                                )
                              ? 23
                              : step === 20
                                ? 27
                                : step === 27
                                  ? 19
                                  : step - 1,
                    )
            }
          >
            {!editingReview && step === 1 ? (
              "Cancel"
            ) : (
              <>
                <ChevronLeft className="size-4" />
                Back
              </>
            )}
          </PillButton>
          <div className="ml-auto flex items-center gap-3">
            {step === 10 && showSavedCompany && (
              <PillButton
                size="large"
                variant="secondary"
                disabled={busy || uploading}
                onClick={() => void startNewCompany()}
              >
                New company
              </PillButton>
            )}
            {step === 10 &&
              !showSavedCompany &&
              !data.submitted &&
              data.canUseSavedCompany && (
                <PillButton
                  size="large"
                  variant="secondary"
                  disabled={busy || uploading}
                  onClick={() => void restoreSavedCompany()}
                >
                  Use saved company
                </PillButton>
              )}
            {!editingReview &&
            data.submitted &&
            [4, 5, 9, 21, 24, 27, 28].includes(step) ? (
              <PillButton
                size="large"
                disabled={busy || uploading || (!canContinue && !canSkipStep)}
                variant={skipStep ? "secondary" : "primary"}
                onClick={() => void returnToApplication(!skipStep)}
              >
                {skipStep ? "Skip" : "Continue"}
              </PillButton>
            ) : step !== 28 ? (
              <PillButton
                size="large"
                disabled={busy || uploading || (!canContinue && !canSkipStep)}
                variant={skipStep ? "secondary" : "primary"}
                onClick={() =>
                  void navigate(
                    step === 29 ? 30 : step === 30 ? 28 : step === 6 && details.coverages[0]?.coverage === "unknown"
                      ? 8
                      : step === 3 &&
                          ["No", "None"].includes(answers.requirements ?? "")
                        ? 5
                        : step === 20 && answers.currentInsurance === "No"
                          ? 25
                          : step === 23 &&
                              /^(none|no|0)$/i.test(
                                answers.claims?.trim() ?? "",
                              )
                            ? 25
                            : step === 10 &&
                                data.orgId &&
                                answers.description &&
                                answers.locations &&
                                !editCompany &&
                                !editingReview &&
                                !data.submitted
                              ? 27
                              : step === 19
                                ? 27
                                : step === 26
                                  ? 28
                                  : step === 27
                                    ? 20
                                    : step + 1,
                    !skipStep,
                    skipStep,
                  )
                }
              >
                {busy || followupsPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {followupsPending ? "Preparing questions…" : skipStep ? "Skip" : "Continue"}
              </PillButton>
            ) : (
              <PillButton
                size="large"
                disabled={
                  busy ||
                  uploading ||
                  missing.length > 0 ||
                  (!data.verified && codeSent && code.length !== 6)
                }
                onClick={() => void finalize()}
              >
                {busy ? "Submitting…" : "Submit"}
              </PillButton>
            )}
          </div>
        </>
      }
    >
      <h1 className={`text-wrap-pretty ${typeStyle("heading.display")}`}>
        {personalizeIntakeQuestion((step === 29 || step === 30) && (data.submitted || followupBatch?.status === "ready") && followupQuestion
          ? followupQuestion.label
          : isDriverStep(step) ? driverQuestion(step,details.drivers?.[details.driverIndex??0]?.name)
          : isSavings && step === 21
          ? "Can you upload your current policies?"
          : step === 10 && showSavedCompany
            ? "Are you applying for your saved business?"
            : step === 7
              ? `What limits do you need for ${details.coverages[details.coverageIndex] ? coverageRequestLabel(details.coverages[details.coverageIndex]).toLowerCase() : "coverage"}?`
              : step === 18 && details.revenueStep === "projected"
                ? "Where do you project your business’s revenue to be?"
                : step === 14 && details.mailingAddressStep
                  ? "What is your mailing address?"
                  : INTAKE_STEPS[step],answers.legalName || answers.dba)}
      </h1>
      <div className="h-10" />
      <div className="space-y-6">
        {(step === 29 || step === 30) && <IntakeFollowups
          question={followupQuestion}
          businessName={answers.legalName || answers.dba}
          status={data.submitted ? "ready" : followupWaitExpired && followupBatch?.status !== "ready" ? "failed" : followupBatch?.status}
          answer={(details.followups ?? []).find((row) => row.id === followupQuestion?.id)?.answer ?? ""}
          onChange={changeFollowup}
        />}
        {step === 0 && (
          <>
            {field("name", { required: true })}
            {field("email")}
            {field("phone", { type: "tel", required: true })}
          </>
        )}
        {step === 1 && select("trigger", INTAKE_REASONS, true, true)}
        {step === 2 && (
          <>
            <IntakeDateFields
              details={details}
              onChange={changeDetails}
              disabled={false}
            />
          </>
        )}
        {step === 4 && files("requirements", "Upload insurance requirements")}
        {step === 5 && (
          <>
            {field("requestDetails", { multiline: true })}
            {files("supporting", "Upload a supporting document")}
          </>
        )}
        {step === 6 && (
          <IntakeCoverageSelection
            details={details}
            onChange={changeDetails}
            disabled={false}
          />
        )}
        {step === 7 && (
          <IntakeCoverageLimits
            details={details}
            onChange={changeDetails}
            disabled={false}
          />
        )}
        {step === 8 && (
          <IntakeAdditionalCoverages
            details={details}
            onChange={changeDetails}
          />
        )}
        {[41,42].includes(step) && <IntakeAutoQuoteFields details={details} step={step} onChange={changeDetails} />}
        {isDriverStep(step) && <IntakeDriverFields details={details} step={step} onChange={changeDetails} />}
        {step === 9 && (
          <IntakeCoverageScope details={details} onChange={changeDetails} />
        )}
        {step === 10 &&
          (showSavedCompany ? (
            <IntakeSavedBusinessSummary answers={answers} details={details} />
          ) : (
            field("legalName", { required: true })
          ))}
        {step === 11 && (
          <>
            {field("website", { type: "url" })}
            {field("dba")}
          </>
        )}
        {step === 12 && (
          <>
            {select("entityType", [
              "LLC",
              "Corporation",
              "S corporation",
              "Partnership",
              "Sole proprietor",
              "Nonprofit",
              "Trust / estate",
              "Government",
              "Other",
              "Not sure",
            ])}
            <IntakeRegistration details={details} onChange={changeDetails} />
          </>
        )}
        {step === 13 && (
          <>
            {(details.registrationCountry || "United States") ===
              "United States" && field("fein")}
            {details.registrationCountry === "Canada" &&
              field("businessNumber")}
          </>
        )}
        {step === 14 && (
          <IntakeMailingAddress
            details={details}
            onChange={changeDetails}
            disabled={false}
          />
        )}
        {step === 15 && (
          <IntakeRelatedEntities
            details={details}
            onChange={changeDetails}
            disabled={false}
          />
        )}
        {step === 16 && (
          <>
            {field("description", { multiline: true, required: true })}
            {field("yearStarted", { type: "number" })}
            {select("industry", [
              ...INDUSTRIES.map((industry) => industry.label),
              "I'm not sure",
            ])}
            {INDUSTRIES.find((industry) => industry.label === answers.industry)
              ?.verticals.length
              ? select("industryVertical", [
                  ...INDUSTRIES.find(
                    (industry) => industry.label === answers.industry,
                  )!.verticals.map((vertical) => vertical.label),
                  "I'm not sure",
                ])
              : null}
          </>
        )}
        {step === 17 && (
          <>
            {field("fullTime", { type: "number" })}
            {field("partTime", { type: "number" })}
            {field("contractors", { type: "number" })}
          </>
        )}
        {step === 18 && (
          <IntakeRevenueFields details={details} onChange={changeDetails} />
        )}
        {step === 19 && (
          <IntakeLocations
            defaultActivities={answers.description?.trim() ?? ""}
            details={details}
            onChange={changeDetails}
            disabled={false}
          />
        )}
        {step === 20 &&
          select("currentInsurance", ["Yes", "No", "Not sure"], true)}
        {step === 21 && files("policy", "Upload your current policies")}
        {(step === 23 || step === 25) && (
          <>
            <IntakeRadioChoices
              label={
                step === 23
                  ? "Has your business had any claims?"
                  : "Has coverage been cancelled or declined for renewal?"
              }
              choices={["Yes", "No"]}
              value={
                historyChoice === "yes"
                  ? "Yes"
                  : historyChoice === "no"
                    ? "No"
                    : ""
              }
              onChange={(value) => {
                changeDetails({
                  ...details,
                  [historyChoiceKey]: value === "Yes" ? "yes" : "no",
                });
                if (value === "No") change(historyField, "No");
                else if (/^(none|no|0)$/i.test(historyAnswer))
                  change(historyField, "");
              }}
            />
            {historyChoice === "yes" &&
              field(historyField, {
                multiline: true,
                hint:
                  step === 23
                    ? "Include the time period and any open claims."
                    : undefined,
              })}
          </>
        )}
        {step === 24 &&
          files("loss_runs", "Upload loss runs or claims history")}
      </div>
    </IntakeFrame>
  );
}
