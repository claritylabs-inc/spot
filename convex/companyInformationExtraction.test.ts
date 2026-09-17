import { expect, test } from "vitest";
import {
  CompanyInformationExtractionSchema,
  sanitizeCompanyInformationExtraction,
} from "./lib/companyInformationExtraction";

test("new company extraction emits narrative only", () => {
  const result = sanitizeCompanyInformationExtraction(
    CompanyInformationExtractionSchema.parse({
      organizationFacts: [
        {
          section: "operations",
          content: "Cove develops software.",
          confidence: 1,
        },
        { section: "profile", content: "Unsupported fact.", confidence: 0.5 },
      ],
    }),
  );
  expect(result).toEqual({
    organizationFacts: [
      {
        section: "operations",
        content: "Cove develops software.",
        confidence: 1,
      },
    ],
  });
});
