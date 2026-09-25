const IMESSAGE_DIRECT_TITLE_PREFIX = "iMessage - ";
const IMESSAGE_GROUP_TITLE_PREFIX = "iMessage group - ";

export type ThreadDisplayLike = {
  _id: string;
  _creationTime: number;
  title: string;
  lastMessageAt?: number;
  originChannel?: "chat" | "email" | "imessage" | "slack";
  threadPhone?: string;
  slackConversationKind?: "channel" | "direct_message";
  visibility?: "broker_visible" | "client_internal" | "user_private";
};

export function isImessageThread(thread: ThreadDisplayLike) {
  return (
    thread.originChannel === "imessage" ||
    Boolean(thread.threadPhone) ||
    thread.title.startsWith(IMESSAGE_DIRECT_TITLE_PREFIX) ||
    thread.title.startsWith(IMESSAGE_GROUP_TITLE_PREFIX)
  );
}

export function getThreadDisplayLabel(thread: ThreadDisplayLike) {
  if (!isImessageThread(thread)) return thread.title;

  const withoutDirectPrefix = thread.title.startsWith(
    IMESSAGE_DIRECT_TITLE_PREFIX,
  )
    ? thread.title.slice(IMESSAGE_DIRECT_TITLE_PREFIX.length).trim()
    : thread.title;
  const withoutGroupPrefix = withoutDirectPrefix.startsWith(
    IMESSAGE_GROUP_TITLE_PREFIX,
  )
    ? withoutDirectPrefix.slice(IMESSAGE_GROUP_TITLE_PREFIX.length).trim()
    : withoutDirectPrefix;

  return withoutGroupPrefix || thread.threadPhone || thread.title;
}
