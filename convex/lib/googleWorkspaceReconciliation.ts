import { z } from "zod";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import type { GoogleWorkspaceScanSourceEvidence } from "./googleWorkspaceScan";
import { completionOutcomeSchema } from "./procurementCompletionOutcome";
import { ORG_WIKI_SECTION_KEYS } from "./orgWiki";

dayjs.extend(customParseFormat);
const text = z.string().trim().min(1).max(200);
const calendar = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const identity = z.object({
  kind: z.enum(["client", "broker"]),
  name: text,
  contactEmail: z.email(),
  // A full physical address is an independent anchor for a new organization.
  address: z
    .object({ street1: text, city: text, state: text, zip: text })
    .nullable(),
});
const request = z.object({ title: text, coverage: text });
const evidence = {
  excerpt: z.string().min(1).max(4000),
  effectiveDate: calendar,
  identity,
  explanation: z.string().min(1).max(2000),
};
export const scanOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    ...evidence,
    kind: z.literal("create_organization"),
    website: z.url().nullable(),
  }),
  z.object({
    ...evidence,
    kind: z.literal("company_facts"),
    section: z.enum(ORG_WIKI_SECTION_KEYS),
    body: z.string().min(1).max(12000),
  }),
  z.object({
    ...evidence,
    kind: z.literal("broker_capabilities"),
    writingStates: z.array(text).max(60),
    lineOfBusinessCodes: z.array(text).max(60),
  }),
  z.object({
    ...evidence,
    kind: z.literal("create_request"),
    request,
    narrative: z.string().min(1).max(4000),
    targetEffectiveDate: calendar.nullable(),
  }),
  z.object({
    ...evidence,
    kind: z.literal("update_request"),
    request,
    targetEffectiveDate: calendar.nullable(),
    status: z
      .enum([
        "submitted",
        "gathering_information",
        "marketing",
        "proposal_review",
      ])
      .nullable(),
  }),
  z.object({
    ...evidence,
    kind: z.literal("external_placement"),
    request,
    completedPurchase: z.boolean(),
    noLongerNeeded: z.boolean(),
    outcome: completionOutcomeSchema,
  }),
  z.object({
    ...evidence,
    kind: z.literal("market_activity"),
    request,
    brokerIdentity: identity,
    log: z.string().min(1).max(6000),
  }),
  z.object({
    ...evidence,
    kind: z.literal("import_policy"),
    attachmentId: text,
    documentKind: z.enum(["bound_policy", "quote", "ambiguous"]),
    grouping: z.enum(["single_complete_policy", "ambiguous"]),
  }),
]);
export type ScanOperation = z.infer<typeof scanOperationSchema>;
export const scanExtractionSchema = z.object({
  operations: z.array(scanOperationSchema).max(12),
  attention: z
    .array(
      z.object({
        explanation: z.string().min(1).max(2000),
        excerpt: z.string().max(4000),
      }),
    )
    .max(12),
});
export type ScanExtraction = z.infer<typeof scanExtractionSchema>;
export class ScanAttention extends Error {}
export function normalizedIdentity(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
export function sourceEffectiveAt(
  operation: ScanOperation,
  source: GoogleWorkspaceScanSourceEvidence,
  body: string,
) {
  if (!source.bodyComplete || !body.includes(operation.excerpt))
    throw new ScanAttention(
      "Evidence excerpt is unavailable or source is incomplete",
    );
  const date = dayjs(operation.effectiveDate, "YYYY-MM-DD", true);
  if (
    !date.isValid() ||
    !source.internalDate ||
    date.startOf("day").valueOf() >
      dayjs(source.internalDate).endOf("day").valueOf()
  )
    throw new ScanAttention("Evidence chronology is ambiguous");
  if (
    !body.toLowerCase().includes(operation.identity.name.toLowerCase()) ||
    ![source.from, ...source.to, ...source.cc].some((value) =>
      value
        ?.toLowerCase()
        .includes(operation.identity.contactEmail.toLowerCase()),
    )
  )
    throw new ScanAttention(
      "Organization identity lacks a named participant anchor",
    );
  if (
    operation.kind === "external_placement" &&
    (!operation.completedPurchase || !operation.noLongerNeeded)
  )
    throw new ScanAttention(
      "Tentative purchase or continuing coverage need cannot complete a request",
    );
  if (
    operation.kind === "import_policy" &&
    (operation.documentKind !== "bound_policy" ||
      operation.grouping !== "single_complete_policy")
  )
    throw new ScanAttention(
      "Policy document identity or grouping requires review",
    );
  const sent = source.sentAt ? dayjs(source.sentAt) : null;
  if (!sent?.isValid() || sent.valueOf() > source.internalDate + 5 * 60_000)
    throw new ScanAttention(
      "Original message date is missing or conflicts with mailbox chronology",
    );
  const quoted = /(?:forwarded message|original message|^>)/im.test(
    body.slice(0, body.indexOf(operation.excerpt) + operation.excerpt.length),
  );
  if (quoted && !operation.excerpt.includes(operation.effectiveDate))
    throw new ScanAttention(
      "Forwarded or quoted evidence requires its own explicit effective date",
    );
  if (date.isAfter(sent, "day"))
    throw new ScanAttention("Evidence is dated after its original message");
  if (
    operation.kind === "create_organization" &&
    operation.identity.address &&
    Object.values(operation.identity.address).some(
      (value) => !operation.excerpt.toLowerCase().includes(value.toLowerCase()),
    )
  )
    throw new ScanAttention(
      "New organization address is not grounded in the cited evidence",
    );
  if (
    "request" in operation &&
    !operation.excerpt
      .toLowerCase()
      .includes(operation.request.coverage.toLowerCase())
  )
    throw new ScanAttention(
      "Cited evidence does not identify the exact coverage",
    );
  if (
    operation.kind === "external_placement" &&
    (!/\b(purchased|bought|completed (?:the )?purchase|have (?:now )?purchased)\b/i.test(
      operation.excerpt,
    ) ||
      !/\b(no longer need|do not need|don't need|cancel (?:this|the|my) request)\b/i.test(
        operation.excerpt,
      ) ||
      /\b(might|may|considering|plan to|planning to|if we|would buy|will buy)\b/i.test(
        operation.excerpt,
      ))
  )
    throw new ScanAttention(
      "Purchase completion and ending this exact request must be explicit",
    );
  if (
    (operation.kind === "company_facts" ||
      operation.kind === "create_request") &&
    /(?:ignore (?:all|previous)|system prompt|assistant|api key|password|private (?:market|broker)|broker commission)/i.test(
      operation.kind === "company_facts" ? operation.body : operation.narrative,
    )
  )
    throw new ScanAttention(
      "Client-visible content contains private or instructional material",
    );
  return !quoted && date.isSame(sent, "day")
    ? sent.valueOf()
    : date.startOf("day").valueOf();
}
export function assertNewerEvidence(
  effectiveAt: number,
  currentChangedAt: number,
  previousEffectiveAt?: number,
) {
  if (effectiveAt <= (previousEffectiveAt ?? currentChangedAt))
    throw new ScanAttention(
      "The record has newer or same-date evidence; review chronology before overwriting",
    );
}
export function assertUnchangedSnapshot(current: unknown, expected: string) {
  if (JSON.stringify(current) !== expected)
    throw new ScanAttention(
      "The target changed during analysis; retry to re-evaluate current values",
    );
}
