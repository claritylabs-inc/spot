"use client";
import { ClientInformationForms } from "./information-form";
import { INTAKE_TERMS_VERSION } from "@/lib/intake-terms";
import { isIntakePercentageQuestion } from "@/lib/intake-percentages";
import { vehicleRelevanceKey, filterVehicleRelevantQuestions } from "@/lib/intake-vehicle-relevance";
import { isWorkforceProviderSource, workforceProviderComplete } from "@/lib/intake-workforce-provider";
import {
  useFollowedState,
  useIsFollowing,
  useLeaderOnly,
} from "@/hooks/use-followed-state";
import { workJurisdictionsComplete } from "@/lib/intake-jurisdictions";
import { payrollAnswerComplete, payrollPages, payrollPageTitle, payrollPageValue, parsePayrollAnswer } from "@/lib/intake-payroll";
import { cyberDocumentQuestions, cyberDocumentUrlValid, intakeCyberResearchKey, withCyberDocumentQuestions } from "@/lib/intake-cyber-research";
import { vehicleSubsectionQuestions as unfilteredVehicleSubsectionQuestions, isVehicleSubsectionQuestion, withVehicleSubsections as unfilteredWithVehicleSubsections } from "@/lib/intake-vehicle-subsections";
import { propertySubsectionQuestions, isPropertySubsectionQuestion, withPropertySubsections } from "@/lib/intake-property-subsections";
import { intakeCatalogCoverage } from "@/lib/intake-acord-questions";
import { intakeCoverageDestination, intakeCoveragePages } from "@/lib/intake-coverage-navigation";
import { intakeApplicantQuestion, intakeLocationHeading } from "@/lib/intake-applicant-wording";
import { routeAnswerComplete } from "@/lib/route-input";
import { parseCalendarDateInput } from "@/lib/date-format";
import { intakeSection, atIntakeSectionStart } from "@/lib/intake-sections";
import { isFixedVehicleFollowup } from "@/lib/intake-vehicle-underwriting";
import { mergeRequirementCoverageSuggestions } from "@/lib/intake-requirement-prefill";
import { invalidateIntakePrefills } from "@/lib/intake-prefill-state";
import { IntakeSectionIntroduction } from "./section-introduction";
import { intakeSubmissionProblems } from "@/lib/intake-submission";
import { driverQuestion, DRIVER_FIELDS, isDriverStep, hasCommercialAuto, newIntakeDriver, driverFieldValid } from "@/lib/intake-drivers";
import { vinError } from "@/lib/intake-vehicles";
import { IntakeAutoQuoteFields } from "./auto-quote-fields";
import { autoVehicles, estimatedVehicleValueError } from "@/lib/intake-auto-quote";
import { VehicleSpecificationLookup } from "./vehicle-specification-lookup";
import { IntakeDriverFields } from "./driver-fields";
import { INTAKE_STEP_FIELDS } from "@/lib/intake-question-history";
import { IntakeFollowups } from "./followups";
import { intakeFollowupLastPageIndex, intakeFollowupPages, intakeFollowupPageTitle, personalizeIntakeQuestion, followupQuestionVisible, expandIntakeFollowupQuestion, withIntakeFollowupAnswer, type IntakeFollowupQuestion } from "@/lib/intake-followups";
import { WebsiteInput } from "@claritylabs-inc/ui/components/website-input";
import { captureAnalytics } from "@/lib/analytics";
import dayjs from "dayjs";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { IntakeLoadingState } from "./loading-state";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
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
  IntakeCoverageScope,
  IntakeCheckboxCard,
  IntakeCoverageSelection,
  IntakeCoverageLimits,
  IntakeDateFields,
  IntakeMailingAddress,
  IntakeRelatedEntities,
} from "./details-fields";
import {
  addressText,
  detailsAnswers,
  detailsFromAnswers,
  coverageOption,
  COVERAGE_OPTIONS,
  newCoverage,
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
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  useConvexAuth,
  useConvexConnectionState,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  COMPANY_INTAKE_FIELDS,
  ENTITY_TYPES,
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
import { ArrowRight, ChevronLeft, Circle, X } from "lucide-react";

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
        <div aria-hidden="true" className="flex w-full justify-between">
          <Skeleton className="h-12 w-20 rounded-full" />
          <Skeleton className="h-12 w-28 rounded-full" />
        </div>
      }
    >
      <IntakeLoadingState />
    </IntakeFrame>
  );
}

const isTypedScopeQuestion = (question?: IntakeFollowupQuestion) => isPropertySubsectionQuestion(question) || isVehicleSubsectionQuestion(question) || !!question?.id.startsWith("cyber_document_");

/**
 * A follower sees the leader's step but never saves; remounting when following
 * stops drops the paused writes and reloads the follower's own draft.
 */
export function InsuranceIntake() {
  const following = useIsFollowing();
  return <IntakeApplication key={following ? "following" : "own"} />;
}

