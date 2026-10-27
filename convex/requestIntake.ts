import { INTAKE_TERMS_VERSION, intakeTermsForVersion, INTAKE_TERMS_URL, INTAKE_TERMS_STATEMENT } from "../lib/intake-terms";
import { INTAKE_QUESTION_REFERENCE_VERSION } from "../lib/intake-question-reference";
import { workforcePolicyQuestion } from "../lib/intake-workforce-policy";
import { vehicleRelevanceKey, vehicleRelevanceEvidence, vehicleRelevanceCandidates } from "../lib/intake-vehicle-relevance";
import { bakedCoverageQuestions, BAKED_COVERAGE_QUESTIONS_VERSION } from "../lib/intake-coverage-questions";
import { intakeCyberResearchKey } from "../lib/intake-cyber-research";
import { isFixedVehicleFollowup } from "../lib/intake-vehicle-underwriting";
import { intakePrefillEvidence, invalidateIntakePrefills } from "../lib/intake-prefill-state";
import { followupPrefillValidator } from "./lib/intakeFollowupSchema";
import { mergeIntakePrefills } from "./lib/intakePrefills";
import { jevDecisionBand } from "./lib/jevThreshold";
import { intakeSubmissionProblems } from "../lib/intake-submission";
import { driverModelContext } from "../lib/intake-drivers";
import { intakeQuestionHistory } from "../lib/intake-question-history";
import { validateFollowupAnswers, boundIntakeFollowupQuestions, followupQuestionVisible, isRetiredIntakeFollowup, expandIntakeFollowupQuestion } from "../lib/intake-followups";
import { INTAKE_ACORD_CATALOG_VERSION } from "./lib/intakeAcordQuestions";
import {
  followupSectionValidator,
  followupQuestionValidator,
} from "./lib/intakeFollowupSchema";
import { createOwnedIntakePolicyUpload } from "./policies";
import {
  applicationMarkdownBlock,
  submittedIntakeApplication,
} from "../lib/intake-application";
import {
  fillRequestFromClientProfile,
  hashIntakeToken,
  readIntakeBusinessProfile,
  saveIntakeBusinessProfile,
  submissionContent,
} from "./lib/intakeApplication";
import { queueIntakeSlack } from "./intakeSlack";
import { intakeDetailsValidator } from "./lib/intakeDetailsSchema";
import {
  activeIntakeDetails,
  detailsFromAnswers,
  detailsAnswers,
  validateIntakeDetails,
  type IntakeDetails,
} from "../lib/insurance-intake-details";
import dayjs from "dayjs";
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getSessionUserId } from "./lib/sessionIdentity";
import { getOrgAccess } from "./lib/access";
import { normalizeUserPhone, findUserByNormalizedPhone } from "./lib/userPhone";
import { isBootstrapOperatorEmail } from "./lib/operatorIdentity";
import { intakeAnswersValidator } from "./lib/insuranceIntakeSchema";
import {
  completedIntakeSteps,
  COMPANY_INTAKE_FIELDS,
  INTAKE_VERSION,
  INTAKE_REASONS,
  SAVINGS_INTAKE_REASON,
  INTAKE_STEPS,
  type IntakeAnswers,
} from "../lib/insurance-intake";
import { createProcurementInboxToken } from "./lib/procurement";
import { seedRequestIntake } from "./lib/procurementNarrative";
import { publicResearchUrl } from "./lib/companyResearch";
import { scheduleCompanyResearch } from "./companyResearch";
import { scheduleWebsiteTechScan } from "./websiteTech";
import { ensureClientIntakeAuthorization } from "./intakeAuthorizations";

function validateContact(name: string, email: string, phone: string, validatePhone = true) {
  const contact = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
  };
  if (
    !contact.name ||
    contact.name.length > 200 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) ||
    contact.email.length > 254 ||
    (validatePhone && !/^\+?[\d\s().-]{7,40}$/.test(contact.phone))
  )
    throw new Error("Enter your name, valid work email, and phone number.");
  if (isBootstrapOperatorEmail(contact.email))
    throw new Error("Use a customer email address.");
  return contact;
}
/** Raw application contact data is retained even when it cannot identify a phone channel. */
function intakeProfilePhone(value: string | undefined) {
  try { return normalizeUserPhone(value); }
  catch { return undefined; }
}

