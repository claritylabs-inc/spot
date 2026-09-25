import type { Doc, Id } from "@/convex/_generated/dataModel";

export type ThreadMessage = Doc<"threadMessages">;

export type ThreadAttachment = NonNullable<
  ThreadMessage["attachments"]
>[number];

export type ToolArtifactData = { type: string; data: unknown };

/** Which artifact side panel is open, if any. */
export type ThreadArtifactRef =
  | { kind: "email"; messageId: Id<"threadMessages"> }
  | { kind: "vendor_compliance"; messageId: Id<"threadMessages">; index: number }
  | {
      kind: "mailbox_task";
      messageId: Id<"threadMessages">;
      index: number;
      emailIndex?: number;
    };
