import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

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
          ? [{ id: String(clientFileId), name: file.name, contentType: file.contentType, size: file.size }]
          : [];
      }),
    );
    const unfiled = (message.unfiledAttachments ?? [])
      .filter((file) => !shown(file.contentId))
      .map((file) => ({
        id: String(file.storageId),
        name: file.name,
        contentType: file.contentType,
        size: file.size,
      }));
    return {
      clientOrgId: message.clientOrgId,
      subject: message.subject,
      text: message.currentText.slice(0, 2000),
      attachments: [...filed.flat(), ...unfiled].filter((file) => file.contentType.startsWith("image/")),
    };
  },
});

/** Records which image attachments are decoration; an empty list marks the message as judged. */
export const saveInternal = internalMutation({
  args: { messageId: v.id("teamEmailMessages"), decorativeIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.decorativeAttachmentIds !== undefined) return;
    await ctx.db.patch(args.messageId, { decorativeAttachmentIds: args.decorativeIds });
  },
});
