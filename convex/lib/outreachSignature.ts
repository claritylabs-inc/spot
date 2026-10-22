import { buildSpotEmailIconHtml, escapeHtml } from "./emailTemplate";

/**
 * Operator signature for outreach mail (providers and clients): Spot mark,
 * operator name, Spot, and the reply address. The operator name falls back to
 * Spot alone; the inbox display name ("Ana at Spot") is never repeated here.
 */
export function buildOutreachSignature(operator: { name?: string | null; email?: string }) {
  const cleaned = operator.name?.replace(/\s+/g, " ").trim().slice(0, 80);
  const name = cleaned && cleaned !== "Spot" ? cleaned : null;
  const email = operator.email?.trim().slice(0, 120) || null;
  const text = [name ?? "Spot", [name ? "Spot" : null, email].filter(Boolean).join(" · ")]
    .filter(Boolean)
    .join("\n");
  const lines = [
    `<strong style="color:#111111;font-weight:600">${escapeHtml(name ?? "Spot")}</strong>`,
    ...(name ? [`<span style="color:#6b6b6b">Spot</span>`] : []),
    ...(email
      ? [`<a href="mailto:${escapeHtml(email)}" style="color:#6b6b6b;text-decoration:none">${escapeHtml(email)}</a>`]
      : []),
  ];
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 0;border-collapse:collapse"><tr><td style="padding:2px 10px 0 0;vertical-align:top">${buildSpotEmailIconHtml({ size: 32, borderRadius: 8 })}</td><td style="font-size:13px;line-height:19px;vertical-align:top">${lines.join("<br>")}</td></tr></table>`;
  return { text, html };
}