function IntakeApplication() {
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
  const confirmOwnership = useLeaderOnly(useMutation(
    api.requestIntake.confirmVerifiedOwnership,
  ));
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
    // OTP sign-in replaces the restricted session asynchronously. Wait for the
    // verified viewer before claiming the application with the new identity.
    if (!verification || !requestId || !isAuthenticated ||
      !viewer?.emailVerificationTime || viewer.intakeRestricted) return;
    void confirmOwnership({ requestId, token: verification })
      .then(() => {
        try {
          localStorage.removeItem(`spot:intake-proof:${requestId}`);
        } catch {
          /* Ownership is already saved on the server. */
        }
        router.replace(withQuoteProvider(`/intake?request=${requestId}`, params.get("provider")));
      })
      .catch((e) => {
        setConfirmationError(
          getUserFacingErrorMessage(e, "Could not confirm your application"),
        );
      });
  }, [verification, requestId, isAuthenticated, viewer, confirmOwnership, params, router]);
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
          <PillButton size="large" href={withQuoteProvider("/signup", params.get("provider"))}>Find my drafts</PillButton>
        )}
      </IntakeFrame>
    );
  if (!requestId) return null;
  if (confirmationError)
    return (
      <IntakeFrame>
        <p>Please reopen your saved application.</p>
        <PillButton size="large" href={withQuoteProvider("/signup", params.get("provider"))}>Find my drafts</PillButton>
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
  const save = useLeaderOnly(useMutation(api.requestIntake.save));
  const suggestIndustry = useLeaderOnly(useAction(api.actions.intakeIndustry.suggestProfile));
  const suggestRequestCoverages = useLeaderOnly(useAction(api.actions.intakeCoverage.suggest));
  const requestCoverageAttempts = useRef(new Set<string>());
  const scopeCoverageSuggestions = useRef(new Map<string, { ready: boolean; ids: string[] | null }>());
  const suggestDateInputs = useLeaderOnly(useAction(api.actions.intakeFollowupInputs.dates));
  const suggestVehicleBodyType = useLeaderOnly(useAction(api.actions.intakeFollowupInputs.vehicleBodyType));
  const vehicleBodyAttempts = useRef(new Set<string>());
  const dateInputAttempts = useRef(new Set<string>());
  const [dateInputHints, setDateInputHints] = useState<Record<string, boolean>>({});
  const industryAttempts = useRef(new Set<string>());
  const descriptionFocused = useRef(false);
  const industrySelectionVersion = useRef(0);
  const industryRequestVersion = useRef(0);
  useEffect(() => () => { industryRequestVersion.current++; }, [requestId]);
  const prepareFollowups = useLeaderOnly(useMutation(api.requestIntake.prepareFollowups));
  const preparingFollowups = useRef<string | null>(null);
  const [checkedFollowupEntry, setCheckedFollowupEntry] = useState<string | null>(null);
  const prepareVerification = useLeaderOnly(useMutation(
    api.requestIntake.prepareVerification,
  ));
  const submit = useLeaderOnly(useMutation(api.requestIntake.submit));
  const removeUploadedFile = useLeaderOnly(useMutation(api.requestIntake.removeFile));
  const selectNewCompany = useLeaderOnly(useMutation(api.requestIntake.useNewCompany));
  const selectSavedCompany = useLeaderOnly(useMutation(api.requestIntake.useSavedCompany));
  const { signIn } = useAuthActions();
  const { run } = useBackgroundTasks();
  const org = useQuery(api.orgs.viewerOrg, data?.verified ? {} : "skip");
  const [answers, setAnswers] = useState<IntakeAnswers>({});
  const isSavings =
    (answers.intakeGoal ?? data?.answers.intakeGoal) === "savings";
  const [details, setDetails] = useState<IntakeDetails>(detailsFromAnswers({}));
  const [step, setStep] = useFollowedState(`intake:${requestId}:step`, 0);
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
      120000 - (followupStartedAt && followupBatch?.status !== "prepared" ? dayjs().valueOf() - followupStartedAt : 0),
    );
    const timer = setTimeout(
      () => setExpiredFollowupKey(followupWaitKey),
      remaining,
    );
    return () => clearTimeout(timer);
  }, [step, followupWaitKey, followupStartedAt, followupBatch?.status]);
  const relevanceFor = (current: IntakeDetails) => data?.vehicleRelevance?.status === "completed" &&
    data.vehicleRelevance.sourceKey === vehicleRelevanceKey(answers,current) ? data.vehicleRelevance.excludedIds : [];
  const excludedVehicleQuestions = relevanceFor(details);
  const vehicleSubsectionQuestions = (current: IntakeDetails) => unfilteredVehicleSubsectionQuestions(current).filter(row=>!relevanceFor(current).includes(row.question.id));
  const withVehicleSubsections = (current: IntakeDetails, questions: IntakeFollowupQuestion[]) => filterVehicleRelevantQuestions(unfilteredWithVehicleSubsections(current,questions),relevanceFor(current));
  const propertyQuestions = propertySubsectionQuestions(details);
  const vehicleQuestions = vehicleSubsectionQuestions(details);
  const cyberResearch = data?.cyberResearch?.status === "completed" && data.cyberResearch.sourceKey === intakeCyberResearchKey(answers, details) ? data.cyberResearch : undefined;
  const cyberDocuments = cyberDocumentQuestions(details, cyberResearch);
  const typedScopeQuestions = [...propertyQuestions, ...vehicleQuestions, ...cyberDocuments];
  const followupsPending =
    !(step === 29 && typedScopeQuestions.length > 0) &&
    !data?.submitted &&
    [29, 30].includes(step) &&
    !followupWaitExpired &&
    (!followupBatch || followupBatch.status === "pending" || followupBatch.status === "prepared");
  const [editingReview, setEditingReview] = useState(
    reviewStep !== undefined && reviewStep !== 28,
  );
  const reviewScroll = useRef(0);
  const editingSection = useRef(reviewSection);
  const followupSection = step === 29 ? "acord" : "additional";
  const catalogQuestionsForSection = (section: "acord" | "additional") => {
  const savedFollowupQuestions = (details.followups ?? []).filter(
    (row) => row.section === section,
  ).flatMap((row) => data?.submitted || row.answer.trim() ? [row] : expandIntakeFollowupQuestion(row));
  const currentFollowupQuestions = data?.submitted
    ? []
    : (section === "acord" ? data?.followupBatches?.acord?.questions ?? []
      : data?.followupBatches?.[section]?.status === "ready" ? data.followupBatches[section].questions : []).flatMap(expandIntakeFollowupQuestion);
  return Array.from(new Map([
    ...currentFollowupQuestions,
    ...savedFollowupQuestions.filter(
      (saved) =>
        // Historical answers remain reviewable, but a new forward batch must
        // not turn previously answered/skipped questions into new pages again.
        (!!data?.submitted || editingReview) &&
        !currentFollowupQuestions.some((question) => question.id === saved.id),
    ),
  ].map((question) => [question.id, question])).values()).filter(question=>!isFixedVehicleFollowup(question) && followupQuestionVisible(question,details.followups) && (editingReview || data?.submitted || details.followups?.find(row=>row.id===question.id)?.prefilled?.contextHash.startsWith("cyber:") || !details.followups?.find(row=>row.id===question.id)?.prefilled));
  };
  const coverageFollowupQuestions = withCyberDocumentQuestions(details, withVehicleSubsections(details, withPropertySubsections(details, catalogQuestionsForSection("acord"))), cyberResearch);
  const followupQuestions = followupSection === "acord" ? coverageFollowupQuestions : catalogQuestionsForSection("additional");
  const coveragePages = intakeCoveragePages(details, coverageFollowupQuestions, new Map(typedScopeQuestions.map(row => [row.question.id, row.coverageIndex])), excludedVehicleQuestions);
  const followupCursorAnchor = useRef<{ requestId: string; step: number; index: number; questionId?: string; key: string } | undefined>(undefined);
  const savedFollowupIndex = details.followupProgress?.[followupSection] ?? 0;
  const questionListKey = followupQuestions.map(question => question.id).join(",");
  const anchor = followupCursorAnchor.current;
  const anchoredIndex = anchor?.requestId === requestId && anchor.step === step && anchor.index === savedFollowupIndex && anchor.key !== questionListKey
    ? followupQuestions.findIndex(question => question.id === anchor.questionId) : -1;
  const followupIndex = anchoredIndex >= 0 ? anchoredIndex : Math.min(savedFollowupIndex, Math.max(0, followupQuestions.length - 1));
  if (followupQuestions.length && (data?.submitted || followupBatch?.status === "ready"))
    followupCursorAnchor.current = { requestId, step, index: followupIndex, questionId: followupQuestions[followupIndex]?.id, key: questionListKey };
  const followupQuestion = followupQuestions[followupIndex];
  const isPayrollPage = [29,30].includes(step) && !!followupQuestion?.source?.endsWith(" · shared.operations.annual_payroll");
  const payrollAnswer = details.followups?.find(row=>row.id===followupQuestion?.id)?.answer ?? "";
  const payrollSteps = payrollPages(payrollAnswer);
  const payrollPageIndex = isPayrollPage ? Math.min(details.payrollPage ?? 0, payrollSteps.length-1) : 0;
  const payrollPage = payrollSteps[payrollPageIndex];
  const payrollGroupName = isPayrollPage && payrollPage.field !== "names"
    ? parsePayrollAnswer(payrollAnswer)?.groups[payrollPage.groupIndex]?.employees : undefined;

  const followupPages = intakeFollowupPages(followupQuestions);
  const followupPageIndex = Math.max(0, followupPages.findIndex(page => page.some(question => question.id === followupQuestion?.id)));
  const followupPage = followupPages[followupPageIndex] ?? [];
  const followupLocation = followupQuestion ? intakeLocationHeading(followupQuestion, details) : undefined;
  const followupSubject = followupQuestion ? intakeApplicantQuestion(followupQuestion).context : undefined;
  const followupVehicle = followupSubject?.match(/^Vehicle \d+ \((.+)\)$/)?.[1];
  const typedFollowupSubject = typedScopeQuestions.find(row => row.question.id === followupQuestion?.id);
  const followupCoverageId = followupQuestion ? intakeCatalogCoverage(followupQuestion, details.coverages.map(line => line.coverage)) : undefined;
  const followupCoverage = typedFollowupSubject ? details.coverages[typedFollowupSubject.coverageIndex]
    : details.coverages.find(line => line.coverage === followupCoverageId);
  const subjectQuestions = followupSubject ? followupQuestions.filter(question => intakeApplicantQuestion(question).context === followupSubject) : [];
  const subsectionKey = subjectQuestions[0]?.id;
  const showSubsectionIntro = !data?.submitted && !editingReview && step === 29 &&
    !!subsectionKey && (followupBatch?.status === "ready" || isTypedScopeQuestion(followupQuestion)) &&
    !(details.subsectionIntroductions ?? []).includes(subsectionKey);
  const textQuestionIds = followupPage.filter(question => question.section !== "acord" && !question.source?.startsWith("single-pass-v1") && ["short_text", "long_text"].includes(question.kind) && !isTypedScopeQuestion(question)).map(question => question.id).join(",");
  const dateQuestionIds = followupPage.filter(question => dateInputHints[`${requestId}:${question.id}`]).map(question => question.id);
  const visiblePreparedQuestions = (section: "acord" | "additional") =>
    (data?.followupBatches?.[section]?.questions ?? [])
      .flatMap(expandIntakeFollowupQuestion)
      .filter(question => !isFixedVehicleFollowup(question) &&
        followupQuestionVisible(question, details.followups) &&
        !details.followups?.find(row => row.id === question.id)?.prefilled);
  const followupEntryChecked = (followupBatch?.status === "ready" && followupBatch.current) ||
    (checkedFollowupEntry === `${requestId}:${followupSection}` &&
      (followupBatch?.status !== "ready" || followupBatch.current));
  const followupEntryFailed = checkedFollowupEntry === `${requestId}:${followupSection}:failed`;
  const currentSection = intakeSection(step);
  const sectionStart = atIntakeSectionStart(step, followupPageIndex, isSavings) ||
    (step === 30 && followupPageIndex === 0);
  const needsTermsConsent = !isSavings && details.termsAcceptedVersion !== INTAKE_TERMS_VERSION;
  const showSectionIntro = !!data && (
    (!data.submitted && !editingReview && sectionStart &&
      (![29, 30].includes(step) || (followupEntryChecked && followupBatch?.status === "ready" && followupQuestions.length > 0)) &&
      !(details.sectionIntroductions ?? []).includes(currentSection)) ||
    (currentSection === 1 && needsTermsConsent)
  );
  const followupTailPending = !followupWaitExpired && followupPageIndex >= followupPages.length - 1 &&
    ((step === 30 && followupBatch?.status === "ready" && !!followupBatch.enriching) ||
      (step === 29 && typedScopeQuestions.length > 0 && (!followupBatch || ["pending", "prepared"].includes(followupBatch.status))));
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
  useEffect(()=>{
    if(!initialized.current || !data || state.current.dirty || data.revision<=state.current.revision)return;
    state.current={...state.current,answers:data.answers,details:data.details,revision:data.revision};
    queueMicrotask(()=>{setAnswers(data.answers);setDetails(data.details);});
  },[data]);

  const [showRequirementsPaste, setShowRequirementsPaste] = useFollowedState<
    boolean | null
  >(`intake:${requestId}:requirements-paste`, null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready || ![29, 30].includes(step) || (!data?.submitted && followupBatch?.status !== "ready") || !textQuestionIds) return;
    const questionIds = textQuestionIds.split(",").filter(id => !dateInputAttempts.current.has(`${requestId}:${id}`));
    if (!questionIds.length) return;
    questionIds.forEach(id => dateInputAttempts.current.add(`${requestId}:${id}`));
    const version = industryRequestVersion.current;
    void suggestDateInputs({ requestId, questionIds }).then(ids => {
      if (version !== industryRequestVersion.current) return;
      setDateInputHints(previous => ({ ...previous, ...Object.fromEntries(ids.map(id => [`${requestId}:${id}`, true])) }));
    }).catch(() => { /* Retain the approved text control without replay. */ });
  }, [ready, step, data?.submitted, followupBatch?.status, textQuestionIds, requestId, suggestDateInputs]);

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
      (savedSavings && [6, 7, 8, 9, 44].includes(state.current.step)) ||
      (!savedAuto && ([41, 42].includes(state.current.step) || isDriverStep(state.current.step)))
    )
      state.current.step = 10;
    else if (state.current.step === 42 && !autoVehicles(state.current.details).length)
      state.current.step = 31;
    else if (isDriverStep(state.current.step) && state.current.step !== 31) {
      if (!state.current.details.drivers?.length) state.current.step = 31;
      else if ([32, 33].includes(state.current.step))
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
    // Step 8 is retired: Other coverage is collected by coverage selection.
    if (state.current.step === 8) state.current.step = state.current.details.coverages.some(line => needsCoverageScope(line.coverage)) ? 9 : 29;
    if (state.current.step === 9 && !state.current.details.coverages.some((line) => needsCoverageScope(line.coverage)))
      state.current.step = savedSavings ? 10 : 29;
    if (state.current.step === 26) state.current.step = state.current.answers.intakeGoal === "savings" ? 28 : 29;
    if (state.current.step === 19) state.current.step = savedSavings ? 28 : 20;
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
  }, [data, key, reviewStep, reviewCoverageIndex, setStep]);
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
      try {
        if (!data.followupBatches?.[section]?.current)
          await prepareFollowups({ requestId, section });
        if (state.current.step === step && preparingFollowups.current === key)
          setCheckedFollowupEntry(key);
      }
      catch {
        if (state.current.step === step) setCheckedFollowupEntry(`${key}:failed`);
      }
    })();
  }, [ready, data, isSavings, step, requestId, flush, prepareFollowups]);
  const advanceEmptyFollowups = useEffectEvent(() => {
    if (editingReview) void returnToReview();
    else void navigate(step === 29 ? 10 : 28);
  });
  useEffect(() => {
    const emptyReady = followupEntryChecked && followupBatch?.status === "ready" && !followupBatch.enriching;
    if (ready && !data?.submitted && [29, 30].includes(step) &&
      emptyReady && !followupQuestions.length && !busy && !uploading)
      advanceEmptyFollowups();
  }, [ready, data?.submitted, editingReview, step, followupEntryChecked, followupEntryFailed, followupWaitExpired, followupBatch?.status,
    followupBatch?.enriching, followupQuestions.length, busy, uploading]);
  function changeFollowup(question: IntakeFollowupQuestion, answer: string) {
    const document = cyberDocumentQuestions(state.current.details ?? details).find(row => row.question.id === question.id);
    if (document) {
      const current = state.current.details ?? details;
      changeDetails({ ...current, cyberDocuments: { ...current.cyberDocuments, [document.field]: answer } });
      return;
    }
    const vehicleField = vehicleSubsectionQuestions(state.current.details ?? details).find(row => row.question.id === question.id);
    if (vehicleField) {
      const current = state.current.details ?? details;
      changeDetails({ ...current, coverages: current.coverages.map((line, coverageIndex) => coverageIndex !== vehicleField.coverageIndex ? line : {
        ...line, vehicles: line.vehicles?.map((vehicle, vehicleIndex) => vehicleIndex !== vehicleField.vehicleIndex ? vehicle : {
          ...vehicle, underwriting: { ...vehicle.underwriting, [vehicleField.field]: answer,
            ...(vehicleField.field === "custom_equipment" && answer !== "Yes" ? { custom_equipment_detail: "", custom_equipment_value: "" } : {}),
          },
        }),
      }) });
      return;
    }
    const fixed = propertySubsectionQuestions(state.current.details ?? details).find(row => row.question.id === question.id);
    if (fixed) {
      if (fixed.field === "staff" && answer !== "I'm not sure" && !/^\d*$/.test(answer)) return;
      const current = state.current.details ?? details;
      changeDetails({ ...current, coverages: current.coverages.map((line, coverageIndex) => coverageIndex !== fixed.coverageIndex ? line : {
        ...line, properties: line.properties?.map((property, propertyIndex) => propertyIndex !== fixed.propertyIndex ? property : {
          ...property, [fixed.field]: fixed.field === "ownership" ? answer === "Owned" ? "owned" : answer === "Leased" ? "leased" : answer === "I'm not sure" ? "unknown" : undefined : answer,
          ...(fixed.field === "details" ? { activitiesPrefilled: false } : {}),
        }),
      }) });
      return;
    }
    const current = state.current.details ?? details;
    changeDetails({...current,followups:withIntakeFollowupAnswer(current.followups ?? [],question,answer)});
  }
  function change(field: IntakeField, value: string) {
    if (field === "phone" && (state.current.answers.phone ?? "") === value) return;
    if (field === "industry" || field === "industryVertical")
      industrySelectionVersion.current++;
    const previousAnswers=state.current.answers;
    const previousDetails=state.current.details ?? details;
    setSubmissionConfirmed(false);
    if (field === "trigger" && state.current.answers.intakeGoal &&
      state.current.answers.intakeGoal !== (value === SAVINGS_INTAKE_REASON ? "savings" : "quote")) {
      const next = {...(state.current.details ?? details), sectionIntroductions: (state.current.details?.sectionIntroductions ?? []).filter(section => section === 0 || section === 2)};
      state.current.details = next;
      setDetails(next);
    }
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
    state.current.details=invalidateIntakePrefills(previousAnswers,previousDetails,state.current.answers,state.current.details ?? details);
    setDetails(state.current.details);
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
    next=invalidateIntakePrefills(state.current.answers,previous,{...state.current.answers,...detailsAnswers(next)},next);
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
  const persistFollowupAnchor = useEffectEvent(() => {
    const current = state.current.details;
    if (!ready || !data || data.submitted || followupBatch?.status !== "ready" || !followupQuestions.length || !current || ![29, 30].includes(step) || followupIndex === savedFollowupIndex) return;
    changeDetails({ ...current, followupProgress: { acord: current.followupProgress?.acord ?? 0, additional: current.followupProgress?.additional ?? 0, [followupSection]: followupIndex } });
  });
  useEffect(() => { persistFollowupAnchor(); }, [ready, step, followupIndex, savedFollowupIndex]);
  const appliedCyberResearch = useRef(new Set<string>());
  const applyCyberResearch = useEffectEvent(() => {
    const research = data?.cyberResearch;
    const current = state.current.details;
    if (!ready || data?.submitted || data?.followupBatches?.acord?.status !== "ready" || isSavings || conflict.current || !current ||
      !current.coverages.some(line => line.coverage === "cyber") || research?.status !== "completed" ||
      research.sourceKey !== intakeCyberResearchKey(state.current.answers, current) || appliedCyberResearch.current.has(`${requestId}:${research.fingerprint}`)) return;
    appliedCyberResearch.current.add(`${requestId}:${research.fingerprint}`);
    const rows = [...(current.followups ?? [])];
    const definitions = (data?.followupBatches?.acord?.questions ?? []).flatMap(expandIntakeFollowupQuestion);
    const suggestions = [...(research.suggestions ?? [])].sort((a,b) => definitions.findIndex(row=>row.id===a.questionId) - definitions.findIndex(row=>row.id===b.questionId));
    for (const suggestion of suggestions) {
      const question = definitions.find(row => row.id === suggestion.questionId);
      // Even a blank saved row represents the applicant's choice to clear/skip.
      if (!question || rows.some(row => row.id === question.id) || !followupQuestionVisible(question, rows)) continue;
      rows.push({ ...question, answer: suggestion.answer, prefilled: { confidence: suggestion.confidence, contextHash: `cyber:${research.fingerprint}` } });
    }
    if (rows.length === (current.followups ?? []).length) return;
    const updated = { ...current, followups: rows };
    if (step === 29 && followupQuestion) {
      const visible = definitions.filter(question => !isFixedVehicleFollowup(question) && followupQuestionVisible(question, rows) && (rows.find(row => row.id === question.id)?.prefilled?.contextHash.startsWith("cyber:") || !rows.find(row => row.id === question.id)?.prefilled));
      const nextQuestions = withCyberDocumentQuestions(updated, withVehicleSubsections(updated, withPropertySubsections(updated, visible)), research);
      const index = nextQuestions.findIndex(question => question.id === followupQuestion.id);
      if (index >= 0) updated.followupProgress = { ...updated.followupProgress, acord: index, additional: updated.followupProgress?.additional ?? 0 };
    }
    changeDetails(updated);
  });
  useEffect(() => { applyCyberResearch(); }, [ready, data, isSavings, step, followupQuestion?.id]);
  useEffect(() => {
    if (!data || !ready || data.submitted || isSavings || conflict.current) return;
    const current = state.current.details;
    if (!current) return;
    const sources = new Set((current.prefillSourceIds ?? []).filter(id=>id.startsWith("request-notes:") || data.files.some(file=>file.id===id)));
    let coverages = current.coverages;
    let applied = false;
    for (const file of data.files) {
      if (!file.prefillCoveragesJson || sources.has(file.id)) continue;
      const suggestions = JSON.parse(
        file.prefillCoveragesJson,
      ) as CoverageRequest[];
      coverages=mergeRequirementCoverageSuggestions(coverages,suggestions,current.declinedRequirementCoverages);
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
  }, [data, ready, cache, isSavings]);

  useEffect(() => {
    const notes = answers.requestDetails?.trim() ?? "";
    if (!ready || !data || data.submitted || isSavings || step < 6 || !notes ||
      data.answers.requestDetails?.trim() !== notes || conflict.current) return;
    const key = JSON.stringify([requestId, notes]);
    if (requestCoverageAttempts.current.has(key)) return;
    requestCoverageAttempts.current.add(key);
    const version = industryRequestVersion.current;
    void (async () => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(notes));
      const source = `request-notes:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
      if (state.current.details?.prefillSourceIds?.includes(source)) return;
      const suggestions = await suggestRequestCoverages({ requestId, notes });
      const latest = state.current;
      if (!suggestions || version !== industryRequestVersion.current ||
        latest.answers.requestDetails?.trim() !== notes || conflict.current || !latest.details) return;
      const current = latest.details;
      const coverages = mergeRequirementCoverageSuggestions(current.coverages,
        COVERAGE_OPTIONS.filter(option => suggestions.includes(option.id)).map(option => newCoverage(option.id)),
        current.declinedRequirementCoverages);
      const next = { ...current, coverages, prefillSourceIds: [
        ...(current.prefillSourceIds ?? []).filter(id => !id.startsWith("request-notes:")), source,
      ].slice(-20) };
      state.current = { ...latest, details: next,
        answers: { ...latest.answers, ...detailsAnswers(next) }, dirty: true };
      setDetails(next);
      setAnswers(state.current.answers);
      setSubmissionConfirmed(false);
      cache();
      setStatus("Saving…");
    })().catch(() => { /* Keep manual selection available without replaying a decision. */ });
  }, [ready, data, isSavings, step, answers.requestDetails, requestId, suggestRequestCoverages, cache]);

  useEffect(() => {
    if (!ready || !data || data.submitted || isSavings || step !== 9) return;
    // Wait for the server to hold the exact scope text, then match once in the background.
    const timer = setTimeout(() => {
      const latest = state.current;
      const line = latest.details?.coverages[0];
      const description = line?.coverage === "unknown" ? line.scopeDescription?.trim() ?? "" : "";
      const saved = data.details.coverages.find(row => row.coverage === "unknown")?.scopeDescription?.trim();
      if (!description || description.length > 8000 || latest.dirty || latest.step !== 9 ||
        conflict.current || saved !== description) return;
      const key = JSON.stringify([requestId, description]);
      if (scopeCoverageSuggestions.current.has(key)) return;
      // Record the attempt first: unknown outcomes must not replay automatically.
      scopeCoverageSuggestions.current.set(key, { ready: false, ids: null });
      // The result is only cached; Next consumes it if the same saved text is still current.
      suggestRequestCoverages({ requestId, notes: description, source: "unknown_scope" })
        .then(ids => { scopeCoverageSuggestions.current.set(key, { ready: true, ids }); })
        .catch(() => { /* Keep the ordinary flow available when matching fails. */ });
    }, 400);
    return () => clearTimeout(timer);
  }, [ready, data, isSavings, step, requestId, suggestRequestCoverages]);

  const prefillIndustry = useCallback(async () => {
    const current = state.current;
    const description = current.answers.description?.trim() ?? "";
    if (!ready || data?.submitted || descriptionFocused.current || !description || current.answers.industry?.trim()) return;
    const key = JSON.stringify([requestId, description]);
    if (industryAttempts.current.has(key)) return;
    industryAttempts.current.add(key);
    const selectionVersion = industrySelectionVersion.current;
    const requestVersion = industryRequestVersion.current;
    try {
      const suggestion = await suggestIndustry({ requestId, description });
      const latest = state.current;
      if (!suggestion?.industry || requestVersion !== industryRequestVersion.current ||
        selectionVersion !== industrySelectionVersion.current ||
        latest.answers.description?.trim() !== description || latest.answers.industry?.trim()) return;
      const nextAnswers = {
        ...latest.answers,
        industry: suggestion.industry,
        ...(!latest.answers.industryVertical?.trim() && suggestion.industryVertical
          ? { industryVertical: suggestion.industryVertical }
          : {}),
      };
      const previousDetails = latest.details ?? detailsFromAnswers(latest.answers);
      const nextDetails = invalidateIntakePrefills(latest.answers, previousDetails, nextAnswers, previousDetails);
      state.current = { ...latest, answers: nextAnswers, details: nextDetails, dirty: true };
      setAnswers(nextAnswers);
      setDetails(nextDetails);
      setSubmissionConfirmed(false);
      cache();
      setStatus("Saving…");
    } catch {
      // Suggestions stay optional and failed calls are not replayed.
    }
  }, [ready, data?.submitted, requestId, suggestIndustry, cache]);
  useEffect(() => {
    if (step === 16) void prefillIndustry();
  }, [step, answers.description, answers.industry, prefillIndustry]);

  useEffect(() => {
    if (!ready || data?.submitted || isSavings || ![9, 29].includes(step)) return;
    const version = industryRequestVersion.current;
    // Let manual model typing settle; selecting a model uses the same path.
    const timer = setTimeout(() => {
      for (const line of state.current.details?.coverages ?? []) {
        if (line.coverage !== "commercial_auto") continue;
        for (const vehicle of line.vehicles ?? []) {
          if (!vehicle.make.trim() || !vehicle.model.trim() || vehicle.underwriting?.body_type?.trim()) continue;
          const { make, model, year } = vehicle;
          const key = JSON.stringify([requestId, make, model, year]);
          if (vehicleBodyAttempts.current.has(key)) continue;
          vehicleBodyAttempts.current.add(key);
          void suggestVehicleBodyType({ requestId, make, model, year }).then(bodyType => {
            const latest = state.current;
            if (!bodyType || version !== industryRequestVersion.current || conflict.current || !latest.details) return;
            let changed = false;
            const next = { ...latest.details, coverages: latest.details.coverages.map(currentLine =>
              currentLine.coverage !== "commercial_auto" ? currentLine : { ...currentLine,
                vehicles: currentLine.vehicles?.map(currentVehicle => {
                  if (currentVehicle.make !== make || currentVehicle.model !== model || currentVehicle.year !== year || currentVehicle.underwriting?.body_type?.trim()) return currentVehicle;
                  changed = true;
                  return { ...currentVehicle, underwriting: { ...currentVehicle.underwriting, body_type: bodyType } };
                }),
              }) };
            if (!changed) return;
            state.current = { ...latest, details: next, dirty: true };
            setDetails(next);
            setSubmissionConfirmed(false);
            cache();
            setStatus("Saving…");
          }).catch(() => { /* Leave the editable field blank; do not replay a failed inference. */ });
        }
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [ready, data?.submitted, isSavings, step, details.coverages, requestId, suggestVehicleBodyType, cache]);

  useEffect(() => {
    const research = data?.companyResearch;
    if (!ready || !research?.suggestions || conflict.current) return;
    const current = state.current;
    if (
      !current.details ||
      current.details.companyResearchSource === research.fingerprint ||
      (current.answers.legalName?.trim() || current.answers.dba?.trim() || "") !== research.name ||
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
    const requestedStep = next;
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
    if (isSavings && ([6, 7, 8, 9, 41, 42, 44].includes(next) || isDriverStep(next))) next = 10;
    if (!isSavings && !fromReview && step === 10 && next === 27) next = 6;
    // Keep old saved step numbers compatible without showing the retired confirmation page.
    if (next === 27) next = step >= 20 ? 19 : 20;
    if (isSavings && [20, 22, 23, 24, 25, 26, 29, 30, 43].includes(next))
      next = data?.files.some((file) => file.category === "policy") ? 28 : 21;
    if (!isSavings && !fromReview) {
      if (step === 5 && next === 6) next = 10;
      else if (step === 10 && next === 9) next = 5;
      else if (step === 6 && next === 5) next = 18;
    }
    const previousStep = step;
    let previousDetails = state.current.details ?? details;
    setBusy(true);
    try {
      if (isPayrollPage && !fromReview) {
        const forward = next === 10 || next === 28 || next > step;
        let pages = payrollSteps;
        if (forward && payrollPage.field === "names") {
          const parsed = parsePayrollAnswer(payrollAnswer);
          if (parsed) {
            changeFollowup(followupQuestion, parsed.groups.some(row=>row.employees.trim())
              ? JSON.stringify({...parsed, groups:parsed.groups.filter(row=>row.employees.trim())}) : "");
            previousDetails = state.current.details ?? details;
            pages = payrollPages(previousDetails.followups?.find(row=>row.id===followupQuestion.id)?.answer ?? "");
          }
        }
        const index = payrollPageIndex + (forward ? 1 : -1);
        if (index >= 0 && index < pages.length) {
          changeDetails({...previousDetails, payrollPage:index});
          if (await flush()) window.scrollTo({top:0});
          return;
        }
      }
      if (!(await flush())) return;
      let showingSuggestions = false;
      if (!fromReview && !data?.submitted && !isSavings && step === 9 && requestedStep === 10 &&
        !skipped && previousDetails.coverages[0]?.coverage === "unknown") {
        const description = previousDetails.coverages[0].scopeDescription?.trim() ?? "";
        // Matching runs in the background; only a settled result for this exact saved text routes here.
        const match = scopeCoverageSuggestions.current.get(JSON.stringify([requestId, description]));
        const latest = state.current.details;
        if (match?.ready && !conflict.current && state.current.step === step &&
          latest?.coverages[0]?.coverage === "unknown" &&
          latest.coverages[0].scopeDescription?.trim() === description) {
          const coverages = COVERAGE_OPTIONS.filter(option => option.id !== "unknown" &&
            option.id !== "other" && match.ids?.includes(option.id)).map(option => newCoverage(option.id));
          if (coverages.length) {
            previousDetails = { ...latest, coverages, coverageIndex: 0,
              scopeNote: [latest.scopeNote?.trim(), description].filter((text, index, all) => text && all.indexOf(text) === index).join("\n\n") };
            changeDetails(previousDetails);
            next = 44;
            showingSuggestions = true;
          }
        }
      }
      if (step === 44 && !fromReview && (requestedStep === 9 ||
        (requestedStep === 7 && previousDetails.coverages[0]?.coverage === "unknown"))) {
        previousDetails = { ...previousDetails, coverageIndex: 0,
          coverages: [{ ...newCoverage("unknown"), scopeDescription: previousDetails.scopeNote ?? "" }] };
        changeDetails(previousDetails);
      }
      let coverageIndex = previousDetails.coverageIndex;
      let autoVehicleIndex = previousDetails.autoVehicleIndex ?? 0;
      let driverIndex = previousDetails.driverIndex ?? 0;
      let mailingAddressStep = previousDetails.mailingAddressStep;
      let revenueStep = previousDetails.revenueStep;
      let followupProgress = previousDetails.followupProgress ?? { acord: 0, additional: 0 };
      const coverageDestination = !showingSuggestions && !fromReview && !isSavings && !data?.submitted
        ? intakeCoverageDestination(coveragePages, previousDetails, step === 44 && requestedStep === 7 ? 6 : step, requestedStep, followupIndex)
        : undefined;
      if (coverageDestination) {
        next = coverageDestination.step;
        coverageIndex = coverageDestination.coverageIndex;
        autoVehicleIndex = coverageDestination.autoVehicleIndex ?? autoVehicleIndex;
        driverIndex = coverageDestination.driverIndex ?? driverIndex;
        if (coverageDestination.followupIndex !== undefined)
          followupProgress = { ...followupProgress, acord: coverageDestination.followupIndex };
      } else {
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
      const scopeIndexes = previousDetails.coverages.flatMap((line, index) => needsCoverageScope(line.coverage) ? [index] : []);
      if (!fromReview && step === 9 && next === 10) {
        const following = scopeIndexes.find(index => index > coverageIndex);
        if (following !== undefined) { next = 9; coverageIndex = following; }
      } else if (!fromReview && step === 9 && next === 8) {
        const preceding = scopeIndexes.filter(index => index < coverageIndex).at(-1);
        if (preceding !== undefined) { next = 9; coverageIndex = preceding; }
      } else if (next === 9 && scopeIndexes.length) {
        coverageIndex = step > 9 ? scopeIndexes.at(-1)! : scopeIndexes[0];
      }
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
      if (next === 8) {
        if (step >= 9) { next = previousDetails.coverages[0]?.coverage === "unknown" ? 6 : 7; coverageIndex = Math.max(0, previousDetails.coverages.length - 1); }
        else { next = 9; coverageIndex = scopeIndexes[0] ?? 0; }
      }
      if (
        next === 9 &&
        !previousDetails.coverages.some((line) =>
          needsCoverageScope(line.coverage),
        )
      )
        next = step > 9
          ? previousDetails.coverages[0]?.coverage === "unknown" ? 6 : 7
          : 10;
      if (next === 7 && step > 8) coverageIndex = Math.max(0, previousDetails.coverages.length - 1);
      if (
        next === 13 &&
        !["United States", "Canada"].includes(
          previousDetails.registrationCountry || "United States",
        )
      )
        next = step > 13 ? 12 : 14;
      const auto = !isSavings && hasCommercialAuto(previousDetails);
      if (!fromReview) {
        if (isDriverStep(step)) {
          const driver = previousDetails.drivers?.[driverIndex];
          if (step === 31) { next = next > step ? 34 : (autoVehicles(previousDetails).length ? 42 : 41); autoVehicleIndex=Math.max(0,autoVehicles(previousDetails).length-1); driverIndex=0; }
          else if (next > step) {
            if (next === 32) next=34;
            if (next === 38 && driver?.accidents !== "yes") next=39;
            if (next === 40 && driver?.violations !== "yes") next=41;
            if (next === 41) { if(driverIndex < (previousDetails.drivers?.length??0)-1){next=34;driverIndex++;}else next=10; }
          } else {
            if(next===38 && driver?.accidents!=="yes")next=37;
            if(next===33)next=31;
            if(next===31 && driverIndex>0){driverIndex--;next=previousDetails.drivers?.[driverIndex]?.violations==="yes"?40:39;}
          }
        }
      }
      if (!fromReview) {
        if (step === 41) { next = next > step ? (autoVehicles(previousDetails).length ? 42 : 31) : 29; autoVehicleIndex=0; }
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
      if (step === 18 && next === 19 && revenueStep !== "projected") {
        next = 18;
        revenueStep = "projected";
      } else if (step === 18 && next < 18 && revenueStep === "projected") {
        next = 18;
        revenueStep = "annual";
      } else if (step === 19 && next === 18) revenueStep = "projected";
      else if (next === 18 && step < 18) revenueStep = "annual";
      // Step 19 is retired; property locations are collected in Coverage.
      if (next === 19) {
        if (step >= 20) {
          next = 18;
          revenueStep = "projected";
        } else next = isSavings ? 28 : 6;
      }
      if (!isSavings && !fromReview) {
        if (next === 10 && [7, 8, 9].includes(step)) next = 29;

        if (!data?.submitted && !editingReview && next === 28 && step !== 30) next = 30;
      }
      if (!fromReview && (step === 29 || step === 30)) {
        const forward = step === 29 ? next === 10 : next === 28;
        const backward = step === 29 ? (next < 10 || isDriverStep(next)) : next === 25;
        if (forward && (data?.submitted || followupBatch?.status === "ready" || (step === 29 && typedScopeQuestions.length > 0)) && followupPageIndex < followupPages.length - 1) {
          next = step;
          followupProgress = {
            ...followupProgress,
            [followupSection]: followupQuestions.findIndex(question => question.id === followupPages[followupPageIndex + 1][0].id),
          };
        } else if (backward && (data?.submitted || followupBatch?.status === "ready" || (step === 29 && typedScopeQuestions.length > 0)) && followupPageIndex > 0) {
          next = step;
          followupProgress = {
            ...followupProgress,
            [followupSection]: followupQuestions.findIndex(question => question.id === followupPages[followupPageIndex - 1][0].id),
          };
        } else if (forward && next === 30) {
          followupProgress = { ...followupProgress, additional: 0 };
        } else if (backward && next === 29) {
          followupProgress = {
            ...followupProgress,
            acord: intakeFollowupLastPageIndex(
              (data?.followupBatches?.acord?.questions ?? []).flatMap(expandIntakeFollowupQuestion)
                .filter(question => followupQuestionVisible(question, previousDetails.followups)),
            ),
          };
        }
      } else if (next === 29 || next === 30) {
        followupProgress = {
          ...followupProgress,
          [next === 29 ? "acord" : "additional"]:
            (step === 28 || ((step === 10 || step === 41) && next === 29)) && !fromReview
              ? intakeFollowupLastPageIndex(next === 29
                  ? withVehicleSubsections(previousDetails, withPropertySubsections(previousDetails, (data?.followupBatches?.acord?.questions ?? []).flatMap(expandIntakeFollowupQuestion).filter(question => followupQuestionVisible(question, previousDetails.followups))))
                  : (data?.followupBatches?.additional?.questions ?? []).flatMap(expandIntakeFollowupQuestion).filter(question => followupQuestionVisible(question, previousDetails.followups)))
              : 0,
        };
      }
      // Back must also pass over prepared empty batches instead of bouncing
      // forward again when the automatic empty-page redirect runs.
      if (!fromReview && !editingReview && (step === 28 || ((step === 10 || step === 41) && next === 29))) {
        while ([29, 30].includes(next)) {
          const section = next === 29 ? "acord" : "additional";
          const batch = data?.followupBatches?.[section];
          if (!batch || !["ready", "failed"].includes(batch.status) || batch.enriching || visiblePreparedQuestions(section).length) break;
          if (next === 30) next = 25;
          else if (auto) {
            driverIndex = Math.max(0, (previousDetails.drivers?.length ?? 1) - 1);
            next = previousDetails.drivers?.[driverIndex]?.violations === "yes" ? 40 : 39;
          } else {
            next = previousDetails.coverages.some(line => needsCoverageScope(line.coverage)) ? 9 : previousDetails.coverages[0]?.coverage === "unknown" ? 6 : 7;
            if (next === 7) coverageIndex = Math.max(0, previousDetails.coverages.length - 1);
          }
        }
      }
      if (!fromReview && step === 29 && next === 10 && auto) {
        next = 41;
        driverIndex = 0;
        autoVehicleIndex = 0;
      }
      if (!fromReview && !isSavings && ((step === 29 && next === 10) || (isDriverStep(step) && next === 10))) next = 20;
      if (!fromReview && !isSavings && step === 20 && next === 18) {
        if (auto) {
          driverIndex = Math.max(0, (previousDetails.drivers?.length ?? 1) - 1);
          next = previousDetails.drivers?.[driverIndex]?.violations === "yes" ? 40 : 39;
        } else {
          next = 29;
          followupProgress = { ...followupProgress, acord: intakeFollowupLastPageIndex(withVehicleSubsections(previousDetails, withPropertySubsections(previousDetails, visiblePreparedQuestions("acord")))) };
        }
      }
      if (!fromReview && !isSavings && step === 6 && next === 18) revenueStep = "projected";
      }
      const nextDetails = {
        ...previousDetails,
        payrollPage: 0,
        ...(!fromReview && !editingReview && !data?.submitted &&
          intakeSection(next) !== intakeSection(step) &&
          atIntakeSectionStart(next, 0, isSavings)
          ? { sectionIntroductions: (previousDetails.sectionIntroductions ?? []).filter(section => section !== intakeSection(next)) }
          : {}),
        autoVehicleIndex,
        ...(step===42 ? {coverages: previousDetails.coverages.map(line=>line.coverage==="commercial_auto"?{...line,vehicles:line.vehicles?.map((vehicle,index)=>index===(previousDetails.autoVehicleIndex??0)?{...vehicle,estimatedValueSkipped:!!skipped && !vehicle.estimatedValue?.trim()}:vehicle)}:line)} : {}),
        ...(isDriverStep(next) || isDriverStep(step) ? {driverIndex, drivers: previousDetails.drivers?.length ? previousDetails.drivers : [newIntakeDriver()]} : {}),
        ...(!showSectionIntro && !showSubsectionIntro && [29, 30].includes(step) && followupPage.length ? {
          followups: [
            ...(previousDetails.followups ?? []).map(row =>
              followupPage.some(question => question.id === row.id)
                ? {...row, skipped: !row.answer.trim()}
                : row),
            ...followupPage.filter(question => !isTypedScopeQuestion(question) && !(previousDetails.followups ?? []).some(row => row.id === question.id))
              .map(question => ({...question, answer: "", skipped: true})),
          ],
        } : {}),
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
      if (!fromReview && [29,30].includes(next) && (step === 29 ? requestedStep === 9 : requestedStep < step)) {
        const target = (next === 29 ? coverageFollowupQuestions : catalogQuestionsForSection("additional"))[followupProgress[next === 29 ? "acord" : "additional"]];
        if (target?.source?.endsWith(" · shared.operations.annual_payroll"))
          nextDetails.payrollPage = payrollPages(nextDetails.followups?.find(row=>row.id===target.id)?.answer ?? "").length-1;
      }
      const persistedNextDetails=invalidateIntakePrefills(state.current.answers,previousDetails,state.current.answers,nextDetails);
      if (editingReview && !fromReview) {
        const start = editingSection.current;
        const withinSection =
          start === 0
            ? next === 0
            : start === 1
              ? (next >= 1 && next <= 5) || (isSavings && next === 21)
              : start === 6
                ? next >= 6 && next <= 9 || isDriverStep(next) || next===41 || next===42 || next===29 || next===44
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
        details: persistedNextDetails,
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
      if (next !== previousStep) setCheckedFollowupEntry(null);
      setStep(next);
      setDetails(persistedNextDetails);
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
      // Verification revokes the restricted session. Reload from the freshly
      // written auth cookies instead of letting old live queries redirect to
      // login. Answers are flushed and uploads are idle, so this one deliberate
      // unload must also bypass the auth SDK's token-refresh unload warning.
      const allowVerifiedRedirect = (event: BeforeUnloadEvent) => event.stopImmediatePropagation();
      window.addEventListener("beforeunload", allowVerifiedRedirect, { capture: true, once: true });
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
    website: "company.com",
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
            onFocus={() => { if (id === "description") descriptionFocused.current = true; }}
            onBlur={() => {
              void flush();
              if (id === "description") {
                descriptionFocused.current = false;
                void prefillIndustry();
              }
            }}
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
        ) : id === "website" ? (
          <WebsiteInput
            id={`intake-${id}`}
            size="lg"
            placeholder={placeholder}
            value={answers[id] ?? ""}
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
            value={answers[id] || undefined}
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
        {radio || choices.length < 8 ? (
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
  function files(
    category: "requirements" | "policy" | "loss_runs" | "supporting",
    label: string,
    uploadOnly = false,
  ) {
    return (
      <Field>
        <div
          className={category === "requirements" ? "relative h-52" : undefined}
        >
          {category === "requirements" && !uploadOnly &&
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
              {category === "requirements" && !uploadOnly && (
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
  // Navigation below skips unavailable optional questions; never flash their page.
  if (!data.submitted && [29, 30].includes(step) && !followupQuestions.length &&
    (followupEntryChecked && followupBatch?.status === "ready" && !followupBatch.enriching))
    return null;
  const scopeIndex = needsCoverageScope(details.coverages[details.coverageIndex]?.coverage)
    ? details.coverageIndex : details.coverages.findIndex(line => needsCoverageScope(line.coverage));
  const scopeLine = details.coverages[scopeIndex];
  if (!data.submitted && [29, 30].includes(step) && !(step === 29 && isTypedScopeQuestion(followupQuestion)) &&
    ((!followupQuestions.length && (followupEntryFailed || followupWaitExpired || followupBatch?.status === "failed")) ||
    ((!followupEntryChecked && !followupEntryFailed) || (followupEntryChecked && followupBatch?.status === "ready" && !followupQuestions.length))))
    return <IntakeFrame section={currentSection} footer={
      <PillButton size="large" variant="ghost" onClick={() => void navigate(step === 29 ? 9 : 25)}>
        <ChevronLeft className="size-4" />Back
      </PillButton>
    }>
      <h1 className={typeStyle("heading.display")}>{step === 29 ? "Your Coverage" : "Additional details"}</h1>
      {followupEntryFailed || followupWaitExpired || followupBatch?.status === "failed" ? <div className="mt-8 space-y-6">
        <p className={typeStyle("body.root")}>{followupBatch?.status === "pending" ? "We’re still checking your application. Your answers are saved." : "We couldn’t check your application for additional questions. Your answers are saved."}</p>
        {followupBatch?.status !== "pending" && <PillButton size="large" disabled={busy} onClick={async()=>{
          setBusy(true);
          try { if(await flush()) { await prepareFollowups({requestId,section:step===29?"acord":"additional",retry:true}); setCheckedFollowupEntry(`${requestId}:${followupSection}`); setExpiredFollowupKey(null); } }
          catch {setError("Could not start the question check. Please try again.");}
          finally {setBusy(false);}
        }}>Retry question check</PillButton>}
      </div> : <div className="mt-8"><IntakeLoadingState compact title="Checking your saved answers" description="We’re preparing the remaining questions. Your progress is saved." /></div>}
    </IntakeFrame>;
  if (showSubsectionIntro && subsectionKey && followupSubject)
    return <IntakeSectionIntroduction
      section={1} savings={false} status={status} disabled={busy || uploading}
      content={{
        title: followupVehicle ? `More information about your ${followupVehicle}` : `More information about ${followupLocation?.name ?? followupSubject}`,
        description: followupLocation?.address ?? "A few details about this vehicle and how you use it.",
        topics: subjectQuestions.map(question => intakeApplicantQuestion(question).title).slice(0, 6),
      }}
      onSection={next => void navigate(next, false, false, true)}
      onContinue={async () => {
        if (busy || uploading) return;
        setBusy(true);
        try {
          changeDetails({ ...(state.current.details ?? details), subsectionIntroductions: [
            ...new Set([...(state.current.details?.subsectionIntroductions ?? []), subsectionKey]),
          ].slice(-60) });
          await flush();
        } finally { setBusy(false); }
      }}
      onBack={() => void navigate(9)}
    />;
  if (showSectionIntro)
    return (
      <IntakeSectionIntroduction
        section={currentSection}
        applicantName={answers.name}
        termsConsent={currentSection === 1 && !isSavings ? {
          checked: !needsTermsConsent,
          onCheckedChange: checked => changeDetails({ ...details, termsAcceptedVersion: checked ? INTAKE_TERMS_VERSION : undefined }),
        } : undefined}
        savings={isSavings}
        status={status}
        disabled={busy || uploading}
        onSection={(next) => {
          if (currentSection === 1 && needsTermsConsent) return;
          void navigate(next, false, false, true);
        }}
        onContinue={() => {
          if (busy || uploading || (currentSection === 1 && needsTermsConsent)) return;
          setBusy(true);
          changeDetails({
            ...details,
            sectionIntroductions: [
              ...new Set([
                ...(details.sectionIntroductions ?? []),
                currentSection,
              ]),
            ],
          });
          void flush().finally(() => setBusy(false));
        }}
        onBack={() => {
          if (currentSection === 0) {
            void (async () => {
              if (await flush())
                router.push(withQuoteProvider("/signup", params.get("provider")));
            })();
            return;
          }
          void navigate(
            isSavings && step === 21
              ? 1
              : step === 28
                ? isSavings
                  ? 19
                  : 30
                : step === 29
                  ? 9
                  : step === 30
                    ? 25
                    : step === 20
                      ? 19
                      : step - 1,
          );
        }}
      />
    );
  const showSavedCompany =
    !!data.orgId &&
    !!answers.description &&
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
          <>
          {data.submitted && <ClientInformationForms requestId={requestId} />}
          {data.submitted && !data.verified ? (
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
          ) : undefined}
          </>
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
  const routesIncomplete = [29,30].includes(step) && followupPage.some(question => question.kind === "routes" && !routeAnswerComplete(details.followups?.find(row => row.id === question.id)?.answer ?? ""));
  const datesIncomplete = [29, 30].includes(step) && followupPage.some(question => {
    const answer = details.followups?.find(row => row.id === question.id)?.answer?.trim();
    return (question.kind === "date" || dateQuestionIds.includes(question.id)) && !!answer && answer !== "I'm not sure" && !parseCalendarDateInput(answer);
  });
  const cyberUrlInvalid = followupPage.some(question=>isWorkforceProviderSource(question.source) && !workforceProviderComplete(details.followups?.find(row=>row.id===question.id)?.answer ?? "")) || followupPage.some(question => { const document = cyberDocuments.find(row => row.question.id === question.id); return document && !cyberDocumentUrlValid(document.answer); });
  const jurisdictionsIncomplete = followupPage.some(question=>question.source?.endsWith(" · wc.terms.covered_jurisdictions") && !workJurisdictionsComplete(details.followups?.find(row=>row.id===question.id)?.answer ?? ""));
  const payrollIncomplete = isPayrollPage && payrollPage.field === "dates" && !payrollAnswerComplete(JSON.stringify({version:"payroll-v1",groups:[parsePayrollAnswer(payrollAnswer)?.groups[payrollPage.groupIndex]].filter(Boolean)}));
  const percentageInvalid = followupPage.some(question => {
    const answer = details.followups?.find(row => row.id === question.id)?.answer;
    return isIntakePercentageQuestion(question) && !!answer && answer !== "I'm not sure" &&
      (!Number.isFinite(Number(answer)) || Number(answer) < 0 || Number(answer) > 100);
  });
  const canContinue =
    step===42 ? !estimatedVehicleValueError(autoVehicles(details)[details.autoVehicleIndex??0]?.estimatedValue) :
    isDriverStep(step) ? step === 31 ? !!details.drivers?.length && details.drivers.every(driver=>!!driver.name.trim()) : !!details.drivers?.[details.driverIndex??0] && driverFieldValid(details.drivers[details.driverIndex??0],step) :
    [29, 30].includes(step) ? !followupsPending && !followupTailPending && !routesIncomplete && !datesIncomplete && !percentageInvalid && !payrollIncomplete && !cyberUrlInvalid && !jurisdictionsIncomplete : isSavings && step === 21
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
                : step === 6 || step === 44
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
                              : step === 11
                                ? !!answers.legalName?.trim()
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
    29: followupPage.some(question => typedScopeQuestions.some(row => row.question.id === question.id && !!row.answer.trim()) || details.followups?.some(row => row.id === question.id && !!row.answer.trim())),
    30: followupPage.some(question => details.followups?.some(row => row.id === question.id && !!row.answer.trim())),
    4:
      data.files.some((file) => file.category === "requirements") ||
      !!answers.requirements?.trim(),
    5: answers.requestDetails?.trim() ?? "",
    8: details.coverages.some((line) => line.additionalCoverages?.trim())
      ? "answered"
      : "",
    10: showSavedCompany || answers.dba?.trim() || "",
    11: [answers.legalName, answers.website].join("").trim(),
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
  // Empty optional details and trading names are valid answers.
  const canSkipStep = step !== 44 && !jurisdictionsIncomplete && !cyberUrlInvalid && !payrollIncomplete && !percentageInvalid && !routesIncomplete && !datesIncomplete && !followupTailPending && !(step===42 && estimatedVehicleValueError(autoVehicles(details)[details.autoVehicleIndex??0]?.estimatedValue)) && !(isDriverStep(step) && (step === 31 || !driverFieldValid(details.drivers?.[details.driverIndex??0] ?? newIntakeDriver(), step))) && !(step === 9 && details.coverages.some(line=>(line.vehicles??[]).some(vehicle=>!!vinError(vehicle.vin, details.registrationCountry)))) && step !== 28 && !followupsPending && !(isSavings && step === 21);
  const driverValue = details.drivers?.[details.driverIndex??0]?.[DRIVER_FIELDS[step-31]];
  const skipStep =
    canSkipStep && !([29,30].includes(step) && (!followupQuestion || (!data.submitted && followupBatch?.status !== "ready" && !isTypedScopeQuestion(followupQuestion)))) &&
    (isPayrollPage ? !payrollPageValue(payrollAnswer, payrollPage) : !canContinue || (isDriverStep(step) && !driverValue?.trim()) || (step in optionalValues && !optionalValues[step]));
  return (
    <IntakeFrame
      showSteps={!isSavings}
      section={currentSection}
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
            onClick={async () => {
              if (isPayrollPage && payrollPageIndex > 0) return void navigate(step === 29 ? 9 : 25);
              if (!data.submitted && !editingReview && step === 29 && subsectionKey &&
                followupQuestion?.id === subsectionKey) {
                changeDetails({ ...(state.current.details ?? details), subsectionIntroductions:
                  (state.current.details?.subsectionIntroductions ?? []).filter(id => id !== subsectionKey) });
                await flush();
                return;
              }
              if (!data.submitted && !editingReview && sectionStart) {
                if (busy || uploading) return;
                setBusy(true);
                try {
                  changeDetails({
                    ...(state.current.details ?? details),
                    sectionIntroductions: (state.current.details?.sectionIntroductions ?? []).filter(section => section !== currentSection),
                  });
                  await flush();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                } finally { setBusy(false); }
                return;
              }
              return editingReview && step!==42 && !isDriverStep(step) && !([29, 30].includes(step) && followupPageIndex > 0)
                ? void returnToReview()
                : step === 1
                  ? void (async () => {
                      if (await flush()) router.push(withQuoteProvider("/signup", params.get("provider")));
                    })()
                  : void navigate(
                      step === 44 ? 9 : step === 29 ? 9 : step === 30 ? 25 : step === 8 && details.coverages[0]?.coverage === "unknown"
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
                    );
            }}
          >
            <ChevronLeft className="size-4" />
            Back
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
                {!skipStep && <ArrowRight aria-hidden="true" className="size-4" />}
              </PillButton>
            ) : step !== 28 ? (
              <PillButton
                size="large"
                disabled={busy || uploading || (!canContinue && !canSkipStep)}
                variant={skipStep ? "secondary" : "primary"}
                onClick={() =>
                  void navigate(
                    step === 44 ? 7 : step === 29 ? 10 : step === 30 ? 28 : step === 6 && details.coverages[0]?.coverage === "unknown"
                      ? 9
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
                {busy || followupsPending || followupTailPending ? <Spinner aria-hidden="true" className="size-4 motion-reduce:animate-none" /> : null}
                {followupsPending ? "Preparing questions…" : followupTailPending ? "Checking final details…" : skipStep ? "Skip" : "Continue"}
                {!skipStep && !followupsPending && !followupTailPending && <ArrowRight aria-hidden="true" className="size-4" />}
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
      {step === 29 && (followupCoverage || followupLocation || followupVehicle) && (
        <div className="mb-6 space-y-1">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {followupCoverage && <span className={typeStyle("heading.item")}>{coverageRequestLabel(followupCoverage)}</span>}
            {(followupLocation || followupVehicle || payrollGroupName) && <span className={`text-muted-foreground ${typeStyle("heading.item")}`}>{followupLocation?.name ?? followupVehicle ?? payrollGroupName}</span>}
          </p>
          {followupLocation && <p className={`text-muted-foreground ${typeStyle("body.default")}`}>{followupLocation.address}</p>}
        </div>
      )}
      {step === 9 && scopeLine && scopeLine.coverage !== "unknown" && <p className={`mb-6 ${typeStyle("heading.item")}`}>{coverageRequestLabel(scopeLine)}</p>}
      {step === 7 && details.coverages[details.coverageIndex] && <p className={`mb-6 ${typeStyle("heading.item")}`}>{coverageRequestLabel(details.coverages[details.coverageIndex])}</p>}
      <h1 className={`text-wrap-pretty ${typeStyle("heading.display")}`}>
        {personalizeIntakeQuestion(followupsPending && [29, 30].includes(step) ? (step === 29 ? "Your Coverage" : "Additional details") : (step === 29 || step === 30) && (data.submitted || followupBatch?.status === "ready" || isTypedScopeQuestion(followupQuestion)) && followupQuestion
          ? isPayrollPage ? payrollPageTitle(payrollAnswer, payrollPage) : intakeFollowupPageTitle(followupQuestion, details.followups)
          : isDriverStep(step) ? driverQuestion(step,details.drivers?.[details.driverIndex??0]?.name)
          : isSavings && step === 21
          ? "Can you upload your current policies?"
          : step === 10 && showSavedCompany
            ? "Are you applying for your saved business?"
            : step === 9 && scopeLine
              ? scopeLine.coverage === "unknown" ? "What are you looking to get insured?" : scopeLine.coverage === "property" ? "What properties are you looking to get insured?"
                : scopeLine.coverage === "commercial_auto" ? "What vehicles are you looking to get insured?"
                  : `What are you looking to insure with ${coverageRequestLabel(scopeLine).toLowerCase()}?`
            : step === 7
              ? `What limits do you need for ${details.coverages[details.coverageIndex] ? coverageRequestLabel(details.coverages[details.coverageIndex]).toLowerCase() : "coverage"}?`
              : step === 18 && details.revenueStep === "projected"
                ? "Where do you project your business’s revenue to be?"
                : step === 14 && details.mailingAddressStep
                  ? "What is your mailing address?"
                  : INTAKE_STEPS[step],[10, 11, 29].includes(step) ? undefined : answers.legalName || answers.dba)}
      </h1>
      <div className="h-10" />
      <div className="space-y-6">
        {step === 29 && typedFollowupSubject && "vehicleIndex" in typedFollowupSubject && ["gross_vehicle_weight","seats"].includes(typedFollowupSubject.field) && <VehicleSpecificationLookup
          key={followupQuestion?.id}
          requestId={requestId}
          coverageIndex={typedFollowupSubject.coverageIndex}
          vehicleIndex={typedFollowupSubject.vehicleIndex}
          identity={details.coverages[typedFollowupSubject.coverageIndex]?.vehicles?.[typedFollowupSubject.vehicleIndex] ?? {year:"",make:"",model:""}}
          field={typedFollowupSubject.field as "gross_vehicle_weight"|"seats"}
          value={typedFollowupSubject.answer}
          onChange={value=>changeFollowup(typedFollowupSubject.question,value)}
          onPrefill={value=>{const current=vehicleSubsectionQuestions(state.current.details??details).find(row=>row.question.id===typedFollowupSubject.question.id);if(current&&!current.answer.trim())changeFollowup(current.question,value);}}
        />}
        {(step === 29 || step === 30) && <IntakeFollowups
          payrollPage={payrollPage}
          dateQuestionIds={dateQuestionIds}
          question={followupQuestion}
          questions={followupPage}
          checking={!followupWaitExpired && step === 30 && !!followupBatch?.enriching}
          answers={[...(details.followups ?? []), ...typedScopeQuestions.map(row => ({...row.question, answer: row.answer}))]}
          defaultCountry={details.registrationCountry}
          businessName={answers.legalName || answers.dba}
          industry={answers.industry}
          status={data.submitted || (editingReview && followupQuestions.length > 0) || (followupQuestion && isTypedScopeQuestion(followupQuestion)) ? "ready" : followupEntryFailed || (followupWaitExpired && followupBatch?.status !== "ready") ? "failed" : followupBatch?.status}
          answer={(details.followups ?? []).find((row) => row.id === followupQuestion?.id)?.answer ?? ""}
          onChange={changeFollowup}
        />}
        {step === 29 && followupQuestion?.source?.endsWith(" · gl.coverage.additional_insured_agreement") &&
          details.followups?.find(row => row.id === followupQuestion.id)?.answer === "Yes" && <>
            <p className={`text-muted-foreground ${typeStyle("body.root")}`}>Upload the agreement and we’ll use its insurance requirements to help fill in unanswered coverage questions. You can continue without it.</p>
            {files("requirements", "Upload the agreement", true)}
          </>}
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
        {step === 44 && <p className={`text-muted-foreground ${typeStyle("body.root")}`}>Based on what you described, these coverages may fit your needs. You can change the selection before continuing.</p>}
        {(step === 6 || step === 44) && (
          <IntakeCoverageSelection
            details={details}
            onChange={changeDetails}
            disabled={busy}
          />
        )}
        {step === 7 && details.coverages[details.coverageIndex]?.coverage === "workers_compensation" && <>
          <p className={`text-muted-foreground ${typeStyle("body.root")}`}>Have written safety or return-to-work policies? Upload them to help fill in unanswered workers’ compensation questions. This is optional.</p>
          {files("supporting", "Upload workplace policies", true)}
        </>}
        {step === 7 && (
          <IntakeCoverageLimits
            details={details}
            onChange={changeDetails}
            disabled={false}
          />
        )}
        {[41,42].includes(step) && <IntakeAutoQuoteFields details={details} step={step} onChange={changeDetails} />}
        {isDriverStep(step) && <IntakeDriverFields details={details} step={step} onChange={changeDetails} />}
        {step === 9 && (
          <IntakeCoverageScope details={details} onChange={changeDetails} activeCoverageIndex={scopeIndex} disabled={busy} />
        )}
        {step === 10 &&
          (showSavedCompany ? (
            <IntakeSavedBusinessSummary answers={answers} details={details} />
          ) : (
            field("dba")
          ))}
        {step === 11 && (
          <>
            {field("legalName", { required: true })}
            {field("website", { type: "url" })}
          </>
        )}
        {step === 12 && (
          <>
            {select("entityType", [...ENTITY_TYPES])}
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
