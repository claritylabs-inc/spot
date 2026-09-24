import type { ConvexReactClient } from "convex/react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import dayjs from "dayjs";
import type { Id, TableNames } from "@/convex/_generated/dataModel";
import type { ThemeChoice } from "@/hooks/use-theme";
import type { WebMcpToolName } from "@/lib/webmcp/catalog";
import type { WebMcpResult } from "@/lib/webmcp/runtime";

export type ToolInput = Record<string, unknown>;
export type ToolExecute = (input: ToolInput) => Promise<WebMcpResult>;
export type ToolMap = Partial<Record<WebMcpToolName, ToolExecute>>;

export type ClientToolContext = {
  convex: ConvexReactClient;
  router: AppRouterInstance;
  orgId: Id<"organizations">;
  userId: Id<"users">;
  signOut: () => Promise<void>;
  setTheme: (theme: ThemeChoice) => void;
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function text(input: ToolInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requiredText(input: ToolInput, key: string): string {
  const value = text(input, key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

export function bool(input: ToolInput, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

export function requiredBool(input: ToolInput, key: string): boolean {
  const value = bool(input, key);
  if (value === undefined) throw new Error(`${key} must be true or false.`);
  return value;
}

export function num(input: ToolInput, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringList(input: ToolInput, key: string): string[] | undefined {
  const value = input[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return items.length > 0 ? items : undefined;
}

export function id<T extends TableNames>(input: ToolInput, key: string): Id<T> {
  return requiredText(input, key) as Id<T>;
}

export function record(input: ToolInput, key: string): ToolInput | undefined {
  const value = input[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ToolInput)
    : undefined;
}

export function assertDate(value: string | undefined, key: string) {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${key} must be YYYY-MM-DD.`);
  }
  return value;
}

/** Drops keys whose value is undefined so Convex validators see omitted args. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/^data:[^,]*,/, "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export type UploadedFile = {
  storageId: Id<"_storage">;
  fileName: string;
  contentType: string;
  size: number;
};

/**
 * Uploads a base64 file param set ({file_name, content_type, content_base64})
 * to a Convex storage upload URL, the same POST the UI's drop zones make.
 */
export async function uploadBase64File(
  file: ToolInput,
  getUploadUrl: () => Promise<string>,
): Promise<UploadedFile> {
  const fileName = requiredText(file, "file_name");
  const contentType = text(file, "content_type") ?? "application/octet-stream";
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64(requiredText(file, "content_base64"));
  } catch {
    throw new Error("content_base64 is not valid base64.");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("The file must be between 1 byte and 20 MB.");
  }
  const response = await fetch(await getUploadUrl(), {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Blob([bytes], { type: contentType }),
  });
  if (!response.ok) throw new Error("Upload failed.");
  const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
  return { storageId, fileName, contentType, size: bytes.byteLength };
}

export function isoTime(value: number | undefined | null) {
  return typeof value === "number" ? dayjs(value).toISOString() : null;
}
