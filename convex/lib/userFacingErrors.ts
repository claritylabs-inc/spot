import { ConvexError } from "convex/values";

export const userFacingErrorCodes = {
  authRequired: "AUTH_REQUIRED",
  orgAccessRequired: "ORG_ACCESS_REQUIRED",
  orgAdminRequired: "ORG_ADMIN_REQUIRED",
  brokerAdminRequired: "BROKER_ADMIN_REQUIRED",
  clientAdminRequired: "CLIENT_ADMIN_REQUIRED",
  operatorRequired: "OPERATOR_REQUIRED",
  operatorOwnerRequired: "OPERATOR_OWNER_REQUIRED",
  readOnlyAccess: "READ_ONLY_ACCESS",
  impersonationReadOnly: "IMPERSONATION_READ_ONLY",
} as const;

export type UserFacingErrorCode =
  (typeof userFacingErrorCodes)[keyof typeof userFacingErrorCodes];

export type UserFacingErrorData = {
  category: "authentication" | "permission";
  code: UserFacingErrorCode;
  message: string;
};

const defaultMessages: Record<UserFacingErrorCode, string> = {
  AUTH_REQUIRED: "Your session has expired. Sign in again and retry this action.",
  ORG_ACCESS_REQUIRED: "You don’t have access to this organization.",
  ORG_ADMIN_REQUIRED: "Only an organization admin can perform this action.",
  BROKER_ADMIN_REQUIRED: "Only a provider admin can perform this action.",
  CLIENT_ADMIN_REQUIRED: "Only a client admin can perform this action.",
  OPERATOR_REQUIRED: "This action is available only to Spot operators.",
  OPERATOR_OWNER_REQUIRED: "Only a Spot operator owner can perform this action.",
  READ_ONLY_ACCESS: "You have read-only access and can’t make this change.",
  IMPERSONATION_READ_ONLY:
    "Live-organization impersonation is read-only. Exit operator mode to make this change from an authorized organization account.",
};

export function userFacingError(
  code: UserFacingErrorCode,
  message = defaultMessages[code],
) {
  return new ConvexError<UserFacingErrorData>({
    category: code === userFacingErrorCodes.authRequired
      ? "authentication"
      : "permission",
    code,
    message,
  });
}

export function throwUserFacingError(
  code: UserFacingErrorCode,
  message?: string,
): never {
  throw userFacingError(code, message);
}

export function isUserFacingErrorCode(
  error: unknown,
  code: UserFacingErrorCode,
) {
  return (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    error.data.code === code
  );
}