async function intakeUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user || user.accountKind === "operator" || user.serviceAccountKind)
    throw new Error("Customer session required");
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId && ctx.db.normalizeId("authSessions", sessionId)) {
    const session = await ctx.db.get(sessionId);
    if (
      !session ||
      session.userId !== userId ||
      session.expirationTime <= dayjs().valueOf()
    )
      throw new Error("Session expired. Confirm your email to continue.");
  }
  return user;
}
export async function ownedRequest(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const user = await intakeUser(ctx);
  const request = await ctx.db.get(requestId);
  if (
    !request ||
    request.deletedAt ||
    request.ownerUserId !== user._id ||
    request.intakeSchemaVersion === undefined
  )
    throw new Error("Request not found");
  if (!user.intakeRestricted && !request.intakeVerifiedAccess)
    throw new Error("Confirm application ownership to resume this draft");
  if (request.clientOrgId && !user.intakeRestricted)
    await getOrgAccess(ctx, request.clientOrgId);
  return { user, request };
}
/** Stands in until the applicant names their company; syncDraftClient replaces it. */
function placeholderCompanyName(user: Doc<"users"> | null) {
  const name =
    user?.name?.trim() || user?.email?.split("@")[0] || "New applicant";
  return name.replace(/\b\w/g, (char) => char.toUpperCase());
}
async function createIntakeClient(
  ctx: MutationCtx,
  userId: Id<"users">,
  answers: IntakeAnswers,
  draftRequestId?: Id<"procurementRequests">,
) {
  const companyName = answers.dba?.trim() || answers.legalName?.trim();
  const website = answers.website?.trim() || undefined;
  const orgId = await ctx.db.insert("organizations", {
    name: companyName || placeholderCompanyName(await ctx.db.get(userId)),
    website,
    type: "client",
    primaryInsuranceContactId: userId,
    onboardingComplete: true,
    intakeDraftRequestId: draftRequestId,
  });
  await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
  if (companyName) await scheduleCompanyResearch(ctx, orgId);
  if (website)
    await ctx.scheduler.runAfter(
      0,
      internal.actions.extractCompanyInfo.importMissingOrgLogoInternal,
      { orgId, url: website },
    );
  return orgId;
}
/** The client created early by this unsubmitted draft, whose identity still follows its answers. */
async function draftClient(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  if (!request.clientOrgId || request.intakeSubmittedAt) return null;
  const org = await ctx.db.get(request.clientOrgId);
  return org &&
    org.deletedAt === undefined &&
    org.intakeDraftRequestId === request._id
    ? org
    : null;
}
async function syncDraftClient(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  answers: IntakeAnswers,
) {
  const name =
    answers.dba?.trim() || answers.legalName?.trim() || org.name;
  const website = answers.website?.trim() || undefined;
  if (name === org.name && website === org.website) return;
  await ctx.db.patch(org._id, { name, website });
  await scheduleCompanyResearch(ctx, org._id);
  if (website && website !== org.website)
    await ctx.scheduler.runAfter(
      0,
      internal.actions.extractCompanyInfo.importMissingOrgLogoInternal,
      { orgId: org._id, url: website },
    );
}
async function newDraft(
  ctx: MutationCtx,
  userId: Id<"users">,
  answers: IntakeAnswers,
  orgId?: Id<"organizations">,
  companyDetails?: IntakeDetails,
) {
  const now = dayjs().valueOf();
  const requestId = await ctx.db.insert("procurementRequests", {
    ownerUserId: userId,
    clientOrgId: orgId,
    createdByUserId: userId,
    updatedByUserId: userId,
    title: "New insurance request",
    status: "draft",
    clientVisible: false,
    inboxToken: createProcurementInboxToken(),
    createdAt: now,
    updatedAt: now,
    intakeVerifiedAccess: !!(await ctx.db.get(userId))?.emailVerificationTime,
    intakeSchemaVersion: INTAKE_VERSION,
    intakeAnswers: answers,
    intakeDetails: {
      ...detailsFromAnswers(answers),
      ...(companyDetails
        ? {
            mailingAddress: companyDetails.mailingAddress,
            locations: companyDetails.locations,
            relatedEntities: companyDetails.relatedEntities,
            relatedEntitiesNote: companyDetails.relatedEntitiesNote,
            ...(companyDetails.hasRelatedEntities
              ? { hasRelatedEntities: companyDetails.hasRelatedEntities }
              : {}),
            ...(companyDetails.registrationAddress
              ? { registrationAddress: companyDetails.registrationAddress }
              : {}),
            ...(companyDetails.mailingSameAsRegistered
              ? {
                  mailingSameAsRegistered:
                    companyDetails.mailingSameAsRegistered,
                }
              : {}),
            ...(companyDetails.registrationCountry
              ? { registrationCountry: companyDetails.registrationCountry }
              : {}),
            ...(companyDetails.registrationState
              ? { registrationState: companyDetails.registrationState }
              : {}),
          }
        : {}),
    },
    intakeStep: answers.intakeGoal === "savings" ? 21 : 1,
    intakeRevision: 0,
  });
  // First-time applicants get a client right away so operators can open it before submission.
  if (
    !orgId &&
    !(await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", userId))
      .first())
  )
    await ctx.db.patch(requestId, {
      clientOrgId: await createIntakeClient(ctx, userId, answers, requestId),
    });
  await queueIntakeSlack(ctx, requestId, "started", "Application started");
  return requestId;
}
export const createHandoff = internalMutation({
  args: {
    intakeGoal: v.optional(v.union(v.literal("quote"), v.literal("savings"))),
    token: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^[a-zA-Z0-9_-]{32,128}$/.test(args.token))
      throw new Error("Invalid handoff key");
    const contact = validateContact(args.name, args.email, args.phone);
    const tokenHash = await hashIntakeToken(args.token);
    const previous = await ctx.db
      .query("requestHandoffs")
      .withIndex("token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (previous) {
      if (
        previous.email !== contact.email ||
        previous.name !== contact.name ||
        previous.phone !== contact.phone ||
        previous.intakeGoal !== args.intakeGoal ||
        previous.expiresAt < dayjs().valueOf()
      )
        throw new Error("Handoff expired or changed. Start again.");
      return { existingAccount: !previous.requestId };
    }
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", contact.email))
      .first();
    let requestId: Id<"procurementRequests"> | undefined;
    if (!existing) {
      const userId = await ctx.db.insert("users", {
        name: contact.name,
        email: contact.email,
        accountKind: "customer",
        intakeRestricted: true,
        onboardingComplete: false,
      });
      requestId = await newDraft(ctx, userId, {
        ...contact,
        intakeGoal: args.intakeGoal,
      });
    }
    await ctx.db.insert("requestHandoffs", {
      ...contact,
      intakeGoal: args.intakeGoal,
      tokenHash,
      requestId,
      expiresAt: dayjs().add(30, "minute").valueOf(),
    });
    return { existingAccount: !!existing };
  },
});
export const inspectHandoff = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const tokenHash = await hashIntakeToken(token);
    const handoff = await ctx.db
      .query("requestHandoffs")
      .withIndex("token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!handoff || handoff.expiresAt < dayjs().valueOf()) return null;
    return {
      email: handoff.email,
      name: handoff.name,
      phone: handoff.phone,
      existingAccount: !handoff.requestId,
      claimed: !!handoff.claimedAt,
    };
  },
});
export const claimNewSession = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const tokenHash = await hashIntakeToken(token);
    const handoff = await ctx.db
      .query("requestHandoffs")
      .withIndex("token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (
      !handoff ||
      !handoff.requestId ||
      handoff.claimedAt ||
      handoff.expiresAt < dayjs().valueOf()
    )
      throw new Error("Please confirm your email to continue.");
    const request = await ctx.db.get(handoff.requestId);
    const user = request?.ownerUserId
      ? await ctx.db.get(request.ownerUserId)
      : null;
    if (
      request?.deletedAt ||
      !user?.intakeRestricted ||
      user.emailVerificationTime
    )
      throw new Error("Please confirm your email to continue.");
    await ctx.db.patch(handoff._id, { claimedAt: dayjs().valueOf() });
    return { userId: user._id };
  },
});
export const claimHandoff = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await intakeUser(ctx);
    const tokenHash = await hashIntakeToken(token);
    const handoff = await ctx.db
      .query("requestHandoffs")
      .withIndex("token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (
      !handoff ||
      handoff.expiresAt < dayjs().valueOf() ||
      handoff.email !== user.email
    )
      throw new Error("Handoff expired. Start a request again.");
    if (handoff.requestId) {
      await ownedRequest(ctx, handoff.requestId);
      return handoff.requestId;
    }
    if (!user.emailVerificationTime || user.intakeRestricted)
      throw new Error("Confirm your email first");
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", user._id))
      .first();
    const company = membership ? await ctx.db.get(membership.orgId) : null;
    const orgId =
      company?.type === "client" && company.deletedAt === undefined
        ? company._id
        : undefined;
    let companyDefaults: IntakeAnswers = {};
    let companyDetails: IntakeDetails | undefined;
    if (orgId) {
      await getOrgAccess(ctx, orgId);
      const previous = await ctx.db
        .query("procurementRequests")
        .withIndex("organization", (q) => q.eq("clientOrgId", orgId))
        .order("desc")
        .take(100);
      const previousProfile = previous.find(
        (r) => r.intakeSubmittedAt && r.clientVisible === true,
      );
      const savedBusiness = await readIntakeBusinessProfile(ctx, orgId);
      const profile =
        savedBusiness?.answers ??
        previousProfile?.intakeAnswers ??
        previousProfile?.intakeSnapshot;
      companyDetails = savedBusiness?.details ?? previousProfile?.intakeDetails;
      companyDefaults = Object.fromEntries(
        COMPANY_INTAKE_FIELDS.map((key) => [key, profile?.[key] ?? ""]),
      );
      companyDefaults.legalName = profile?.legalName || company!.name;
      companyDefaults.website = company!.website ?? profile?.website ?? "";
    }
    const requestId = await newDraft(
      ctx,
      user._id,
      {
        ...companyDefaults,
        name: handoff.name,
        email: handoff.email,
        phone: handoff.phone,
        intakeGoal: handoff.intakeGoal,
      },
      orgId,
      companyDetails,
    );
    await ctx.db.patch(handoff._id, {
      requestId,
      claimedAt: dayjs().valueOf(),
    });
    return requestId;
  },
});
export const start = mutation({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const user = await intakeUser(ctx);
    const priorOwned = await ctx.db
      .query("procurementRequests")
      .withIndex("owner_updated", (q) => q.eq("ownerUserId", user._id))
      .order("desc")
      .take(100);
    const priorSubmitted = priorOwned.find(
      (r) => !r.deletedAt && r.intakeSubmittedAt,
    );
    const priorContact = priorSubmitted
      ? submittedIntakeApplication(priorSubmitted)?.answers
      : undefined;
    let answers: IntakeAnswers = {
      name: user.name ?? "",
      email: user.email ?? "",
      phone: user.phone ?? priorContact?.phone ?? "",
    };
    let companyDetails: IntakeDetails | undefined;
    if (user.intakeRestricted) {
      if (args.orgId) throw new Error("Use your own application’s company");
      const prior = priorOwned.find(
        (r) => r.intakeSubmittedAt && r.clientOrgId,
      );
      if (prior) {
        const savedBusiness = await readIntakeBusinessProfile(
          ctx,
          prior.clientOrgId!,
        );
        const profile =
          savedBusiness?.answers ?? prior.intakeAnswers ?? prior.intakeSnapshot;
        answers = {
          ...answers,
          ...Object.fromEntries(
            COMPANY_INTAKE_FIELDS.map((key) => [key, profile?.[key] ?? ""]),
          ),
        };
        companyDetails = savedBusiness?.details ?? prior.intakeDetails;
      }
      return newDraft(
        ctx,
        user._id,
        answers,
        prior?.clientOrgId,
        companyDetails,
      );
    }
    if (args.orgId) {
      const access = await getOrgAccess(ctx, args.orgId);
      if (access.accessType !== "member")
        throw new Error("Company membership required");
      if (access.orgType !== "client")
        throw new Error("Select a client company");
      const previous = await ctx.db
        .query("procurementRequests")
        .withIndex("organization", (q) => q.eq("clientOrgId", args.orgId))
        .order("desc")
        .take(100);
      const previousProfile = previous.find(
        (r) => r.intakeSubmittedAt && r.clientVisible === true,
      );
      const savedBusiness = await readIntakeBusinessProfile(ctx, args.orgId);
      const profile =
        savedBusiness?.answers ??
        (previousProfile
          ? submittedIntakeApplication(previousProfile)?.answers
          : undefined);
      companyDetails =
        savedBusiness?.details ??
        (previousProfile
          ? submittedIntakeApplication(previousProfile)?.details
          : undefined);
      answers = {
        ...answers,
        ...Object.fromEntries(
          COMPANY_INTAKE_FIELDS.map((key) => [key, profile?.[key] ?? ""]),
        ),
        legalName: profile?.legalName || access.org.name,
        website: access.org.website ?? profile?.website ?? "",
      };
    }
    return newDraft(ctx, user._id, answers, args.orgId, companyDetails);
  },
});
export const get = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    const { user, request } = await ownedRequest(ctx, args.requestId);
    const files = await ctx.db
      .query("requestIntakeFiles")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .take(30);
    const details =
      request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {});
    const premiumDraftContentHash = await hashIntakeToken(submissionContent(request.intakeAnswers ?? {}, activeIntakeDetails(details,request.intakeAnswers?.intakeGoal), files.map(file=>String(file._id))));
    const hasTypedScope = details.coverages.some(
      (line) =>
        line.properties !== undefined ||
        line.vehicles !== undefined ||
        line.scopeDescription !== undefined,
    );
    const hasTypedAdditional = details.coverages.some(
      (line) => line.additionalCoverages !== undefined,
    );
    return {
      requestId: request._id,
      vehicleRelevance: request.intakeVehicleRelevance,
      answers: request.intakeAnswers ?? {},
      followupBatches: {
        acord: {
          status: "ready" as const, token: BAKED_COVERAGE_QUESTIONS_VERSION,
          contextHash: BAKED_COVERAGE_QUESTIONS_VERSION, startedAt: 0, current: true, enriching: false, preloaded: false,
          questions: bakedCoverageQuestions({ answers: request.intakeAnswers ?? {}, details }),
        },
        additional: request.intakeFollowups?.additional ? {...request.intakeFollowups.additional, current: request.intakeFollowups.additional.contextHash === await followupContextHash(ctx, request, "additional"), questions: request.intakeFollowups.additional.status === "ready" ? request.intakeFollowups.additional.questions : []} : undefined,
      },
      details: {
        ...details,
        scopeNote:
          details.scopeNote ??
          (hasTypedScope ? "" : (request.intakeAnswers?.coverageScope ?? "")),
        additionalNote:
          details.additionalNote ??
          (hasTypedAdditional
            ? ""
            : (request.intakeAnswers?.separateQuotes ?? "")),
      },
      step:
        request.intakeSchemaVersion === 1
          ? [1, 6, 10, 20, 28][request.intakeStep ?? 0]
          : (request.intakeStep ?? 0),
      revision: request.intakeRevision ?? 0,
      submitted: !!request.intakeSubmittedAt,
      submissionBaseline: request.intakeSubmittedAt
        ? (request.intakeSubmittedApplication ??
          request.intakeSubmissionBaseline ?? {
            answers: request.intakeSnapshot ?? {},
            details:
              request.intakeDetailsSnapshot ??
              detailsFromAnswers(request.intakeSnapshot ?? {}),
            files: files
              .filter((file) => file.createdAt <= request.intakeSubmittedAt!)
              .map((file) => ({ id: String(file._id), name: file.name })),
          })
        : undefined,
      hasUnsubmittedChanges:
        !!request.intakeSubmittedAt &&
        (await hashIntakeToken(
          submissionContent(
            request.intakeAnswers ?? {},
            details,
            files.map((f) => String(f._id)),
          ),
        )) !==
          (request.intakeSubmittedContentHash ??
            (await hashIntakeToken(
              submissionContent(
                request.intakeSnapshot ?? {},
                request.intakeDetailsSnapshot ??
                  detailsFromAnswers(request.intakeSnapshot ?? {}),
                files
                  .filter((f) => f.createdAt <= request.intakeSubmittedAt!)
                  .map((f) => String(f._id)),
              ),
            ))),
      skippedSteps: request.intakeSkippedSteps ?? [],
      status: request.status,

      submittedAt: request.intakeSubmittedAt,
      updatedAt: request.updatedAt,
      companyResearch:
        request.intakeCompanyResearch?.status === "completed"
          ? request.intakeCompanyResearch
          : undefined,
      cyberResearch: request.intakeCyberResearch,
      premiumDraftContentHash,
      premiumEstimate: request.intakePremiumEstimate && (request.intakePremiumEstimate.provisional ? request.intakePremiumEstimate.contentHash === premiumDraftContentHash : !request.intakeSubmittedContentHash || request.intakePremiumEstimate.contentHash === request.intakeSubmittedContentHash) ? request.intakePremiumEstimate : undefined,
      // A client created by this draft is not a saved company to offer back.
      orgId: (await draftClient(ctx, request))
        ? undefined
        : request.clientOrgId,
      canUseSavedCompany:
        !!request.intakeSavedCompany || !!request.intakeNewCompany,
      verified: !!user.emailVerificationTime && !user.intakeRestricted,
      files: await Promise.all(
        files.map(async (f) => ({
          id: f._id,
          name: f.name,
          category: f.category,
          prefillCoveragesJson: f.prefillCoveragesJson,
          prefillStatus: f.prefillStatus,
          prefillStartedAt: f.prefillStartedAt,
          url: await ctx.storage.getUrl(f.fileId),
        })),
      ),
    };
  },
});
export const drafts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user || user.accountKind === "operator" || user.serviceAccountKind)
      return [];
    const sessionId = await getAuthSessionId(ctx);
    if (
      sessionId &&
      ctx.db.normalizeId("authSessions", sessionId) &&
      !(await ctx.db.get(sessionId))
    )
      return [];
    const rows = await ctx.db
      .query("procurementRequests")
      .withIndex("owner_updated", (q) => q.eq("ownerUserId", user._id))
      .order("desc")
      .take(100);
    return rows
      .filter(
        (r) =>
          !r.deletedAt &&
          r.status === "draft" &&
          !r.intakeSubmittedAt &&
          (user.intakeRestricted || r.intakeVerifiedAccess),
      )
      .map((r) => ({
        id: r._id,
        title: r.intakeAnswers?.dba || r.intakeAnswers?.legalName || r.title,
        coverage:
          r.intakeAnswers?.intakeGoal === "savings"
            ? "Policy savings review"
            : r.intakeAnswers?.coverage || "",
        effectiveDate: r.intakeAnswers?.effectiveDate || "",
        insuredName:
          r.intakeAnswers?.legalName ||
          r.intakeAnswers?.name ||
          user.name ||
          "",
        updatedAt: r.updatedAt,
      }));
  },
});
/** Owners can return to submitted applications without confirming email. */
export const submitted = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getSessionUserId(ctx, true);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user || user.accountKind === "operator" || user.serviceAccountKind)
      return [];
    const rows = await ctx.db
      .query("procurementRequests")
      .withIndex("owner_updated", (q) => q.eq("ownerUserId", user._id))
      .order("desc")
      .take(100);
    const accessible = await Promise.all(
      rows
        .filter(
          (r) =>
            !r.deletedAt &&
            r.intakeSubmittedAt &&
            (user.intakeRestricted || r.intakeVerifiedAccess),
        )
        .map(async (r) => {
          if (!r.clientOrgId) return null;
          const [org, membership] = await Promise.all([
            ctx.db.get(r.clientOrgId),
            ctx.db
              .query("orgMemberships")
              .withIndex("organization_user", (q) =>
                q.eq("orgId", r.clientOrgId!).eq("userId", user._id),
              )
              .first(),
          ]);
          if (!org || org.deletedAt !== undefined || !membership) return null;
          return {
            id: r._id,
            title: r.intakeAnswers?.dba || r.intakeAnswers?.legalName || r.title,
            coverage:
              r.intakeAnswers?.intakeGoal === "savings"
                ? "Policy savings review"
                : r.intakeAnswers?.coverage || "",
            effectiveDate:
              r.intakeAnswers?.effectiveDate || r.targetEffectiveDate || "",
            insuredName: r.intakeAnswers?.legalName || org.name,
            status: r.status,
          };
        }),
    );
    return accessible.filter((r) => r !== null);
  },
});

