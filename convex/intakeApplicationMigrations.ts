import { Migrations } from "@convex-dev/migrations";
import dayjs from "dayjs";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { bindGmailThread } from "./lib/gmailThreadBinding";
import { messageIdForms } from "./lib/messageId";
import {
  submittedIntakeApplication,
  companyApplicationProfile,
} from "../lib/intake-application";

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
/**
 * Binds Gmail sends recorded before Gmail thread bindings existed: each sent
 * draft's Gmail thread is joined, through its Message-ID, to the team email
 * message (and so the conversation) Spot recorded for it. Idempotent and
 * resumable, one draft per step; drafts with no recorded message are left
 * alone. No follow-up checks are scheduled for old sends.
 */
export const bindEarlierGmailSends = migrations.define({
  table: "operatorGmailDrafts",
  migrateOne: async (ctx, draft) => {
    if (draft.status !== "sent" || !draft.gmailThreadId) return;
    const connection = await ctx.db.get(draft.connectionId);
    if (!connection || connection.status === "disconnected") return;
    for (const form of messageIdForms(draft.messageId)) {
      const message = await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_messageId", (q) => q.eq("messageId", form))
        .first();
      if (!message) continue;
      const thread = await ctx.db.get(message.threadId);
      if (!thread || thread.deletedAt) return;
      await bindGmailThread(ctx, {
        threadId: thread._id,
        connection,
        gmailThreadId: draft.gmailThreadId,
        now: dayjs().valueOf(),
      });
      return;
    }
  },
});
export const run = migrations.runner();
