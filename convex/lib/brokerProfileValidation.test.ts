import { describe, expect, test } from "vitest";
import {
  assertExternalBrokerIdentity,
  isSpotOwnedDomain,
  SPOT_ACQUISITION_BRANDS,
} from "./brokerProfileValidation";
import {
  isOperatorDomainEmail,
  operatorEmailAliases,
} from "./operatorIdentity";

describe("Spot acquisition ownership", () => {
  test.each(SPOT_ACQUISITION_BRANDS)(
    "excludes $domain and its brand without granting operator identity",
    (brand) => {
      for (const value of [
        brand.domain,
        `https://WWW.${brand.domain.toUpperCase()}./about`,
        `quotes.${brand.domain}`,
        `hello@${brand.domain}`,
      ]) {
        expect(isSpotOwnedDomain(value)).toBe(true);
        expect(() => assertExternalBrokerIdentity({ website: value })).toThrow(
          "Spot-owned",
        );
      }
      expect(() => assertExternalBrokerIdentity({ name: brand.name })).toThrow(
        "Spot-owned",
      );
      expect(() => assertExternalBrokerIdentity({ name: brand.alias })).toThrow(
        "Spot-owned",
      );
      expect(isOperatorDomainEmail(`terry@${brand.domain}`)).toBe(false);
      expect(operatorEmailAliases(`terry@${brand.domain}`)).toEqual([]);
    },
  );

  test.each([
    "https://montgomeryrisk.com.example.org",
    "https://notmontgomeryrisk.com",
    "https://montgomeryrisk.com@external.example",
    "https://external.example/montgomeryrisk.com",
    "https://external.example/?next=https://montgomeryrisk.com",
    "hello@montgomeryrisk.com.example.org",
    "sansome.com", // The source ledger also lists domains that Spot does not own.
  ])("keeps distinct external domains eligible: %s", (website) => {
    expect(isSpotOwnedDomain(website)).toBe(false);
    expect(() =>
      assertExternalBrokerIdentity({ name: "External Broker", website }),
    ).not.toThrow();
  });
});
