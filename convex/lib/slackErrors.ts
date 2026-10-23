export const DEFINITIVE_SLACK_ERRORS = new Set([
  "account_inactive", "channel_not_found", "invalid_auth", "is_archived",
  "missing_scope", "not_allowed_token_type", "not_authed", "org_login_required",
  "not_in_channel", "token_expired", "token_revoked",
]);

export class SlackProviderError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean) {
    super(message);
    this.name = "SlackProviderError";
  }
}

/** For attachment-free posts only: a failed request does not prove rejection. */
export function isDefinitiveSlackRejection(error: unknown): error is SlackProviderError {
  return error instanceof SlackProviderError && (
    DEFINITIVE_SLACK_ERRORS.has(error.code) ||
    ["ratelimited", "rate_limited", "http_429", "invalid_arguments", "invalid_blocks", "msg_too_long", "no_text", "installation_unavailable"].includes(error.code)
  );
}
