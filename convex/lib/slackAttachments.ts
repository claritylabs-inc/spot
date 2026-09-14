import { v, type Infer } from "convex/values";

const attachmentFields = {
  providerFileId: v.string(),
  filename: v.string(),
  contentType: v.string(),
  size: v.optional(v.number()),
};

export const slackInboundAttachmentValidator = v.object(attachmentFields);
export const slackStoredAttachmentValidator = v.object({
  ...attachmentFields,
  fileId: v.optional(v.id("_storage")),
});

type SlackAttachment = Infer<typeof slackStoredAttachmentValidator>;

export function slackAttachments(input: {
  attachments?: SlackAttachment[];
  attachment?: SlackAttachment;
}): SlackAttachment[] {
  const files = new Map<string, SlackAttachment>();
  for (const file of [
    ...(input.attachments ?? []),
    ...(input.attachment ? [input.attachment] : []),
  ]) {
    const existing = files.get(file.providerFileId);
    if (existing?.fileId && file.fileId && existing.fileId !== file.fileId) {
      throw new Error("Slack attachment has conflicting stored file references");
    }
    files.set(
      file.providerFileId,
      existing
        ? {
            ...existing,
            size: existing.size ?? file.size,
            fileId: existing.fileId ?? file.fileId,
          }
        : file,
    );
  }
  return [...files.values()];
}
