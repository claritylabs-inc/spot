import { describe, expect, test } from "vitest";
import { SupplementarySchema } from "./supplementaryExtraction";

describe("SupplementarySchema", () => {
  test("parses a full result with contacts, notice periods, and auxiliary facts", () => {
    const parsed = SupplementarySchema.parse({
      regulatoryContacts: [
        {
          name: "State Department of Insurance",
          phone: "555-0100",
          sourceSpanIds: ["span-1"],
        },
      ],
      claimsContacts: [
        {
          name: "Claims Department",
          phone: "555-0200",
          hours: "9am-5pm",
          sourceSpanIds: ["span-2"],
        },
      ],
      thirdPartyAdministrators: [
        { name: "TPA Co", email: "claims@tpa.example", sourceSpanIds: ["span-3"] },
      ],
      cancellationNoticeDays: 30,
      nonrenewalNoticeDays: 60,
      auxiliaryFacts: [
        { key: "policyholder_age", value: "45", subject: "John Doe", context: "Named Insured" },
      ],
    });

    expect(parsed.cancellationNoticeDays).toBe(30);
    expect(parsed.auxiliaryFacts?.[0]?.key).toBe("policyholder_age");
  });

  test("allows an entirely empty result", () => {
    expect(SupplementarySchema.parse({})).toEqual({});
  });

  test("rejects a contact without sourceSpanIds", () => {
    const result = SupplementarySchema.safeParse({
      claimsContacts: [{ name: "Claims Department" }],
    });
    expect(result.success).toBe(false);
  });
});