export const save = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    answers: intakeAnswersValidator,
    details: v.optional(intakeDetailsValidator),
    step: v.number(),
    expectedRevision: v.number(),
    skippedStep: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user, request } = await ownedRequest(ctx, args.requestId);
    if (
      args.answers.trigger !== undefined &&
      INTAKE_REASONS.includes(args.answers.trigger)
    ) {
      args.answers = {
        ...args.answers,
        intakeGoal:
          args.answers.trigger === SAVINGS_INTAKE_REASON ? "savings" : "quote",
      };
    }
    if (
      args.answers.intakeGoal !== undefined &&
      !["quote", "savings"].includes(args.answers.intakeGoal)
    )
      throw new Error("Choose a new quote or a policy savings review");
    if (
      request.intakeSubmittedAt &&
      args.answers.intakeGoal !== undefined &&
      args.answers.intakeGoal !== request.intakeAnswers?.intakeGoal
    )
      throw new Error("A submitted application cannot change its purpose");
    if ((request.intakeRevision ?? 0) !== args.expectedRevision)
      throw new Error(
        "This request changed in another tab. Reload to review the latest answers; your edits remain on this device.",
      );
    if (
      !Number.isInteger(args.step) ||
      args.step < 0 ||
      args.step >= INTAKE_STEPS.length
    )
      throw new Error("Invalid step");
    if (
      Object.values(args.answers).some(
        (value) => value && value.length > 8000,
      ) ||
      JSON.stringify(args.answers).length > 64000
    )
      throw new Error("Answers are too long");
    if (args.answers.email && args.answers.email !== user.email)
      throw new Error(
        "Use your account email. Start again to use a different email.",
      );
    if (
      args.skippedStep !== undefined &&
      (!Number.isInteger(args.skippedStep) ||
        args.skippedStep < 0 ||
        args.skippedStep >= INTAKE_STEPS.length ||
        args.skippedStep === 28)
    )
      throw new Error("This question cannot be skipped");
    if (args.details) {
      if (args.details.termsAcceptedVersion && !intakeTermsForVersion(args.details.termsAcceptedVersion))
        throw new Error("Review and accept the current Spot Terms of Service");
      validateIntakeDetails(args.details);
      const approved = [
        ...bakedCoverageQuestions({ answers: { ...request.intakeAnswers, ...args.answers }, details: args.details }),
        ...(request.intakeFollowups?.acord?.status === "ready" ? request.intakeFollowups.acord.questions : []),
        ...(request.intakeFollowups?.additional?.status === "ready" ? request.intakeFollowups.additional.questions : []),
        ...(request.intakeDetails?.followups ?? []),
      ].flatMap((question) => [question, ...expandIntakeFollowupQuestion(question)]);
      for (const row of args.details.followups??[]) {
        const { answer: _answer, skipped: _skipped, prefilled, ...question }=row;
        if (prefilled) {
          const existing = request.intakeDetails?.followups?.some(saved => saved.id === row.id && saved.answer === row.answer &&
            saved.prefilled?.confidence === prefilled.confidence && saved.prefilled?.contextHash === prefilled.contextHash);
          const research = request.intakeCyberResearch;
          const researched = research?.status === "completed" && prefilled.contextHash === `cyber:${research.fingerprint}` &&
            research.sourceKey === intakeCyberResearchKey({ ...request.intakeAnswers, ...args.answers }, args.details) &&
            jevDecisionBand(prefilled.confidence, "prefill") === "high" &&
            research.suggestions?.some(proposal => proposal.questionId === row.id && proposal.answer === row.answer && proposal.confidence === prefilled.confidence);
          if (!existing && !researched) throw new Error("Invalid inferred answer provenance");
        }
        if(row.answer.trim() && !isRetiredIntakeFollowup(row) && !followupQuestionVisible(row,args.details.followups))throw new Error("This follow-up does not apply to the current answer.");
        if (
          !approved.some(
            (candidate) =>
              candidate.id === question.id &&
              candidate.section === question.section &&
              candidate.label === question.label &&
              candidate.kind === question.kind &&
              candidate.source === question.source &&
              (candidate.conditions ?? []).length === (question.conditions ?? []).length &&
              (candidate.conditions ?? []).every((condition, index) =>
                condition.questionId === question.conditions?.[index]?.questionId &&
                condition.answer === question.conditions?.[index]?.answer) &&
              JSON.stringify(candidate.options) ===
                JSON.stringify(question.options),
          )
        )
          throw new Error(
            "These follow-up questions have changed. Reload your application.",
          );
      }
    }
    let details = args.details ?? request.intakeDetails;
    // Older drafts can navigate to the new consent without autosave blocking them.
    if (details?.termsAcceptedVersion && details.termsAcceptedVersion !== INTAKE_TERMS_VERSION)
      details = { ...details, termsAcceptedVersion: undefined };
    if (!args.details && details) {
      const legacy = detailsFromAnswers({
        ...request.intakeAnswers,
        ...args.answers,
      });
      details = {
        ...details,
        ...(args.answers.coverage !== undefined
          ? { coverages: legacy.coverages, coverageIndex: 0 }
          : {}),
        ...(args.answers.limits !== undefined
          ? { limitsNote: args.answers.limits }
          : {}),
        ...(args.answers.registeredAddress !== undefined
          ? { registrationAddress: legacy.registrationAddress }
          : {}),
        ...(args.answers.mailingAddress !== undefined
          ? { mailingAddress: legacy.mailingAddress }
          : {}),
        ...(args.answers.locations !== undefined
          ? { locations: legacy.locations }
          : {}),
        ...(args.answers.relatedEntities !== undefined
          ? {
              relatedEntitiesNote: args.answers.relatedEntities,
              relatedEntities: [],
            }
          : {}),
        ...(args.answers.effectiveDate !== undefined
          ? { dateParts: legacy.dateParts, dateInput: undefined }
          : {}),
      };
    }
    const answers = {
      ...request.intakeAnswers,
      ...args.answers,
      ...(args.details ? detailsAnswers(args.details) : {}),
    };
    const signerChanged = !!request.intakeTermsAcceptance?.signerName && (
      request.intakeTermsAcceptance.signerName !== answers.name?.trim() ||
      request.intakeTermsAcceptance.signerEmail !== answers.email?.trim().toLowerCase()
    );
    if (signerChanged && details) details = { ...details, termsAcceptedVersion: undefined };
    if(details && !request.intakeSubmittedAt)details=invalidateIntakePrefills(request.intakeAnswers ?? {},request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {}),answers,details);
    const website = answers.website?.trim() ?? "";
    const name = answers.legalName?.trim() || answers.dba?.trim() || "";
    const url =
      website &&
      publicResearchUrl(
        /^https?:\/\//i.test(website) ? website : `https://${website}`,
      );
    // Scan once the applicant moves past the question, not on every keystroke autosave.
    if (url && args.step !== request.intakeStep)
      await scheduleWebsiteTechScan(ctx, url);
    const fingerprint = JSON.stringify([name, website]);
    if (details && !request.intakeSubmittedAt && answers.intakeGoal !== "savings" &&
      vehicleRelevanceEvidence(answers,details).vehicles.some(vehicle=>vehicle.use.trim() && vehicle.use!=="I'm not sure")) {
      const sourceKey=vehicleRelevanceKey(answers,details);
      const previous=request.intakeVehicleRelevance;
      if(previous?.sourceKey!==sourceKey && (previous?.attempts ?? 0)<40){
        const fingerprint=await hashIntakeToken(sourceKey);
        await ctx.db.patch(request._id,{intakeVehicleRelevance:{sourceKey,fingerprint,status:"pending",startedAt:dayjs().valueOf(),attempts:previous?.attempts??0,excludedIds:[]}});
        await ctx.scheduler.runAfter(1500,internal.actions.intakeVehicleRelevance.run,{requestId:request._id,fingerprint});
      }
    }
    const previousResearch = request.intakeCompanyResearch;
    if (url && details?.coverages.some(line => line.coverage === "cyber") && answers.intakeGoal !== "savings" && !request.intakeSubmittedAt) {
      const sourceKey = intakeCyberResearchKey(answers, details);
      const previous = request.intakeCyberResearch;
      if (previous?.sourceKey !== sourceKey && (previous?.attempts ?? 0) < 10) {
        const fingerprint = await hashIntakeToken(sourceKey);
        await ctx.db.patch(request._id, { intakeCyberResearch: {
          sourceKey, fingerprint, startedAt: dayjs().valueOf(), attempts: previous?.attempts ?? 0, status: "pending",
        } });
        await ctx.scheduler.runAfter(1500, internal.actions.intakeCyberResearch.run, { requestId: request._id, fingerprint });
      }
    }
    if (
      url &&
      previousResearch?.fingerprint !== fingerprint &&
      (previousResearch?.attempts ?? 0) < 10
    ) {
      await ctx.db.patch(request._id, {
        intakeCompanyResearch: {
          fingerprint,
          name,
          website,
          status: "pending",
          startedAt: dayjs().valueOf(),
          attempts: previousResearch?.attempts ?? 0,
        },
      });
      await ctx.scheduler.runAfter(
        1500,
        internal.actions.intakeCompanyResearch.run,
        { requestId: request._id, fingerprint },
      );
    }
    // Keep the draft client named after the company, or create one for an applicant starting a new company.
    let clientOrgId = request.clientOrgId;
    if (!request.intakeSubmittedAt && name && args.step !== request.intakeStep) {
      const company = await draftClient(ctx, request);
      if (company) await syncDraftClient(ctx, company, answers);
      else if (
        !clientOrgId &&
        (request.intakeNewCompany ||
          !(await ctx.db
            .query("orgMemberships")
            .withIndex("user", (q) => q.eq("userId", user._id))
            .first()))
      )
        clientOrgId = await createIntakeClient(
          ctx,
          user._id,
          answers,
          request._id,
        );
    }
    const answersChanged =
      JSON.stringify(answers) !== JSON.stringify(request.intakeAnswers ?? {});
    const revision = (request.intakeRevision ?? 0) + 1;
    await ctx.db.patch(request._id, {
      clientOrgId,
      intakeAnswers: answers,
      ...(answers.intakeGoal === "savings" ? { intakeFollowups: undefined } : {}),
      ...(request.intakeSubmittedAt && answersChanged
        ? {
            intakeAmendedAt: dayjs().valueOf(),

            targetEffectiveDate: answers.effectiveDate || undefined,
          }
        : {}),
      ...(details ? { intakeDetails: details } : {}),
      ...(args.details || signerChanged ? { intakeTermsAcceptance:
        details?.termsAcceptedVersion === INTAKE_TERMS_VERSION
          ? request.intakeTermsAcceptance?.version === INTAKE_TERMS_VERSION
            ? request.intakeTermsAcceptance
            : { userId: user._id, acceptedAt: dayjs().valueOf(), version: INTAKE_TERMS_VERSION,
                url: `${INTAKE_TERMS_URL}?version=${INTAKE_TERMS_VERSION}`, statement: INTAKE_TERMS_STATEMENT,
                signerName: answers.name?.trim(), signerEmail: answers.email?.trim().toLowerCase() }
          : undefined,
      } : {}),
      intakeSkippedSteps: [
        ...new Set([
          ...(request.intakeSkippedSteps ?? []).filter(
            (step) => step !== args.step,
          ),
          ...(args.skippedStep === undefined ? [] : [args.skippedStep]),
        ]),
      ],
      intakeCompletedSteps: completedIntakeSteps(answers),
      intakeStep: args.step,
      intakeSchemaVersion: INTAKE_VERSION,
      intakeRevision: revision,
      ...(request.verificationClaimHash && user.intakeRestricted
        ? { verificationClaimExpiresAt: dayjs().add(30, "day").valueOf() }
        : {}),

      title: answers.coverage
        ? `${answers.coverage} — ${answers.dba || answers.legalName || "Insurance request"}`.slice(
            0,
            200,
          )
        : request.title,
      updatedAt: dayjs().valueOf(),
      updatedByUserId: user._id,
    });
    if (!request.intakeSubmittedAt && answers.intakeGoal !== "savings") {
      await ctx.scheduler.runAfter(5000, internal.requestIntake.warmFollowupsAfterSave, {
        requestId: request._id,
        revision,
      });
    }
    if (
      args.step !== request.intakeStep ||
      details?.revenueStep !== request.intakeDetails?.revenueStep ||
      details?.coverageIndex !== request.intakeDetails?.coverageIndex ||
      details?.mailingAddressStep !== request.intakeDetails?.mailingAddressStep
    ) {
      const key = `step:${args.step}:${details?.revenueStep || ""}:${details?.coverageIndex ?? 0}${args.step === 14 && details?.mailingAddressStep ? ":mailing" : ""}`;
      await queueIntakeSlack(
        ctx,
        request._id,
        key,
        `Application saved — now on: ${INTAKE_STEPS[args.step]}`,
      );
    } else {
      // Same-question autosaves also refresh the thread's current answer values.
      await queueIntakeSlack(
        ctx,
        request._id,
        `summary:${revision}`,
        "Application saved",
      );
    }
    return revision;
  },
});
export const useNewCompany = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const { request } = await ownedRequest(ctx, args.requestId);
    if (request.intakeSubmittedAt)
      throw new Error("Start a new application to use a different company");
    const company = await draftClient(ctx, request);
    if ((request.intakeRevision ?? 0) !== args.expectedRevision)
      throw new Error(
        "This application changed. Reload before changing companies.",
      );
    const answers = { ...request.intakeAnswers };
    for (const key of COMPANY_INTAKE_FIELDS) delete answers[key];
    delete answers.companyConfirmed;
    const previous = request.intakeDetails ?? detailsFromAnswers(answers);
    const details = {
      ...detailsFromAnswers(answers),
      coverages: previous.coverages,
      coverageIndex: previous.coverageIndex,
      dateInput: previous.dateInput,
      dateParts: previous.dateParts,
      limitsNote: previous.limitsNote,
      scopeNote: previous.scopeNote,
      additionalNote: previous.additionalNote,
      prefillSourceIds: previous.prefillSourceIds,
      sectionIntroductions: previous.sectionIntroductions,
      subsectionIntroductions: previous.subsectionIntroductions,
      drivers: previous.drivers,
      driverIndex: previous.driverIndex,
      collectSensitiveDriverDetails: previous.collectSensitiveDriverDetails,
      freightHauled: previous.freightHauled,
      autoVehicleIndex: previous.autoVehicleIndex,
    };
    const revision = (request.intakeRevision ?? 0) + 1;
    await ctx.db.patch(request._id, {
      ...(request.clientOrgId && !request.intakeSavedCompany && !company
        ? {
            intakeSavedCompany: {
              orgId: request.clientOrgId,
              answers: request.intakeAnswers ?? {},
              details: previous,
            },
          }
        : {}),
      clientOrgId: company?._id,
      intakeNewCompany: true,
      intakeCompanyResearch: undefined,
      intakeAnswers: answers,
      intakeDetails: details,
      intakeStep: 10,
      intakeRevision: revision,
      updatedAt: dayjs().valueOf(),
    });
    return { answers, details, revision };
  },
});

