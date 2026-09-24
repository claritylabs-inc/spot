import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { FeatureFlagMap, FeatureFlagOrgType } from "./featureFlags";

export type ImessageAppCard = {
  url: string;
  title?: string;
  subtitle?: string;
  summary?: string;
};

type ToolArtifact = { type: string; data: unknown };

/**
 * Removed at integration: P11 call site (convex/actions/handleInboundImessage.ts).
 * The imessage_app_cards beta flag and policy/certificate card minting are
 * removed; iMessage replies always use the non-card path. Kept as a no-op so
 * the existing call site keeps compiling until P11 removes it.
 */
export async function mintImessageAppCards(
  _ctx: ActionCtx,
  _args: {
    org: {
      type?: FeatureFlagOrgType;
      featureFlags?: FeatureFlagMap;
    };
    threadId: Id<"threads">;
    sourceThreadMessageId?: Id<"threadMessages">;
    createdByUserId: Id<"users">;
    presentedPolicyIds: Id<"policies">[];
    artifacts: ToolArtifact[];
  },
): Promise<ImessageAppCard[]> {
  return [];
}

export async function mintImessageEmailDraftReviewCard(
  ctx: ActionCtx,
  args: {
    pendingEmailId: Id<"pendingEmails">;
    threadId: Id<"threads">;
    sourceThreadMessageId?: Id<"threadMessages">;
  },
): Promise<ImessageAppCard | null> {
  const draft = (await ctx.runQuery(
    internal.pendingEmails.getInternal,
    { id: args.pendingEmailId },
  )) as Doc<"pendingEmails"> | null;
  if (
    !draft ||
    draft.status !== "draft" ||
    draft.threadId !== args.threadId
  ) {
    return null;
  }
  try {
    const link = await ctx.runMutation(
      internal.emailDraftReviewLinks.createInternal,
      {
        pendingEmailId: draft._id,
        channel: "imessage",
        sourceThreadMessageId: args.sourceThreadMessageId,
      },
    );
    return {
      url: link.url,
      title: "Email draft",
      subtitle: `To ${draft.recipientEmail}`,
      summary: draft.subject,
    };
  } catch (error) {
    console.warn("[imessage] Failed to create email draft review card:", error);
    return null;
  }
}
