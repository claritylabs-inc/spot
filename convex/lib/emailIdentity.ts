"use node";

import { buildSpotEmailIconHtml, escapeHtml } from "./emailTemplate";
import { getAgentDomain } from "./resend";

export function getEmailAgentFromName(): string {
  return "Spot";
}

export function buildEmailSignature(agentEmail: string): {
  text: string;
  html: string;
} {
  const agentName = getEmailAgentFromName();
  const text = ["", "-", agentName, agentEmail].join("\n");

  const logoHtml = buildSpotEmailIconHtml({
    size: 20,
    borderRadius: 4,
    margin: "0 8px 0 0",
  });

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">-</p>`,
    `<p style="font-size:13px;margin:4px 0 2px">${logoHtml}<strong>${escapeHtml(agentName)}</strong></p>`,
    `<p style="font-size:12px;color:#999;margin:0">${agentEmail}</p>`,
  ].join("\n");

  return { text, html };
}

export function resolveEmailAgentIdentity(org: Record<string, unknown>): {
  canSend: boolean;
  agentAddress?: string;
  fromHeader?: string;
  reason?: string;
} {
  const handle =
    typeof org.agentHandle === "string" && org.agentHandle.trim()
      ? org.agentHandle
      : "agent";

  const agentAddress = `${handle}@${getAgentDomain()}`;
  return {
    canSend: true,
    agentAddress,
    fromHeader: `${getEmailAgentFromName()} <${agentAddress}>`,
  };
}
