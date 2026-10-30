/// <reference types="vite/client" />
// Failure modes: a client reads another request's suggestions, sees a
// medium-confidence suggestion, or confirms one outside an authorized form
// submission for its own request.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import dayjs from "dayjs";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function seedRequest(
  ctx: MutationCtx,
  name: string,
  clientUserId: Id<"users">,
) {
  const now = dayjs().valueOf();
  const orgId = await ctx.db.insert("organizations", { name, type: "client" });
  await ctx.db.insert("orgMemberships", {
    orgId,
    userId: clientUserId,
    role: "admin",
  });
  const requestId = await ctx.db.insert("procurementRequests", {
    title: `${name} renewal`,
    status: "gathering_information",
    clientOrgId: orgId,
    clientVisible: true,
    inboxToken: `${name}-token`,
    createdByUserId: clientUserId,
    updatedByUserId: clientUserId,
    createdAt: now,
    updatedAt: now,
  });
  const question = async (label: string) => {
    const questionId = await ctx.db.insert("procurementInformationQuestions", {
      requestId,
      question: {
        id: "provider_question",
        section: "additional",
        label,
        kind: "yes_no",
        options: [],
      },
      scope: { subject: "company", period: "current", coverage: "unknown" },
      createdByUserId: clientUserId,
      createdAt: now,
    });
    await ctx.db.insert("procurementInformationRequirements", {
      requestId,
      questionId,
      status: "needs_information",
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    return questionId;
  };
  const highQuestion = await question("Does the company sell online?");
  const mediumQuestion = await question("Does the company export goods?");
  const runId = await ctx.db.insert("procurementInformationResearchRuns", {
    requestId,
    fingerprint: `${name}-fingerprint`,
    automatic: false,
    status: "completed",
    questions: [{ questionId: highQuestion }, { questionId: mediumQuestion }],
    questionCount: 2,
    suggestionCount: 2,
    provider: "parallel",
    createdAt: now,
    completedAt: now,
  });
  const suggestion = (
    questionId: Id<"procurementInformationQuestions">,
    confidence: "high" | "medium",
  ) =>
    ctx.db.insert("procurementInformationSuggestions", {
      requestId,
      questionId,
      answer: "Yes",
      confidence,
      citations: [
        {
          url: `https://${name.toLowerCase()}.example.com/about`,
          title: "About",
          excerpt: "We sell online and export goods.",
        },
      ],
      provider: "parallel",
      researchRunId: runId,
      status: "pending",
      createdAt: now,
    });
  const high = await suggestion(highQuestion, "high");
  const medium = await suggestion(mediumQuestion, "medium");
  const formId = await ctx.db.insert("procurementInformationForms", {
    requestId,
    title: "Oct 30, 2026",
    questions: [highQuestion, mediumQuestion].map((questionId) => ({
      questionId,
      question: {
        id: String(questionId),
        section: "additional" as const,
        label: "Question",
        kind: "yes_no" as const,
        options: [],
      },
      scope: { subject: "company", period: "current", coverage: "unknown" },
    })),
    responses: [],
    revision: 0,
    status: "open",
    createdByUserId: clientUserId,
    createdAt: now,
  });
  return { requestId, formId, highQuestion, mediumQuestion, high, medium };
}

async function fixture() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const userX = await ctx.db.insert("users", {
      email: "x@client.example.com",
      accountKind: "customer",
    });
    const userY = await ctx.db.insert("users", {
      email: "y@client.example.com",
      accountKind: "customer",
    });
    const sessionX = await ctx.db.insert("authSessions", {
      userId: userX,
      expirationTime: dayjs().add(30, "day").valueOf(),
    });
    return {
      sessionX,
      userX,
      x: await seedRequest(ctx, "Xco", userX),
      y: await seedRequest(ctx, "Yco", userY),
    };
  });
  return {
    t,
    ...seeded,
    clientX: t.withIdentity({ subject: `${seeded.userX}|${seeded.sessionX}` }),
  };
}

test("a client sees only its own request's high-confidence suggestions", async () => {
  const f = await fixture();
  const form = await f.clientX.query(
    api.procurementInformationForms.clientForm,
    {
      formId: f.x.formId,
    },
  );
  const byQuestion = new Map(
    form.questions.map((q) => [q.questionId, q.suggestion]),
  );
  expect(byQuestion.get(f.x.highQuestion)).toEqual({
    suggestionId: f.x.high,
    answer: "Yes",
    citations: [{ url: "https://xco.example.com/about", title: "About" }],
  });
  expect(byQuestion.get(f.x.mediumQuestion)).toBeUndefined();
  await expect(
    f.clientX.query(api.procurementInformationForms.clientForm, {
      formId: f.y.formId,
    }),
  ).rejects.toThrow();
  for (const requestId of [f.x.requestId, f.y.requestId])
    await expect(
      f.clientX.query(api.procurementInformationSuggestions.listForRequest, {
        requestId,
      }),
    ).rejects.toThrow();
});

test("suggestions are confirmed only by an authorized submission of the request's own form", async () => {
  const f = await fixture();
  await expect(
    f.clientX.mutation(api.procurementInformationSuggestions.accept, {
      suggestionId: f.x.high,
    }),
  ).rejects.toThrow();
  await expect(
    f.clientX.mutation(api.procurementInformationSuggestions.dismiss, {
      suggestionId: f.x.high,
    }),
  ).rejects.toThrow();
  await expect(
    f.clientX.mutation(api.procurementInformationForms.saveForm, {
      formId: f.y.formId,
      revision: 0,
      responses: [f.y.highQuestion, f.y.mediumQuestion].map((questionId) => ({
        questionId,
        answer: "Yes",
        unsure: false,
        fileItemIds: [],
      })),
      submit: true,
      confirmed: true,
    }),
  ).rejects.toThrow();
  const status = (id: Id<"procurementInformationSuggestions">) =>
    f.t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      return { status: row?.status, resolution: row?.resolution };
    });
  expect(await status(f.y.high)).toEqual({ status: "pending" });
  expect(await status(f.x.high)).toEqual({ status: "pending" });

  await f.clientX.mutation(api.procurementInformationForms.saveForm, {
    formId: f.x.formId,
    revision: 0,
    responses: [f.x.highQuestion, f.x.mediumQuestion].map((questionId) => ({
      questionId,
      answer: "Yes",
      unsure: false,
      fileItemIds: [],
    })),
    submit: true,
    confirmed: true,
  });
  expect(await status(f.x.high)).toEqual({
    status: "accepted",
    resolution: "client_confirmed",
  });
  // The client never saw the medium suggestion, so its answer does not confirm it.
  expect(await status(f.x.medium)).toEqual({
    status: "superseded",
    resolution: "answered_elsewhere",
  });
  expect(await status(f.y.high)).toEqual({ status: "pending" });
});
