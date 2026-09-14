import {
  MAX_OPERATOR_MCP_INLINE_AGGREGATE_BYTES,
  MAX_OPERATOR_MCP_INLINE_ATTACHMENT_BYTES,
  normalizeAgentAttachmentContentType,
  normalizeAgentAttachmentFilename,
} from "./agentAttachmentLimits";

const MAX_BASE64_INPUT_CHARS =
  Math.ceil(MAX_OPERATOR_MCP_INLINE_ATTACHMENT_BYTES / 3) * 4 + 4_096;

export type DecodedOperatorMcpAttachment = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

function decodeBase64(value: string, filename: string): Uint8Array {
  if (value.length > MAX_BASE64_INPUT_CHARS) {
    throw new Error(`${filename} exceeds the 12 MB MCP inline file limit`);
  }
  const compact = value.replace(/\s/g, "");
  if (
    compact.length % 4 === 1 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      compact,
    )
  ) {
    throw new Error(`${filename} has invalid base64 data`);
  }

  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    throw new Error(`${filename} has invalid base64 data`);
  }
  if (binary.length > MAX_OPERATOR_MCP_INLINE_ATTACHMENT_BYTES) {
    throw new Error(`${filename} exceeds the 12 MB MCP inline file limit`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function decodeOperatorMcpAttachments(
  input: unknown,
): DecodedOperatorMcpAttachment[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("attachments must be an array");

  const decoded: DecodedOperatorMcpAttachment[] = [];
  let aggregateSize = 0;
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Each attachment must be an object");
    }
    const attachment = value as Record<string, unknown>;
    const rawFilename =
      typeof attachment.filename === "string" ? attachment.filename.trim() : "";
    const filename = normalizeAgentAttachmentFilename(
      rawFilename.replace(/\\/g, "/").split("/").at(-1) ?? "",
    );
    const rawContentType =
      typeof attachment.content_type === "string"
        ? attachment.content_type.trim()
        : "";
    let contentType: string;
    try {
      contentType = normalizeAgentAttachmentContentType(rawContentType);
    } catch {
      throw new Error(`${filename} has an invalid content_type`);
    }
    if (typeof attachment.data_base64 !== "string") {
      throw new Error(`${filename} is missing data_base64`);
    }
    const bytes = decodeBase64(attachment.data_base64, filename);
    aggregateSize += bytes.byteLength;
    if (aggregateSize > MAX_OPERATOR_MCP_INLINE_AGGREGATE_BYTES) {
      throw new Error(
        "Operator task attachments exceed the 14 MB MCP inline message limit",
      );
    }
    decoded.push({
      filename,
      contentType,
      bytes,
    });
  }
  return decoded;
}
