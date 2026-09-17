import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { syncOrgProfileFromDeclarationFacts } from "./lib/orgProfileFacts";
import { reconcileExtractedCompanyFacts } from "./orgWiki";

const MAX_ACTIVE_EXTRACTIONS_PER_ORG = 500;

async function reconcileCompanyInformation(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("companyInformationExtractions")
    .withIndex("organization", (index) => index.eq("orgId", orgId))
    .order("desc")
    .take(MAX_ACTIVE_EXTRACTIONS_PER_ORG);
  const applied = rows.filter((row) => row.appliedFingerprint);
  const org = await ctx.db.get(orgId);

  await reconcileExtractedCompanyFacts(ctx, {
    orgId,
    source: "extraction",
    facts: [...(org?.companyResearch?.facts ?? []).map((fact) => ({ ...fact, content: `${fact.content} [Source](${fact.sourceRef})` })), ...applied.flatMap((row) =>
      (row.organizationFacts ?? []).map((fact) => ({
        // Rows stored before the wiki gained sections held one flat fact list.
        key: fact.section ?? "profile",
        sourceRef: row.sourceRef,
        content: fact.content,
      })),
    )],
  });
  await syncOrgProfileFromDeclarationFacts(ctx, orgId);
}

async function removeExtraction(
  ctx: MutationCtx,
  extraction: Doc<"companyInformationExtractions"> | null,
) {
  if (!extraction) return false;
  await ctx.db.delete(extraction._id);
  await reconcileCompanyInformation(ctx, extraction.orgId);
  return true;
}

export async function removeClientFileCompanyInformation(
  ctx: MutationCtx,
  clientFileId: Id<"clientFiles">,
) {
  const extraction = await ctx.db
    .query("companyInformationExtractions")
    .withIndex("file", (index) => index.eq("clientFileId", clientFileId))
    .unique();
  return await removeExtraction(ctx, extraction);
}

export async function removeEmailThreadCompanyInformation(
  ctx: MutationCtx,
  emailThreadId: Id<"procurementEmailThreads">,
) {
  const thread = await ctx.db.get(emailThreadId);
  const extraction = await ctx.db
    .query("companyInformationExtractions")
    .withIndex("email", (index) =>
      index.eq("procurementEmailThreadId", emailThreadId),
    )
    .unique();
  if (extraction) await ctx.db.delete(extraction._id);

  const messages = await ctx.db
    .query("procurementEmailMessages")
    .withIndex("thread", (index) => index.eq("threadId", emailThreadId))
    .collect();
  for (const clientFileId of new Set(
    messages.flatMap((message) => message.clientFileIds),
  )) {
    const fileExtraction = await ctx.db
      .query("companyInformationExtractions")
      .withIndex("file", (index) => index.eq("clientFileId", clientFileId))
      .unique();
    if (fileExtraction) await ctx.db.delete(fileExtraction._id);
  }
  const orgId = extraction?.orgId ?? thread?.clientOrgId;
  if (orgId) await reconcileCompanyInformation(ctx, orgId);
  return Boolean(extraction || messages.length > 0);
}
