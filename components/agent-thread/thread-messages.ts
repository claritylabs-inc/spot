import { useMemo, useRef } from "react";
import { stableHash } from "@claritylabs/cl-sync";
import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadMessage } from "@/components/agent-thread/types";

export type AssistantPdfAttachment = {
  key: string;
  messageId: Id<"threadMessages">;
  fileId: Id<"_storage">;
};

// This cache only interns immutable query records; it never drives rendering.
/* eslint-disable react-hooks/refs */
export function useStableMessages(messages: ThreadMessage[] | undefined) {
  const cacheRef = useRef(
    new Map<string, { hash: string; message: ThreadMessage }>(),
  );
  const stableMessagesRef = useRef<ThreadMessage[] | undefined>(undefined);

  return useMemo(() => {
    if (!messages) {
      cacheRef.current = new Map();
      stableMessagesRef.current = undefined;
      return undefined;
    }

    const previousMessages = stableMessagesRef.current;
    const nextCache = new Map<
      string,
      { hash: string; message: ThreadMessage }
    >();
    let changed = previousMessages?.length !== messages.length;
    const nextMessages = messages.map((message, index) => {
      const hash = stableHash(message);
      const cached = cacheRef.current.get(message._id);
      const stableMessage = cached?.hash === hash ? cached.message : message;
      nextCache.set(message._id, { hash, message: stableMessage });
      if (previousMessages?.[index] !== stableMessage) changed = true;
      return stableMessage;
    });

    cacheRef.current = nextCache;
    if (!changed && previousMessages) return previousMessages;
    stableMessagesRef.current = nextMessages;
    return nextMessages;
  }, [messages]);
}
/* eslint-enable react-hooks/refs */

export function assistantPdfAttachments(
  messages: ThreadMessage[] | undefined,
): AssistantPdfAttachment[] {
  return (messages ?? []).flatMap((message) => {
    if (message.role !== "agent" || message.channel === "email") return [];
    return (message.attachments ?? []).flatMap((attachment) =>
      attachment.fileId && attachment.contentType === "application/pdf"
        ? [{
            key: `${message._id}:${attachment.fileId}`,
            messageId: message._id,
            fileId: attachment.fileId,
          }]
        : [],
    );
  });
}

export function messageSenderName(message: ThreadMessage) {
  if (message.operatorInitiated) {
    return message.operatorInitiated.displayLabel;
  }
  if (message.channel === "imessage") {
    return (
      message.imessageParticipantLabel ??
      message.userName ??
      message.imessageSenderAddress ??
      "iMessage participant"
    );
  }
  return message.userName ?? message.fromName ?? message.fromEmail ?? "User";
}

type ThreadMessageRenderPlan = {
  attachedEmailMessageIds: Set<string>;
  firstUserMessageId?: string;
  hiddenStatusMessageIds: Set<string>;
  relatedEmailsByMessageId: Map<string, ThreadMessage[]>;
};

export type WebMessageReceiptStatus = "delivered" | "read";

export function isMessageFromViewer(
  message: ThreadMessage,
  viewerId?: string,
  viewerEmail?: string,
) {
  return Boolean(
    (viewerId && message.userId === viewerId) ||
      (viewerEmail &&
        message.fromEmail?.toLowerCase() === viewerEmail.toLowerCase()),
  );
}

export function latestOwnWebMessageReceipt(
  messages: ThreadMessage[],
  viewerId?: string,
  viewerEmail?: string,
): { messageId: Id<"threadMessages">; status: WebMessageReceiptStatus } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role !== "user" ||
      message.channel !== "chat" ||
      !isMessageFromViewer(message, viewerId, viewerEmail)
    ) {
      continue;
    }

    const reply = messages.find(
      (candidate) => candidate.replyToMessageId === message._id,
    );
    const isOptimistic = String(message._id).includes(":local:");
    if (isOptimistic) return null;

    const status: WebMessageReceiptStatus =
      reply?.agentRunStartedAt != null ||
      (reply != null && reply.status !== "processing")
        ? "read"
        : "delivered";
    return { messageId: message._id, status };
  }
  return null;
}

export function buildThreadMessageRenderPlan(
  messages: ThreadMessage[],
): ThreadMessageRenderPlan {
  const attachedEmailMessageIds = new Set<string>();
  const hiddenStatusMessageIds = new Set<string>();
  const relatedEmailsByMessageId = new Map<string, ThreadMessage[]>();

  messages.forEach((message) => {
    if (message.status === "processing") return;
    // Email cards already own review and send; keep their confirmation cue persisted without duplicating it in the thread.
    if (
      message.messageKind === "channel_sync" ||
      (message.messageKind === "workflow_status" && message.pendingEmailId)
    ) {
      hiddenStatusMessageIds.add(message._id);
      return;
    }

    if (message.role !== "agent" || message.pendingEmailId === undefined) return;
    // The sent copy of a pending email renders as a card on the agent turn.
    const linked = messages.find(
      (candidate) =>
        candidate.channel === "email" &&
        candidate.role === "agent" &&
        candidate.pendingEmailId === message.pendingEmailId &&
        candidate._id !== message._id,
    );
    if (!linked || attachedEmailMessageIds.has(linked._id)) return;
    relatedEmailsByMessageId.set(message._id, [linked]);
    attachedEmailMessageIds.add(linked._id);
  });

  return {
    attachedEmailMessageIds,
    firstUserMessageId: messages.find((message) => message.role === "user")
      ?._id,
    hiddenStatusMessageIds,
    relatedEmailsByMessageId,
  };
}

export function threadMessageGroupingFingerprint(
  threadId: Id<"threads">,
  messages: ThreadMessage[],
) {
  return `${threadId}:${messages
    .map((message) => {
      if (message.status === "processing") {
        return `${message._id}:processing`;
      }
      if (message.channel === "email") {
        return `${message._id}:${stableHash(message)}`;
      }
      return `${message._id}:${stableHash({
        channel: message.channel,
        content: message.content,
        creationTime: message._creationTime,
        pendingEmailId: message.pendingEmailId,
        role: message.role,
        status: message.status,
        toAddresses: message.toAddresses,
      })}`;
    })
    .join("|")}`;
}
