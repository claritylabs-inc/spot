"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getClientPortalUrl } from "./domains";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";

type PolicyLike = {
  _id: Id<"policies">;
  carrier?: string;
  security?: string;
  generalAgent?: { agencyName?: string };
  policyNumber?: string;
  linesOfBusiness?: string[];
};

export type EmailPolicySource = {
  id: Id<"policies">;
  href: string;
  title: string;
  label: string;
  detail: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sourceFromPolicy(policy: PolicyLike, siteUrl: string): EmailPolicySource {
  const href = `${siteUrl.replace(/\/$/, "")}/policies/${policy._id}`;
  const label = "Policy";
  const generalAgent =
    policy.generalAgent?.agencyName ||
    policy.security ||
    policy.carrier ||
    "Unknown";
  const type = policyLobCodes(policy).filter((code) => code !== "UN").map(lobLabel)[0];
  const detail = [generalAgent, policy.policyNumber, type].filter(Boolean).join(" - ");

  return {
    id: policy._id,
    href,
    label,
    title: detail || label,
    detail: policy.policyNumber ? `Policy ${policy.policyNumber}` : label,
  };
}

export async function buildEmailPolicySources(
  ctx: ActionCtx,
  policyIds: Array<Id<"policies"> | string> | undefined,
  siteUrl: string = getClientPortalUrl(),
): Promise<EmailPolicySource[]> {
  const uniqueIds = [...new Set((policyIds ?? []).filter(Boolean).map(String))];
  const sources: EmailPolicySource[] = [];

  for (const id of uniqueIds) {
    const policy = await ctx.runQuery(internal.policies.getInternal, {
      id: id as Id<"policies">,
    });
    if (!policy) continue;
    sources.push(sourceFromPolicy(policy as PolicyLike, siteUrl));
  }

  return sources;
}

export function buildPolicySourcesText(sources: EmailPolicySource[]): string {
  if (sources.length === 0) return "";
  return [
    "",
    "",
    "Sources",
    ...sources.map((source) => `- ${source.title}: ${source.href}`),
  ].join("\n");
}

export function buildPolicySourcesHtml(sources: EmailPolicySource[]): string {
  if (sources.length === 0) return "";
  const cards = sources
    .map((source) => {
      const title = escapeHtml(source.title);
      const label = escapeHtml(source.label);
      const href = escapeHtml(source.href);
      return `
<a href="${href}" style="display:block;margin:5px 0 0;padding:7px 9px;border:1px solid #e5e5e5;border-radius:6px;background:#ffffff;text-decoration:none;color:#000000;">
  <span style="display:block;font-size:10px;line-height:1.2;color:#9aa3af;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${label}</span>
  <span style="display:block;margin-top:2px;font-size:12px;line-height:1.3;color:#374151;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${title}</span>
</a>`;
    })
    .join("\n");

  return `
<div style="margin:14px 0 0;padding:10px 0 0;border-top:1px solid #e5e5e5;">
  <p style="margin:0 0 2px;font-size:11px;line-height:1.3;color:#6b7280;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-weight:600;">Sources</p>
  ${cards}
</div>`;
}
