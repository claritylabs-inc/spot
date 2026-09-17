// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  DecideRequest,
  DecisionAnswer,
} from "@claritylabs/cl-router-policy";
import schema from "../schema";
import { api, internal } from "../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");
const source =
  "Vendors must carry commercial general liability insurance with $1,000,000 each occurrence.";
const requirement = {
  scope: "vendors" as const,
  title: "General liability",
  requirementText: source,
  lineOfBusiness: "CGL",
  limits: [
    {
      kind: "per_occurrence",
      amount: 1000000,
      label: "$1,000,000 each occurrence",
    },
  ],
  maxDeductible: null,
  coverageForm: null,
  retroactiveDateOnOrBefore: null,
  provisions: null,
  requiredForms: null,
  sourceExcerpt: source,
  sourcePageStart: null as number | null,
  sourcePageEnd: null as number | null,
};
const holder = {
  displayName: "Owner LLC",
  contactName: null,
  email: null,
  phone: null,
  address: null,
  sourceExcerpt: "Certificate holder: Owner LLC.",
};
type Candidate = {
  requirements: (typeof requirement)[];
  certificateHolders: (typeof holder)[];
};
const candidate = (): Candidate => ({
  requirements: [structuredClone(requirement)],
  certificateHolders: [],
});

function configure(
  mode: "legacy" | "shadow" | "active",
  family = "requirements.import_verification",
) {
  vi.stubEnv(
    "SPOT_DECISION_POLICY",
    JSON.stringify({
      mode,
      timeoutMs: 5000,
      families: {
        [family]: { threshold: 0.95, evaluationId: "test-fixture-only" },
      },
    }),
  );
}

function mockRouter(
  options: {
    initial?: Candidate;
    repaired?: Candidate;
    answer?: (
      id: string,
      request: DecideRequest,
      call: number,
    ) => DecisionAnswer;
    onDecide?: () => void;
    decisionError?: boolean;
    pdfText?: string;
  } = {},
) {
  const generations: string[] = [];
  const decisions: DecideRequest[] = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/liteparse/convert") && options.pdfText) {
        return Response.json({ text: options.pdfText, sourceSpans: [] });
      }
      expect(String(url)).toMatch(
        /^https:\/\/router\.example\.test\/v1\/(generate|decide)$/,
      );
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer router-test-secret",
      });
      expect(body.tenantId).toBe("glass");
      expect(Buffer.byteLength(String(init?.body))).toBeLessThan(
        4 * 1024 * 1024,
      );
      if (String(url).endsWith("/decide")) {
        decisions.push(body);
        options.onDecide?.();
        if (options.decisionError) throw new Error("transport unavailable");
        return Response.json({
          contractVersion: 1,
          requestId: `decision-${decisions.length}`,
          model: "jev-1.13.0",
          answers: Object.fromEntries(
            Object.keys(body.questions).map((id) => [
              id,
              options.answer?.(id, body, decisions.length) ?? {
                type: "noul",
                noul: 0.99,
              },
            ]),
          ),
          usage: { inputTokens: 10, outputTokens: 4 },
          cost: { status: "unpriced", costNanoUsd: null },
          durationMs: 1,
        });
      }
      generations.push(String(init?.body));
      return Response.json({
        requestId: `extraction-${generations.length}`,
        model: { provider: "openai", model: "gpt-5-mini" },
        routing: {
          decision: "policy",
          candidatesConsidered: [],
          policyVersion: null,
          cacheStickinessApplied: false,
          attemptCount: 1,
          routeSource: "static",
        },
        usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 0 },
        costUsd: null,
        costStatus: "unpriced",
        output:
          generations.length === 1
            ? (options.initial ?? candidate())
            : (options.repaired ?? candidate()),
      });
    },
  );
  vi.stubGlobal("fetch", fetch);
  return { fetch, generations, decisions };
}

async function fixture(role: "admin" | "member" = "admin") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      name: "Admin",
      email: "admin@example.test",
    });
    await ctx.db.insert("orgMemberships", { orgId, userId, role });
    return { orgId, userId };
  });
  const viewer = t.withIdentity({ subject: `${ids.userId}|session` });
  const run = (pastedText = source) =>
    viewer.action(api.actions.complianceRequirements.importRequirements, {
      orgId: ids.orgId,
      pastedText,
    });
  const saved = () =>
    t.run(async (ctx) => ({
      requirements: await ctx.db.query("insuranceRequirements").collect(),
      sources: await ctx.db.query("requirementSourceDocuments").collect(),
      holders: await ctx.db.query("certificateHolders").collect(),
      runs: await ctx.db.query("requirementExtractionRuns").collect(),
    }));
  return { t, viewer, ...ids, run, saved };
}

