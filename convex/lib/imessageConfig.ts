import { normalizeUserPhone } from "./userPhone";

export function isImessageEnabled(): boolean {
  return process.env.IMESSAGE_ENABLED === "true";
}

export function isImessageTerminalEnabled(): boolean {
  return process.env.IMESSAGE_TERMINAL_ENABLED === "true";
}

export function isImessageInboundEnabled(): boolean {
  return isImessageEnabled() || isImessageTerminalEnabled();
}

export function isOperatorImessageEnabled(): boolean {
  return process.env.OPERATOR_IMESSAGE_ENABLED === "true";
}

export function isOperatorImessageTerminalEnabled(): boolean {
  return process.env.OPERATOR_IMESSAGE_TERMINAL_ENABLED === "true";
}

export function isOperatorImessageInboundEnabled(): boolean {
  return isOperatorImessageEnabled() || isOperatorImessageTerminalEnabled();
}

export function getOperatorImessageContactPhone(): string | undefined {
  try {
    return normalizeUserPhone(
      process.env.OPERATOR_IMESSAGE_CONTACT_PHONE?.trim(),
    );
  } catch {
    return undefined;
  }
}

export type ImessageChannelRole = "customer" | "operator";

/** Photon delivers inbound messages to the Convex Spectrum webhook and outbound sends run through Spectrum inside Convex. */
export function isImessageWebhookTransportEnabled(
  role: ImessageChannelRole,
): boolean {
  return role === "operator" ? isOperatorImessageEnabled() : isImessageEnabled();
}

export function getSpectrumWebhookSecret(
  role: ImessageChannelRole,
): string | undefined {
  return (
    (role === "operator"
      ? process.env.OPERATOR_SPECTRUM_WEBHOOK_SECRET
      : process.env.SPECTRUM_WEBHOOK_SECRET
    )?.trim() || undefined
  );
}

export function getSpectrumCredentials(
  role: ImessageChannelRole,
):
  | { projectId: string; projectSecret: string; webhookSecret: string }
  | undefined {
  const operator = role === "operator";
  const projectId = (
    operator
      ? process.env.OPERATOR_PHOTON_PROJECT_ID
      : process.env.PHOTON_PROJECT_ID
  )?.trim();
  const projectSecret = (
    operator
      ? process.env.OPERATOR_PHOTON_PROJECT_SECRET
      : process.env.PHOTON_PROJECT_SECRET
  )?.trim();
  const webhookSecret = getSpectrumWebhookSecret(role);
  if (!projectId || !projectSecret || !webhookSecret) return undefined;
  return { projectId, projectSecret, webhookSecret };
}

/** True when the role has its Spectrum credentials. */
export function isImessageTransportConfigured(
  role: ImessageChannelRole,
): boolean {
  return Boolean(getSpectrumCredentials(role));
}
