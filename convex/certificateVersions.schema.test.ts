/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("certificateVersions schema compatibility", () => {
  test("accepts current and legacy-linked certificate versions", async () => {
    const t = convexTest(schema, modules);

    const versions = await t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const orgId = await ctx.db.insert("organizations", {
        name: "Certificate schema fixture",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Fixture Carrier",
        policyNumber: "SCHEMA-1",
        linesOfBusiness: ["CGL"],
        documentType: "policy",
        policyYear: 2026,
        effectiveDate: "2026-01-01",
        expirationDate: "2027-01-01",
        isRenewal: false,
        coverages: [],
        insuredName: "Certificate schema fixture",
      });
      const holderId = await ctx.db.insert("certificateHolders", {
        orgId,
        displayName: "Fixture Holder",
        normalizedName: "fixture holder",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      });
      const certificateId = await ctx.db.insert("policyCertificates", {
        orgId,
        policyId,
        holderId,
        status: "active",
        dedupeKey: "certificate-schema-fixture",
        createdAt: now,
        updatedAt: now,
      });
      const fileId = await ctx.storage.store(
        new Blob(["synthetic certificate"], { type: "application/pdf" }),
      );
      const legacyCertificateId = await ctx.db.insert("certificates", {
        orgId,
        policyId,
        fileId,
        fileName: "legacy.pdf",
        createdAt: now,
      });
      const currentVersionId = await ctx.db.insert("certificateVersions", {
        orgId,
        certificateId,
        holderId,
        policyId,
        versionNumber: 1,
        status: "issued",
        createdAt: now,
        updatedAt: now,
      });
      const legacyVersionId = await ctx.db.insert("certificateVersions", {
        orgId,
        certificateId,
        holderId,
        policyId,
        versionNumber: 2,
        status: "superseded",
        legacyCertificateId,
        createdAt: now,
        updatedAt: now,
      });

      return {
        current: await ctx.db.get(currentVersionId),
        legacy: await ctx.db.get(legacyVersionId),
        legacyCertificateId,
      };
    });

    expect(versions.current).not.toHaveProperty("legacyCertificateId");
    expect(versions.legacy?.legacyCertificateId).toBe(
      versions.legacyCertificateId,
    );
  });
});
