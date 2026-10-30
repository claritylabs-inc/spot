import {
  linkedProcurementRequest,
  type OperatorIntentPrefetchRead,
} from "../operatorAgentIntentRegistry";
import { CONSUMER_DOMAINS } from "../procurement";
import type { OperatorPageContextEntry } from "./types";

type EmailAddress = { address?: unknown; name?: unknown } | null | undefined;

type ThreadMessage = {
  direction?: unknown;
  fromName?: unknown;
  fromEmail?: unknown;
  fromOperator?: unknown;
  currentText?: unknown;
  forwarded?: { email?: { from?: EmailAddress; body?: unknown } } | null;
};

type TeamThreadRead = {
  thread?: { subject?: unknown };
  client?: { _id?: unknown; name?: unknown } | null;
  request?: { requestId?: unknown; title?: unknown } | null;
  addressedRequest?: { requestId?: unknown; title?: unknown } | null;
  messages?: ThreadMessage[];
};

const SIGNATURE_LINES = 8;
const QUOTED_HISTORY =
  /^(>|On .+wrote:\s*$|-{2,}\s*(Original Message|Forwarded message)\s*-{2,})/i;

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** The label a company's domain is named after: `luminvera` for `mail.luminvera.co.uk`. */
function domainLabel(domain: string) {
  const labels = domain.split(".");
  const secondLevel =
    labels.length >= 3 &&
    labels.at(-1)!.length === 2 &&
    ["co", "com", "org", "net", "ac", "gov"].includes(labels.at(-2)!);
  return labels.at(secondLevel ? -3 : -2);
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The outside party the conversation is with: the original sender of the
 * newest forwarded message, else the newest inbound sender who is not an
 * operator.
 */
function counterparty(messages: readonly ThreadMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.direction !== "inbound") continue;
    const original = message.forwarded?.email?.from;
    const originalAddress = text(original?.address);
    if (originalAddress)
      return {
        name: text(original?.name),
        email: originalAddress.toLowerCase(),
        body: text(message.forwarded?.email?.body),
        forwardedBy: text(message.fromEmail),
      };
    const address = text(message.fromEmail);
    if (address && !message.fromOperator)
      return {
        name: text(message.fromName),
        email: address.toLowerCase(),
        body: text(message.currentText),
      };
  }
  return undefined;
}

/** The last lines of a body before any quoted history, where a signature sits. */
function signatureLines(body: string | undefined) {
  if (!body) return [];
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const quoted = lines.findIndex((line) => QUOTED_HISTORY.test(line));
  return (quoted >= 0 ? lines.slice(0, quoted) : lines)
    .filter(Boolean)
    .slice(-SIGNATURE_LINES);
}

/**
 * Facts the model would otherwise search for: who wrote, their company's
 * domain and where the subject or signature names it, and the conversation's
 * links. Derived in code from the prefetched thread.
 */
export function teamEmailThreadHints(read: unknown): string[] {
  const thread = read as TeamThreadRead | undefined;
  if (!thread || typeof thread !== "object") return [];
  const hints: string[] = [];
  const sender = counterparty(
    Array.isArray(thread.messages) ? thread.messages : [],
  );
  if (sender) {
    const domain = sender.email.split("@")[1];
    const company =
      domain && !CONSUMER_DOMAINS.has(domain) ? domainLabel(domain) : undefined;
    hints.push(
      `Sender: ${sender.name ? `${sender.name} <${sender.email}>` : sender.email}${
        sender.forwardedBy ? ` (forwarded by ${sender.forwardedBy})` : ""
      }`,
    );
    if (domain)
      hints.push(
        company
          ? `Sender domain: ${domain} (a company domain, not a personal mailbox)`
          : `Sender domain: ${domain} (personal mailbox; does not identify a company)`,
      );
    const label = company && company.length >= 3 ? squash(company) : undefined;
    if (label) {
      const subject = text(thread.thread?.subject);
      if (subject && squash(subject).includes(label))
        hints.push(`Company named in the subject: "${subject.slice(0, 160)}"`);
      // The sender's own name line may share the company's name.
      const name = sender.name ? squash(sender.name) : undefined;
      const signature = signatureLines(sender.body).find(
        (line) => squash(line).includes(label) && squash(line) !== name,
      );
      if (signature)
        hints.push(
          `Company named in the sender's signature: "${signature.slice(0, 160)}"`,
        );
    }
  }
  const request = thread.request ?? thread.addressedRequest;
  const clientName = text(thread.client?.name);
  if (!thread.client && !request) {
    hints.push("Not linked to a client or procurement request.");
  } else {
    if (thread.client)
      hints.push(
        `Linked client: ${clientName ?? "unnamed"} (${String(thread.client._id)})`,
      );
    else hints.push("Not linked to a client.");
    if (request)
      hints.push(
        `${thread.request ? "Linked" : "Addressed to"} procurement request: ${
          text(request.title) ?? "untitled"
        } (${String(request.requestId)})`,
      );
    else hints.push("Not linked to a procurement request.");
  }
  return hints;
}

const linkedClient: OperatorIntentPrefetchRead["input"] = ({ results }) => {
  const thread = results.get("get_team_inbox_thread") as
    | TeamThreadRead
    | undefined;
  const orgId = thread?.client?._id;
  return typeof orgId === "string" ? { orgId } : undefined;
};

export const emailPageContexts: readonly OperatorPageContextEntry[] = [
  {
    pageTypes: ["team_email_thread"],
    noun: "email conversation",
    families: ["team_inbox"],
    prefetch: [
      [
        {
          toolName: "get_team_inbox_thread",
          input: ({ focus }) =>
            focus.entityId
              ? { teamEmailThreadId: focus.entityId, view: "full" }
              : undefined,
        },
      ],
      [
        {
          toolName: "get_procurement_request",
          input: (state) => {
            const input = linkedProcurementRequest(state);
            return input ? { ...input, view: "summary" } : undefined;
          },
        },
        { toolName: "get_organization", input: linkedClient },
      ],
    ],
    hints: (results) =>
      teamEmailThreadHints(results.get("get_team_inbox_thread")),
  },
];
