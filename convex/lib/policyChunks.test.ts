import { describe, expect, test } from "vitest";
// Parity test only — production code must use chunkPolicyDocument, not this.
import { chunkDocument } from "@claritylabs/cl-sdk";
import type { InsuranceDocument } from "@claritylabs/cl-sdk";
import { chunkPolicyDocument } from "./policyChunks";

function fixture(): InsuranceDocument {
  return {
    id: "policy-1",
    type: "policy",
    carrier: "Acme Insurance Co",
    carrierLegalName: "Acme Insurance Company",
    carrierNaicNumber: "12345",
    mga: "Acme MGA",
    underwriter: "Jane Underwriter",
    brokerAgency: "Best Brokers LLC",
    security: "Acme Surplus Lines",
    linesOfBusiness: ["GL", "PROP"],
    summary: "General liability and property policy.",
    policyNumber: "GL-100-2026",
    effectiveDate: "2026-01-01",
    expirationDate: "2027-01-01",
    insuredName: "Example Corp",
    insuredDba: "Example Co",
    insuredFein: "12-3456789",
    insuredAddress: {
      street1: "1 Main St",
      city: "Springfield",
      state: "IL",
      zip: "62704",
    },
    additionalNamedInsureds: [
      { name: "Example Holdings LLC", relationship: "Parent" },
    ],
    insurer: {
      legalName: "Acme Insurance Company",
      naicNumber: "12345",
    },
    producer: {
      agencyName: "Best Brokers LLC",
      contactName: "Pat Broker",
    },
    coverages: [
      { name: "General Liability", limit: "$1,000,000", deductible: "$5,000" },
    ],
    enrichedCoverages: [
      {
        name: "Property",
        limit: "$2,000,000",
        included: true,
      },
    ],
    limits: {
      perOccurrence: "$1,000,000",
      generalAggregate: "$2,000,000",
      sublimits: [{ name: "Water Damage", limit: "$100,000" }],
      sharedLimits: [{ description: "Shared GL/Umbrella", limit: "$5,000,000", coverageParts: ["GL", "Umbrella"] }],
    },
    deductibles: {
      perOccurrence: "$5,000",
    },
    formInventory: [
      { formNumber: "CG 00 01", formType: "coverage", title: "Commercial General Liability Coverage Form" },
    ],
    endorsements: [
      { title: "Additional Insured Endorsement", endorsementType: "additional_insured", formNumber: "CG 20 10" },
    ],
    exclusions: [{ name: "Pollution Exclusion", content: "This policy does not cover pollution." }],
    conditions: [{ name: "Notice of Claim", conditionType: "notice", content: "Notify us promptly." }],
    declarations: { line: "GL", formType: "occurrence" },
    sections: [
      {
        title: "Coverage A",
        type: "coverage",
        pageStart: 1,
        pageEnd: 2,
        subsections: [{ title: "Insuring Agreement", pageNumber: 1 }],
      },
    ],
    locations: [
      {
        number: "1",
        address: { street1: "1 Main St", city: "Springfield", state: "IL", zip: "62704" },
        occupancy: "Office",
      },
    ],
    vehicles: [
      { number: "1", year: 2020, make: "Ford", model: "Transit", vin: "1FTBW2CM0LKA00000" },
    ],
    classifications: [
      { code: "8810", description: "Clerical Office Employees", premiumBasis: "payroll" },
    ],
    additionalInsureds: [{ name: "Landlord LLC", role: "additional_insured" }],
    lossPayees: [{ name: "Bank of Example" }],
    mortgageHolders: [{ name: "Example Mortgage Co" }],
    premium: "$10,000",
    totalCost: "$10,500",
    taxesAndFees: [{ name: "Surplus Lines Tax", amount: "$300" }],
    paymentPlan: { installments: [{ dueDate: "2026-01-01", amount: "$2,500" }] },
    premiumByLocation: [{ locationNumber: "1", premium: "$10,000" }],
    ratingBasis: [{ type: "payroll", amount: "$500,000" }],
    lossSummary: { period: "3 years", totalClaims: 2 },
    individualClaims: [
      { dateOfLoss: "2024-05-01", description: "Slip and fall", status: "closed" },
    ],
    experienceMod: { factor: 0.95 },
    claimsContacts: [{ name: "Claims Dept", phone: "555-0100", sourceSpanIds: ["s1"] }],
    regulatoryContacts: [{ name: "State DOI", phone: "555-0200", sourceSpanIds: ["s2"] }],
    thirdPartyAdministrators: [{ name: "TPA Co", phone: "555-0300", sourceSpanIds: ["s3"] }],
    cancellationNoticeDays: 30,
    nonrenewalNoticeDays: 60,
    supplementaryFacts: [{ key: "policyholder_age", value: "45", subject: "John Doe" }],
  } as unknown as InsuranceDocument;
}

describe("chunkPolicyDocument parity with cl-sdk chunkDocument", () => {
  test("produces identical chunks to cl-sdk 4.6.0 chunkDocument for a representative policy", () => {
    const doc = fixture();
    const expected = chunkDocument(doc);
    const actual = chunkPolicyDocument(doc);
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(20);
  });

  test("chunk ids are namespaced by document id and stay stable", () => {
    const doc = fixture();
    const chunks = chunkPolicyDocument(doc);
    for (const chunk of chunks) {
      expect(chunk.id.startsWith("policy-1:")).toBe(true);
      expect(chunk.documentId).toBe("policy-1");
    }
  });
});
