import { v } from "convex/values";

export const threadMessageKindValidator = v.union(
  v.literal("conversation"),
  v.literal("workflow_status"),
  v.literal("channel_sync"),
);

const parsedEmailAddressValidator = v.object({
  address: v.optional(v.string()),
  name: v.optional(v.string()),
});

export const emailContentValidator = v.object({
  rawText: v.optional(v.string()),
  rawHtml: v.optional(v.string()),
  quotedText: v.optional(v.string()),
  parserVersion: v.string(),
  parseInputTruncated: v.boolean(),
  forwarded: v.optional(
    v.object({
      email: v.object({
        body: v.optional(v.string()),
        from: v.optional(parsedEmailAddressValidator),
        to: v.array(parsedEmailAddressValidator),
        cc: v.array(parsedEmailAddressValidator),
        subject: v.optional(v.string()),
        date: v.optional(v.string()),
      }),
    }),
  ),
});

export const operatorEmailContentValidator = v.object({
  ...emailContentValidator.fields,
  subject: v.string(),
  currentText: v.string(),
});

export const pendingEmailAttachmentKindValidator = v.union(
  v.literal("coi"),
  v.literal("original_policy"),
  v.literal("uploaded_file"),
  v.literal("generated_document"),
);

export const pendingEmailAttachmentValidator = v.object({
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
  fileId: v.id("_storage"),
  kind: v.optional(pendingEmailAttachmentKindValidator),
});
