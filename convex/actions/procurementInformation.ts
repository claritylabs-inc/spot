"use node";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { extractClientAnswers } from "../lib/procurementInformationClientExtraction";
import { extractProviderQuestions } from "../lib/procurementInformationProviderExtraction";

/** One persisted inference per message. Mail content never authorizes sends or canonical application edits. */
export const extractInternal = internalAction({
  args: { extractionId: v.id("procurementInformationExtractions") },
  handler: async (ctx, { extractionId }): Promise<void> => {
    try {
      const context = await ctx.runQuery(
        internal.procurementInformationEmail.extractionContext,
        { extractionId },
      );
      if (!context) return;
      if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 96000)
        throw new Error("Extraction context too large");
      const trace = {
        traceId: String(context.requestId),
        channel: "web",
        phase: "provider_information",
      };
      if (context.audience === "client") {
        await ctx.runMutation(
          internal.procurementInformationEmail.finishExtraction,
          {
            extractionId,
            failed: false,
            questions: [],
            emailAnswers: await extractClientAnswers(ctx, context, trace),
          },
        );
        return;
      }
      const { questions, reviewReasons } = await extractProviderQuestions(
        ctx,
        context,
        trace,
      );
      await ctx.runMutation(internal.procurementInformationEmail.finishExtraction, {
        extractionId,
        failed: false,
        questions,
        reviewReasons,
      });
    } catch (error) {
      console.error("[procurementInformation] extraction failed", {
        extractionId,
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.runMutation(internal.procurementInformationEmail.finishExtraction, {
        extractionId,
        failed: true,
        questions: [],
      });
    }
  },
});
