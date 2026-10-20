import { intakeSubmissionProblems } from "../lib/intake-submission";
import { driverModelContext } from "../lib/intake-drivers";
import { intakeQuestionHistory } from "../lib/intake-question-history";
import { boundIntakeFollowupQuestions, followupQuestionVisible, expandIntakeFollowupQuestion } from "../lib/intake-followups";
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
  readIntakeBusinessProfile,
  saveIntakeBusinessProfile,
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

export async function hashIntakeToken(token: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function submissionContent(
  answers: IntakeAnswers,
  details: IntakeDetails,
  fileIds: string[],
) {
  const uiKeys = new Set([
    "companyConfirmed",
    "coverageIndex",
    "revenueStep",
    "mailingAddressStep",
    "dateInput",
    "dateParts",
    "companyResearchSource",
    "prefillSourceIds",
    "operatingLocationPrefilled",
    "activitiesPrefilled",
    "followupProgress",
    "driverIndex",
    "autoVehicleIndex",
    "collectSensitiveDriverDetails",
  ]);
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key, item]) =>
              !uiKeys.has(key) && item !== undefined && item !== "",
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]),
      );
    return value;
  };
  return JSON.stringify(
    normalize({ answers, details: activeIntakeDetails(details,answers.intakeGoal), files: [...fileIds].sort() }),
  );
}
function validateContact(name: string, email: string, phone: string) {
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
    !/^\+?[\d\s().-]{7,40}$/.test(contact.phone)
  )
    throw new Error("Enter your name, valid work email, and phone number.");
  if (isBootstrapOperatorEmail(contact.email))
    throw new Error("Use a customer email address.");
  return contact;
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
async function ownedRequest(
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
      answers: request.intakeAnswers ?? {},
      followupBatches: request.intakeFollowups,
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
      orgId: request.clientOrgId,
      canUseSavedCompany:
        !!request.intakeSavedCompany || !!request.intakeNewCompany,
      verified: !!user.emailVerificationTime && !user.intakeRestricted,
      files: await Promise.all(
        files.map(async (f) => ({
          id: f._id,
          name: f.name,
          category: f.category,
          prefillCoveragesJson: f.prefillCoveragesJson,
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
        title: r.intakeAnswers?.legalName || r.title,
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
            title: r.intakeAnswers?.legalName || r.title,
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
      validateIntakeDetails(args.details);
      const approved = [
        ...(request.intakeFollowups?.acord?.questions ?? []),
        ...(request.intakeFollowups?.additional?.questions ?? []),
        ...(request.intakeDetails?.followups ?? []),
      ].flatMap((question) => [question, ...expandIntakeFollowupQuestion(question)]);
      for (const row of args.details.followups??[]) {
        const { answer: _answer, skipped: _skipped, ...question }=row;
        if(row.answer.trim() && !followupQuestionVisible(row,args.details.followups))throw new Error("This follow-up does not apply to the current answer.");
        if (
          !approved.some(
            (candidate) =>
              candidate.id === question.id &&
              candidate.section === question.section &&
              candidate.label === question.label &&
              candidate.kind === question.kind &&
              candidate.source === question.source &&
              JSON.stringify(candidate.conditions??[])===JSON.stringify(question.conditions??[]) &&
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
    const website = answers.website?.trim() ?? "";
    const name = answers.legalName?.trim() ?? "";
    const url =
      website &&
      publicResearchUrl(
        /^https?:\/\//i.test(website) ? website : `https://${website}`,
      );
    const fingerprint = JSON.stringify([name, website]);
    const previousResearch = request.intakeCompanyResearch;
    if (
      name &&
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
    const answersChanged =
      JSON.stringify(answers) !== JSON.stringify(request.intakeAnswers ?? {});
    const revision = (request.intakeRevision ?? 0) + 1;
    await ctx.db.patch(request._id, {
      intakeAnswers: answers,
      ...(request.intakeSubmittedAt && answersChanged
        ? {
            intakeAmendedAt: dayjs().valueOf(),

            targetEffectiveDate: answers.effectiveDate || undefined,
          }
        : {}),
      ...(details ? { intakeDetails: details } : {}),
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
        ? `${answers.coverage} — ${answers.legalName || "Insurance request"}`.slice(
            0,
            200,
          )
        : request.title,
      updatedAt: dayjs().valueOf(),
      updatedByUserId: user._id,
    });
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
    };
    const revision = (request.intakeRevision ?? 0) + 1;
    await ctx.db.patch(request._id, {
      ...(request.clientOrgId && !request.intakeSavedCompany
        ? {
            intakeSavedCompany: {
              orgId: request.clientOrgId,
              answers: request.intakeAnswers ?? {},
              details: previous,
            },
          }
        : {}),
      clientOrgId: undefined,
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
      name: args.name.slice(0, 200),
      ownerUserId: user._id,
      contentType: metadata.contentType!,
      size: metadata.size,
      createdAt: dayjs().valueOf(),
    });
    if (args.category === "requirements")
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
    );
    const savings = answers.intakeGoal === "savings";
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
      orgId = await ctx.db.insert("organizations", {
        name: answers.legalName!,
        website: answers.website || undefined,
        type: "client",
        primaryInsuranceContactId: user._id,
        onboardingComplete: true,
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: user._id,
        role: "admin",
      });
      await scheduleCompanyResearch(ctx, orgId);
      if (answers.website)
        await ctx.scheduler.runAfter(
          0,
          internal.actions.extractCompanyInfo.importMissingOrgLogoInternal,
          { orgId, url: answers.website },
        );
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
      const phone = normalizeUserPhone(answers.phone);
      const phoneOwner = phone
        ? await findUserByNormalizedPhone(ctx, phone)
        : null;
      await ctx.db.patch(user._id, {
        name: answers.name,
        ...(!phoneOwner || phoneOwner._id === user._id ? { phone } : {}),
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
    await seedRequestIntake(ctx, {
      requestId: request._id,
      clientOrgId: orgId,
      narrative: applicationMarkdownBlock(submissionBaseline),
      userId: user._id,
      source: "client",
    });
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
    const phone = normalizeUserPhone(answers.phone);
    const phoneOwner = phone
      ? await findUserByNormalizedPhone(ctx, phone)
      : null;
    await ctx.db.patch(user._id, {
      name: answers.name,
      ...(!phoneOwner || phoneOwner._id === user._id ? { phone } : {}),
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
      file.category !== "requirements" ||
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
    await ctx.db.patch(file._id, { prefillStartedAt: dayjs().valueOf() });
    return {
      fileId: file.fileId,
      name: file.name,
      contentType: file.contentType,
    };
  },
});
export const finishRequirementPrefill = internalMutation({
  args: { intakeFileId: v.id("requestIntakeFiles"), coveragesJson: v.string() },
  handler: async (ctx, { intakeFileId, coveragesJson }) => {
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
    await ctx.db.patch(file._id, { prefillCoveragesJson: coveragesJson });
    return null;
  },
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
        request.intakeAnswers?.legalName?.trim() ?? "",
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
  },
  handler: async (ctx, { requestId, fingerprint, suggestions }) => {
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
      },
    });
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
        ? (details.followups ?? []).filter((row) => row.section === "acord")
        : undefined,
  };
  const files = await ctx.db
    .query("requestIntakeFiles")
    .withIndex("request", (q) => q.eq("requestId", request._id))
    .take(50);
  return hashIntakeToken(
    `${INTAKE_ACORD_CATALOG_VERSION}:history-v4-active-quote:${JSON.stringify((request.intakeSkippedSteps ?? []).filter((step) => step < 28))}:${submissionContent(
      request.intakeAnswers ?? {},
      contextDetails,
      files.map((file) => String(file._id)),
    )}`,
  );
}
/** One generation per saved application context; revisiting after edits prepares a new context. */
export const prepareFollowups = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    section: followupSectionValidator,
  },
  handler: async (ctx, { requestId, section }) => {
    const { request } = await ownedRequest(ctx, requestId);
    if (
      request.intakeSubmittedAt ||
      request.intakeAnswers?.intakeGoal === "savings"
    )
      throw new Error(
        "Follow-up generation is only available for quote drafts",
      );
    const contextHash = await followupContextHash(ctx, request, section);
    const previous = request.intakeFollowups?.[section];
    // Never automatically replay a pending, failed, or unknown inference outcome.
    if (previous?.contextHash === contextHash) return null;
    const batch = {
      status: "pending" as const,
      token: crypto.randomUUID(),
      contextHash,
      startedAt: dayjs().valueOf(),
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
  },
});
export const followupContext = internalQuery({
  args: {
    requestId: v.id("procurementRequests"),
    section: followupSectionValidator,
    token: v.string(),
  },
  handler: async (ctx, { requestId, section, token }) => {
    const request = await ctx.db.get(requestId);
    if (
      !request ||
      request.deletedAt ||
      request.intakeSubmittedAt ||
      request.intakeFollowups?.[section]?.token !== token
    )
      return null;
    const files = await ctx.db
      .query("requestIntakeFiles")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .take(50);
    const historyDetails = activeIntakeDetails(request.intakeDetails ?? detailsFromAnswers(request.intakeAnswers ?? {}),request.intakeAnswers?.intakeGoal);
    return {
      questionHistory: intakeQuestionHistory(request.intakeAnswers ?? {}, historyDetails, request.intakeSkippedSteps ?? []),
      priorQuestions:
        section === "additional"
          ? (request.intakeFollowups?.acord?.questions ?? [])
          : [],
      reservedQuestions: request.intakeFollowups?.[section === "acord" ? "additional" : "acord"]?.status === "ready" ? request.intakeFollowups[section === "acord" ? "additional" : "acord"]!.questions : [],
      answers: request.intakeAnswers ?? {},
      details: { ...historyDetails, drivers: (historyDetails.drivers ?? []).map(driverModelContext) },
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
    failed: v.boolean(),
  },
  handler: async (ctx, { requestId, section, token, questions, failed }) => {
    const request = await ctx.db.get(requestId);
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
    failed ||=
      batch.contextHash !== (await followupContextHash(ctx, request, section));
    if (failed) questions = [];
    else {
      const other=request.intakeFollowups?.[section === "acord" ? "additional" : "acord"];
      questions=boundIntakeFollowupQuestions(questions,request.intakeDetails?.followups??[],other?.status==="ready"?other.questions:[]);
    }
    await ctx.db.patch(requestId, {
      intakeFollowups: {
        ...request.intakeFollowups,
        [section]: {
          ...batch,
          status: failed ? ("failed" as const) : ("ready" as const),
          questions,
        },
      },
    });
  },
});
