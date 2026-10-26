import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { websiteTechDomain } from "./websiteTech";

export type ResearchKind = "company" | "tech_stack";

/** One shape for every async research run, so agents poll by state, not by guess. */
export type ResearchStatus = {
  kind: ResearchKind;
  state: "not_started" | "queued" | "running" | "completed" | "partial" | "failed";
  /** Nothing further will change without a new request. */
  settled: boolean;
  updatedAt?: number;
  completedAt?: number;
  error?: string;
  /** Count of cited facts (company) or detected signals (tech stack). */
  findings?: number;
};

export const NOT_STARTED = (kind: ResearchKind): ResearchStatus => ({
  kind,
  state: "not_started",
  settled: true,
});

export function companyResearchStatus(
  organization: Pick<Doc<"organizations">, "companyResearch">,
): ResearchStatus {
  const research = organization.companyResearch;
  if (!research) return NOT_STARTED("company");
  return {
    kind: "company",
    state: research.status === "pending" ? "queued" : research.status,
    settled: !["pending", "running"].includes(research.status),
    updatedAt: research.updatedAt,
    error: research.error?.slice(0, 300),
    findings: research.facts.length,
  };
}

export async function techStackResearchStatus(
  ctx: QueryCtx,
  website: string | undefined,
): Promise<ResearchStatus> {
  const domain = websiteTechDomain(website);
  const profile = domain
    ? await ctx.db
        .query("websiteTechProfiles")
        .withIndex("domain", (q) => q.eq("domain", domain))
        .unique()
    : null;
  if (!profile) return NOT_STARTED("tech_stack");
  return {
    kind: "tech_stack",
    state: profile.status === "pending" ? "queued" : profile.status,
    settled: profile.status === "completed" || profile.status === "failed",
    updatedAt: profile.updatedAt,
    completedAt: profile.completedAt,
    error: profile.error?.slice(0, 300),
    findings: profile.signals.length + profile.disclosures.length,
  };
}
