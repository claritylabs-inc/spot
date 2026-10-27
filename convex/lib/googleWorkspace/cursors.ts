"use node";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceToolName,
} from "../googleWorkspace";

export type ListCursorState = { offset?: number; pageToken?: string };
/** The date window is pinned so later pages cover the same range across midnight. */
export type ScanCursorState = { start?: number; end?: number; pageToken?: string };
export type SearchCursorState = {
  mailboxes: string[];
  mailboxIndex: number;
  gmailPageToken?: string;
  directoryPageToken?: string;
  directoryDone: boolean;
  hadErrors: boolean;
  encounteredErrorCount: number;
};
export type ThreadCursorState = {
  hadUnavailableBody: boolean;
  messageIndex: number;
  bodyOffset: number;
  threadFingerprint: string;
};

type CursorEnvelope = {
  version: 1;
  tool: OperatorGoogleWorkspaceToolName;
  configUpdatedAt: number;
  requestFingerprint: string;
  state: unknown;
};

export function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

export function encodeCursor(
  secret: string,
  tool: OperatorGoogleWorkspaceToolName,
  configUpdatedAt: number,
  requestFingerprint: string,
  state: unknown,
) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      tool,
      configUpdatedAt,
      requestFingerprint,
      state,
    } satisfies CursorEnvelope),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const cursor = `${payload}.${signature}`;
  if (cursor.length > GOOGLE_WORKSPACE_LIMITS.maxCursorChars) {
    throw new Error("Google Workspace continuation state is too large.");
  }
  return cursor;
}

export function decodeCursor<T>(
  secret: string,
  cursor: string | undefined,
  expected: {
    tool: OperatorGoogleWorkspaceToolName;
    configUpdatedAt: number;
    requestFingerprint: string;
  },
  initial: T,
): T {
  if (!cursor) return initial;
  if (cursor.length > GOOGLE_WORKSPACE_LIMITS.maxCursorChars) {
    throw new Error("Google Workspace cursor is invalid.");
  }
  let envelope: CursorEnvelope;
  try {
    const pieces = cursor.split(".");
    if (pieces.length !== 2) throw new Error("invalid cursor");
    const expectedSignature = createHmac("sha256", secret)
      .update(pieces[0])
      .digest();
    const suppliedSignature = Buffer.from(pieces[1], "base64url");
    if (
      expectedSignature.byteLength !== suppliedSignature.byteLength ||
      !timingSafeEqual(expectedSignature, suppliedSignature)
    ) {
      throw new Error("invalid cursor signature");
    }
    const value = JSON.parse(
      Buffer.from(pieces[0], "base64url").toString("utf8"),
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid cursor envelope");
    }
    envelope = value as CursorEnvelope;
  } catch {
    throw new Error("Google Workspace cursor is invalid.");
  }
  if (
    envelope.version !== 1 ||
    envelope.tool !== expected.tool ||
    envelope.configUpdatedAt !== expected.configUpdatedAt ||
    envelope.requestFingerprint !== expected.requestFingerprint ||
    !envelope.state ||
    typeof envelope.state !== "object" ||
    Array.isArray(envelope.state)
  ) {
    throw new Error(
      "Google Workspace cursor does not match this request or current settings.",
    );
  }
  return envelope.state as T;
}

function validOptionalToken(value: unknown) {
  return (
    value === undefined || (typeof value === "string" && value.length <= 8_000)
  );
}

export function assertListCursorState(state: ListCursorState) {
  if (
    (state.offset !== undefined &&
      (!Number.isInteger(state.offset) || state.offset < 0)) ||
    !validOptionalToken(state.pageToken)
  ) {
    throw new Error("Google Workspace cursor is invalid.");
  }
}

export function assertScanCursorState(state: ScanCursorState) {
  const validTime = (value: number | undefined) =>
    value === undefined || (Number.isInteger(value) && value >= 0);
  if (
    !validTime(state.start) ||
    !validTime(state.end) ||
    (state.start === undefined) !== (state.end === undefined) ||
    !validOptionalToken(state.pageToken)
  ) {
    throw new Error("Google Workspace cursor is invalid.");
  }
}

export function assertSearchCursorState(state: SearchCursorState) {
  if (
    !Array.isArray(state.mailboxes) ||
    state.mailboxes.length > GOOGLE_WORKSPACE_LIMITS.maxRequestedMailboxes ||
    state.mailboxes.some(
      (mailbox) =>
        typeof mailbox !== "string" ||
        !mailbox ||
        mailbox.length > GOOGLE_WORKSPACE_LIMITS.maxMailboxChars,
    ) ||
    !Number.isInteger(state.mailboxIndex) ||
    state.mailboxIndex < 0 ||
    state.mailboxIndex > GOOGLE_WORKSPACE_LIMITS.maxRequestedMailboxes ||
    !validOptionalToken(state.gmailPageToken) ||
    !validOptionalToken(state.directoryPageToken) ||
    typeof state.directoryDone !== "boolean" ||
    typeof state.hadErrors !== "boolean" ||
    !Number.isInteger(state.encounteredErrorCount) ||
    state.encounteredErrorCount < 0
  ) {
    throw new Error("Google Workspace cursor is invalid.");
  }
}

export function assertThreadCursorState(state: ThreadCursorState) {
  if (
    typeof state.hadUnavailableBody !== "boolean" ||
    !Number.isInteger(state.messageIndex) ||
    state.messageIndex < 0 ||
    !Number.isInteger(state.bodyOffset) ||
    state.bodyOffset < 0 ||
    typeof state.threadFingerprint !== "string" ||
    state.threadFingerprint.length > 100
  ) {
    throw new Error("Google Workspace cursor is invalid.");
  }
}

export function pageSize(limit: number | undefined) {
  const value = limit ?? GOOGLE_WORKSPACE_LIMITS.defaultPageSize;
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > GOOGLE_WORKSPACE_LIMITS.maxPageSize
  ) {
    throw new Error(
      `Google Workspace page size must be between 1 and ${GOOGLE_WORKSPACE_LIMITS.maxPageSize}.`,
    );
  }
  return value;
}
