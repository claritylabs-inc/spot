import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const senderKey = (email: string) => email.trim().toLowerCase();

/** Image attachments Jev has not yet judged and the HTML body does not already show inline. */
export const candidatesInternal = internalQuery({
  args: { messageId: v.id("teamEmailMessages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.decorativeAttachmentIds !== undefined) return null;
    const shown = (contentId: string | undefined) =>
      Boolean(contentId && message.bodyHtml?.includes(`cid:${contentId}`));
    const inlineIds = new Set(
      (message.inlineFiles ?? []).filter((file) => shown(file.contentId)).map((file) => file.clientFileId),
    );
    const filed = await Promise.all(
      message.clientFileIds.map(async (clientFileId) => {
        const file = await ctx.db.get(clientFileId);
        return file && !inlineIds.has(clientFileId)
          ? [{ id: String(clientFileId), storageId: file.fileId, name: file.name, contentType: file.contentType, size: file.size }]
          : [];
      }),
    );
    const unfiled = (message.unfiledAttachments ?? [])
      .filter((file) => !shown(file.contentId))
      .map((file) => ({
        id: String(file.storageId),
        storageId: file.storageId,
        name: file.name,
        contentType: file.contentType,
        size: file.size,
      }));
    const images = await Promise.all(
      [...filed.flat(), ...unfiled]
        .filter((file) => file.contentType.startsWith("image/"))
        .map(async ({ storageId, ...file }) => {
          const sha256 = (await ctx.db.system.get("_storage", storageId as Id<"_storage">))?.sha256;
          const known = sha256
            ? await ctx.db
                .query("teamEmailImageJudgments")
                .withIndex("by_fromEmail_and_sha256", (q) =>
                  q.eq("fromEmail", senderKey(message.fromEmail)).eq("sha256", sha256),
                )
                .first()
            : null;
          return { ...file, sha256, decorative: known?.decorative };
        }),
    );
    return {
      clientOrgId: message.clientOrgId,
      subject: message.subject,
      text: message.currentText.slice(0, 2000),
      images,
    };
  },
});

/** Records which image attachments are decoration and remembers each judged image by sender and hash; an empty list marks the message as judged. */
export const saveInternal = internalMutation({
  args: {
    messageId: v.id("teamEmailMessages"),
    decorativeIds: v.array(v.string()),
    judged: v.optional(v.array(v.object({ sha256: v.string(), decorative: v.boolean() }))),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.decorativeAttachmentIds !== undefined) return;
    await ctx.db.patch(args.messageId, { decorativeAttachmentIds: args.decorativeIds });
    const fromEmail = senderKey(message.fromEmail);
    for (const { sha256, decorative } of args.judged ?? []) {
      const known = await ctx.db
        .query("teamEmailImageJudgments")
        .withIndex("by_fromEmail_and_sha256", (q) => q.eq("fromEmail", fromEmail).eq("sha256", sha256))
        .first();
      if (!known) await ctx.db.insert("teamEmailImageJudgments", { fromEmail, sha256, decorative });
    }
  },
});
