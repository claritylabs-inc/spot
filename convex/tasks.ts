import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Step definitions for each operation type

export const EXTRACTION_STEPS = [
  { key: "receiving", label: "Receiving your document" },
  { key: "classifying", label: "Figuring out what type of document this is" },
  { key: "extracting", label: "Reading through your coverage details" },
  { key: "organizing", label: "Organizing everything" },
  { key: "done", label: "Here's your breakdown" },
];

export const RE_EXTRACTION_STEPS = [
  { key: "retrieving", label: "Retrieving your document" },
  { key: "extracting", label: "Reading through your coverage details" },
  { key: "organizing", label: "Organizing everything" },
  { key: "done", label: "Here's your breakdown" },
];

export const REINDEX_STEPS = [
  { key: "scanning", label: "Scanning your policies" },
  { key: "indexing", label: "Indexing your coverage details" },
  { key: "done", label: "All done" },
];

function generateToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < 24; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

// Create a new task, sets first step to "active", returns { taskId, token }
export const create = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.string(),
  },
  handler: async (ctx, { userId, type }) => {
    let stepDefs: { key: string; label: string }[];
    if (type === "extraction") {
      stepDefs = EXTRACTION_STEPS;
    } else if (type === "re-extraction") {
      stepDefs = RE_EXTRACTION_STEPS;
    } else if (type === "reindex") {
      stepDefs = REINDEX_STEPS;
    } else {
      stepDefs = EXTRACTION_STEPS;
    }

    const steps = stepDefs.map((s, i) => ({
      key: s.key,
      label: s.label,
      status: i === 0 ? "active" : "pending",
    }));

    const token = generateToken();
    const taskId = await ctx.db.insert("tasks", {
      userId,
      token,
      type,
      status: "running",
      steps,
      startedAt: Date.now(),
    });

    return { taskId, token };
  },
});

// Mark a step as completed and advance the next step to "active"
export const advanceStep = internalMutation({
  args: {
    taskId: v.id("tasks"),
    stepKey: v.string(),
  },
  handler: async (ctx, { taskId, stepKey }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;

    const steps = task.steps.map((s, i) => {
      if (s.key === stepKey) {
        return { ...s, status: "completed" };
      }
      // Find the next step after the completed one and mark it active
      const completedIndex = task.steps.findIndex((st) => st.key === stepKey);
      if (i === completedIndex + 1 && s.status === "pending") {
        return { ...s, status: "active" };
      }
      return s;
    });

    await ctx.db.patch(taskId, { steps });
  },
});

// Mark ALL steps completed, set status="completed", store result and optional policyId
export const complete = internalMutation({
  args: {
    taskId: v.id("tasks"),
    policyId: v.optional(v.id("policies")),
    result: v.optional(v.object({
      summary: v.optional(v.string()),
      carrier: v.optional(v.string()),
      category: v.optional(v.string()),
      documentType: v.optional(v.string()),
      policyNumber: v.optional(v.string()),
      effectiveDate: v.optional(v.string()),
      expirationDate: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      rechunkedCount: v.optional(v.number()),
    })),
  },
  handler: async (ctx, { taskId, policyId, result }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;

    const steps = task.steps.map((s) => ({ ...s, status: "completed" }));

    await ctx.db.patch(taskId, {
      steps,
      status: "completed",
      result,
      policyId,
      completedAt: Date.now(),
    });
  },
});

// Mark active step as "failed", set status="failed", store optional errorMessage
export const fail = internalMutation({
  args: {
    taskId: v.id("tasks"),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, errorMessage }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;

    const steps = task.steps.map((s) => {
      if (s.status === "active") {
        return { ...s, status: "failed" };
      }
      return s;
    });

    await ctx.db.patch(taskId, {
      steps,
      status: "failed",
      result: errorMessage ? { errorMessage } : undefined,
      completedAt: Date.now(),
    });
  },
});

// Public query: look up task by token
export const getByToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
  },
});