export const useSavedCompany = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const { user, request } = await ownedRequest(ctx, args.requestId);
    if (request.intakeSubmittedAt)
      throw new Error("Start a new application to change companies");
    if ((request.intakeRevision ?? 0) !== args.expectedRevision)
      throw new Error(
        "This application changed. Reload before changing companies.",
      );
    let saved = request.intakeSavedCompany;
    if (!saved) {
      const previous = await ctx.db
        .query("procurementRequests")
        .withIndex("owner_updated", (q) => q.eq("ownerUserId", user._id))
        .order("desc")
        .take(100);
      const source = previous.find(
        (row) =>
          row._id !== request._id && row.intakeSubmittedAt && row.clientOrgId,
      );
      if (source?.clientOrgId) {
        const profile = await readIntakeBusinessProfile(
          ctx,
          source.clientOrgId,
        );
        const submitted = submittedIntakeApplication(source);
        if (profile || submitted)
          saved = {
            orgId: source.clientOrgId,
            answers: profile?.answers ?? submitted!.answers,
            details: profile?.details ?? submitted!.details,
          };
      }
    }
    if (!saved) throw new Error("No saved company is available");
    const company = await ctx.db.get(saved.orgId);
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", saved!.orgId).eq("userId", user._id),
      )
      .first();
    if (
      !company ||
      company.deletedAt !== undefined ||
      company.type !== "client" ||
      !membership
    )
      throw new Error("Saved company is no longer available");
    const draftCompany = await draftClient(ctx, request);
    if (draftCompany && draftCompany._id !== saved.orgId) {
      await ctx.db.patch(draftCompany._id, {
        deletedAt: dayjs().valueOf(),
        deletedByUserId: user._id,
        intakeDraftRequestId: undefined,
      });
      const draftMembership = await ctx.db
        .query("orgMemberships")
        .withIndex("organization_user", (q) =>
          q.eq("orgId", draftCompany._id).eq("userId", user._id),
        )
        .first();
      if (draftMembership) await ctx.db.delete(draftMembership._id);
    }
    const answers = { ...request.intakeAnswers };
    for (const key of COMPANY_INTAKE_FIELDS) {
      delete answers[key];
      if (saved.answers[key] !== undefined) answers[key] = saved.answers[key];
    }
    const current = request.intakeDetails ?? detailsFromAnswers(answers);
    const details = {
      ...saved.details,
      coverages: current.coverages,
      coverageIndex: current.coverageIndex,
      dateInput: current.dateInput,
      dateParts: current.dateParts,
      limitsNote: current.limitsNote,
      scopeNote: current.scopeNote,
      additionalNote: current.additionalNote,
      prefillSourceIds: current.prefillSourceIds,
      sectionIntroductions: current.sectionIntroductions,
      subsectionIntroductions: current.subsectionIntroductions,
      drivers: current.drivers,
      driverIndex: current.driverIndex,
      collectSensitiveDriverDetails: current.collectSensitiveDriverDetails,
      freightHauled: current.freightHauled,
      autoVehicleIndex: current.autoVehicleIndex,
    };
    const revision = (request.intakeRevision ?? 0) + 1;
    await ctx.db.patch(request._id, {
      clientOrgId: saved.orgId,
      intakeNewCompany: undefined,
      intakeAnswers: answers,
      intakeDetails: details,
      intakeCompanyResearch: undefined,
      intakeRevision: revision,
      intakeStep: 10,
      updatedAt: dayjs().valueOf(),
    });
    return { answers, details, revision };
  },
});

export const uploadUrl = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    const { user, request } = await ownedRequest(ctx, args.requestId);
    const files = await ctx.db
      .query("requestIntakeFiles")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .take(30);
    if (files.length >= 20) throw new Error("Maximum 20 files per application");
    const intentId = await ctx.db.insert("requestIntakeUploadIntents", {
      requestId: request._id,
      ownerUserId: user._id,
      createdAt: dayjs().valueOf(),
      expiresAt: dayjs().add(30, "minute").valueOf(),
    });
    return { url: await ctx.storage.generateUploadUrl(), intentId };
  },
});
export const attachFile = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    intentId: v.id("requestIntakeUploadIntents"),
    fileId: v.id("_storage"),
    name: v.string(),
    category: v.union(
      v.literal("requirements"),
      v.literal("policy"),
      v.literal("loss_runs"),
      v.literal("supporting"),
    ),
  },
  handler: async (ctx, args) => {
    const { user, request } = await ownedRequest(ctx, args.requestId);
    if (
      request.intakeSubmittedAt &&
      request.intakeAnswers?.intakeGoal === "savings"
    )
      throw new Error("Start a new savings review to add policies");
    const intent = await ctx.db.get(args.intentId);
    if (
      !intent ||
      intent.requestId !== request._id ||
      intent.ownerUserId !== user._id ||
      intent.expiresAt < dayjs().valueOf() ||
      (intent.fileId && intent.fileId !== args.fileId)
    )
      throw new Error("Upload authorization expired or invalid");
    const metadata = await ctx.db.system.get(args.fileId);
    if (
      request.intakeAnswers?.intakeGoal === "savings" &&
      (args.category !== "policy" ||
        metadata?.contentType !== "application/pdf")
    )
      throw new Error("Upload your current policy as a PDF");
    if (metadata && metadata._creationTime < intent.createdAt - 1000)
      throw new Error("Upload does not match this upload authorization");
    if (
      !metadata ||
      metadata.size > 20 * 1024 * 1024 ||
      ![
        "application/pdf",
        "image/png",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(metadata.contentType ?? "")
    )
      throw new Error("Upload a PDF, PNG, JPEG, or DOCX up to 20 MB");
    const existing = await ctx.db
      .query("requestIntakeFiles")
      .withIndex("storage", (q) => q.eq("fileId", args.fileId))
      .unique();
    if (existing) {
      if (existing.requestId !== request._id)
        throw new Error("File already attached");
      return existing._id;
    }
    const files = await ctx.db
      .query("requestIntakeFiles")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .take(30);
    if (
      files.length >= 20 ||
      files.reduce((sum, f) => sum + f.size, 0) + metadata.size >
        100 * 1024 * 1024
    )
      throw new Error("Application upload limit reached");
    await ctx.db.patch(intent._id, { fileId: args.fileId });
    const fileArgs = {
      requestId: args.requestId,
      fileId: args.fileId,
      category: args.category,
    };
    const intakeFileId = await ctx.db.insert("requestIntakeFiles", {
      ...fileArgs,
      ...((args.category === "requirements" || (args.category === "supporting" && request.intakeDetails?.coverages.some(line=>line.coverage==="workers_compensation"))) ? {prefillStatus:"pending" as const} : {}),
      name: args.name.slice(0, 200),
      ownerUserId: user._id,
      contentType: metadata.contentType!,
      size: metadata.size,
      createdAt: dayjs().valueOf(),
    });
    if (args.category === "requirements" || (args.category === "supporting" && request.intakeDetails?.coverages.some(line=>line.coverage==="workers_compensation")))
      await ctx.scheduler.runAfter(
        0,
        internal.actions.intakeRequirementPrefill.extract,
        { intakeFileId },
      );
    if (request.intakeSubmittedAt && request.clientOrgId) {
      const now = dayjs().valueOf();
      const clientFileId = await ctx.db.insert("clientFiles", {
        orgId: request.clientOrgId,
        fileId: args.fileId,
        name: args.name.slice(0, 200),
        originalName: args.name.slice(0, 200),
        contentType: metadata.contentType!,
        size: metadata.size,
        clientVisible: true,
        uploadedByUserId: user._id,
        uploadedBySide: "client",
        nameSource: "original",
        nameStatus: "ready",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("procurementFileItems", {
        requestId: request._id,
        clientOrgId: request.clientOrgId,
        clientFileId,
        label: args.name.slice(0, 200),
        brokerRelease: "attached",
        clientVisible: true,
        createdByUserId: user._id,
        updatedByUserId: user._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(intakeFileId, { clientFileId });
      await ctx.db.patch(request._id, { intakeAmendedAt: now, updatedAt: now });
    }
    await queueIntakeSlack(
      ctx,
      request._id,
      `summary:file:${intakeFileId}:attached`,
      "Document attached",
    );
    return intakeFileId;
  },
});
/** Remove the request attachment, retaining stored evidence and issued snapshots. */
export const removeFile = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    intakeFileId: v.id("requestIntakeFiles"),
  },
  handler: async (ctx, { requestId, intakeFileId }) => {
    const { user, request } = await ownedRequest(ctx, requestId);
    if (
      request.intakeSubmittedAt &&
      request.intakeAnswers?.intakeGoal === "savings"
    )
      throw new Error("Submitted policy reviews cannot be changed");
    const file = await ctx.db.get(intakeFileId);
    if (!file) return null;
    if (file.requestId !== request._id || file.ownerUserId !== user._id)
      throw new Error("File not found");
    const now = dayjs().valueOf();
    if (file.clientFileId) {
      const items = await ctx.db
        .query("procurementFileItems")
        .withIndex("file", (q) => q.eq("clientFileId", file.clientFileId!))
        .take(201);
      if (items.length > 200)
        throw new Error("Too many file associations to remove safely");
      for (const item of items)
        if (item.requestId === request._id)
          await ctx.db.patch(item._id, {
            brokerRelease: "hidden",
            clientVisible: false,
            updatedAt: now,
            updatedByUserId: user._id,
          });
    }
    await ctx.db.delete(file._id);
    await ctx.db.patch(request._id, {
      updatedAt: now,
      ...(request.intakeSubmittedAt ? { intakeAmendedAt: now } : {}),
      ...(!request.intakeSubmittedAt && request.intakeDetails?.followups?.some(row => [`requirements:${file._id}`,`workforce:${file._id}`].includes(row.prefilled?.contextHash??"")) ? {
        intakeDetails: { ...request.intakeDetails, followups: request.intakeDetails.followups.filter(row => ![`requirements:${file._id}`,`workforce:${file._id}`].includes(row.prefilled?.contextHash??"")) },
        intakeRevision: (request.intakeRevision ?? 0) + 1,
      } : {}),
      ...(file.clientFileId
        ? { packetRevision: (request.packetRevision ?? 0) + 1 }
        : {}),
    });
    await queueIntakeSlack(
      ctx,
      request._id,
      `summary:file:${intakeFileId}:removed`,
      "Document removed",
    );
    return null;
  },
});

