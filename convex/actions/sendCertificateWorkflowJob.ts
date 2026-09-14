"use node";

import { v } from "convex/values";
import { parseMarkdownDocument, stringifyMarkdownDocument } from "../lib/markdownDocument";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  buildEmailPayload,
  buildEmailSignature,
  resolveEmailAgentIdentity,
  toResendAttachments,
} from "../lib/emailSubagent";
import { sendResendEmail } from "../lib/resend";
import {
  certificateHolderDisplayBlock,
  type CertificateHolderAddressInput,
} from "../lib/certificateIdentity";

type PreparedSendJob = {
  job: {
    orgId: Id<"organizations">;
    policyId: Id<"policies">;
    recipientEmail?: string;
    recipientPhone?: string;
    policyVersionId?: Id<"policyVersions">;
  };
  holder: {
    displayName: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: CertificateHolderAddressInput;
  };
  org: Record<string, unknown>;
  userId?: Id<"users">;
};

type GeneratedCertificate = {
  fileId?: Id<"_storage">;
  fileName?: string;
  size?: number;
  certificateVersionId?: Id<"certificateVersions">;
};

export const send = action({
  args: {
    jobId: v.id("certificateWorkflowJobs"),
    sendNotes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "sent";
    fileId: Id<"_storage">;
    certificateVersionId?: string;
  }> => {
    if (args.sendNotes !== undefined) {
      stringifyMarkdownDocument({ title: "Certificate delivery notes" }, args.sendNotes.trim());
    }
    const prepared = (await ctx.runMutation(
      api.certificateWorkflowJobs.prepareSendJob,
      {
        jobId: args.jobId,
        sendNotes: args.sendNotes,
      },
    )) as PreparedSendJob;
    try {
      const generated = (await ctx.runAction(
        internal.certificates.generateForOrg,
        {
          orgId: prepared.job.orgId,
          policyId: prepared.job.policyId,
          holderName: prepared.holder.displayName,
          certificateHolder: certificateHolderDisplayBlock(prepared.holder),
          holderContactName: prepared.holder.contactName,
          holderEmail: prepared.job.recipientEmail ?? prepared.holder.email,
          holderPhone: prepared.job.recipientPhone ?? prepared.holder.phone,
          addressLine1: prepared.holder.address?.line1,
          addressLine2: prepared.holder.address?.line2,
          city: prepared.holder.address?.city,
          state: prepared.holder.address?.state,
          postalCode: prepared.holder.address?.postalCode,
          country: prepared.holder.address?.country,
          policyVersionId: prepared.job.policyVersionId,
          source: "agent",
          createdByUserId: prepared.userId,
          forceReissue: true,
        },
      )) as GeneratedCertificate;
      if (!generated?.fileId) {
        throw new Error("Certificate generation did not produce a PDF.");
      }

      const identity = await resolveEmailAgentIdentity(prepared.org);
      if (!identity.canSend || !identity.agentAddress || !identity.fromHeader) {
        throw new Error(identity.reason ?? "Email sending is not configured.");
      }
      if (!prepared.job.recipientEmail) {
        throw new Error(
          "Certificate workflow job is missing a recipient email.",
        );
      }
      const signature = buildEmailSignature(identity.agentAddress);
      const subject = `Certificate of Insurance - ${prepared.holder.displayName}`;
      const body = [
        `Attached is the updated certificate of insurance for ${prepared.holder.displayName}.`,
        args.sendNotes === undefined ? undefined : parseMarkdownDocument(args.sendNotes).body,
      ]
        .filter(Boolean)
        .join("\n\n");
      const payload = buildEmailPayload({
        fromHeader: identity.fromHeader,
        to: prepared.job.recipientEmail,
        cc: [],
        bcc: [],
        subject,
        body,
        signature,
      });
      payload.attachments = await toResendAttachments(ctx, [
        {
          filename: generated.fileName ?? "certificate-of-insurance.pdf",
          contentType: "application/pdf",
          size: generated.size ?? 0,
          fileId: generated.fileId,
        },
      ]);
      const sent = await sendResendEmail(
        payload as Parameters<typeof sendResendEmail>[0],
        {
          retries: 2,
        },
      );
      if (!sent.ok) throw new Error(sent.error);

      await ctx.runMutation(internal.certificateWorkflowJobs.markSentInternal, {
        jobId: args.jobId,
        generatedCertificateVersionId: generated.certificateVersionId,
        sentByUserId: prepared.userId,
        sendNotes: args.sendNotes,
      });
      return {
        status: "sent",
        fileId: generated.fileId,
        certificateVersionId: generated.certificateVersionId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(
        internal.certificateWorkflowJobs.markFailedInternal,
        {
          jobId: args.jobId,
          error: message,
        },
      );
      throw error;
    }
  },
});
