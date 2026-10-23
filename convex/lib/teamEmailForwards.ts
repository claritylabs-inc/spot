import type { ParsedInboundEmail } from "./inboundEmailParser";

/**
 * Pure forward-content helper: the original correspondents named in the header
 * block that `parseInboundEmail` found in a forwarded message.
 *
 * Nothing here is authenticated. The block is text the forwarder (or anyone
 * who can influence the body) controls, so these addresses are evidence for
 * matching only. A caller that treats a message as a forward must separately
 * require that the envelope sender is the inbox owner's alias with a matching
 * DKIM result, and must never infer or link a request from this alone.
 */

export type ForwardedCorrespondents = {
  /** The original sender, from the forwarded header block. */
  from?: string;
  to: string[];
  cc: string[];
  /** Deduplicated `from`, `to` and `cc`, in that order. */
  participants: string[];
  subject?: string;
};

export function forwardedCorrespondents(
  forwarded: ParsedInboundEmail["forwarded"],
): ForwardedCorrespondents | null {
  if (!forwarded) return null;
  const { email } = forwarded;
  const addresses = (mailboxes: Array<{ address?: string }>) =>
    mailboxes.flatMap((mailbox) => (mailbox.address ? [mailbox.address] : []));
  const from = email.from?.address;
  const to = addresses(email.to);
  const cc = addresses(email.cc);
  return {
    ...(from ? { from } : {}),
    to,
    cc,
    participants: Array.from(new Set([...(from ? [from] : []), ...to, ...cc])),
    ...(email.subject ? { subject: email.subject } : {}),
  };
}

/** Original correspondents of a forward; empty when the message is not a forward. */
export function forwardedParticipantAddresses(
  forwarded: ParsedInboundEmail["forwarded"],
): string[] {
  return forwardedCorrespondents(forwarded)?.participants ?? [];
}
