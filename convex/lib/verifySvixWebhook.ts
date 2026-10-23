import { Webhook } from "svix";

export class SvixWebhookVerificationError extends Error {
  constructor(
    readonly code: "missing_secret" | "missing_headers" | "invalid_signature",
  ) {
    super(`Svix webhook verification failed: ${code}`);
    this.name = "SvixWebhookVerificationError";
  }
}

/**
 * Strict Svix signature verification. The secret is required: a missing or
 * blank secret throws instead of skipping verification. Svix enforces its
 * default five-minute timestamp tolerance; replay deduplication (by `svix-id`
 * or the event's own id) stays with the caller.
 */
export function verifySvixWebhook(args: {
  secret: string | undefined;
  payload: string;
  svixId: string | null | undefined;
  svixTimestamp: string | null | undefined;
  svixSignature: string | null | undefined;
}): void {
  const secret = args.secret?.trim();
  if (!secret) throw new SvixWebhookVerificationError("missing_secret");
  if (!args.svixId || !args.svixTimestamp || !args.svixSignature) {
    throw new SvixWebhookVerificationError("missing_headers");
  }
  try {
    new Webhook(secret).verify(args.payload, {
      "svix-id": args.svixId,
      "svix-timestamp": args.svixTimestamp,
      "svix-signature": args.svixSignature,
    });
  } catch {
    throw new SvixWebhookVerificationError("invalid_signature");
  }
}