export const submit = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    orgId: v.optional(v.id("organizations")),
    resubmit: v.optional(v.boolean()),
    confirmedAccurateAndAuthorized: v.optional(v.boolean()),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user, request } = await ownedRequest(ctx, args.requestId);
    if (request.intakeSubmittedAt && !args.resubmit)
      return { requestId: request._id, orgId: request.clientOrgId! };
    if (
      request.intakeSubmittedAt &&
      request.intakeAnswers?.intakeGoal === "savings"
    )
      throw new Error("Start a new savings review to add policies");
    if (!args.confirmedAccurateAndAuthorized)
      throw new Error(
        "Confirm the application is accurate and authorize Spot to shop for insurance before submitting",
      );
    if (args.expectedRevision !== (request.intakeRevision ?? 0))
      throw new Error(
        "This application changed. Review the latest details before submitting",
      );
    const answers = request.intakeAnswers ?? {};
    validateContact(
      answers.name ?? "",
      answers.email ?? "",
      answers.phone ?? "",
      false,
    );
    const savings = answers.intakeGoal === "savings";
    if (!savings && request.intakeTermsAcceptance?.version !== INTAKE_TERMS_VERSION)
      throw new Error("Accept Spot’s Terms of Service in the Coverage section before submitting");
    if (!savings && (
      request.intakeTermsAcceptance?.userId !== user._id ||
      request.intakeTermsAcceptance.signerName !== answers.name?.trim() ||
      request.intakeTermsAcceptance.signerEmail !== answers.email?.trim().toLowerCase()
    )) throw new Error("Review your name and electronically sign the authorization in the Coverage section before submitting");
    const details = activeIntakeDetails(request.intakeDetails ?? detailsFromAnswers(answers),answers.intakeGoal);
    const problems=intakeSubmissionProblems(answers,details);
    if(problems.length)throw new Error(`Please complete: ${problems.map(problem=>problem.label).join(", ")}`);
    const files = await ctx.db
      .query("requestIntakeFiles")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .take(30);
    if (
      savings &&
      (!files.some((file) => file.category === "policy") ||
        files.some(
          (file) =>
            file.category === "policy" &&
            file.contentType !== "application/pdf",
        ))
    )
      throw new Error("Upload at least one current policy as a PDF");
    const contentHash = await hashIntakeToken(
      submissionContent(
        answers,
        details,
        files.map((file) => String(file._id)),
      ),
    );
    const submissionBaseline = {
      answers,
      details,
      files: files.map((file) => ({ id: String(file._id), name: file.name })),
      submittedAt: dayjs().valueOf(),
      revision: request.intakeRevision ?? 0,
    };
    const shoppingAuthorization = {
      userId: user._id,
      confirmedAt: dayjs().valueOf(),
      contentHash,
      statement:
        "I confirm that the information in this application is accurate and authorize Spot to shop for insurance on my behalf.",
    };
    if (request.intakeSubmittedAt) {
      if (savings)
        throw new Error(
          "Start a new policy savings review to send more policies",
        );
      if (contentHash !== request.intakeSubmittedContentHash) {
        await ctx.db.patch(request._id, {
          intakeSubmittedContentHash: contentHash,
          intakeResubmittedAt: dayjs().valueOf(),
          intakeSubmittedApplication: submissionBaseline,
          packetRevision: (request.packetRevision ?? 0) + 1,
          intakeShoppingAuthorization: shoppingAuthorization,

          updatedAt: dayjs().valueOf(),
        });
        await fillRequestFromClientProfile(ctx, (await ctx.db.get(request._id))!);
        await ensureClientIntakeAuthorization(ctx, request._id, submissionBaseline, contentHash);
        await ctx.scheduler.runAfter(0, internal.requestIntake.preparePremiumEstimateInternal, { requestId: request._id });
        if (request.clientOrgId)
          await saveIntakeBusinessProfile(
            ctx,
            request.clientOrgId,
            user._id,
            request._id,
            submissionBaseline,
          );
        await queueIntakeSlack(
          ctx,
          request._id,
          `submitted:${contentHash}`,
          "Insurance application resubmitted",
          true,
        );
      }
      return { requestId: request._id, orgId: request.clientOrgId! };
    }
    let orgId =
      request.clientOrgId ??
      (request.intakeNewCompany ? undefined : args.orgId);
    let writeCompanyProfile = true;
    if (orgId) {
      if (user.intakeRestricted) {
        if (orgId !== request.clientOrgId)
          throw new Error("Company membership required");
        const [company, membership] = await Promise.all([
          ctx.db.get(orgId),
          ctx.db
            .query("orgMemberships")
            .withIndex("organization_user", (q) =>
              q.eq("orgId", orgId!).eq("userId", user._id),
            )
            .first(),
        ]);
        if (
          !membership ||
          !company ||
          company.deletedAt !== undefined ||
          company.type !== "client"
        )
          throw new Error("Company membership required");
        writeCompanyProfile = membership.role === "admin";
      } else {
        const access = await getOrgAccess(ctx, orgId);
        if (access.accessType !== "member")
          throw new Error("Company membership required");
        if (access.orgType !== "client")
          throw new Error("Select a client company");
        writeCompanyProfile = access.role === "admin";
      }
    } else {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("user", (q) => q.eq("userId", user._id))
        .first();
      if (membership && !request.intakeNewCompany)
        throw new Error("Select your existing company before submitting");
      orgId = await createIntakeClient(ctx, user._id, answers);
    }
    const draftCompany = await draftClient(ctx, request);
    if (draftCompany) {
      await syncDraftClient(ctx, draftCompany, answers);
      await ctx.db.patch(draftCompany._id, { intakeDraftRequestId: undefined });
    }
    const now = dayjs().valueOf();
    await ctx.db.patch(request._id, {
      clientOrgId: orgId,
      status: savings ? "draft" : "submitted",
      clientVisible: !savings,
      targetEffectiveDate: answers.effectiveDate || undefined,
      intakeSnapshot: answers,
      intakeDetailsSnapshot: details,
      intakeSubmittedAt: now,
      intakeSubmittedApplication: submissionBaseline,
      intakeSubmittedContentHash: contentHash,
      intakeShoppingAuthorization: shoppingAuthorization,

      updatedAt: now,
    });
    await fillRequestFromClientProfile(ctx, (await ctx.db.get(request._id))!);
    if (savings) {
      if (writeCompanyProfile)
        await saveIntakeBusinessProfile(
          ctx,
          orgId,
          user._id,
          request._id,
          submissionBaseline,
        );
      for (const file of files.filter((file) => file.category === "policy"))
        await createOwnedIntakePolicyUpload(ctx, {
          intakeFileId: file._id,
          userId: user._id,
          orgId,
        });
      const phone = intakeProfilePhone(answers.phone);
      const phoneOwner = phone
        ? await findUserByNormalizedPhone(ctx, phone)
        : null;
      await ctx.db.patch(user._id, {
        name: answers.name,
        ...(phone && (!phoneOwner || phoneOwner._id === user._id) ? { phone } : {}),
        onboardingComplete: true,
      });
      await queueIntakeSlack(
        ctx,
        request._id,
        `submitted:${contentHash}`,
        "Policies received for a savings review",
        true,
      );
      return { requestId: request._id, orgId };
    }
    await ctx.scheduler.runAfter(0, internal.requestIntake.preparePremiumEstimateInternal, { requestId: request._id });
    await seedRequestIntake(ctx, {
      requestId: request._id,
      clientOrgId: orgId,
      narrative: applicationMarkdownBlock(submissionBaseline),
      userId: user._id,
      source: "client",
    });
    await ensureClientIntakeAuthorization(ctx, request._id, submissionBaseline, contentHash);
    if (writeCompanyProfile)
      await saveIntakeBusinessProfile(
        ctx,
        orgId,
        user._id,
        request._id,
        submissionBaseline,
      );
    for (const file of files) {
      const clientFileId = await ctx.db.insert("clientFiles", {
        orgId,
        fileId: file.fileId,
        name: file.name,
        originalName: file.name,
        contentType: file.contentType,
        size: file.size,
        clientVisible: true,
        uploadedByUserId: user._id,
        uploadedBySide: "client",
        nameSource: "original",
        nameStatus: "ready",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("procurementFileItems", {
        requestId: request._id,
        clientOrgId: orgId,
        clientFileId,
        label: file.name,
        brokerRelease: "attached",
        clientVisible: true,
        createdByUserId: user._id,
        updatedByUserId: user._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(file._id, { clientFileId });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.procurementPacket.ensureRequestLinkInternal,
      { requestId: request._id, createdByUserId: user._id },
    );
    const phone = intakeProfilePhone(answers.phone);
    const phoneOwner = phone
      ? await findUserByNormalizedPhone(ctx, phone)
      : null;
    await ctx.db.patch(user._id, {
      name: answers.name,
      ...(phone && (!phoneOwner || phoneOwner._id === user._id) ? { phone } : {}),
      onboardingComplete: true,
    });
    await queueIntakeSlack(
      ctx,
      request._id,
      `submitted:${contentHash}`,
      "Insurance application submitted",
      true,
    );
    return { requestId: request._id, orgId };
  },
});

export const prepareVerification = mutation({
  args: { requestId: v.id("procurementRequests"), token: v.string() },
  handler: async (ctx, args) => {
    const { request } = await ownedRequest(ctx, args.requestId);
    if (!/^[a-zA-Z0-9_-]{32,128}$/.test(args.token))
      throw new Error("Invalid verification request");
    await ctx.db.patch(request._id, {
      verificationClaimHash: await hashIntakeToken(args.token),
      verificationClaimExpiresAt: dayjs().add(30, "day").valueOf(),
    });
    return null;
  },
});
export const confirmVerifiedOwnership = mutation({
  args: { requestId: v.id("procurementRequests"), token: v.string() },
  handler: async (ctx, args) => {
    const user = await intakeUser(ctx);
    if (!user.emailVerificationTime || user.intakeRestricted)
      throw new Error("Confirm your email first");
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request.deletedAt ||
      request.ownerUserId !== user._id ||
      request.intakeAnswers?.email !== user.email
    )
      throw new Error("Request not found");
    if (request.intakeVerifiedAccess) return null;
    if (
      !request.verificationClaimHash ||
      request.verificationClaimExpiresAt! < dayjs().valueOf() ||
      (await hashIntakeToken(args.token)) !== request.verificationClaimHash
    )
      throw new Error(
        "Application confirmation expired. Resume from the browser that started the application.",
      );
    await ctx.db.patch(request._id, {
      intakeVerifiedAccess: true,
      verificationClaimHash: undefined,
      verificationClaimExpiresAt: undefined,
    });
    return null;
  },
});

// One-shot source claim: scheduled replays must never repeat inference.
export const claimRequirementPrefill = internalMutation({
  args: { intakeFileId: v.id("requestIntakeFiles") },
  handler: async (ctx, { intakeFileId }) => {
    const file = await ctx.db.get(intakeFileId);
    if (
      !file ||
      !["requirements","supporting"].includes(file.category) ||
      file.prefillStartedAt !== undefined
    )
      return null;
    const request = await ctx.db.get(file.requestId);
    if (
      !request ||
      request.deletedAt ||
      request.ownerUserId !== file.ownerUserId ||
      request.intakeSchemaVersion === undefined
    )
      return null;
    await ctx.db.patch(file._id, { prefillStartedAt: dayjs().valueOf(),prefillStatus:"running" });
    return {
      fileId: file.fileId,
      name: file.name,
      contentType: file.contentType,
      workforce: file.category === "supporting",
      companyIdentity: JSON.stringify([request.intakeAnswers?.legalName??"",request.intakeAnswers?.dba??""]),
      businessName: request.intakeAnswers?.legalName || request.intakeAnswers?.dba || "",
      workforceQuestions: file.category === "supporting" ? bakedCoverageQuestions({answers:request.intakeAnswers??{},details:request.intakeDetails??detailsFromAnswers(request.intakeAnswers??{})}).filter(workforcePolicyQuestion) : [],
    };
  },
});
export const finishRequirementPrefill = internalMutation({
  args: {
    intakeFileId: v.id("requestIntakeFiles"), coveragesJson: v.string(),
    workforceProposals: v.optional(v.array(v.object({questionId:v.string(),answer:v.string(),confidence:v.number()}))),
    companyIdentity: v.optional(v.string()),
    provisionRequirements: v.optional(v.array(v.object({ coverage: v.string(), provisions: v.array(v.object({ provision: v.union(v.literal("additional_insured"), v.literal("waiver_of_subrogation"), v.literal("primary_non_contributory")), confidence: v.number() })) }))),
  },
  handler: async (ctx, { intakeFileId, coveragesJson, provisionRequirements, workforceProposals, companyIdentity }) => {
    const file = await ctx.db.get(intakeFileId);
    const request = file ? await ctx.db.get(file.requestId) : null;
    if (
      !file ||
      !request ||
      request.deletedAt ||
      request.ownerUserId !== file.ownerUserId ||
      file.prefillStartedAt === undefined ||
      file.prefillCoveragesJson !== undefined
    )
      return null;
    if (coveragesJson.length > 16000)
      throw new Error("Prefill exceeds size limit");
    const details = detailsFromAnswers({});
    details.coverages = JSON.parse(coveragesJson);
    validateIntakeDetails(details);
    await ctx.db.patch(file._id, { prefillCoveragesJson: coveragesJson,prefillStatus:"complete" });
    if (file.category === "supporting" && !request.intakeSubmittedAt && companyIdentity === JSON.stringify([request.intakeAnswers?.legalName??"",request.intakeAnswers?.dba??""]) && request.intakeDetails?.coverages.some(line=>line.coverage==="workers_compensation")) {
      const current=request.intakeDetails;
      const questions=bakedCoverageQuestions({answers:request.intakeAnswers??{},details:current}).filter(workforcePolicyQuestion);
      const followups=[...(current.followups??[])];
      for(const question of questions) {
        const proposal=workforceProposals?.find(row=>row.questionId===question.id);
        const saved=followups.find(row=>row.id===question.id);
        if(!proposal || !Number.isFinite(proposal.confidence) || jevDecisionBand(proposal.confidence,"prefill")!=="high" || proposal.confidence>1 || saved?.answer.trim() || saved?.skipped || !followupQuestionVisible(question,followups))continue;
        const row={...question,answer:proposal.answer,prefilled:{confidence:proposal.confidence,contextHash:`workforce:${file._id}`}};
        validateFollowupAnswers([row]);
        if(saved)followups[followups.indexOf(saved)]=row;else followups.push(row);
      }
      validateFollowupAnswers(followups);
      if(JSON.stringify(followups)!==JSON.stringify(current.followups??[]))await ctx.db.patch(request._id,{intakeDetails:{...current,followups},intakeRevision:(request.intakeRevision??0)+1});
    }
    if (!request.intakeSubmittedAt && request.intakeAnswers?.intakeGoal !== "savings" && provisionRequirements?.length) {
      const current = request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {});
      const questions = bakedCoverageQuestions({ answers: request.intakeAnswers ?? {}, details: current });
      const glProvisions = provisionRequirements
        .filter(row => row.coverage === "general_liability")
        .flatMap(row => row.provisions);
      const targets = [
        ["additional_insured", "gl.coverage.additional_insureds"],
        ["waiver_of_subrogation", "gl.coverage.waiver_requirements"],
        ["primary_non_contributory", "gl.coverage.primary_requirement"],
      ] as const;
      const proposals = targets.flatMap(([provision, source]) => {
        const question = questions.find(row => row.source?.endsWith(` · ${source}`));
        const supported = glProvisions.find(row =>
          row.provision === provision && jevDecisionBand(row.confidence, "prefill") === "high",
        );
        // Preserve the actual upstream probability; the writer rechecks its risk gate.
        return supported && question
          ? [{ questionId: question.id, answer: "Yes" as const, confidence: supported.confidence }]
          : [];
      });
      const followups = mergeIntakePrefills(current.followups ?? [], questions, proposals, `requirements:${file._id}`);
      if (JSON.stringify(followups) !== JSON.stringify(current.followups ?? []))
        await ctx.db.patch(request._id, { intakeDetails: { ...current, followups }, intakeRevision: (request.intakeRevision ?? 0) + 1 });
    }
    return null;
  },
});

