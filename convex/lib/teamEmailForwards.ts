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

// ---------------------------------------------------------------------------
// Request matching for an authenticated forward. All of it is deterministic
// code over known facts; a model only ever chooses between candidates this
// code produced.
// ---------------------------------------------------------------------------

export const MAX_FORWARD_PARTICIPANTS = 20;
export const MAX_FORWARD_CANDIDATES = 8;
const MAX_SIGNAL_VALUES = 3;
/** Stored when a suggestion comes from one candidate on an incomplete scan. */
export const INCOMPLETE_SCAN_SUGGESTION_CONFIDENCE = 0.5;

/** What the signed forward block says; the only input to candidate matching. */
export type ForwardEvidence = {
  /** Original correspondents (lowercase addresses), never the forwarder. */
  participants: string[];
  /** Normalized subject of the forwarded message; empty when it has none. */
  normalizedSubject: string;
};

/**
 * The original correspondents of a forward: the forwarded block's addresses
 * without the forwarder's own and Spot's (`excluded`), bounded.
 */
export function originalCorrespondents(
  forwarded: ParsedInboundEmail["forwarded"],
  excluded: (address: string) => boolean,
): string[] {
  return forwardedParticipantAddresses(forwarded)
    .map((address) => address.trim().toLowerCase())
    .filter((address, index, all) => all.indexOf(address) === index && !excluded(address))
    .slice(0, MAX_FORWARD_PARTICIPANTS);
}

export type ForwardSignalKind =
  | "outreach_contact"
  | "broker_contact"
  | "client_person"
  | "client_domain"
  | "subject";

export type ForwardSignal = { kind: ForwardSignalKind; value: string };

/** Known facts about one open request. Lists hold lowercase addresses. */
export type ForwardRequestFacts = {
  outreachContacts: string[];
  brokerContacts: string[];
  /** Current client members and the applicant contact. */
  clientPeople: string[];
  clientWebsite?: string;
  /** Normalized subjects of the request's existing conversations. */
  threadSubjects: string[];
};

function websiteHost(website: string | undefined) {
  if (!website?.trim()) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/** Why a request is a candidate for the forward, at most three values per kind. */
export function forwardRequestSignals(
  evidence: ForwardEvidence,
  facts: ForwardRequestFacts,
): ForwardSignal[] {
  const participants = new Set(evidence.participants);
  const signals: ForwardSignal[] = [];
  const add = (kind: ForwardSignalKind, values: string[]) => {
    for (const value of [...new Set(values)].slice(0, MAX_SIGNAL_VALUES))
      signals.push({ kind, value });
  };
  const known = (emails: string[]) =>
    emails.map((email) => email.trim().toLowerCase()).filter((email) => participants.has(email));
  add("outreach_contact", known(facts.outreachContacts));
  add("broker_contact", known(facts.brokerContacts));
  add("client_person", known(facts.clientPeople));
  const host = websiteHost(facts.clientWebsite);
  if (host)
    add(
      "client_domain",
      evidence.participants
        .map((address) => address.slice(address.lastIndexOf("@") + 1))
        .filter((domain) => domain === host || domain.endsWith(`.${host}`)),
    );
  if (evidence.normalizedSubject && facts.threadSubjects.includes(evidence.normalizedSubject))
    add("subject", [evidence.normalizedSubject]);
  return signals;
}

export function describeForwardSignals(signals: ForwardSignal[]): string {
  const label: Record<ForwardSignalKind, string> = {
    outreach_contact: "outreach contact",
    broker_contact: "broker contact",
    client_person: "client contact",
    client_domain: "client domain",
    subject: "subject matches a conversation",
  };
  return signals
    .map((signal) =>
      signal.kind === "subject" ? label.subject : `${label[signal.kind]} ${signal.value}`,
    )
    .join("; ")
    .slice(0, 300);
}

export type ForwardCandidate<Request extends string, Client extends string> = {
  requestId: Request;
  clientOrgId: Client;
  signals: ForwardSignal[];
};

export type ForwardPlan<Candidate> =
  | { kind: "none"; reason: "no_candidates" | "too_many_candidates" | "incomplete_scan" }
  | { kind: "link"; candidate: Candidate }
  /** One candidate on an incomplete scan: stored as a suggestion, never linked. */
  | { kind: "suggest"; candidate: Candidate }
  | { kind: "choose"; candidates: Candidate[] };

/**
 * What a candidate set allows. Only a complete scan with exactly one candidate
 * links without a model; an incomplete scan can never link or be chosen from,
 * because the real candidate may be the one it did not reach.
 */
export function planForwardLink<Candidate>(scan: {
  candidates: Candidate[];
  complete: boolean;
}): ForwardPlan<Candidate> {
  const { candidates, complete } = scan;
  if (candidates.length === 0) return { kind: "none", reason: "no_candidates" };
  if (candidates.length > MAX_FORWARD_CANDIDATES)
    return { kind: "none", reason: "too_many_candidates" };
  if (!complete)
    return candidates.length === 1
      ? { kind: "suggest", candidate: candidates[0] }
      : { kind: "none", reason: "incomplete_scan" };
  return candidates.length === 1
    ? { kind: "link", candidate: candidates[0] }
    : { kind: "choose", candidates };
}
