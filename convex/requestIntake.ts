import { intakeDetailsValidator } from "./lib/intakeDetailsSchema";
import {
  detailsFromAnswers,
  detailsAnswers,
  validateIntakeDetails,
  validCoverageLimit,
  validCoverageScope,
  coverageOption,
  type IntakeDetails,
} from "../lib/insurance-intake-details";
import dayjs from "dayjs";
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getSessionUserId } from "./lib/sessionIdentity";
import { getOrgAccess } from "./lib/access";
import { normalizeUserPhone, findUserByNormalizedPhone } from "./lib/userPhone";
import {
  isBootstrapOperatorEmail,
  requireOperator,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { requireDirectOperatorWrite } from "./procurementRequests";
import { intakeAnswersValidator } from "./lib/insuranceIntakeSchema";
import {
  completedIntakeSteps,
  COMPANY_INTAKE_FIELDS,
  INTAKE_VERSION,
  INTAKE_STEPS,
  intakeMarkdown,
  intakeFollowUps,
  missingIntakeAnswers,
  type IntakeAnswers,
} from "../lib/insurance-intake";
import { createProcurementInboxToken } from "./lib/procurement";
import { seedRequestIntake } from "./lib/procurementNarrative";
import { getMarkdownDocument, saveMarkdownDocument } from "./markdownDocuments";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
} from "./lib/markdownDocument";
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
    request.ownerUserId !== user._id ||
    request.intakeSchemaVersion === undefined
  )
    throw new Error("Request not found");
  if (!user.intakeRestricted && !request.intakeVerifiedAccess)
    throw new Error("Confirm application ownership to resume this draft");
  if (request.clientOrgId) await getOrgAccess(ctx, request.clientOrgId);
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
  return ctx.db.insert("procurementRequests", {
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
    intakeStep: 1,
    intakeRevision: 0,
    readiness: "incomplete",
    readinessMissing: missingIntakeAnswers(answers),
  });
}
export const createHandoff = internalMutation({
  args: {
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
      requestId = await newDraft(ctx, userId, contact);
    }
    await ctx.db.insert("requestHandoffs", {
      ...contact,
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
    if (!user?.intakeRestricted || user.emailVerificationTime)
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
      const profile =
        previousProfile?.intakeAnswers ?? previousProfile?.intakeSnapshot;
      companyDetails = previousProfile?.intakeDetails;
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
    if (user.intakeRestricted || !user.emailVerificationTime)
      throw new Error("Confirm your email first");
    const priorOwned = await ctx.db
      .query("procurementRequests")
      .withIndex("owner_updated", (q) => q.eq("ownerUserId", user._id))
      .order("desc")
      .take(100);
    const priorContact = priorOwned.find(
      (r) => r.intakeSubmittedAt,
    )?.intakeSnapshot;
    let answers: IntakeAnswers = {
      name: user.name ?? "",
      email: user.email ?? "",
      phone: user.phone ?? priorContact?.phone ?? "",
    };
    let companyDetails: IntakeDetails | undefined;
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
      const profile =
        previousProfile?.intakeAnswers ?? previousProfile?.intakeSnapshot;
      companyDetails = previousProfile?.intakeDetails;
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
      skippedSteps: request.intakeSkippedSteps ?? [],
      status: request.status,
      readiness: request.readiness,
      missing: request.readinessMissing ?? [],
      submittedAt: request.intakeSubmittedAt,
      updatedAt: request.updatedAt,
      orgId: request.clientOrgId,
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
          r.status === "draft" &&
          !r.intakeSubmittedAt &&
          (user.intakeRestricted || r.intakeVerifiedAccess),
      )
      .map((r) => ({
        id: r._id,
        title: r.intakeAnswers?.legalName || r.title,
        coverage: r.intakeAnswers?.coverage || "",
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
/** Verified owners can return to tracking after submission. */
export const submitted = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getSessionUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (
      !user?.emailVerificationTime ||
      user.accountKind === "operator" ||
      user.serviceAccountKind
    )
      return [];
    const rows = await ctx.db
      .query("procurementRequests")
      .withIndex("owner_updated", (q) => q.eq("ownerUserId", user._id))
      .order("desc")
      .take(100);
    const accessible = await Promise.all(
      rows
        .filter((r) => r.intakeSubmittedAt && r.intakeVerifiedAccess)
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
            coverage: r.intakeAnswers?.coverage || "",
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
      request.intakeSubmittedAt &&
      (!user.emailVerificationTime || user.intakeRestricted)
    )
      throw new Error("Confirm your email before editing this application");
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
      ![4, 5, 8, 11, 13, 14, 15, 17, 18, 21, 22, 23, 24, 25, 26].includes(
        args.skippedStep,
      )
    )
      throw new Error("This question cannot be skipped");
    if (args.details) validateIntakeDetails(args.details);
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
    const answersChanged =
      JSON.stringify(answers) !== JSON.stringify(request.intakeAnswers ?? {});
    const revision = (request.intakeRevision ?? 0) + 1;
    await ctx.db.patch(request._id, {
      intakeAnswers: answers,
      ...(request.intakeSubmittedAt && answersChanged
        ? {
            intakeAmendedAt: dayjs().valueOf(),
            readiness: "ready_for_review" as const,
            readinessConfirmedAt: undefined,
            readinessConfirmedByUserId: undefined,
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
      readinessMissing: missingIntakeAnswers(answers),
      title: answers.coverage
        ? `${answers.coverage} — ${answers.legalName || "Insurance request"}`.slice(
            0,
            200,
          )
        : request.title,
      updatedAt: dayjs().valueOf(),
      updatedByUserId: user._id,
    });
    if (request.intakeSubmittedAt && request.clientOrgId && answersChanged) {
      const document = await getMarkdownDocument(ctx, {
        orgId: request.clientOrgId,
        requestId: request._id,
        kind: "packet",
        filename: "public.md",
      });
      const parsed = parseMarkdownDocument(document?.markdown ?? "");
      const start = "<!-- spot-current-application:start -->";
      const end = "<!-- spot-current-application:end -->";
      const managed = `${start}\n## Current application\n\n${intakeMarkdown(answers)}\n${end}`;
      const first = parsed.body.indexOf(start);
      const last = first >= 0 ? parsed.body.indexOf(end, first) : -1;
      const body =
        first >= 0 && last >= first
          ? parsed.body.slice(0, first) +
            managed +
            parsed.body.slice(last + end.length)
          : `${parsed.body}\n\n${managed}`;
      await saveMarkdownDocument(ctx, {
        orgId: request.clientOrgId,
        requestId: request._id,
        kind: "packet",
        filename: "public.md",
        expectedRevision: document?.revision ?? 0,
        markdown: stringifyMarkdownDocument(
          parsed.frontmatter,
          request.intakeSnapshot
            ? body
                .replace(
                  `## Request\n\n${intakeMarkdown(request.intakeSnapshot)}`,
                  "",
                )
                .trim()
            : body,
        ),
      });
      await ctx.db.patch(request._id, {
        packetRevision: (request.packetRevision ?? 0) + 1,
      });
    }
    return revision;
  },
});
export const uploadUrl = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    const { user, request } = await ownedRequest(ctx, args.requestId);
    if (
      request.intakeSubmittedAt &&
      (!user.emailVerificationTime || user.intakeRestricted)
    )
      throw new Error("Confirm your email before editing this application");
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
      (!user.emailVerificationTime || user.intakeRestricted)
    )
      throw new Error("Confirm your email before editing this application");
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
        brokerRelease: "hidden",
        clientVisible: true,
        createdByUserId: user._id,
        updatedByUserId: user._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(intakeFileId, { clientFileId });
      await ctx.db.patch(request._id, {
        intakeAmendedAt: now,
        readiness: "ready_for_review",
        readinessConfirmedAt: undefined,
        readinessConfirmedByUserId: undefined,
        updatedAt: now,
        readinessMissing: intakeFollowUps(request.intakeAnswers ?? {}, [
          ...files.map((f) => f.category),
          args.category,
        ]),
      });
    }
    return intakeFileId;
  },
});
export const submit = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const { user, request } = await ownedRequest(ctx, args.requestId);
    if (!user.emailVerificationTime || user.intakeRestricted)
      throw new Error("Confirm your email before submitting");
    if (request.intakeSubmittedAt)
      return { requestId: request._id, orgId: request.clientOrgId! };
    const answers = request.intakeAnswers ?? {};
    validateContact(
      answers.name ?? "",
      answers.email ?? "",
      answers.phone ?? "",
    );
    const missing = missingIntakeAnswers(answers);
    const details = request.intakeDetails ?? detailsFromAnswers(answers);
    if (
      (details.registrationCountry || "United States") === "United States" &&
      answers.fein &&
      !/^\d{2}-?\d{7}$/.test(answers.fein.trim())
    )
      missing.push("Valid nine-digit FEIN");
    if (
      details.registrationCountry === "Canada" &&
      answers.businessNumber &&
      !/^\d{9}$/.test(answers.businessNumber.trim())
    )
      missing.push("Valid nine-digit Canadian business number");
    for (const line of details.coverages) {
      if (!validCoverageScope(line, details.scopeNote || answers.coverageScope))
        missing.push(`${coverageOption(line.coverage).label}: what to insure`);
      for (const limit of coverageOption(line.coverage).limits)
        if (!validCoverageLimit(limit.key, line.limits[limit.key]))
          missing.push(
            `${coverageOption(line.coverage).label}: ${limit.label}`,
          );
    }
    if (missing.length)
      throw new Error(`Please complete: ${missing.join(", ")}`);
    for (const key of ["effectiveDate", "deadline"] as const)
      if (
        answers[key] &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(answers[key]!) ||
          dayjs(answers[key]).format("YYYY-MM-DD") !== answers[key])
      )
        throw new Error("Enter a valid date");
    let orgId = request.clientOrgId ?? args.orgId;
    let writeCompanyProfile = true;
    if (orgId) {
      const access = await getOrgAccess(ctx, orgId);
      if (access.accessType !== "member")
        throw new Error("Company membership required");
      if (access.orgType !== "client")
        throw new Error("Select a client company");
      writeCompanyProfile = access.role === "admin";
    } else {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("user", (q) => q.eq("userId", user._id))
        .first();
      if (membership)
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
    const files = await ctx.db
      .query("requestIntakeFiles")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .take(30);
    const now = dayjs().valueOf();
    await ctx.db.patch(request._id, {
      clientOrgId: orgId,
      status: "submitted",
      clientVisible: true,
      targetEffectiveDate: answers.effectiveDate || undefined,
      intakeSnapshot: answers,
      intakeDetailsSnapshot:
        request.intakeDetails ?? detailsFromAnswers(answers),
      intakeSubmittedAt: now,
      readiness: "ready_for_review",
      readinessMissing: intakeFollowUps(
        answers,
        files.map((f) => f.category),
      ),
      updatedAt: now,
    });
    await seedRequestIntake(ctx, {
      requestId: request._id,
      clientOrgId: orgId,
      narrative: intakeMarkdown(answers),
      userId: user._id,
      source: "client",
    });
    if (writeCompanyProfile) {
      const wiki = await getMarkdownDocument(ctx, {
        orgId,
        kind: "company_wiki",
      });
      const parsed = parseMarkdownDocument(wiki?.markdown ?? "");
      await saveMarkdownDocument(ctx, {
        orgId,
        kind: "company_wiki",
        filename: wiki?.filename ?? "company.md",
        expectedRevision: wiki?.revision ?? 0,
        markdown: stringifyMarkdownDocument(
          { ...parsed.frontmatter, visibility: "shared" },
          [
            parsed.body,
            `## Customer-confirmed company information (${dayjs(now).format("YYYY-MM-DD")})\n\n${intakeMarkdown(answers, COMPANY_INTAKE_FIELDS)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        ),
      });
    }
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
        brokerRelease: "hidden",
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
    return { requestId: request._id, orgId };
  },
});

export const setReadiness = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    readiness: v.union(
      v.literal("needs_information"),
      v.literal("ready_for_market"),
    ),
    missing: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    const request = await ctx.db.get(args.requestId);
    if (!request?.clientOrgId || !request.intakeSubmittedAt)
      throw new Error("Submitted company request required");
    const missing = args.missing.map((s) => s.trim()).filter(Boolean);
    if (missing.length > 30 || missing.some((s) => s.length > 500))
      throw new Error("Keep the checklist to 30 short items");
    if (args.readiness === "ready_for_market" && missing.length)
      throw new Error("Resolve outstanding items first");
    const now = dayjs().valueOf();
    await ctx.db.patch(request._id, {
      readiness: args.readiness,
      readinessMissing: missing,
      readinessConfirmedByUserId: operator.userId,
      readinessConfirmedAt: now,
      updatedAt: now,
      updatedByUserId: operator.userId,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: request.clientOrgId,
      summary: `Insurance request marked ${args.readiness.replaceAll("_", " ")}`,
      metadata: { requestId: request._id, missing },
    });
  },
});

export const prepareVerification = mutation({
  args: { requestId: v.id("procurementRequests"), token: v.string() },
  handler: async (ctx, args) => {
    const { request } = await ownedRequest(ctx, args.requestId);
    if (
      !/^[a-zA-Z0-9_-]{32,128}$/.test(args.token) ||
      request.intakeSubmittedAt
    )
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