/** Generic client state only; provider errors remain server-side. */
export const failRequirementPrefill = internalMutation({
  args:{intakeFileId:v.id("requestIntakeFiles")},
  handler:async(ctx,{intakeFileId})=>{
    const file=await ctx.db.get(intakeFileId);
    if(file && ["requirements","supporting"].includes(file.category) && file.prefillStartedAt!==undefined && file.prefillCoveragesJson===undefined)await ctx.db.patch(file._id,{prefillStatus:"failed"});
    return null;
  }
});

export const claimCompanyResearch = internalMutation({
  args: { requestId: v.id("procurementRequests"), fingerprint: v.string() },
  handler: async (ctx, { requestId, fingerprint }) => {
    const request = await ctx.db.get(requestId);
    const research = request?.intakeCompanyResearch;
    if (
      request?.deletedAt ||
      !request?.ownerUserId ||
      !research ||
      research.fingerprint !== fingerprint ||
      research.status !== "pending"
    )
      return null;
    if (
      JSON.stringify([
        request.intakeAnswers?.legalName?.trim() || request.intakeAnswers?.dba?.trim() || "",
        request.intakeAnswers?.website?.trim() ?? "",
      ]) !== fingerprint
    )
      return null;
    await ctx.db.patch(requestId, {
      intakeCompanyResearch: {
        ...research,
        status: "running",
        attempts: research.attempts + 1,
      },
    });
    return { name: research.name, website: research.website };
  },
});
export const finishCompanyResearch = internalMutation({
  args: {
    requestId: v.id("procurementRequests"),
    fingerprint: v.string(),
    suggestions: v.optional(intakeAnswersValidator),
    evidence: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, fingerprint, suggestions, evidence }) => {
    const request = await ctx.db.get(requestId);
    const research = request?.intakeCompanyResearch;
    if (
      request?.deletedAt ||
      !request?.ownerUserId ||
      !research ||
      research.fingerprint !== fingerprint ||
      research.status !== "running"
    )
      return null;
    const allowed = suggestions
      ? Object.fromEntries(
          Object.entries(suggestions).filter(
            ([key, value]) =>
              [
                "description",
                "yearStarted",
                "industry",
                "industryVertical",
              ].includes(key) &&
              typeof value === "string" &&
              value.length <= 8000,
          ),
        )
      : undefined;
    await ctx.db.patch(requestId, {
      intakeCompanyResearch: {
        ...research,
        status: suggestions ? "completed" : "failed",
        ...(allowed ? { suggestions: allowed } : {}),
        ...(evidence ? { evidence: evidence.slice(0, 30000) } : {}),
      },
    });
    return null;
  },
});

export const claimVehicleRelevance = internalMutation({
  args:{requestId:v.id("procurementRequests"),fingerprint:v.string()},
  handler:async(ctx,{requestId,fingerprint})=>{
    const request=await ctx.db.get(requestId);
    const job=request?.intakeVehicleRelevance;
    const details=request?.intakeDetails;
    const answers=request?.intakeAnswers??{};
    if(!request?.ownerUserId || request.deletedAt || request.intakeSubmittedAt || answers.intakeGoal==="savings" || !details ||
      !job || job.status!=="pending" || job.fingerprint!==fingerprint || job.sourceKey!==vehicleRelevanceKey(answers,details))return null;
    await ctx.db.patch(requestId,{intakeVehicleRelevance:{...job,status:"running",attempts:job.attempts+1}});
    return {evidence:vehicleRelevanceEvidence(answers,details),candidates:vehicleRelevanceCandidates(answers,details)};
  },
});
export const finishVehicleRelevance = internalMutation({
  args:{requestId:v.id("procurementRequests"),fingerprint:v.string(),failed:v.boolean(),decisions:v.array(v.object({id:v.string(),irrelevantProbability:v.number()}))},
  handler:async(ctx,{requestId,fingerprint,failed,decisions})=>{
    const request=await ctx.db.get(requestId);
    const job=request?.intakeVehicleRelevance;
    const details=request?.intakeDetails;
    if(!request?.ownerUserId || request.deletedAt || request.intakeSubmittedAt || !details || !job || job.status!=="running" || job.fingerprint!==fingerprint ||
      job.sourceKey!==vehicleRelevanceKey(request.intakeAnswers??{},details))return null;
    const allowed=new Set(vehicleRelevanceCandidates(request.intakeAnswers??{},details).map(candidate=>candidate.id));
    const excludedIds=failed?[]:[...new Set(decisions.filter(row=>allowed.has(row.id) && Number.isFinite(row.irrelevantProbability) && jevDecisionBand(row.irrelevantProbability,"omission")==="high" && row.irrelevantProbability<=1).map(row=>row.id))];
    await ctx.db.patch(requestId,{intakeVehicleRelevance:{...job,status:failed?"failed":"completed",excludedIds}});
    return null;
  },
});

export const claimCyberResearch = internalMutation({
  args: { requestId: v.id("procurementRequests"), fingerprint: v.string() },
  handler: async (ctx, { requestId, fingerprint }) => {
    const request = await ctx.db.get(requestId);
    const research = request?.intakeCyberResearch;
    const details = request?.intakeDetails;
    const answers = request?.intakeAnswers ?? {};
    if (!request?.ownerUserId || request.deletedAt || request.intakeSubmittedAt || !details ||
      !details.coverages.some(line => line.coverage === "cyber") || answers.intakeGoal === "savings" ||
      !research || research.fingerprint !== fingerprint || research.status !== "pending" || research.sourceKey !== intakeCyberResearchKey(answers, details)) return null;
    await ctx.db.patch(requestId, { intakeCyberResearch: { ...research, status: "running", attempts: research.attempts + 1 } });
    return {
      website: answers.website!, documents: details.cyberDocuments,
      evidence: request.intakeCompanyResearch?.website === answers.website ? request.intakeCompanyResearch?.evidence : undefined,
      questions: bakedCoverageQuestions({ answers, details }).filter(question => / · cyber\.(?:data|access|defense|recovery|people)\./.test(question.source ?? "")),
    };
  },
});

export const finishCyberResearch = internalMutation({
  args: {
    requestId: v.id("procurementRequests"), fingerprint: v.string(), failed: v.boolean(),
    privacyPolicyUrl: v.optional(v.string()), termsUrl: v.optional(v.string()),
    technologies: v.optional(v.array(v.object({ name: v.string(), evidence: v.string(), sourceUrl: v.string() }))),
    suggestions: v.optional(v.array(v.object({ questionId: v.string(), answer: v.string(), confidence: v.number(), evidence: v.string(), sourceUrl: v.string() }))),
  },
  handler: async (ctx, { requestId, fingerprint, failed, privacyPolicyUrl, termsUrl, technologies, suggestions }) => {
    const request = await ctx.db.get(requestId);
    const research = request?.intakeCyberResearch;
    if (!request?.ownerUserId || request.deletedAt || !research || research.fingerprint !== fingerprint || research.status !== "running") return null;
    await ctx.db.patch(requestId, { intakeCyberResearch: {
      ...research, status: failed ? "failed" : "completed",
      ...(!failed ? { privacyPolicyUrl: privacyPolicyUrl?.slice(0, 2000), termsUrl: termsUrl?.slice(0, 2000),
        technologies: (technologies ?? []).slice(0, 40), suggestions: (suggestions ?? []).slice(0, 40) } : {}),
    } });
    // Research is a proposal only. The owner's next save merges untouched fields
    // through the ordinary revision guard; no background answer write can race typing.
    return null;
  },
});

async function followupContextHash(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
  section: "acord" | "additional",
) {
  const details =
    request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {});
  const contextDetails = {
    ...details,
    followups:
      section === "additional"
        ? (details.followups ?? []).filter(
            (row) => row.section === "acord",
          )
        : undefined,
  };
  const files = await ctx.db
    .query("requestIntakeFiles")
    .withIndex("request", (q) => q.eq("requestId", request._id))
    .take(50);
  const issuedQuestions =
    section === "additional"
      ? {
          acord: bakedCoverageQuestions({ answers: request.intakeAnswers ?? {}, details: contextDetails }),
        }
      : undefined;
  return hashIntakeToken(
      `${INTAKE_ACORD_CATALOG_VERSION}:${BAKED_COVERAGE_QUESTIONS_VERSION}:${INTAKE_QUESTION_REFERENCE_VERSION}:history-v8-single-pass:${JSON.stringify(issuedQuestions)}:${JSON.stringify((request.intakeSkippedSteps ?? []).filter((step) => step < 28))}:${submissionContent(
      request.intakeAnswers ?? {},
      contextDetails,
      files.map((file) => String(file._id)),
    )}`,
  );
}
/** A preload may survive history answers, but never a changed business/coverage/upload. */
async function followupPreloadScopeHash(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  const {
    currentInsurance: _insurance,
    claims: _claims,
    cancellations: _cancellations,
    ...answers
  } = request.intakeAnswers ?? {};
  const {
    followups: _followups,
    hasClaims: _hasClaims,
    hasCancellations: _hasCancellations,
    ...details
  } = request.intakeDetails ?? detailsFromAnswers(answers);
  const files = await ctx.db
    .query("requestIntakeFiles")
    .withIndex("request", (q) => q.eq("requestId", request._id))
    .take(50);
  const risk = {
    insured: _insurance === "Yes",
    claims: _hasClaims === "yes" ? _claims || "Yes" : "",
    cancellations: _hasCancellations === "yes" ? _cancellations || "Yes" : "",
  };
  const scopeDetails = {
    ...details,
    skippedBaseFields: details.skippedBaseFields?.filter(
      (field) =>
        !["claims", "cancellations", "currentInsurance"].includes(field),
    ),
  };
  return hashIntakeToken(
    JSON.stringify([
      risk,
      submissionContent(
        answers,
        scopeDetails,
        files.map((file) => String(file._id)),
      ),
    ]),
  );
}
const MAX_FOLLOWUP_BACKGROUND_ATTEMPTS = 20;

/** One generation per saved application context; revisiting after edits prepares a new context. */
async function prepareFollowupBatch(
  ctx: MutationCtx,
  request: Doc<"procurementRequests">,
  section: "acord" | "additional",
  preload = false,
  retryFailed = false,
) {
  const requestId = request._id;
  // Catalog questions are projected synchronously from the shared baked packs.
  if (section === "acord") return null;
    if (
      request.intakeSubmittedAt ||
      request.intakeAnswers?.intakeGoal === "savings"
    )
      return null;
    // Wait for enough scope to make background questions useful. Terminal entry
    // can still prepare incomplete applications through the ordinary path.
    if (preload && (!request.intakeAnswers?.legalName?.trim() ||
      !request.intakeDetails?.coverages.some(line => line.coverage !== "unknown"))) return null;
    const previous = request.intakeFollowups?.[section];
    if (previous?.status === "pending") return null;
    const background = preload && request.intakeStep !== 30;
    if (background && (previous?.backgroundAttempts ?? 0) >= MAX_FOLLOWUP_BACKGROUND_ATTEMPTS) return null;
    const contextHash = await followupContextHash(ctx, request, section);
    if (previous?.contextHash === contextHash && previous.status !== "prepared" && !(retryFailed && previous.status === "failed")) return null;
    const scopeHash = await followupPreloadScopeHash(ctx, request);
    console.info("[intakeFollowups] preparing batch", {
      requestId, section, background: preload,
      reason: previous ? "application_facts_changed" : "first_preparation",
      previousStatus: previous?.status ?? "none",
    });
    const batch = {
      status: "pending" as const,
      token: crypto.randomUUID(),
      contextHash,
      startedAt: dayjs().valueOf(),
      preloaded: !!preload,
      backgroundAttempts: (previous?.backgroundAttempts ?? 0) + (background ? 1 : 0),
      enriching: false,
      preloadScopeHash: scopeHash,
      questions: [],
    };
    await ctx.db.patch(requestId, {
      intakeFollowups: { ...request.intakeFollowups, [section]: batch },
    });
    await ctx.scheduler.runAfter(0, internal.actions.intakeFollowups.generate, {
      requestId,
      section,
      token: batch.token,
    });
    return null;
}
export const prepareFollowups = mutation({
  args: { requestId: v.id("procurementRequests"), section: followupSectionValidator, preload: v.optional(v.boolean()), retry: v.optional(v.boolean()) },
  handler: async (ctx, { requestId, section, preload, retry }) => {
    const { request } = await ownedRequest(ctx, requestId);
    return prepareFollowupBatch(ctx, request, section, preload, !!retry);
  },
});

/** Coalesce autosaves; the last saved revision prepares one context at a time. */
export const warmFollowupsAfterSave = internalMutation({
  args: { requestId: v.id("procurementRequests"), revision: v.optional(v.number()) },
  handler: async (ctx, { requestId, revision }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.deletedAt || revision === undefined ||
      request.intakeRevision !== revision) return null;
    return prepareFollowupBatch(ctx, request, "additional", true);
  },
});

