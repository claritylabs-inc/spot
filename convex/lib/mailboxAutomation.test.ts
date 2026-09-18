import { describe, expect, test } from "vitest";
import type { DecideResponse } from "@claritylabs/cl-router-policy";
import {
  applyMailboxAutomationJudgments,
  canAutoExecuteMailboxDecision,
} from "./mailboxAutomation";

const extracted = {
  emailRef: "1",
  reason: "Observed source facts",
  policyGroups: [{ filenames: ["policy.pdf"] }],
  requirementFilenames: ["lease.pdf"],
  attentionTitle: null,
  attentionBody: null,
};
const attachments = ["policy.pdf", "lease.pdf"].map((filename) => ({
  filename,
  contentType: "application/pdf",
}));
function answers(
  category: string,
  source = "lease_agreement",
  scope = "own_org",
): DecideResponse["answers"] {
  const choice = (value: string) => ({
    type: "choice" as const,
    choice: value,
    confidence: 0.99,
    probabilities: { [value]: 0.99 },
  });
  return {
    "1_classification": choice(category),
    "1_body": { type: "noul", noul: 0.99 },
    "1_memory": { type: "noul", noul: 0.99 },
    "1_source": choice(source),
    "1_scope": choice(scope),
  };
}

describe("mailbox automation judgments", () => {
  test("extracted attachments cannot authorize imports rejected by the category decision", () => {
    const decision = applyMailboxAutomationJudgments(
      extracted,
      answers("company_context"),
      attachments,
    )!;
    expect(canAutoExecuteMailboxDecision(decision)).toBe(true);
    expect(decision.policyGroups).toEqual([]);
    expect(decision.requirementFilenames).toEqual([]);
    expect(decision.includeEmailBodyAsRequirements).toBe(false);
    expect(decision.extractCompanyMemory).toBe(true);
  });

  test("a requirement decision cannot authorize an extracted policy import or company memory", () => {
    const decision = applyMailboxAutomationJudgments(
      extracted,
      answers("insurance_requirements"),
      attachments,
    )!;
    expect(canAutoExecuteMailboxDecision(decision)).toBe(true);
    expect(decision.policyGroups).toEqual([]);
    expect(decision.requirementFilenames).toEqual(["lease.pdf"]);
    expect(decision.includeEmailBodyAsRequirements).toBe(true);
    expect(decision.extractCompanyMemory).toBe(false);
  });

  test.each([
    ["none", "own_org"],
    ["lease_agreement", "none"],
  ])(
    "missing requirement source or destination blocks unattended import (%s, %s)",
    (source, scope) => {
      const decision = applyMailboxAutomationJudgments(
        extracted,
        answers("insurance_requirements", source, scope),
        attachments,
      )!;
      expect(canAutoExecuteMailboxDecision(decision)).toBe(false);
    },
  );

  test("multiple requires concrete source and destination before importing both categories", () => {
    const decision = applyMailboxAutomationJudgments(
      extracted,
      answers("multiple"),
      attachments,
    )!;
    expect(canAutoExecuteMailboxDecision(decision)).toBe(true);
    expect(decision.policyGroups).toEqual(extracted.policyGroups);
    expect(decision.requirementFilenames).toEqual(
      extracted.requirementFilenames,
    );
    const missingSource = applyMailboxAutomationJudgments(
      extracted,
      answers("multiple", "none"),
      attachments,
    )!;
    expect(canAutoExecuteMailboxDecision(missingSource)).toBe(false);
  });

  test("uncertain memory and requirement body decisions do not enable those actions", () => {
    const judgments = answers("multiple");
    judgments["1_body"] = { type: "noul", noul: 0.8 };
    judgments["1_memory"] = { type: "noul", noul: 0.8 };
    const decision = applyMailboxAutomationJudgments(
      extracted,
      judgments,
      attachments,
    )!;
    expect(decision.includeEmailBodyAsRequirements).toBe(false);
    expect(decision.extractCompanyMemory).toBe(false);
  });
});
