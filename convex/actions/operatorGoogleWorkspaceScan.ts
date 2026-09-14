"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE,
  GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE,
} from "../lib/googleWorkspace";
import { googleWorkspaceCredentialEnvelope } from "../lib/googleWorkspaceCredentials";
import {
  createGoogleWorkspaceProvider,
  GoogleWorkspaceProviderError,
  googleWorkspaceErrorStatus,
  isEligibleDirectoryMailbox,
  sanitizeGoogleWorkspaceError,
} from "../lib/googleWorkspaceProvider";
import {
  GOOGLE_WORKSPACE_SCAN_LIMITS as LIMITS,
  googleWorkspaceScanBodyFingerprint,
  googleWorkspaceScanContentFingerprint,
  type GoogleWorkspaceScanSourceEvidence,
} from "../lib/googleWorkspaceScan";
import { readGoogleWorkspaceScanMessage } from "../lib/googleWorkspaceTools";
import { extractEmailAddress } from "../lib/emailAddress";
import { isOperatorEmailRecipient } from "../lib/operatorEmailAddress";

async function providerFor(credentialRevision: string) {
  const envelope = await googleWorkspaceCredentialEnvelope();
  if (!envelope.credentials || envelope.revision !== credentialRevision)
    throw new Error("Workspace credentials changed.");
  return createGoogleWorkspaceProvider(envelope.credentials, {
    gmail: [GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE],
    directory: [GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE],
  });
}

export const discover = internalAction({
  args: { runId: v.id("operatorGoogleWorkspaceScanRuns") },
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(
      internal.operatorGoogleWorkspaceScan.claimDiscoveryInternal,
      args,
    );
    if (!claim) return null;
    try {
      const provider = await providerFor(claim.config.credentialRevision);
      const page = await provider.listDirectoryUsers({
        subject: claim.connector.directoryAdminEmail!,
        pageToken: claim.run.directoryPageToken,
        maxResults: LIMITS.directoryPageSize,
      });
      await ctx.runMutation(
        internal.operatorGoogleWorkspaceScan.saveDirectoryPageInternal,
        {
          ...args,
          leaseToken: claim.leaseToken,
          mailboxes: page.users
            .filter(isEligibleDirectoryMailbox)
            .map((user) => user.primaryEmail),
          nextPageToken: page.nextPageToken,
        },
      );
    } catch (error) {
      await ctx.runMutation(
        internal.operatorGoogleWorkspaceScan.failCollectionWorkInternal,
        {
          ...args,
          leaseToken: claim.leaseToken,
          error: sanitizeGoogleWorkspaceError(error),
          resetPage: googleWorkspaceErrorStatus(error) === 400,
        },
      );
    }
    return null;
  },
});

export const collectMailbox = internalAction({
  args: { mailboxId: v.id("operatorGoogleWorkspaceScanMailboxes") },
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(
      internal.operatorGoogleWorkspaceScan.claimMailboxInternal,
      args,
    );
    if (!claim) return null;
    const { mailbox, leaseToken } = claim;
    let readingHistory = false;
    try {
      const provider = await providerFor(claim.config.credentialRevision);
      const user = await provider.getDirectoryUser({
        subject: claim.connector.directoryAdminEmail!,
        userKey: mailbox.mailbox,
      });
      if (
        !isEligibleDirectoryMailbox(user) ||
        user.primaryEmail !== mailbox.mailbox
      )
        throw new Error("Workspace mailbox is no longer eligible.");
      await ctx.runQuery(
        internal.operatorGoogleWorkspaceScan.assertMailboxLeaseInternal,
        { ...args, leaseToken },
      );
      if (mailbox.phase === "checkpoint") {
        // Capture before enumeration so arrivals during backfill are drained afterward.
        const historyCheckpoint = await provider.getHistoryCheckpoint(
          mailbox.mailbox,
        );
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.saveMailboxProgressInternal,
          { ...args, leaseToken, phase: "baseline", historyCheckpoint },
        );
      } else if (mailbox.phase === "baseline") {
        const page = await provider.listMessages({
          mailbox: mailbox.mailbox,
          query: `after:${Math.floor(mailbox.windowStartAt / 1000)} -in:drafts -in:spam -in:trash`,
          pageToken: mailbox.pageToken,
          maxResults: LIMITS.messagePageSize,
        });
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.enqueueMessagesInternal,
          { ...args, leaseToken, messages: page.messages },
        );
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.saveMailboxProgressInternal,
          {
            ...args,
            leaseToken,
            phase: page.nextPageToken ? "baseline" : "history",
            pageToken: page.nextPageToken ?? undefined,
          },
        );
      } else if (mailbox.phase === "history") {
        if (!mailbox.historyCheckpoint)
          throw new Error("Mailbox history checkpoint is missing.");
        readingHistory = true;
        const page = await provider.listHistory({
          mailbox: mailbox.mailbox,
          startHistoryId: mailbox.historyCheckpoint,
          pageToken: mailbox.pageToken,
          maxResults: LIMITS.messagePageSize,
        });
        for (
          let offset = 0;
          offset < page.messages.length;
          offset += LIMITS.messagePageSize
        ) {
          await ctx.runMutation(
            internal.operatorGoogleWorkspaceScan.enqueueMessagesInternal,
            {
              ...args,
              leaseToken,
              messages: page.messages.slice(
                offset,
                offset + LIMITS.messagePageSize,
              ),
            },
          );
        }
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.saveMailboxProgressInternal,
          {
            ...args,
            leaseToken,
            phase: page.nextPageToken ? "history" : "completed",
            pageToken: page.nextPageToken ?? undefined,
            historyCheckpoint: page.nextPageToken
              ? mailbox.historyCheckpoint
              : page.historyId,
          },
        );
      }
    } catch (error) {
      if (readingHistory && googleWorkspaceErrorStatus(error) === 404) {
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.saveMailboxProgressInternal,
          { ...args, leaseToken, phase: "checkpoint" },
        );
      } else {
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.failCollectionWorkInternal,
          {
            ...args,
            leaseToken,
            error: sanitizeGoogleWorkspaceError(error),
            resetPage: googleWorkspaceErrorStatus(error) === 400,
          },
        );
      }
    }
    return null;
  },
});