/** Provisional candidates are never exposed as ready questions. */
export const stageFollowupPreload = internalMutation({
  args: {
    requestId: v.id("procurementRequests"),
    token: v.string(),
    questions: v.array(followupQuestionValidator),
  },
  handler: async (ctx, { requestId, token, questions }) => {
    const request = await ctx.db.get(requestId);
    const batch = request?.intakeFollowups?.additional;
    if (
      !request ||
      request.deletedAt ||
      request.intakeSubmittedAt ||
      batch?.token !== token ||
      batch.status !== "pending" ||
      !batch.preloaded ||
      request.intakeStep === 30
    )
      return false;
    if (
      questions.length > 8 ||
      questions.some((question) => question.section !== "additional")
    )
      throw new Error("Invalid preload");
    await ctx.db.patch(requestId, {
      intakeFollowups: {
        ...request.intakeFollowups,
        additional: { ...batch, status: "prepared", questions },
      },
    });
    return true;
  },
});
export const followupContext = internalQuery({
  args: {
    requestId: v.id("procurementRequests"),
    section: followupSectionValidator,
    token: v.string(),
    enrich: v.optional(v.boolean()),
  },
  handler: async (ctx, { requestId, section, token, enrich }) => {
    const request = await ctx.db.get(requestId);
    if (
      !request ||
      request.deletedAt ||
      request.intakeSubmittedAt ||
      request.intakeFollowups?.[section]?.token !== token ||
      (enrich &&
        (request.intakeFollowups?.[section]?.status !== "ready" ||
          !request.intakeFollowups?.[section]?.enriching))
    )
      return null;
    const files = await ctx.db
      .query("requestIntakeFiles")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .take(50);
    const activeDetails = activeIntakeDetails(
      request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {}),
      request.intakeAnswers?.intakeGoal,
    );
    // Final generated answers are output, never evidence for generating more.
    const historyDetails = {
      ...activeDetails,
      followups: activeDetails.followups?.filter(row => row.section === "acord"),
    };
    return {
      prefillEvidenceHash: await hashIntakeToken(intakePrefillEvidence(request.intakeAnswers ?? {},request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {}))),
      contextHash: await followupContextHash(ctx, request, section),
      evaluationHash: await followupContextHash(
        ctx,
        request,
        section,
      ),
      preloadScopeHash: await followupPreloadScopeHash(ctx, request),
      questionHistory: intakeQuestionHistory(
        request.intakeAnswers ?? {},
        historyDetails,
        request.intakeSkippedSteps ?? [],
      ),
      priorQuestions:
        section === "additional"
          ? [
              ...bakedCoverageQuestions({ answers: request.intakeAnswers ?? {}, details: historyDetails }),
              ...Array.from(new Map([
                ...(request.intakeFollowups?.additional?.questions ?? []),
                ...(request.intakeDetails?.followups ?? [])
                  .filter(row => row.section === "additional")
                  .map(({ answer: _answer, skipped: _skipped, prefilled: _prefilled, ...question }) => question),
              ].map(question => [question.id, question])).values()),
            ]
          : [],
      reservedQuestions: section === "additional" ? bakedCoverageQuestions({ answers: request.intakeAnswers ?? {}, details: historyDetails }) : [],
      answers: request.intakeAnswers ?? {},
      details: {
        ...historyDetails,
        followups:historyDetails.followups?.filter(row=>!isFixedVehicleFollowup(row)) ?? [],
        drivers: (historyDetails.drivers ?? []).map(driverModelContext),
      },
      files: files.map(({ name, category }) => ({ name, category })),
    };
  },
});
export const finishFollowups = internalMutation({
  args: {
    requestId: v.id("procurementRequests"),
    section: followupSectionValidator,
    token: v.string(),
    questions: v.array(followupQuestionValidator),
    prefills: v.optional(v.array(followupPrefillValidator)),
    evaluatedPrefillHash: v.optional(v.string()),
    failed: v.boolean(),
    evaluatedContextHash: v.optional(v.string()),
    evaluatedBaseContextHash: v.optional(v.string()),
    restartGeneration: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      requestId,
      section,
      token,
      questions,
      prefills = [],
      evaluatedPrefillHash,
      failed,
      evaluatedContextHash,
      evaluatedBaseContextHash,
      restartGeneration,
    },
  ) => {
    const request = await ctx.db.get(requestId);
    if (section === "acord") return;
    const batch = request?.intakeFollowups?.[section];
    if (
      !request ||
      request.deletedAt ||
      request.intakeSubmittedAt ||
      !batch ||
      batch.token !== token ||
      batch.status !== "pending"
    )
      return;
    if (
      questions.length > 40 ||
      questions.some((row) => row.section !== section)
    )
      throw new Error("Invalid follow-up batch");
    const currentContextHash = await followupContextHash(ctx, request, section);
    const currentEvaluationHash =
      section === "additional" && evaluatedContextHash
        ? await followupContextHash(ctx, request, section)
        : currentContextHash;
    if (
      !failed &&
      (restartGeneration ||
        (evaluatedContextHash ?? batch.contextHash) !== currentEvaluationHash)
    ) {
      // This inference completed successfully for an old context. Claim a new
      // evaluation for the changed context; never retry a failed/unknown call.
      const background = request.intakeStep !== 30;
      if (background && (batch.backgroundAttempts ?? 0) >= MAX_FOLLOWUP_BACKGROUND_ATTEMPTS) {
        // Invalidate the hash: facts may have changed away and back while this
        // batch ran, so even its original hash cannot certify an empty result.
        await ctx.db.patch(requestId, {
          intakeFollowups: { ...request.intakeFollowups, [section]: {
            ...batch, contextHash: `stale:${batch.token}`, status: "ready", questions: [], preloaded: false,
          } },
        });
        return;
      }
      const scopeHash = await followupPreloadScopeHash(ctx, request);
      const next = {
        ...batch,
        token: crypto.randomUUID(),
        contextHash: currentContextHash,
        preloadScopeHash: scopeHash,
        preloaded: false,
        backgroundAttempts: (batch.backgroundAttempts ?? 0) + (background ? 1 : 0),
        startedAt: dayjs().valueOf(),
        questions: [],
        status: "pending" as const,
      };
      await ctx.db.patch(requestId, {
        intakeFollowups: { ...request.intakeFollowups, [section]: next },
      });
      await ctx.scheduler.runAfter(
        background ? 5000 : 0,
        internal.actions.intakeFollowups.generate,
        {
          requestId,
          section,
          token: next.token,
        },
      );
      return;
    }
    if (failed) questions = [];
    else {
      questions = boundIntakeFollowupQuestions(
        questions,
        request.intakeDetails?.followups ?? [],
        bakedCoverageQuestions({ answers: request.intakeAnswers ?? {}, details: request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {}) }),
      );
    }
    const currentDetails=request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {});
    const currentPrefillHash=await hashIntakeToken(intakePrefillEvidence(request.intakeAnswers ?? {},currentDetails));
    if(evaluatedPrefillHash!==currentPrefillHash)prefills=[];
    const inferred=failed ? currentDetails.followups ?? [] : mergeIntakePrefills(currentDetails.followups ?? [], questions, prefills, currentEvaluationHash);
    validateFollowupAnswers(inferred);
    const prefillChanged=JSON.stringify(inferred)!==JSON.stringify(currentDetails.followups ?? []);
    await ctx.db.patch(requestId, {
      ...(prefillChanged ? {intakeDetails:{...currentDetails,followups:inferred},intakeRevision:(request.intakeRevision ?? 0)+1} : {}),
      intakeFollowups: {
        ...request.intakeFollowups,
        [section]: {
          ...batch,
          contextHash: failed
            ? (evaluatedBaseContextHash ?? batch.contextHash)
            : currentContextHash,
          preloaded: false,
          enriching: false,
          status: failed ? ("failed" as const) : ("ready" as const),
          questions,
        },
      },
    });
  },
});

/** Append screened new facts without replacing any issued question or answer. */
export const appendFollowupEnrichment = internalMutation({
  args: {
    requestId: v.id("procurementRequests"),
    token: v.string(),
    questions: v.array(followupQuestionValidator),
    prefills: v.optional(v.array(followupPrefillValidator)),
    evaluatedPrefillHash: v.optional(v.string()),
    evaluatedContextHash: v.string(),
    failed: v.boolean(),
    restartGeneration: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      requestId,
      token,
      questions,
      prefills = [],
      evaluatedPrefillHash,
      evaluatedContextHash,
      failed,
      restartGeneration,
    },
  ) => {
    const request = await ctx.db.get(requestId);
    const batch = request?.intakeFollowups?.additional;
    if (
      !request ||
      request.deletedAt ||
      request.intakeSubmittedAt ||
      batch?.token !== token ||
      batch.status !== "ready" ||
      !batch.enriching
    )
      return;
    if (
      questions.length > 8 ||
      questions.some((question) => question.section !== "additional")
    )
      throw new Error("Invalid enrichment");
    if (
      !failed &&
      (restartGeneration ||
        evaluatedContextHash !==
          (await followupContextHash(ctx, request, "additional")))
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.intakeFollowups.generate,
        {
          requestId,
          section: "additional",
          token,
          enrich: true,
        },
      );
      return;
    }
    const otherQuestions = bakedCoverageQuestions({ answers: request.intakeAnswers ?? {}, details: request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {}) });
    const additions = failed
      ? []
      : questions
          .filter(
            (question) =>
              !batch.questions.some(
                (existing) =>
                  existing.id === question.id ||
                  existing.label.toLocaleLowerCase().trim() ===
                    question.label.toLocaleLowerCase().trim(),
              ),
          )
          .slice(0, Math.max(0, 8 - batch.questions.length));
    const bounded = boundIntakeFollowupQuestions(
      additions,
      request.intakeDetails?.followups ?? [],
      [
        ...batch.questions,
        ...otherQuestions,
      ],
    );
    const currentDetails=request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {});
    const currentPrefillHash=await hashIntakeToken(intakePrefillEvidence(request.intakeAnswers ?? {},currentDetails));
    if(evaluatedPrefillHash!==currentPrefillHash)prefills=[];
    const inferred=failed ? currentDetails.followups ?? [] : mergeIntakePrefills(currentDetails.followups ?? [], bounded, prefills, evaluatedContextHash);
    validateFollowupAnswers(inferred);
    const prefillChanged=JSON.stringify(inferred)!==JSON.stringify(currentDetails.followups ?? []);
    await ctx.db.patch(requestId, {
      ...(prefillChanged ? {intakeDetails:{...currentDetails,followups:inferred},intakeRevision:(request.intakeRevision ?? 0)+1} : {}),
      intakeFollowups: {
        ...request.intakeFollowups,
        additional: {
          ...batch,
          contextHash: await followupContextHash(ctx, request, "additional"),
          enriching: false,
          questions: [...batch.questions, ...bounded],
        },
      },
    });
  },
});

/** Compatibility endpoint. Final section entry owns the sole model pass. */
export const assessFollowupGaps = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    await ownedRequest(ctx, requestId);
    return null;
  },
});

export const followupGapContext = internalQuery({
  args: { requestId: v.id("procurementRequests"), token: v.string() },
  handler: async (ctx, { requestId, token }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.deletedAt || request.intakeSubmittedAt || request.intakeGapAssessment?.token !== token || request.intakeGapAssessment.status !== "pending") return null;
    const contextHash = await followupContextHash(ctx, request, "additional");
    if (contextHash !== request.intakeGapAssessment.contextHash) return null;
    const answers = request.intakeAnswers ?? {};
    const activeDetails = activeIntakeDetails(request.intakeDetails ?? detailsFromAnswers(answers), answers.intakeGoal);
    const details = { ...activeDetails, followups: activeDetails.followups?.filter(row => row.section === "acord") };
    const files = await ctx.db.query("requestIntakeFiles").withIndex("request", q => q.eq("requestId", requestId)).take(50);
    return {
      contextHash,
      answers,
      details: { ...details, drivers: (details.drivers ?? []).map(driverModelContext) },
      questionHistory: intakeQuestionHistory(answers, details, request.intakeSkippedSteps ?? []),
      plannedQuestions: [...bakedCoverageQuestions({ answers, details }), ...(request.intakeFollowups?.additional?.questions ?? [])],
      files: files.map(({ name, category }) => ({ name, category })),
    };
  },
});

export const finishFollowupGapAssessment = internalMutation({
  args: { requestId: v.id("procurementRequests"), token: v.string(), needsAdditional: v.optional(v.boolean()) },
  handler: async (ctx, { requestId, token, needsAdditional }) => {
    const request = await ctx.db.get(requestId);
    const assessment = request?.intakeGapAssessment;
    if (!request || request.deletedAt || request.intakeSubmittedAt || assessment?.token !== token || assessment.status !== "pending") return null;
    if (assessment.contextHash !== await followupContextHash(ctx, request, "additional")) return null;
    await ctx.db.patch(requestId, { intakeGapAssessment: { ...assessment, status: needsAdditional === undefined ? "failed" : "complete", ...(needsAdditional === undefined ? {} : { needsAdditional }) } });

    return null;
  },
});

