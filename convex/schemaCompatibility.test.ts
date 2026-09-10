import { describe, expect, test } from "vitest";
import schema from "./schema";

type RuntimeValidator = {
  fields?: Record<string, RuntimeValidator>;
  isOptional: "optional" | "required";
  kind: string;
  members?: RuntimeValidator[];
  tableName?: string;
  value?: unknown;
};

function fieldValidator(tableName: string, ...fieldPath: string[]) {
  let validator: RuntimeValidator | undefined = (
    schema.tables as Record<
      string,
      { validator: RuntimeValidator }
    >
  )[tableName]?.validator;

  for (const fieldName of fieldPath) {
    validator = validator?.fields?.[fieldName];
  }

  expect(validator, `${tableName}.${fieldPath.join(".")}`).toBeDefined();
  return validator!;
}

function expectOptionalKind(
  tableName: string,
  fieldPath: string[],
  kind: string,
) {
  const validator = fieldValidator(tableName, ...fieldPath);
  expect(validator.isOptional).toBe("optional");
  expect(validator.kind).toBe(kind);
}

function literalValues(tableName: string, ...fieldPath: string[]) {
  const validator = fieldValidator(tableName, ...fieldPath);
  expect(validator.kind).toBe("union");
  return validator.members?.map((member) => member.value) ?? [];
}

describe("deployed schema compatibility", () => {
  test("keeps historical active-table fields at their exact stored types", () => {
    for (const fieldName of [
      "autoGenerateCoi",
      "autoSendEmails",
      "certificateChangeRequestsEnabled",
      "policyChangeRequestsEnabled",
    ]) {
      expectOptionalKind("organizations", [fieldName], "boolean");
    }
    expectOptionalKind("organizations", ["coiHandling"], "union");
    expect(literalValues("organizations", "coiHandling")).toEqual([
      "broker",
      "member",
      "ignore",
    ]);
    expectOptionalKind("policies", ["analysis"], "any");
    expectOptionalKind("threads", ["deliveryContactKey"], "string");

    const legacyRoute = fieldValidator(
      "globalModelSettings",
      "routes",
      "extraction_visual_table_repair",
    );
    expect(legacyRoute.isOptional).toBe("optional");
    expect(legacyRoute.kind).toBe("object");
    expect(legacyRoute.fields?.model.kind).toBe("string");
    expect(
      legacyRoute.fields?.provider.members?.map((member) => member.value),
    ).toEqual([
      "openai",
      "anthropic",
      "google",
      "xai",
      "mistral",
      "cohere",
      "fireworks",
      "moonshot",
      "deepseek",
    ]);
  });

  test("accepts exact historical policy-change IDs without declaring retired tables", () => {
    for (const [tableName, fieldName] of [
      ["appCardAccessLinks", "policyChangeCaseId"],
      ["certificateRequestHolds", "policyChangeCaseId"],
      ["pendingEmails", "policyChangeCaseId"],
      ["policyUpdateRuns", "caseId"],
      ["policyVersions", "caseId"],
      ["threadMessages", "policyChangeCaseId"],
    ]) {
      const validator = fieldValidator(tableName, fieldName);
      expect(validator.isOptional).toBe("optional");
      expect(validator.kind).toBe("id");
      expect(validator.tableName).toBe("policyChangeCases");
    }

    expect(Object.keys(schema.tables)).not.toContain("policyChangeCases");
    for (const tableName of [
      "apiAuditLog",
      "apiKeys",
      "caseEvidenceLinks",
      "caseMessages",
      "caseValidationReports",
      "pcePackets",
    ]) {
      expect(Object.keys(schema.tables)).not.toContain(tableName);
    }
  });

  test("keeps historical literals valid only on their owning active fields", () => {
    expect(literalValues("appCardAccessLinks", "kind")).toContain(
      "policy_change",
    );
    expect(literalValues("certificateRequestHolds", "status")).toContain(
      "policy_change_opened",
    );
    expect(literalValues("notifications", "type")).toEqual(
      expect.arrayContaining([
        "merge_suggestion",
        "policy_declaration_discrepancy",
        "policy_change_needs_info",
        "policy_change_completed",
      ]),
    );
  });

  test("preserves optional expiry and Slack revocation state", () => {
    for (const [tableName, fieldName] of [
      ["emailDraftReviewLinks", "expiresAt"],
      ["operatorAgentConfirmations", "expiresAt"],
      ["procurementPacketLinks", "expiresAt"],
      ["slackMessagePresentations", "actionTokenExpiresAt"],
      ["threadActionConfirmations", "expiresAt"],
    ]) {
      expectOptionalKind(tableName, [fieldName], "float64");
    }
    expectOptionalKind(
      "slackMessagePresentations",
      ["actionTokenRevokedAt"],
      "float64",
    );
  });
});
