"use client";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  IntakeRadioChoices,
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
  detailsAnswers,
  detailsFromAnswers,
  coverageOption,
  validCoverageLimit,
  validCoverageScope,
  needsCoverageScope,
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
  hasIntakeRequirements,
  INTAKE_STEPS,
  INTAKE_VERSION,
  missingIntakeAnswers,
  type IntakeAnswers,
  type IntakeField,
} from "@/lib/insurance-intake";
import { IntakeFrame } from "./frame";
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
import { completeOtpSignIn } from "@/lib/otp-auth";
import { useBackgroundTasks } from "@claritylabs-inc/ui/components/background-tasks";
import { ChevronLeft, Loader2 } from "lucide-react";

type Recovery = {
  answers: IntakeAnswers;
  step: number;
  revision: number;
  dirty: boolean;
  version?: number;
  details?: IntakeDetails;
  skippedStep?: number;
};
export function InsuranceIntake() {
  const params = useSearchParams();
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
              : 20),
  );
  const reviewCoverageIndex = Number(params.get("coverageIndex") ?? 0);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const confirmOwnership = useMutation(
    api.requestIntake.confirmVerifiedOwnership,
  );
  const [confirmationError, setConfirmationError] = useState("");
  const verification = params.get("verify");
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
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
        window.location.replace(`/intake?request=${requestId}`);
      })
      .catch((e) => {
        setConfirmationError(
          getUserFacingErrorMessage(e, "Could not confirm your application"),
        );
      });
  }, [verification, requestId, isAuthenticated, confirmOwnership]);
  if (verification)
    return (
      <IntakeFrame>
        <p>{confirmationError || "Confirming your saved application…"}</p>
        {confirmationError && (
          <PillButton href="/signup">Find my drafts</PillButton>
        )}
      </IntakeFrame>
    );
  if (!requestId)
    return (
      <IntakeFrame>
        <PillButton href="/signup">Start an insurance request</PillButton>
      </IntakeFrame>
    );
  if (isLoading) return <IntakeFrame>Loading your application…</IntakeFrame>;
  if (!isAuthenticated || viewer === null)
    return (
      <IntakeFrame>
        <p>Log in to resume your saved application.</p>
        <PillButton
          href={`/login?next=${encodeURIComponent(`/intake?request=${requestId}`)}`}
        >
          Log in
        </PillButton>
      </IntakeFrame>
    );
  if (confirmationError)
    return (
      <IntakeFrame>
        <p role="alert">{confirmationError}</p>
        <PillButton href="/signup">Find my drafts</PillButton>
      </IntakeFrame>
    );
  if (!recovered)
    return <IntakeFrame>Checking your saved application…</IntakeFrame>;
  return (
    <Application
      key={`${requestId}:${reviewStep ?? "application"}`}
      requestId={requestId}
      reviewStep={reviewStep}
      reviewSection={reviewSection}
      reviewCoverageIndex={reviewCoverageIndex}
    />
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
  const connection = useConvexConnectionState();
  const data = useQuery(api.requestIntake.get, { requestId });
  const router = useRouter();
  const save = useMutation(api.requestIntake.save);
  const prepareVerification = useMutation(
    api.requestIntake.prepareVerification,
  );
  const submit = useMutation(api.requestIntake.submit);
  const { signIn } = useAuthActions();
  const { run } = useBackgroundTasks();
  const org = useQuery(api.orgs.viewerOrg, data?.verified ? {} : "skip");
  const [answers, setAnswers] = useState<IntakeAnswers>({});
  const [details, setDetails] = useState<IntakeDetails>(detailsFromAnswers({}));
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const verificationToken = useRef("");
  const state = useRef<Recovery>({
    answers: {},
    step: 0,
    revision: 0,
    dirty: false,
  });
  const initialized = useRef(false);
  const [editCompany, setEditCompany] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const running = useRef<Promise<boolean> | null>(null);
  const conflict = useRef(false);
  const key = `spot:request-intake:${requestId}`;
  const needsProof = !!data && !data.verified && !data.submitted;
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
    if (
      state.current.step === 3 ||
      (state.current.step === 4 &&
        !hasIntakeRequirements(state.current.answers))
    )
      state.current.step = hasIntakeRequirements(state.current.answers) ? 4 : 5;
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
  function change(field: IntakeField, value: string) {
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

  async function navigate(next: number, confirmSave = false, skipped = false) {
    if (busy || uploading) return;
    const previousStep = step;
    const previousDetails = state.current.details ?? details;
    setBusy(true);
    try {
      if (!(await flush())) return;
      if (next === 3)
        next =
          step > 3 ? 2 : hasIntakeRequirements(state.current.answers) ? 4 : 5;
      if (next === 4 && !hasIntakeRequirements(state.current.answers))
        next = step > 4 ? 2 : 5;
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
        next = step > 9 ? 8 : 10;
      if (
        next === 13 &&
        !["United States", "Canada"].includes(
          previousDetails.registrationCountry || "United States",
        )
      )
        next = step > 13 ? 12 : 14;
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
      const nextDetails = {
        ...previousDetails,
        coverageIndex,
        ...(mailingAddressStep !== undefined ? { mailingAddressStep } : {}),
      };
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
      if (data?.submitted)
        window.history.replaceState(
          null,
          "",
          `/intake?request=${requestId}&step=${next}&section=${reviewSection}&coverageIndex=${coverageIndex}`,
        );
      if (confirmSave)
        toast.success("Your answers were saved", {
          id: "intake-answers-saved",
        });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }
  async function returnToApplication(confirmSave = false) {
    if (busy || uploading) return;
    setBusy(true);
    if (await flush()) {
      if (confirmSave)
        toast.success("Your answers were saved", {
          id: "intake-answers-saved",
        });
      router.push(`/intake?request=${requestId}`);
    } else setBusy(false);
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
  async function finalize() {
    setBusy(true);
    setError("");
    try {
      if (!(await flush())) return;
      if (!data?.verified) {
        if (!codeSent) {
          verificationToken.current =
            crypto.randomUUID().replaceAll("-", "") +
            crypto.randomUUID().replaceAll("-", "");
          await prepareVerification({
            requestId,
            token: verificationToken.current,
          });
          try {
            localStorage.setItem(
              `spot:intake-proof:${requestId}`,
              verificationToken.current,
            );
          } catch {
            /* The redirect carries this proof too. */
          }
          await signIn("resend-otp", { email: answers.email! });
          setCodeSent(true);
        } else {
          await completeOtpSignIn(answers.email!, code);
          window.location.assign(
            `/intake?request=${requestId}&verify=${verificationToken.current}`,
          );
        }
        return;
      }
      const result = await submit({
        requestId,
        orgId: data.orgId ?? org?.org?._id,
      });
      try {
        localStorage.removeItem(key);
        localStorage.removeItem(`spot:intake-proof:${requestId}`);
      } catch {
        /* Submission is already saved. */
      }
      window.location.assign(`/intake?request=${result.requestId}`);
    } catch (e) {
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
    contractors: "Number of contract workers",
    trailingRevenue: "Enter revenue and reporting period",
    projectedRevenue: "Enter projected revenue and reporting period",
    currentInsuranceDetails:
      "List carriers, coverages, limits, and expiration dates",
    claims: "Describe claims, or enter No",
    cancellations: "Describe cancellations or declines, or enter No",
    changes: "Describe planned changes, or enter No",
  };

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
  function confirm(id: IntakeField, label: string) {
    return (
      <IntakeCheckboxCard
        id={`intake-${id}`}
        label={label}
        checked={answers[id] === "yes"}
        disabled={false}
        onCheckedChange={(checked) => change(id, checked ? "yes" : "")}
      />
    );
  }

  function files(
    category: "requirements" | "policy" | "loss_runs",
    label: string,
  ) {
    return (
      <Field>
        <FileDropZone
          idleLabel={<span className={typeStyle("body.root")}>{label}</span>}
          busyLabel="Uploading…"
          disabled={uploading}
          accept=".pdf,.png,.jpg,.jpeg,.docx"
          padding="px-6 py-12"
          hint={
            <span className={typeStyle("body.root")}>
              PDF, PNG, JPEG, or DOCX · Up to 20 MB
            </span>
          }
          onFile={(file) => void upload(file, category)}
        />
        <ul className="mt-3 space-y-2">
          {data?.files
            .filter((f) => f.category === category)
            .map((f) => (
              <li key={f.id} className={typeStyle("body.root")}>
                <a
                  href={f.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {f.name}
                </a>
                <span className="ml-2 text-muted-foreground">Uploaded</span>
              </li>
            ))}
        </ul>
      </Field>
    );
  }
  if (!data || !ready)
    return <IntakeFrame>Loading your application…</IntakeFrame>;
  if (data.submitted && reviewStep === undefined)
    return <IntakeTracking data={data} />;
  const missing = missingIntakeAnswers(answers);
  const canContinue =
    step === 1
      ? INTAKE_REASONS.includes(answers.trigger ?? "")
      : step === 2
        ? !!answers.effectiveDate
        : step === 3
          ? !!answers.requirements
          : step === 6
            ? details.coverages.length > 0
            : step === 7
              ? !!details.coverages[details.coverageIndex] &&
                coverageOption(
                  details.coverages[details.coverageIndex].coverage,
                ).limits.every((limit) =>
                  validCoverageLimit(
                    limit.key,
                    details.coverages[details.coverageIndex].limits[limit.key],
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
                            validCoverageScope(line, details.scopeNote),
                          )
                        : step === 10
                          ? !!answers.legalName?.trim()
                          : step === 19
                            ? !!answers.locations?.trim()
                            : step === 27
                              ? answers.companyConfirmed === "yes"
                              : step === 13
                                ? ((details.registrationCountry ||
                                    "United States") !== "United States" ||
                                    !answers.fein ||
                                    /^\d{2}-?\d{7}$/.test(
                                      answers.fein.trim(),
                                    )) &&
                                  (details.registrationCountry !== "Canada" ||
                                    !answers.businessNumber ||
                                    /^\d{9}$/.test(
                                      answers.businessNumber.trim(),
                                    ))
                                : step === 17
                                  ? [
                                      answers.fullTime,
                                      answers.partTime,
                                      answers.contractors,
                                    ].every(
                                      (value) =>
                                        !value || /^\d+$/.test(value.trim()),
                                    )
                                  : true;
  const optionalValues: Record<number, string | boolean> = {
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
    18: [answers.trailingRevenue, answers.projectedRevenue].join("").trim(),
    21: data.files.some((file) => file.category === "policy"),
    22: answers.currentInsuranceDetails?.trim() ?? "",
    23: answers.claims?.trim() ?? "",
    24: data.files.some((file) => file.category === "loss_runs"),
    25: answers.cancellations?.trim() ?? "",
    26: answers.changes?.trim() ?? "",
  };
  const skipStep = step in optionalValues && !optionalValues[step];
  return (
    <IntakeFrame
      section={
        step < 6
          ? 0
          : step < 10
            ? 1
            : step < 20 || step === 27
              ? 2
              : step < 28
                ? 3
                : 4
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
              `/intake?request=${requestId}&step=${next}&section=${next}`,
            );
        } else void navigate(next);
      }}
      disabled={busy || uploading}
      footer={
        <>
          {data.submitted && step === reviewSection ? (
            <PillButton
              size="large"
              variant="ghost"
              onClick={() => void returnToApplication()}
            >
              <ChevronLeft className="size-4" />
              Your application
            </PillButton>
          ) : (
            <PillButton
              size="large"
              variant="ghost"
              disabled={(!data.submitted && step <= 1) || busy || uploading}
              onClick={() =>
                void navigate(
                  step === 8 && details.coverages[0]?.coverage === "unknown"
                    ? 6
                    : step === 5 && !hasIntakeRequirements(answers)
                      ? 2
                      : step === 23 && answers.currentInsurance === "No"
                        ? 20
                        : step === 25 &&
                            /^(none|no|0)$/i.test(answers.claims?.trim() ?? "")
                          ? 23
                          : step === 20
                            ? 27
                            : step === 27
                              ? 19
                              : step === 28
                                ? 26
                                : step - 1,
                )
              }
            >
              <ChevronLeft className="size-4" />
              Back
            </PillButton>
          )}
          {data.submitted && [4, 5, 9, 21, 24, 26, 27, 28].includes(step) ? (
            <PillButton
              size="large"
              disabled={busy || uploading || !canContinue}
              variant={skipStep ? "secondary" : "primary"}
              onClick={() => void returnToApplication(!skipStep)}
            >
              {skipStep ? "Skip" : "Continue"}
            </PillButton>
          ) : step < INTAKE_STEPS.length - 1 ? (
            <PillButton
              size="large"
              disabled={busy || uploading || !canContinue}
              variant={skipStep ? "secondary" : "primary"}
              onClick={() =>
                void navigate(
                  step === 6 && details.coverages[0]?.coverage === "unknown"
                    ? 8
                    : step === 3 &&
                        ["No", "None"].includes(answers.requirements ?? "")
                      ? 5
                      : step === 20 && answers.currentInsurance === "No"
                        ? 23
                        : step === 23 &&
                            /^(none|no|0)$/i.test(answers.claims?.trim() ?? "")
                          ? 25
                          : step === 10 &&
                              data.orgId &&
                              answers.description &&
                              answers.locations &&
                              !editCompany &&
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
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {skipStep ? "Skip" : "Continue"}
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
              {busy
                ? "Finalizing…"
                : data.verified
                  ? "Submit insurance request"
                  : codeSent
                    ? "Confirm email"
                    : "Send email code"}
            </PillButton>
          )}
        </>
      }
    >
      <h1 className={`text-wrap-pretty ${typeStyle("heading.display")}`}>
        {step === 7
          ? `What limits do you need for ${coverageOption(details.coverages[details.coverageIndex]?.coverage ?? "unknown").label.toLowerCase()}?`
          : step === 14 && details.mailingAddressStep
            ? "What is your mailing address?"
            : INTAKE_STEPS[step]}
      </h1>
      <div className="h-10" />
      {error && (
        <div
          role="alert"
          className={`mb-6 rounded-xl border border-destructive/30 p-4 text-destructive ${typeStyle("body.root")}`}
        >
          <p>{error}</p>
          {hasConflict && (
            <div className="mt-3 flex gap-3">
              <PillButton
                variant="secondary"
                onClick={() => {
                  localStorage.removeItem(key);
                  window.location.reload();
                }}
              >
                Load saved version
              </PillButton>
              <PillButton
                onClick={() => {
                  state.current.revision = data.revision;
                  conflict.current = false;
                  setHasConflict(false);
                  void flush();
                }}
              >
                Save my reviewed answers
              </PillButton>
            </div>
          )}
        </div>
      )}
      <div className="space-y-6">
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
        {step === 4 && (
          <>
            {files("requirements", "Upload insurance requirements")}
            <p
              className={`${typeStyle("caption.default")} text-muted-foreground`}
            >
              If your requirements are part of a mortgage, lease, or other
              contract, you can upload the whole file.
            </p>
            <Field>
              <FieldLabel htmlFor="intake-requirements" className="sr-only">
                Insurance requirements
              </FieldLabel>
              <Textarea
                id="intake-requirements"
                placeholder="Or paste your insurance requirements here"
                value={answers.requirements || ""}
                onChange={(event) => change("requirements", event.target.value)}
                onBlur={() => void flush()}
                className={`min-h-40 ${typeStyle("body.root")}`}
              />
            </Field>
          </>
        )}
        {step === 5 && field("requestDetails", { multiline: true })}
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
        {step === 9 && (
          <IntakeCoverageScope details={details} onChange={changeDetails} />
        )}
        {step === 10 &&
          (data.orgId &&
          answers.description &&
          answers.locations &&
          !editCompany &&
          !data.submitted ? (
            <div className="space-y-6">
              <Field>
                <FieldLabel className={typeStyle("body.root")}>
                  Saved company details
                </FieldLabel>
                <p className={typeStyle("body.root")}>{answers.legalName}</p>
                <p className={`whitespace-pre-wrap ${typeStyle("body.root")}`}>
                  {answers.description}
                </p>
                <p className={`whitespace-pre-wrap ${typeStyle("body.root")}`}>
                  {answers.locations}
                </p>
              </Field>
              <PillButton
                size="large"
                variant="secondary"
                onClick={() => setEditCompany(true)}
              >
                Update company details
              </PillButton>
            </div>
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
          <>
            {field("trailingRevenue")}
            {field("projectedRevenue")}
          </>
        )}
        {step === 19 && (
          <IntakeLocations
            details={details}
            onChange={changeDetails}
            disabled={false}
          />
        )}
        {step === 20 &&
          select("currentInsurance", ["Yes", "No", "Not sure"], true)}
        {step === 21 && files("policy", "Upload your current policies")}
        {step === 22 && field("currentInsuranceDetails", { multiline: true })}
        {step === 23 &&
          field("claims", {
            multiline: true,
            hint: "Include the time period and open claims, or say none / not sure.",
          })}
        {step === 24 &&
          files("loss_runs", "Upload loss runs or claims history")}
        {step === 25 && field("cancellations", { multiline: true })}
        {step === 26 && field("changes", { multiline: true })}
        {step === 27 && (
          <>
            <OperationalLabelValueList className="[&>dl>div]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] [&>dl>div]:gap-4 [&_dd]:text-right">
              {COMPANY_INTAKE_FIELDS.filter((key) =>
                key === "fein"
                  ? (details.registrationCountry || "United States") ===
                    "United States"
                  : key === "businessNumber"
                    ? details.registrationCountry === "Canada"
                    : true,
              ).map((key) => (
                <OperationalLabelValueRow
                  key={key}
                  align="right"
                  label={
                    <span className={typeStyle("body.root")}>
                      {INTAKE_FIELDS[key]}
                    </span>
                  }
                  value={
                    <span
                      className={`whitespace-pre-wrap ${typeStyle("body.root")}`}
                    >
                      {answers[key] || "Not provided"}
                    </span>
                  }
                />
              ))}
            </OperationalLabelValueList>
            {confirm(
              "companyConfirmed",
              "I confirm these company details are current.",
            )}
          </>
        )}
        {step === 28 && (
          <>
            {missing.length > 0 && (
              <div className="rounded-xl border p-4">
                <h2 className={`text-wrap-pretty ${typeStyle("body.root")}`}>
                  Needed before submission
                </h2>
                <ul
                  className={`mt-3 list-disc space-y-1 pl-5 ${typeStyle("body.root")}`}
                >
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <OperationalLabelValueList className="[&>dl>div]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] [&>dl>div]:gap-4 [&_dd]:text-right">
              {Object.entries(answers)
                .filter(
                  ([key, value]) =>
                    key !== "deadline" &&
                    (key !== "requirements" ||
                      hasIntakeRequirements(answers)) &&
                    value?.trim() &&
                    (key !== "fein" ||
                      (details.registrationCountry || "United States") ===
                        "United States") &&
                    (key !== "businessNumber" ||
                      details.registrationCountry === "Canada"),
                )
                .map(([key, value]) => (
                  <OperationalLabelValueRow
                    key={key}
                    align="right"
                    label={
                      <span className={typeStyle("body.root")}>
                        {INTAKE_FIELDS[key as IntakeField]}
                      </span>
                    }
                    value={
                      <span
                        className={`whitespace-pre-wrap ${typeStyle("body.root")}`}
                      >
                        {value}
                      </span>
                    }
                  />
                ))}
            </OperationalLabelValueList>
            <div className={typeStyle("body.root")}>
              <p>{data.files.length} uploaded document(s)</p>
              <p className="mt-2 text-muted-foreground">
                You can submit without optional documents. We’ll identify what
                else is needed before approaching insurers.
              </p>
            </div>
            {!data.verified && (
              <div className="rounded-xl border p-5 space-y-4">
                <h2 className={`text-wrap-pretty ${typeStyle("body.root")}`}>
                  Confirm your work email
                </h2>
                <p
                  className={`text-muted-foreground ${typeStyle("body.root")}`}
                >
                  We’ll send a fresh code to {answers.email}.
                </p>
                {codeSent && (
                  <Field>
                    <FieldLabel className={typeStyle("body.root")}>
                      Email code
                    </FieldLabel>
                    <OtpField
                      value={code}
                      onValueChange={setCode}
                      label="Email code"
                      autoFocus
                    />
                  </Field>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </IntakeFrame>
  );
}