/** Local/operator diagnostics without disclosing applicant answer contents. */
export const inspectFollowupPreparation = internalQuery({
  args:{requestId:v.id("procurementRequests")},
  handler:async(ctx,{requestId})=>{
    const request=await ctx.db.get(requestId);if(!request)return null;
    const batch=request.intakeFollowups?.additional;
    return {vehicleRelevance:request.intakeVehicleRelevance?{status:request.intakeVehicleRelevance.status,excludedIds:request.intakeVehicleRelevance.excludedIds,current:!!request.intakeDetails && request.intakeVehicleRelevance.sourceKey===vehicleRelevanceKey(request.intakeAnswers??{},request.intakeDetails)}:null,step:request.intakeStep,submitted:!!request.intakeSubmittedAt,batch:batch?{status:batch.status,questionCount:batch.questions.length,preloaded:batch.preloaded,enriching:batch.enriching,startedAt:batch.startedAt,current:batch.contextHash===await followupContextHash(ctx,request,"additional"),preloadScopeCurrent:batch.preloadScopeHash===await followupPreloadScopeHash(ctx,request)}:null};
  },
});

export const inspectCyberResearch = internalQuery({
  args:{requestId:v.id("procurementRequests")},
  handler:async(ctx,{requestId})=>{
    const request=await ctx.db.get(requestId);
    if(!request)return null;
    const research=request.intakeCyberResearch;
    const jobs=research?(await ctx.db.query("routerJobs").order("desc").take(100)).filter(job=>job.operation==="retrieve" && job.createdAt>=research.startedAt && job.createdAt<research.startedAt+5000):[];
    return {hasOwner:!!request.ownerUserId,deleted:!!request.deletedAt,submitted:!!request.intakeSubmittedAt,coverages:request.intakeDetails?.coverages.map(line=>line.coverage),website:request.intakeAnswers?.website,documents:request.intakeDetails?.cyberDocuments,
      research:research?{status:research.status,startedAt:research.startedAt,attempts:research.attempts,current:!!request.intakeDetails && research.sourceKey===intakeCyberResearchKey(request.intakeAnswers??{},request.intakeDetails),fingerprint:research.fingerprint,technologyCount:research.technologies?.length??0,suggestionCount:research.suggestions?.length??0}:null,
      retrievalJobs:jobs.map(job=>({status:job.status,submitted:!!job.routerJobId,error:job.error,failure:job.failure})),
      savedPrefillCount:request.intakeDetails?.followups?.filter(row=>row.prefilled?.contextHash.startsWith("cyber:")).length??0};
  },
});

/** Explicit operator recovery only; inference never replays on its own. */
export const retryCyberResearchInternal = internalMutation({
  args:{requestId:v.id("procurementRequests")},
  handler:async(ctx,{requestId})=>{
    const request=await ctx.db.get(requestId);
    const details=request?.intakeDetails;
    const previous=request?.intakeCyberResearch;
    if(!request?.ownerUserId || request.deletedAt || request.intakeSubmittedAt || !details ||
      !details.coverages.some(line=>line.coverage==="cyber") || request.intakeAnswers?.intakeGoal==="savings" || !previous || !["failed","completed"].includes(previous.status))throw new Error("No completed or failed draft cyber research to retry");
    const sourceKey=intakeCyberResearchKey(request.intakeAnswers??{},details);
    const fingerprint=await hashIntakeToken(`${sourceKey}:${crypto.randomUUID()}`);
    await ctx.db.patch(requestId,{intakeCyberResearch:{sourceKey,fingerprint,startedAt:dayjs().valueOf(),attempts:previous.attempts,status:"pending"}});
    await ctx.scheduler.runAfter(0,internal.actions.intakeCyberResearch.run,{requestId,fingerprint});
    return {scheduled:true};
  },
});

async function premiumEstimateSource(ctx: QueryCtx | MutationCtx, request: Doc<"procurementRequests">, draft: boolean) {
  if (!draft) {
    const application = submittedIntakeApplication(request);
    return application ? {application, contentHash:request.intakeSubmittedContentHash ?? await hashIntakeToken(JSON.stringify(application))} : null;
  }
  const answers=request.intakeAnswers??{};
  const details=activeIntakeDetails(request.intakeDetails??detailsFromAnswers(answers),answers.intakeGoal);
  const files=await ctx.db.query("requestIntakeFiles").withIndex("request",q=>q.eq("requestId",request._id)).take(30);
  return {application:{answers,details,files:files.map(file=>({id:String(file._id),name:file.name})),submittedAt:dayjs().valueOf(),revision:request.intakeRevision??0},contentHash:await hashIntakeToken(submissionContent(answers,details,files.map(file=>String(file._id))))};
}
async function preparePremiumEstimateForRequest(ctx: MutationCtx, request: Doc<"procurementRequests">, preferDraft = false) {
  const provisional=!request.intakeSubmittedAt || preferDraft;
  const source=await premiumEstimateSource(ctx,request,provisional);
  if (!source || !request.ownerUserId || source.application.answers.intakeGoal === "savings" || !source.application.details.coverages.length) return;
  const {application,contentHash}=source;
  // Includes failed and unknown outcomes: opening the page cannot replay a call.
  if (request.intakePremiumEstimate?.contentHash === contentHash) {
    if(!provisional && request.intakePremiumEstimate.provisional)await ctx.db.patch(request._id,{intakePremiumEstimate:{...request.intakePremiumEstimate,provisional:false}});
    return;
  }
  const country = application.details.registrationCountry || application.details.mailingAddress.country;
  const currency = country === "Canada" || country === "CA" ? "CAD" : country === "United Kingdom" || country === "GB" ? "GBP" : "USD";
  const token = crypto.randomUUID();
  await ctx.db.patch(request._id, { intakePremiumEstimate: {
    contentHash, token, currency, provisional, status: "pending", startedAt: dayjs().valueOf(),
  } });
  await ctx.scheduler.runAfter(0, internal.actions.intakePremiumEstimate.run, {requestId: request._id, token});
}

/** Also supports an already-submitted owner's final page without a data migration. */
export const preparePremiumEstimate = mutation({
  args: {requestId: v.id("procurementRequests"), preferDraft:v.optional(v.boolean())},
  handler: async (ctx, {requestId,preferDraft}) => {
    const {request} = await ownedRequest(ctx, requestId);
    await preparePremiumEstimateForRequest(ctx, request,preferDraft);
    return null;
  },
});
export const preparePremiumEstimateInternal = internalMutation({
  args: {requestId: v.id("procurementRequests")},
  handler: async (ctx, {requestId}) => {
    const request = await ctx.db.get(requestId);
    if (request && !request.deletedAt) await preparePremiumEstimateForRequest(ctx, request);
    return null;
  },
});
export const claimPremiumEstimate = internalMutation({
  args: {requestId:v.id("procurementRequests"),token:v.string()},
  handler: async(ctx,{requestId,token}) => {
    const request=await ctx.db.get(requestId);
    const estimate=request?.intakePremiumEstimate;
    const source=request && await premiumEstimateSource(ctx,request,!!estimate?.provisional);
    const application=source?.application;
    if (!request || request.deletedAt || !application || application.answers.intakeGoal === "savings" || !estimate || estimate.token !== token || estimate.status !== "pending" || source?.contentHash!==estimate.contentHash) return null;
    await ctx.db.patch(requestId,{intakePremiumEstimate:{...estimate,status:"running"}});
    const answers={...application.answers};
    for (const key of ["name","email","phone","fein","businessNumber"] as const) delete answers[key];
    const details=activeIntakeDetails(application.details,application.answers.intakeGoal);
    return {currency:estimate.currency,application:{answers,details:{...details,
      drivers:(details.drivers??[]).map((driver,index)=>({...driverModelContext(driver),name:`Driver ${index+1}`,
        ...(driver.dateOfBirth && dayjs(driver.dateOfBirth).isValid() ? {age:dayjs(application.submittedAt).diff(dayjs(driver.dateOfBirth),"year")} : {}),
      })),
      followups:details.followups?.filter(row=>!/auto\.driver\.(?:name|date_of_birth|license_number)/.test(row.source??"")),
      coverages:details.coverages.map(line=>({...line,vehicles:line.vehicles?.map(vehicle=>({...vehicle,vin:vehicle.vin?"[provided]":""}))})),
    }}};
  },
});
export const finishPremiumEstimate = internalMutation({
  args: {requestId:v.id("procurementRequests"),token:v.string(),failed:v.boolean(),minimumMonthly:v.optional(v.number()),maximumMonthly:v.optional(v.number())},
  handler:async(ctx,args)=>{
    const request=await ctx.db.get(args.requestId);
    const estimate=request?.intakePremiumEstimate;
    if(!request || request.deletedAt || !estimate || estimate.token!==args.token || estimate.status!=="running")return null;
    const source=await premiumEstimateSource(ctx,request,!!estimate.provisional);
    if(source?.contentHash!==estimate.contentHash)return null;
    const validBound=(value:number|undefined)=>value===undefined || (Number.isSafeInteger(value) && value>0 && value<=10000000);
    const valid=!args.failed && (args.minimumMonthly!==undefined || args.maximumMonthly!==undefined) &&
      validBound(args.minimumMonthly) && validBound(args.maximumMonthly) &&
      (args.minimumMonthly===undefined || args.maximumMonthly===undefined || args.maximumMonthly>args.minimumMonthly);
    await ctx.db.patch(args.requestId,{intakePremiumEstimate:{...estimate,status:valid?"completed":"failed",
      ...(valid?{minimumMonthly:args.minimumMonthly,maximumMonthly:args.maximumMonthly}:{}),
    }});
    return null;
  },
});

export const inspectPremiumEstimate = internalQuery({
  args: {requestId:v.id("procurementRequests")},
  handler:async(ctx,{requestId})=>{
    const request=await ctx.db.get(requestId);
    const estimate=request?.intakePremiumEstimate;
    const source=request ? await premiumEstimateSource(ctx,request,!!estimate?.provisional) : null;
    return {submitted:!!request?.intakeSubmittedAt,estimate:estimate?{
      status:estimate.status,startedAt:estimate.startedAt,currency:estimate.currency,minimumMonthly:estimate.minimumMonthly,maximumMonthly:estimate.maximumMonthly,
      current:!request?.intakeSubmittedContentHash || estimate.contentHash===request.intakeSubmittedContentHash,
    }:null,inputSummary:source ? {
      country:source.application.details.registrationCountry,
      operations:source.application.answers.description,
      coverages:source.application.details.coverages.map(line=>({coverage:line.coverage,vehicles:line.vehicles?.length??0})),
      drivers:source.application.details.drivers?.length??0,
      followupAnswers:source.application.details.followups?.filter(row=>!row.skipped && row.answer.trim()).length??0,
      underwriting:source.application.details.followups?.filter(row=>!row.skipped && row.answer.trim() && !/auto\.driver\./.test(row.source??"")).slice(0,160).map(row=>({source:row.source,label:row.label,answer:row.answer})),
    }:null};
  },
});

/** Explicit operator-requested retry of a known failed attempt; never automatic. */
export const retryFailedPremiumEstimateInternal = internalMutation({
  args:{requestId:v.id("procurementRequests"),expectedStartedAt:v.number()},
  handler:async(ctx,{requestId,expectedStartedAt})=>{
    const request=await ctx.db.get(requestId);
    const estimate=request?.intakePremiumEstimate;
    if(!request || request.deletedAt || !request.intakeSubmittedAt || !estimate || estimate.status!=="failed" || estimate.startedAt!==expectedStartedAt)
      throw new Error("Estimate is not the expected failed submitted attempt");
    const source=await premiumEstimateSource(ctx,request,false);
    if(!source || source.contentHash!==estimate.contentHash)throw new Error("Submitted application changed since the failed attempt");
    await ctx.db.patch(requestId,{intakePremiumEstimate:undefined});
    await preparePremiumEstimateForRequest(ctx,{...request,intakePremiumEstimate:undefined});
    return null;
  },
});

/** Operator-requested estimate for the current accepted application. A failed
 * current attempt retries only when the operator saw that exact attempt.
 */
export async function refreshPremiumEstimateByOperator(ctx: MutationCtx, request: Doc<"procurementRequests">, expectedStartedAt?: number) {
  const source=await premiumEstimateSource(ctx,request,false);
  if(!request.intakeSubmittedAt || !source)throw new Error("Only submitted applications have premium estimates");
  const estimate=request.intakePremiumEstimate;
  if(estimate && !estimate.provisional && estimate.contentHash===source.contentHash){
    if(estimate.status!=="failed")throw new Error("The estimate is already current");
    if(estimate.startedAt!==expectedStartedAt)throw new Error("The estimate changed. Reload before retrying.");
  }
  await ctx.db.patch(request._id,{intakePremiumEstimate:undefined});
  await preparePremiumEstimateForRequest(ctx,{...request,intakePremiumEstimate:undefined});
}

/** Administrative recovery after logs confirm failure BEFORE inference submission.
 * Never use for a timeout, unknown outcome, or a previously completed estimate.
 */
export const recoverUnstartedPremiumEstimateInternal = internalMutation({
  args:{requestId:v.id("procurementRequests"),expectedStartedAt:v.number()},
  handler:async(ctx,{requestId,expectedStartedAt})=>{
    const request=await ctx.db.get(requestId);
    if(!request || request.deletedAt || request.intakePremiumEstimate?.status!=="failed" || request.intakePremiumEstimate.startedAt!==expectedStartedAt)throw new Error("Estimate is not the expected failed attempt");
    await ctx.db.patch(requestId,{intakePremiumEstimate:undefined});
    await preparePremiumEstimateForRequest(ctx,{...request,intakePremiumEstimate:undefined});
    return null;
  },
});
