import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  submittedIntakeApplication,
  companyApplicationProfile,
} from "../lib/intake-application";
import { createIntakeClient } from "./requestIntake";

const migrations = new Migrations<DataModel>(components.migrations);
/** Additive, resumable. Original snapshots, prose, markers and links are never rewritten. */
export const promoteSubmittedApplications = migrations.define({
  table: "procurementRequests",
  migrateOne: async (ctx, request) => {
    const application = submittedIntakeApplication(request);
    if (!application) return;
    if (!request.intakeSubmittedApplication) {
      if (!request.intakeSubmissionBaseline) {
        const files = await ctx.db
          .query("requestIntakeFiles")
          .withIndex("request", (q) => q.eq("requestId", request._id))
          .take(30);
        application.files = files
          .filter((file) => file.createdAt <= request.intakeSubmittedAt!)
          .map((file) => ({ id: String(file._id), name: file.name }));
      }
      await ctx.db.patch(request._id, {
        intakeSubmittedApplication: application,
      });
    }
    if (!request.clientOrgId || !request.ownerUserId) return;
    const member = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", request.clientOrgId!).eq("userId", request.ownerUserId!),
      )
      .first();
    const org = await ctx.db.get(request.clientOrgId);
    if (
      !org ||
      org.deletedAt ||
      org.type !== "client" ||
      member?.role !== "admin"
    )
      return;
    if (
      !org.intakeBusinessProfile ||
      org.intakeBusinessProfile.submittedAt < application.submittedAt
    )
      await ctx.db.patch(org._id, {
        intakeBusinessProfile: {
          ...companyApplicationProfile(application),
          sourceRequestId: request._id,
        },
      });
  },
});
/** Old intake upload defaults only; never overrides a subsequently edited release. */
export const releaseUntouchedIntakeFiles = migrations.define({
  table: "procurementFileItems",
  migrateOne: async (ctx, item) => {
    if (
      !item.clientFileId ||
      item.outreachId ||
      item.brokerRelease !== "hidden" ||
      item.updatedAt !== item.createdAt
    )
      return;
    const request = await ctx.db.get(item.requestId);
    if (!request || request.deletedAt || !request.intakeSubmittedAt) return;
    const uploads = await ctx.db
      .query("requestIntakeFiles")
      .withIndex("request", (q) => q.eq("requestId", item.requestId))
      .take(30);
    if (
      !uploads.some(
        (file) =>
          file.clientFileId === item.clientFileId &&
          file.ownerUserId === item.createdByUserId,
      )
    )
      return;
    await ctx.db.patch(item._id, { brokerRelease: "attached" });
    await ctx.db.patch(request._id, {
      packetRevision: (request.packetRevision ?? 0) + 1,
    });
  },
});
/** Gives first-time applicants from before clients were created at intake start a client operators can open. */
export const linkUnsubmittedIntakeClients = migrations.define({
  table: "procurementRequests",
  migrateOne: async (ctx, request) => {
    if (
      request.deletedAt !== undefined ||
      request.status !== "draft" ||
      request.intakeSubmittedAt !== undefined ||
      request.intakeSchemaVersion === undefined
    )
      return;
    const client = request.clientOrgId
      ? await ctx.db.get(request.clientOrgId)
      : null;
    if (client && client.deletedAt === undefined) return;
    const userId = request.ownerUserId ?? request.createdByUserId;
    const user = await ctx.db.get(userId);
    if (!user || user.accountKind === "operator" || user.serviceAccountKind)
      return;
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", userId))
      .first();
    if (membership) return;
    await ctx.db.patch(request._id, {
      clientOrgId: await createIntakeClient(
        ctx,
        userId,
        request.intakeAnswers ?? {},
        request._id,
      ),
    });
  },
});
export const run = migrations.runner();
