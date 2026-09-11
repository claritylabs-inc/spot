export const MAX_AGENT_ATTACHMENT_FILES = 10;
export const MAX_AGENT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES = 50 * 1024 * 1024;
export const MAX_AGENT_ATTACHMENT_TEXT_CHARS = 80_000;

export const MAX_ROUTER_ATTACHMENT_ASSETS = 8;
export const MAX_ROUTER_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_ROUTER_ATTACHMENT_AGGREGATE_BYTES = 16 * 1024 * 1024;

export const MAX_OPERATOR_MCP_INLINE_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_OPERATOR_MCP_INLINE_AGGREGATE_BYTES = 14 * 1024 * 1024;
export const MAX_OPERATOR_IMESSAGE_ACTION_BASE64_CHARS = 3_500_000;

export class AgentAttachmentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAttachmentLimitError";
  }
}

export type RouterAttachmentBudget = { count: number; bytes: number };

export function accountRouterAttachment(
  budget: RouterAttachmentBudget,
  attachment: { filename: string; size: number },
): void {
  if (
    !Number.isSafeInteger(attachment.size) ||
    attachment.size <= 0 ||
    attachment.size > MAX_ROUTER_ATTACHMENT_BYTES
  ) {
    throw new AgentAttachmentLimitError(
      `${attachment.filename} exceeds the 12 MiB router asset limit`,
    );
  }
  budget.count += 1;
  budget.bytes += attachment.size;
  if (budget.count > MAX_ROUTER_ATTACHMENT_ASSETS) {
    throw new AgentAttachmentLimitError(
      "Model input contains more than 8 rich binary assets",
    );
  }
  if (budget.bytes > MAX_ROUTER_ATTACHMENT_AGGREGATE_BYTES) {
    throw new AgentAttachmentLimitError(
      "Model input rich binary assets exceed the 16 MiB aggregate limit",
    );
  }
}

export function assertAgentAttachmentLimits(
  attachments: Array<{ filename: string; size: number }>,
): void {
  if (attachments.length > MAX_AGENT_ATTACHMENT_FILES) {
    throw new AgentAttachmentLimitError(
      `Model input supports at most ${MAX_AGENT_ATTACHMENT_FILES} attachments`,
    );
  }

  let aggregateBytes = 0;
  for (const attachment of attachments) {
    if (
      !Number.isSafeInteger(attachment.size) ||
      attachment.size < 0 ||
      attachment.size > MAX_AGENT_ATTACHMENT_BYTES
    ) {
      throw new AgentAttachmentLimitError(
        `${attachment.filename} exceeds the 25 MiB attachment intake limit`,
      );
    }
    aggregateBytes += attachment.size;
  }
  if (aggregateBytes > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
    throw new AgentAttachmentLimitError(
      "Attachments exceed the 50 MiB aggregate intake limit",
    );
  }
}

export function normalizeAgentAttachmentFilename(value: string): string {
  const filename = value.trim();
  if (
    !filename ||
    filename.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(filename)
  ) {
    throw new Error("Attachment filenames must be 1–255 printable characters");
  }
  return filename;
}

export function normalizeAgentAttachmentContentType(
  value: string | undefined,
  fallback = "application/octet-stream",
): string {
  const contentType = value?.trim() || fallback;
  if (
    !contentType ||
    contentType.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(contentType)
  ) {
    throw new Error(
      "Attachment content types must be printable and at most 200 characters",
    );
  }
  return contentType;
}
