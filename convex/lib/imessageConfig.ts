export function isImessageEnabled(): boolean {
  return process.env.IMESSAGE_ENABLED === "true";
}

export function isImessageTerminalEnabled(): boolean {
  return process.env.IMESSAGE_TERMINAL_ENABLED === "true";
}

export function isImessageInboundEnabled(): boolean {
  return isImessageEnabled() || isImessageTerminalEnabled();
}

/** Photon delivers inbound messages to the Convex Spectrum webhook and outbound sends run through Spectrum inside Convex. */
export function isImessageWebhookTransportEnabled(): boolean {
  return isImessageEnabled();
}

export function getSpectrumWebhookSecret(): string | undefined {
  return process.env.SPECTRUM_WEBHOOK_SECRET?.trim() || undefined;
}

export function getSpectrumCredentials():
  | { projectId: string; projectSecret: string; webhookSecret: string }
  | undefined {
  const projectId = process.env.PHOTON_PROJECT_ID?.trim();
  const projectSecret = process.env.PHOTON_PROJECT_SECRET?.trim();
  const webhookSecret = getSpectrumWebhookSecret();
  if (!projectId || !projectSecret || !webhookSecret) return undefined;
  return { projectId, projectSecret, webhookSecret };
}

/** True when Spectrum credentials are configured. */
export function isImessageTransportConfigured(): boolean {
  return Boolean(getSpectrumCredentials());
}
