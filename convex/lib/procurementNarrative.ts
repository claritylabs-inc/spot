import dayjs from "dayjs";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { PACKET_SECTIONS, defaultPacketSection } from "./procurementPacket";

export const NARRATIVE_SECTION_KEY = "intake_narrative";

export function requestNarrative(request: Doc<"procurementRequests">) {
  return request.narrative;
}

export async function seedNarrativePacketSection(
  ctx: MutationCtx,
  args: {
    requestId: Id<"procurementRequests">;
    clientOrgId: Id<"organizations">;
    narrative: string;
    userId: Id<"users">;
    source: Doc<"procurementPacketSections">["source"];
  },
) {
  const body = args.narrative.trim();
  if (!body) return;
  const existing = await ctx.db
    .query("procurementPacketSections")
    .withIndex("request_key", (q) =>
      q.eq("requestId", args.requestId).eq("key", NARRATIVE_SECTION_KEY),
    )
    .first();
  if (existing) return;
  const request = await ctx.db.get(args.requestId);
  if (!request) throw new Error("Procurement request not found");
  const canonical = defaultPacketSection(NARRATIVE_SECTION_KEY);
  const now = dayjs().valueOf();
  await ctx.db.insert("procurementPacketSections", {
    requestId: args.requestId,
    clientOrgId: args.clientOrgId,
    key: NARRATIVE_SECTION_KEY,
    heading: canonical.heading,
    body,
    order: PACKET_SECTIONS.findIndex(([key]) => key === NARRATIVE_SECTION_KEY),
    audience: canonical.defaultAudience,
    source: args.source,
    createdByUserId: args.userId,
    updatedByUserId: args.userId,
    createdAt: now,
    updatedAt: now,
  });
  if (canonical.defaultAudience !== "operator")
    await ctx.db.patch(args.requestId, {
      packetRevision: (request.packetRevision ?? 0) + 1,
      updatedAt: now,
      updatedByUserId: args.userId,
    });
}