beforeEach(() => {
  vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
  vi.stubEnv("CL_ROUTER_SECRET", "router-test-secret");
  configure("active");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requirement import source verification through public actions", () => {
  test.each(["legacy", "shadow"] as const)(
    "%s preserves established extraction without repair",
    async (mode) => {
      configure(mode);
      const router = mockRouter({
        answer: () => ({ type: "noul", noul: 0.01 }),
      });
      const f = await fixture();
      expect((await f.run()).createdCount).toBe(1);
      expect(router.generations).toHaveLength(1);
      expect(router.decisions).toHaveLength(mode === "shadow" ? 1 : 0);
      expect((await f.saved()).requirements[0].limits?.[0].amount).toBe(
        1000000,
      );
    },
  );

  test("another active family does not qualify import verification", async () => {
    configure("active", "compliance.requirement_evidence");
    const router = mockRouter();
    const f = await fixture();
    await f.run();
    expect(router.decisions).toHaveLength(0);
    expect(router.generations).toHaveLength(1);
  });

  test("active success persists normalized rows and retains exact typed deduplication", async () => {
    const router = mockRouter();
    const f = await fixture();
    expect((await f.run()).createdCount).toBe(1);
    expect((await f.run()).createdCount).toBe(0);
    const saved = await f.saved();
    expect(saved.requirements).toHaveLength(1);
    expect(saved.sources).toHaveLength(2);
    expect(saved.runs.every((run) => run.status === "complete")).toBe(true);
    expect(router.decisions[0].task).toBe("requirements.import_verification");
    expect(router.decisions[0].state).toMatchObject({
      sourceText: source,
      requestedScope: "vendors",
    });
  });

  test.each([0.5, 0.01])(
    "uncertainty or negative support (%s) repairs once and reverifies changed rows",
    async (probability) => {
      const initial = candidate();
      initial.requirements[0].limits[0].amount = 2000000;
      const router = mockRouter({
        initial,
        answer: (id, _request, call) => ({
          type: "noul",
          noul: id === "support_0" && call === 1 ? probability : 0.99,
        }),
      });
      const f = await fixture();
      await f.run();
      expect(router.generations).toHaveLength(2);
      expect(router.decisions).toHaveLength(2);
      expect(router.generations[1]).toContain("support_0");
      expect(router.decisions[1].state).toMatchObject({
        candidate: {
          requirements: [
            expect.objectContaining({
              limits: [expect.objectContaining({ amount: 1000000 })],
            }),
          ],
        },
      });
      expect((await f.saved()).requirements[0].limits?.[0].amount).toBe(
        1000000,
      );
    },
  );

  test.each(["scope_0", "conditions_0", "omissions_0", "holder_0"])(
    "unresolved %s blocks all source, holder, and requirement writes",
    async (failed) => {
      const initial = { ...candidate(), certificateHolders: [holder] };
      const router = mockRouter({
        initial,
        repaired: initial,
        answer: (id) => ({ type: "noul", noul: id === failed ? 0.01 : 0.99 }),
      });
      const f = await fixture();
      await expect(f.run(`${source}\n${holder.sourceExcerpt}`)).rejects.toThrow(
        "needs review",
      );
      const saved = await f.saved();
      expect(saved.requirements).toEqual([]);
      expect(saved.sources).toEqual([]);
      expect(saved.holders).toEqual([]);
      expect(saved.runs[0].status).toBe("error");
      expect(router.generations).toHaveLength(2);
    },
  );

  test.each(["quote", "page"])(
    "fabricated %s references require repair before decision acceptance",
    async (kind) => {
      const initial = candidate();
      if (kind === "quote")
        initial.requirements[0].sourceExcerpt = "invented quote";
      else initial.requirements[0].sourcePageStart = 9;
      const router = mockRouter({ initial });
      const f = await fixture();
      await f.run();
      expect(router.generations).toHaveLength(2);
      expect(router.decisions).toHaveLength(1);
      expect((await f.saved()).requirements[0].sourceExcerpt).toBe(source);
    },
  );

  test("malformed answers and failed transport cannot authorize an import", async () => {
    const router = mockRouter({ answer: () => ({ type: "noul", noul: 2 }) });
    const f = await fixture();
    await expect(f.run()).rejects.toThrow("needs review");
    expect(router.generations).toHaveLength(2);
    expect((await f.saved()).sources).toEqual([]);
  });

  test("transport failure retains one reasoning attempt and stops unresolved import", async () => {
    const router = mockRouter({ decisionError: true });
    const f = await fixture();
    await expect(f.run()).rejects.toThrow("needs review");
    expect(router.generations).toHaveLength(2);
    expect((await f.saved()).requirements).toEqual([]);
  });

  test("cancellation during verification starts no repair and writes no source", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const router = mockRouter({ onDecide: () => controller.abort() });
    const f = await fixture();
    await expect(f.run()).rejects.toThrow();
    expect(router.generations).toHaveLength(1);
    expect((await f.saved()).sources).toEqual([]);
  });

  test("reverse audit retains source beyond the extraction prefix and repairs a tail omission", async () => {
    const tail =
      "Vendors must carry automobile liability insurance with $1,000,000 each occurrence.";
    const fullSource = `${source}\n${"Background. ".repeat(4000)}\n${tail}`;
    const repaired = candidate();
    repaired.requirements.push({
      ...requirement,
      title: "Auto liability",
      lineOfBusiness: "AUTOB",
      requirementText: tail,
      sourceExcerpt: tail,
    });
    const router = mockRouter({
      repaired,
      answer: (id, _request, call) => ({
        type: "noul",
        noul: id.startsWith("omissions_") && call === 1 ? 0.01 : 0.99,
      }),
    });
    const f = await fixture();
    expect((await f.run(fullSource)).createdCount).toBe(2);
    expect(router.generations[0]).not.toContain(tail);
    expect(router.generations[1]).toContain(tail);
    expect(router.decisions[0].state).toMatchObject({ sourceText: fullSource });
    expect((await f.saved()).runs[0].sourceCharacterCount).toBe(
      fullSource.length,
    );
  });

  test("filtered candidates do not hide source obligations from the reverse audit", async () => {
    const initial = candidate();
    initial.requirements[0].limits = [];
    const router = mockRouter({
      initial,
      answer: (_id, _request, call) => ({
        type: "noul",
        noul: call === 1 ? 0.01 : 0.99,
      }),
    });
    const f = await fixture();
    await f.run();
    expect(router.decisions[0].state).toMatchObject({
      candidate: { requirements: [] },
    });
    expect((await f.saved()).requirements).toHaveLength(1);
  });

  test("oversized verification uses bounded full-source reasoning then requires review", async () => {
    const router = mockRouter();
    const f = await fixture();
    const fullSource = `${source}\n${"a".repeat(120000)}\nTail obligation`;
    await expect(f.run(fullSource)).rejects.toThrow("needs review");
    expect(router.decisions).toHaveLength(0);
    expect(router.generations).toHaveLength(2);
    expect(router.generations[1]).toContain("Tail obligation");
    expect((await f.saved()).sources).toEqual([]);
  });

  test("reasoning body ceiling rejects oversize full source without silently truncating it", async () => {
    const router = mockRouter();
    const f = await fixture();
    await expect(f.run(`${source}\n${"é".repeat(600000)}`)).rejects.toThrow(
      "reasoning request budget",
    );
    expect(router.generations).toHaveLength(1);
    expect(router.decisions).toHaveLength(0);
    expect((await f.saved()).sources).toEqual([]);
  });

  test("PDF verifier receives parser text beyond 40k and internal imports use the same gate", async () => {
    const fullSource = `${source}\n${"Background. ".repeat(4000)}\nPDF tail obligation`;
    vi.stubEnv("EXTRACTION_WORKER_URL", "https://parser.example.test");
    vi.stubEnv("EXTRACTION_WORKER_SECRET", "parser-test-secret");
    const router = mockRouter({ pdfText: fullSource });
    const f = await fixture();
    const fileId = await f.t.run(async (ctx) =>
      ctx.storage.store(new Blob(["fixture PDF"], { type: "application/pdf" })),
    );
    await f.t.action(
      internal.actions.complianceRequirements.importRequirementsInternal,
      {
        orgId: f.orgId,
        userId: f.userId,
        fileId,
        fileName: "requirements.pdf",
      },
    );
    expect(router.decisions[0].state).toMatchObject({ sourceText: fullSource });
    expect((await f.saved()).runs[0].parserBackend).toBe("liteparse");
  });

  test("unauthorized callers never reach either model or persistence", async () => {
    const router = mockRouter();
    const f = await fixture("member");
    await expect(f.run()).rejects.toThrow();
    expect(router.fetch).not.toHaveBeenCalled();
    expect((await f.saved()).runs).toEqual([]);
  });
});
