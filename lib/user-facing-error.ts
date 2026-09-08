import type { UserFacingErrorData } from "@/convex/lib/userFacingErrors";

const convexServerErrorPattern =
  /^\[CONVEX [^\]]+\](?: \[Request ID: [^\]]+\])? Server Error(?: Called by client)?/i;

function asStructuredErrorData(data: unknown): UserFacingErrorData | null {
  if (typeof data !== "object" || !data) {
    return null;
  }
  if (
    !("category" in data) ||
    !("code" in data) ||
    !("message" in data) ||
    (data.category !== "authentication" && data.category !== "permission") ||
    typeof data.code !== "string" ||
    typeof data.message !== "string"
  ) {
    return null;
  }
  return data as UserFacingErrorData;
}

function structuredErrorData(error: unknown): UserFacingErrorData | null {
  if (typeof error === "object" && error && "data" in error) {
    const structured = asStructuredErrorData(error.data);
    if (structured) return structured;
  }

  const message = normalizedErrorMessage(error);
  if (!message?.startsWith("{")) return null;
  try {
    return asStructuredErrorData(JSON.parse(message));
  } catch {
    return null;
  }
}

function legacyPermissionMessage(message: string) {
  if (/not authenticated/i.test(message)) {
    return "Your session has expired. Sign in again and retry this action.";
  }
  if (/operator impersonation is read-only/i.test(message)) {
    return "Live-organization impersonation is read-only. Exit operator mode to make this change from an authorized organization account.";
  }
  if (/connected client.*read-only|read-only vendor access/i.test(message)) {
    return "This connected organization is read-only. Switch to an authorized organization account to make changes.";
  }
  if (/broker admin access required/i.test(message)) {
    return "Only a broker admin can perform this action.";
  }
  if (/client admin access required/i.test(message)) {
    return "Only a client admin can perform this action.";
  }
  if (
    /admin (?:access|role) required|only (?:an? )?(?:org(?:anization)?|broker|client) admins?/i.test(
      message,
    )
  ) {
    return "Only an organization admin can perform this action.";
  }
  if (
    /unauthorized|access denied|organization access required|only org(?:anization)? members/i.test(
      message,
    )
  ) {
    return "You don’t have permission to perform this action.";
  }
  return null;
}

function normalizedErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  const message = error.message
    .replace(convexServerErrorPattern, "")
    .trim()
    .replace(/^(?:Uncaught Error: )+/, "")
    .trim();
  return convexServerErrorPattern.test(error.message)
    ? message
        .split(/\n\s+at /)[0]
        .replace(/\s*Called by client\s*$/, "")
        .trim()
    : message;
}

export function getPermissionErrorMessage(error: unknown) {
  const structured = structuredErrorData(error);
  if (structured) return structured.message;
  const message = normalizedErrorMessage(error);
  return message ? legacyPermissionMessage(message) : null;
}

export function getUserFacingErrorMessage(error: unknown, fallback: string) {
  const structured = structuredErrorData(error);
  if (structured) return structured.message;

  const message = normalizedErrorMessage(error);
  if (!message) return fallback;
  return legacyPermissionMessage(message) ?? message;
}
