import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { IntakeAnswers } from "../../lib/insurance-intake";
import {
  activeIntakeDetails,
  type IntakeDetails,
} from "../../lib/insurance-intake-details";
import {
  companyApplicationProfile,
  submittedIntakeApplication,
  withCompanyProfileFacts,
  type IntakeApplication,
} from "../../lib/intake-application";

/** Open requests a profile save refills; older or larger histories keep their own facts. */
const PROFILE_FILL_REQUEST_LIMIT = 100;

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
    "prefilled",
    "coverageIndex",
    "revenueStep",
    "mailingAddressStep",
    "dateInput",
    "dateParts",
    "companyResearchSource",
    "prefillSourceIds",
    "declinedRequirementCoverages",
    "operatingLocationPrefilled",
    "activitiesPrefilled",
    "followupProgress",
    "payrollPage",
    "sectionIntroductions",
    "subsectionIntroductions",
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

type IntakeBusinessProfile = NonNullable<Doc<"organizations">["intakeBusinessProfile"]>;

export async function readIntakeBusinessProfile(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  if (org?.intakeBusinessProfile) return org.intakeBusinessProfile;
  const requests = await ctx.db
    .query("procurementRequests")
    .withIndex("organization", (q) => q.eq("clientOrgId", orgId))
    .order("desc")
    .take(100);
  const candidates: {
    application: IntakeApplication;
    sourceRequestId: Id<"procurementRequests">;
  }[] = [];
  for (const request of requests) {
    const application = submittedIntakeApplication(request);
    if (!application || !request.ownerUserId) continue;
    const member = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", orgId).eq("userId", request.ownerUserId!),
      )
      .first();
    if (member?.role === "admin")
      candidates.push({ application, sourceRequestId: request._id });
  }
  candidates.sort(
    (a, b) => b.application.submittedAt - a.application.submittedAt,
  );
  const latest = candidates[0];
  return latest
    ? {
        ...companyApplicationProfile(latest.application),
        sourceRequestId: latest.sourceRequestId,
      }
    : null;
}
export async function saveIntakeBusinessProfile(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
  sourceRequestId: Id<"procurementRequests">,
  application: IntakeApplication,
) {
  const member = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .first();
  if (member?.role !== "admin") return;
  await writeIntakeBusinessProfile(ctx, orgId, {
    ...companyApplicationProfile(application),
    sourceRequestId,
  });
}

/** The only profile writer: a saved profile refills its client's open requests. */
export async function writeIntakeBusinessProfile(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  profile: IntakeBusinessProfile,
) {
  await ctx.db.patch(orgId, { intakeBusinessProfile: profile });
  const requests = await ctx.db
    .query("procurementRequests")
    .withIndex("organization", (q) => q.eq("clientOrgId", orgId))
    .order("desc")
    .take(PROFILE_FILL_REQUEST_LIMIT);
  for (const request of requests)
    await fillRequestFromClientProfile(ctx, request, profile.details);
}

/**
 * Store a submitted request's blank company facts from the client profile, in
 * both the published application and the editable draft, so every reader of
 * the stored application sees them. Closed requests keep what they were
 * completed with.
 */
export async function fillRequestFromClientProfile(
  ctx: MutationCtx,
  request: Doc<"procurementRequests">,
  profile?: IntakeDetails | null,
) {
  const application = submittedIntakeApplication(request);
  if (
    !application ||
    !request.clientOrgId ||
    request.status === "completed" ||
    request.status === "cancelled"
  )
    return;
  profile ??= (await readIntakeBusinessProfile(ctx, request.clientOrgId))
    ?.details;
  const filled = withCompanyProfileFacts(application, profile);
  if (filled === application) return;
  const draft = withCompanyProfileFacts(
    {
      answers: request.intakeAnswers ?? application.answers,
      details: request.intakeDetails ?? application.details,
    },
    profile,
  );
  await ctx.db.patch(request._id, {
    intakeSubmittedApplication: filled,
    intakeSubmittedContentHash: await hashIntakeToken(
      submissionContent(
        filled.answers,
        filled.details,
        filled.files.map((file) => file.id),
      ),
    ),
    intakeAnswers: draft.answers,
    intakeDetails: draft.details,
    packetRevision: (request.packetRevision ?? 0) + 1,
    updatedAt: dayjs().valueOf(),
  });
  await ctx.scheduler.runAfter(
    0,
    internal.requestIntake.preparePremiumEstimateInternal,
    { requestId: request._id },
  );
}
