"use node";
import { v } from "convex/values";
import dayjs from "dayjs";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  clRouterCapabilities,
  clRouterResearchBatch,
} from "../lib/clRouterClient";
import {
  CLIENT_PROFILE_FIELDS,
  type ClientProfileField,
} from "../lib/clientProfileBatchResearch";
import {
  groundResearchCandidates,
  publicResearchCitations,
  verifyResearchCandidates,
  type ResearchCitation,
} from "../lib/publicResearchVerification";
import { routerResearchConfigured } from "../lib/routerCapabilities";
import { durableRouterClientOptionsWithTrace } from "../lib/routerJobClient";

// One `research_batch` job, then per-client grounding and verification, all
// inside the action's ten minutes. A lost action leaves the leases to the
// company research watchdog.
const RESEARCH_BUDGET_MS = 300_000;
const GROUNDING_UNTIL_MS = 450_000;
const VERIFICATION_UNTIL_MS = 480_000;
const CLIENT_CONCURRENCY = 10;
const GROUNDING_CONCURRENCY = 3;
const OBJECTIVE =
  "Research each company's public profile from public sources about that exact company, preferring its own website and government registries or regulators, then reputable business news. Use only facts published about this company, never a similarly named one or an industry norm. Return null rather than guess, and cite the page that states each answer.";

type Candidate = {
  field: ClientProfileField;
  answer: string;
  content: string;
  citations: ResearchCitation[];
};

const entityValidator = v.object({
  name: v.string(),
  website: v.optional(v.string()),
  location: v.optional(v.string()),
});

export const run = internalAction({
  args: {
    items: v.array(
      v.object({
        orgId: v.id("organizations"),
        leaseId: v.string(),
        fingerprint: v.string(),
        entity: entityValidator,
      }),
    ),
  },
  handler: async (ctx, { items }): Promise<null> => {
    const started = dayjs().valueOf();
    const trace = { traceId: `client-profile-batch:${crypto.randomUUID()}` };
    // Spot-owned codes; terminal, so a failed batch is not retried per client.
    const fail = (item: (typeof items)[number], error: string) =>
      ctx.runMutation(internal.companyResearch.fail, {
        orgId: item.orgId,
        leaseId: item.leaseId,
        error,
        retry: false,
      });

    let stage = "capabilities";
    let response: Awaited<ReturnType<typeof clRouterResearchBatch>>;
    try {
      const configured = await clRouterCapabilities()
        .then(routerResearchConfigured)
        .catch(() => false);
      if (!configured) {
        await Promise.all(
          items.map((item) => fail(item, "research_unavailable")),
        );
        return null;
      }
      stage = "research";
      response = await clRouterResearchBatch(
        {
          input: {
            objective: OBJECTIVE,
            fields: CLIENT_PROFILE_FIELDS.map((field) => ({
              key: field.key,
              description: field.description,
              type: field.type,
              ...(field.options ? { options: field.options } : {}),
            })),
            // Index keys: no Spot identifiers reach providers.
            entities: items.map((item, index) => ({
              key: `c${index}`,
              ...item.entity,
            })),
          },
          config: { depth: "standard" },
          executionBudgetMs: RESEARCH_BUDGET_MS,
        },
        durableRouterClientOptionsWithTrace(ctx, {
          ...trace,
          taskKind: "client_profile_batch_research",
        }),
      );
    } catch (error) {
      console.warn("[clientProfileBatchResearch] failed", {
        traceId: trace.traceId,
        stage,
        clients: items.length,
        error:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Unknown research failure",
      });
      await Promise.all(items.map((item) => fail(item, `${stage}_failed`)));
      return null;
    }

    const outcomes = { completed: 0, failed: 0, verified: 0 };
    let next = 0;
    const verifyClient = async (index: number) => {
      const item = items[index];
      const result = response.results[`c${index}`];
      if (result.status !== "completed" || !result.answers) {
        outcomes.failed++;
        await fail(item, "research_entity_failed");
        return;
      }
      if (dayjs().valueOf() - started > VERIFICATION_UNTIL_MS) {
        outcomes.failed++;
        await fail(item, "verification_timeout");
        return;
      }
      const answers = result.answers;
      try {
        const candidates = CLIENT_PROFILE_FIELDS.flatMap(
          (field): Candidate[] => {
            const found = answers[field.key];
            const content = found && field.format(found.value);
            if (
              !content ||
              (found.confidence !== "high" && found.confidence !== "medium")
            )
              return [];
            const citations = publicResearchCitations(found.citations);
            return citations.length
              ? [
                  {
                    field,
                    answer: String(found.value),
                    content,
                    citations,
                  },
                ]
              : [];
          },
        );
        const grounded = await groundResearchCandidates(ctx, candidates, {
          claim: (candidate) =>
            `${candidate.field.description} Company: ${item.entity.name}.`,
          taskKind: "client_profile_grounding",
          trace,
          concurrency: GROUNDING_CONCURRENCY,
          deadline: started + GROUNDING_UNTIL_MS,
        });
        const verified = await verifyResearchCandidates(ctx, {
          task: "client_profile_research_verification",
          trace,
          entity: item.entity,
          candidates: grounded,
          question: (candidate) => ({
            label: candidate.field.description,
            period: "latest published",
            ...(candidate.field.options
              ? { options: candidate.field.options }
              : {}),
          }),
          executionBudgetMs: 60_000,
        });
        await ctx.runMutation(internal.companyResearch.complete, {
          orgId: item.orgId,
          leaseId: item.leaseId,
          fingerprint: item.fingerprint,
          facts: verified.map((candidate) => ({
            key: candidate.field.section,
            content: candidate.content,
            sourceRef: candidate.citations[0].url,
          })),
          sourceUrls: verified.map((candidate) => candidate.citations[0].url),
          unresolvedFields: CLIENT_PROFILE_FIELDS.filter(
            (field) => !verified.some((candidate) => candidate.field === field),
          ).map((field) => field.key),
          supersedes: verified.map((candidate) => candidate.field.label),
        });
        outcomes.completed++;
        outcomes.verified += verified.length;
      } catch (error) {
        console.warn("[clientProfileBatchResearch] verification failed", {
          traceId: trace.traceId,
          orgId: item.orgId,
          error:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Unknown verification failure",
        });
        outcomes.failed++;
        await fail(item, "verification_failed");
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(CLIENT_CONCURRENCY, items.length) },
        async () => {
          while (next < items.length) await verifyClient(next++);
        },
      ),
    );
    // Structural counts only; no evidence or answer text.
    console.info("[clientProfileBatchResearch] completed", {
      traceId: trace.traceId,
      provider: response.provider,
      clients: items.length,
      ...outcomes,
    });
    return null;
  },
});
