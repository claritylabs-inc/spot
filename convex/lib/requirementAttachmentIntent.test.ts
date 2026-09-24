import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import {
  decideRequirementAttachmentImport,
  validateRequirementAttachmentDecision,
} from "./requirementAttachmentIntent";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const file = (filename: string, id = filename) => ({
  filename,
  contentType: "application/pdf",
  fileId: id as Id<"_storage">,
});

describe("requirement attachment decisions", () => {
  it("auto-authorizes only explicit, high-confidence, exact requirement sources", () => {
    const source = file("Program Manager Agreement.pdf", "agreement");
    expect(
      validateRequirementAttachmentDecision(
        {
          intent: "analyze_new_requirements",
          intentEvidence: "check whether we meet this attached agreement",
          scope: "own_org",
          selectedFileIds: ["agreement"],
          documents: [
            {
              fileId: "agreement",
              classification: "insurance_requirements",
              confidence: 0.98,
            },
          ],
          confidence: 0.96,
        },
        [source],
      ),
    ).toMatchObject({
      authorization: "auto",
      attachments: [source],
      scope: "own_org",
    });
  });

  it("never selects a policy classified as a requirement source", () => {
    expect(
      validateRequirementAttachmentDecision(
        {
          intent: "analyze_new_requirements",
          intentEvidence: "compare this policy with saved requirements",
          scope: "own_org",
          selectedFileIds: ["policy"],
          documents: [
            {
              fileId: "policy",
              classification: "insurance_policy",
              confidence: 0.99,
            },
          ],
          confidence: 0.99,
        },
        [file("Zurich E&O Policy.pdf", "policy")],
      ).attachments,
    ).toEqual([]);
  });

  it("rejects selected IDs that were not supplied by the server", () => {
    expect(
      validateRequirementAttachmentDecision(
        {
          intent: "import_new_requirements",
          intentEvidence: "import requirements",
          scope: "vendors",
          selectedFileIds: ["fabricated"],
          documents: [
            {
              fileId: "fabricated",
              classification: "insurance_requirements",
              confidence: 1,
            },
          ],
          confidence: 1,
        },
        [file("Requirements.pdf", "real")],
      ).authorization,
    ).toBe("none");
  });
});

describe("Jev source and recipient decisions", () => {
  const ctx = {} as ActionCtx;
  const orgId = "org" as Id<"organizations">;
  const respond = (
    answers: Awaited<ReturnType<typeof clRouterDecide>>["answers"],
  ) => {
    vi.mocked(clRouterDecide).mockResolvedValueOnce({
      contractVersion: 1,
      requestId: "decision",
      model: "jev-1.13.0",
      answers,
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: { status: "unpriced", costNanoUsd: null },
      durationMs: 1,
    });
  };
  const choice = (value: string, probability: number) => ({
    type: "choice" as const,
    choice: value,
    probabilities: { [value]: probability },
    confidence: 1,
  });

  it("requires confirmation at 0.69 and auto-authorizes at 0.70", async () => {
    const attachment = file("Requirements.pdf", "source");
    for (const probability of [0.69, 0.7]) {
      respond({
        intent: choice("import_new_requirements", 0.99),
        scope: choice("vendors", 0.99),
        document_0: choice("insurance_requirements", probability),
      });
      expect(await decideRequirementAttachmentImport(ctx, {
        orgId,
        messageText: "Import these requirements",
        attachments: [attachment],
      })).toMatchObject({
        authorization: probability < 0.7 ? "confirmation" : "auto",
        attachments: [attachment],
      });
    }
  });

});
