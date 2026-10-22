"use node";

import { buildSpotEmailIconHtml, escapeHtml } from "./emailTemplate";
import { getAgentDomain } from "./resend";

export function getEmailAgentFromName(): string {
  return "Spot";
}

/** `senderName` puts a named operator above Spot's identity line. */
export function buildEmailSignature(
  agentEmail: string,
  senderName?: string,
): {
  text: string;
  html: string;
} {
  const agentName = getEmailAgentFromName();
  const named = senderName?.trim();

  const text = named
    ? ["", "-", named, `${agentName} · ${agentEmail}`].join("\n")
    : ["", "-", agentName, agentEmail].join("\n");

  const logoHtml = buildSpotEmailIconHtml({
    size: 20,
    borderRadius: 4,
    margin: "0 8px 0 0",
  });

  const html = [
    `<br><p style="color:#999;font-size:13px;margin:0">-</p>`,
    `<p style="font-size:13px;margin:4px 0 2px">${named ? "" : logoHtml}<strong>${escapeHtml(named ?? agentName)}</strong></p>`,
    named
      ? `<p style="font-size:12px;color:#999;margin:0">${logoHtml}${agentName} · ${agentEmail}</p>`
      : `<p style="font-size:12px;color:#999;margin:0">${agentEmail}</p>`,
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