export const collectSource = internalAction({
  args: { sourceId: v.id("operatorGoogleWorkspaceScanSources") },
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(
      internal.operatorGoogleWorkspaceScan.claimCollectionInternal,
      args,
    );
    if (!claim) return null;
    const lease = { ...args, leaseToken: claim.leaseToken };
    let readingMessage = false;
    try {
      const context = await ctx.runQuery(
        internal.operatorGoogleWorkspaceScan.getSourceContextInternal,
        lease,
      );
      const provider = await providerFor(context.config.credentialRevision);
      const user = await provider.getDirectoryUser({
        subject: context.connector.directoryAdminEmail!,
        userKey: claim.source.mailbox,
      });
      if (
        !isEligibleDirectoryMailbox(user) ||
        user.primaryEmail !== claim.source.mailbox
      )
        throw new Error("Workspace mailbox is no longer eligible.");
      await ctx.runQuery(
        internal.operatorGoogleWorkspaceScan.getSourceContextInternal,
        lease,
      );
      readingMessage = true;
      const message = await provider.getMessageFull({
        mailbox: claim.source.mailbox,
        messageId: claim.source.messageId,
      });
      if (
        message.labelIds?.some((label) =>
          ["DRAFT", "SPAM", "TRASH"].includes(label),
        ) ||
        message.payload?.headers.some((header) =>
          header.name.toLowerCase() === "from" &&
          isOperatorEmailRecipient(extractEmailAddress(header.value) ?? ""),
        )
      ) {
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.finishCollectionInternal,
          { ...lease, excluded: true },
        );
        return null;
      }
      const parsed = await readGoogleWorkspaceScanMessage(
        {
          ...provider,
          getAttachment: async (request) => {
            await ctx.runQuery(
              internal.operatorGoogleWorkspaceScan.getSourceContextInternal,
              lease,
            );
            return provider.getAttachment(request);
          },
        },
        claim.source.mailbox,
        message,
      );
      const parts = [];
      for (
        let offset = 0;
        offset < parsed.body.length;
        offset += LIMITS.bodyPartChars
      )
        parts.push({
          ordinal: parts.length,
          text: parsed.body.slice(offset, offset + LIMITS.bodyPartChars),
        });
      const internalDate =
        message.internalDate === null ? null : Number(message.internalDate);
      const evidence: GoogleWorkspaceScanSourceEvidence = {
        mailbox: claim.source.mailbox,
        messageId: message.id,
        threadId: message.threadId,
        internetMessageId: parsed.internetMessageId,
        internalDate:
          internalDate !== null && Number.isFinite(internalDate)
            ? internalDate
            : null,
        sentAt: parsed.date,
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        subject: parsed.subject,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        contentFingerprint: "",
        bodyFingerprint: await googleWorkspaceScanBodyFingerprint(parsed.body),
        attachments: parsed.attachments,
        bodyPartCount: parts.length,
        bodyComplete: parsed.bodyComplete,
      };
      evidence.contentFingerprint = await googleWorkspaceScanContentFingerprint(
        evidence,
        parsed.body,
      );
      if (
        claim.source.originalContentFingerprint &&
        claim.source.originalContentFingerprint !== evidence.contentFingerprint
      ) {
        throw new GoogleWorkspaceProviderError(
          "The source message changed. Review its original evidence before retrying.",
        );
      }
      for (let offset = 0; offset < parts.length; offset += 8)
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.storeSourcePartsInternal,
          { ...lease, parts: parts.slice(offset, offset + 8) },
        );
      await ctx.runMutation(
        internal.operatorGoogleWorkspaceScan.finishCollectionInternal,
        { ...lease, evidence, excluded: false },
      );
    } catch (error) {
      if (readingMessage && googleWorkspaceErrorStatus(error) === 404)
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.finishCollectionInternal,
          { ...lease, excluded: true },
        );
      else
        await ctx.runMutation(
          internal.operatorGoogleWorkspaceScan.failCollectionWorkInternal,
          { ...lease, error: sanitizeGoogleWorkspaceError(error) },
        );
    }
    return null;
  },
});
