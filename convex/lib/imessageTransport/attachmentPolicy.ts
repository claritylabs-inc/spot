export type InboundAttachmentContent = {
  mimeType: string;
  name?: string;
  read(): Promise<Uint8Array>;
};

export type NormalizedInboundAttachment = {
  data: string;
  mimeType: string;
  name: string;
};

export type EnsureM4a = (
  bytes: Buffer,
  mimeType: string,
) => Promise<{ buffer: Buffer }>;

const VOICE_MEMO_EXTENSIONS = [
  ".aac",
  ".amr",
  ".caf",
  ".m4a",
  ".mp3",
  ".mp4",
  ".wav",
  ".webm",
] as const;

export function normalizeAttachmentMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";", 1)[0]?.trim() || "";
}

export function isVoiceMemoContent(
  content: Pick<InboundAttachmentContent, "mimeType" | "name">,
): boolean {
  if (normalizeAttachmentMimeType(content.mimeType).startsWith("audio/")) {
    return true;
  }
  const name = content.name?.trim().toLowerCase() ?? "";
  return VOICE_MEMO_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function voiceMemoFilename(name?: string): string {
  const trimmed = name?.trim() || "voice-memo";
  const base = trimmed.replace(/\.[^.]+$/, "") || "voice-memo";
  return `${base}.m4a`;
}

export async function readInboundAttachmentWith(
  ensureM4a: EnsureM4a,
  content: InboundAttachmentContent,
): Promise<NormalizedInboundAttachment> {
  const mimeType = normalizeAttachmentMimeType(content.mimeType);
  const bytes = Buffer.from(await content.read());
  if (!isVoiceMemoContent(content)) {
    return {
      data: bytes.toString("base64"),
      mimeType,
      name: content.name?.trim() || "attachment",
    };
  }

  const { buffer } = await ensureM4a(bytes, mimeType);
  return {
    data: buffer.toString("base64"),
    mimeType: "audio/mp4",
    name: voiceMemoFilename(content.name),
  };
}
