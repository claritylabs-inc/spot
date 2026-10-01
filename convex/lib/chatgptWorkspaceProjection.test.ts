import { expect, test } from "vitest";
import {
  parseMcpToolResult,
  projectSpotWorkspaceData,
} from "./chatgptWorkspaceProjection";

test("parses structured and JSON-text MCP results without retaining the envelope", () => {
  expect(
    parseMcpToolResult({
      content: [{ type: "text", text: JSON.stringify({ policies: [{ id: "p1" }] }) }],
    }),
  ).toEqual({ policies: [{ id: "p1" }] });
  expect(
    parseMcpToolResult({ structuredContent: { result: { id: "p2" } } }),
  ).toEqual({ result: { id: "p2" } });
  expect(parseMcpToolResult({ isError: true, content: [{ type: "text", text: "secret" }] })).toBeNull();
});

test("projects client display data while preserving citations, revisions, actions, and arbitrary coverage maps", () => {
  const projected = projectSpotWorkspaceData(
    "policies",
    {
      _id: "policy-1",
      carrier: "Acme",
      policyNumber: "P-1",
      effectiveDate: "2026-01-01",
      expirationDate: "2027-01-01",
      coverages: [
        {
          unknownCoverageKey: {
            limit: 1000000,
            citation: { pageNumber: 4, quote: "covered" },
          },
        },
      ],
      sourceSpanIds: ["span-1"],
      revision: 3,
      nextAction: { actionId: "action-1", label: "Review" },
      storageUrl: "https://storage.example/secret",
      privateMarkdown: "operator only",
      proposals: [{ proposalId: "proposal-1" }],
      marketActivity: [{ activityId: "activity-1" }],
      apiKey: "secret",
    },
    "client",
  );

  expect(projected).toMatchObject({
    _id: "policy-1",
    carrier: "Acme",
    policyNumber: "P-1",
    coverages: [
      {
        unknownCoverageKey: {
          limit: 1000000,
          citation: { pageNumber: 4, quote: "covered" },
        },
      },
    ],
    sourceSpanIds: ["span-1"],
    revision: 3,
    nextAction: { actionId: "action-1", label: "Review" },
  });
  expect(projected).not.toHaveProperty("storageUrl");
  expect(projected).not.toHaveProperty("privateMarkdown");
  expect(projected).not.toHaveProperty("proposals");
  expect(projected).not.toHaveProperty("marketActivity");
  expect(projected).not.toHaveProperty("apiKey");
});

test("broker projections fail closed outside profile, team, and settings", () => {
  expect(
    projectSpotWorkspaceData("policies", { policies: [{ id: "p1" }] }, "broker"),
  ).toBeNull();
  expect(
    projectSpotWorkspaceData(
      "profile",
      {
        networkStatus: "active",
        lineOfBusinessCodes: ["CGL"],
        secret: "no",
      },
      "broker",
    ),
  ).toEqual({ networkStatus: "active", lineOfBusinessCodes: ["CGL"] });
});

test("operator projections may retain proposal evidence but still strip credentials and storage URLs", () => {
  const projected = projectSpotWorkspaceData(
    "proposals",
    {
      proposalId: "proposal-1",
      extractionFingerprint: "fingerprint-1",
      reviews: [{ sourceNodeIds: ["node-1"], conclusion: "meets" }],
      privateMarkdown: "operator-only notes",
      storageUrl: "https://storage.example/secret",
      encryptedCredential: "secret",
    },
    "operator",
  );

  expect(projected).toMatchObject({
    proposalId: "proposal-1",
    extractionFingerprint: "fingerprint-1",
    reviews: [{ sourceNodeIds: ["node-1"], conclusion: "meets" }],
    privateMarkdown: "operator-only notes",
  });
  expect(projected).not.toHaveProperty("storageUrl");
  expect(projected).not.toHaveProperty("encryptedCredential");
});

