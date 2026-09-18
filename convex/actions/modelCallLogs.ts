"use node";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { modelCallPayloadPreview } from "../lib/modelCallTelemetry";

export const payload = action({
  args: { id: v.id("modelRoutingEvents") },
  handler: async (
    ctx,
    args,
  ): Promise<{ request: string | null; response: string | null }> => {
    // The public query enforces the operator boundary before storage is touched.
    const call = await ctx.runQuery(api.modelRoutingEvents.getCall, args);
    if (!call?.callKey) return { request: null, response: null };
    const job = await ctx.runQuery(internal.routerJobs.get, {
      invocationKey: call.callKey,
    });
    async function preview(id: Id<"_storage"> | undefined) {
      if (!id) return null;
      const blob = await ctx.storage.get(id);
      if (!blob) return null;
      return modelCallPayloadPreview(JSON.parse(await blob.text()));
    }
    const [request, response] = await Promise.all([
      preview(job?.requestStorageId),
      preview(job?.resultStorageId),
    ]);
    return { request, response };
  },
});
