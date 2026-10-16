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

export function getImessageWorkerUrl(): string | undefined {
  if (!isImessageInboundEnabled()) return undefined;
  return process.env.IMESSAGE_WORKER_URL;
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

export function getOperatorImessageWorkerUrl(): string | undefined {
  if (!isOperatorImessageInboundEnabled()) return undefined;
  return process.env.OPERATOR_IMESSAGE_WORKER_URL;
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

/**
 * Per-role cutover flag. When on, Photon delivers inbound messages to the
 * Convex Spectrum webhook and outbound sends run through Spectrum inside Convex
 * instead of the Railway worker's `/send`. Terminal (dev) lanes keep the worker.
 */
export function isImessageWebhookTransportEnabled(
  role: ImessageChannelRole,
): boolean {
  return role === "operator"
    ? isOperatorImessageEnabled() &&
        process.env.OPERATOR_IMESSAGE_WEBHOOK_ENABLED === "true"
    : isImessageEnabled() && process.env.IMESSAGE_WEBHOOK_ENABLED === "true";
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

/** True when the active transport for the role has its credentials. */
export function isImessageTransportConfigured(
  role: ImessageChannelRole,
): boolean {
  if (isImessageWebhookTransportEnabled(role)) {
    return Boolean(getSpectrumCredentials(role));
  }
  return role === "operator"
    ? Boolean(
        getOperatorImessageWorkerUrl() &&
        process.env.OPERATOR_IMESSAGE_WORKER_SECRET?.trim(),
      )
    : Boolean(getImessageWorkerUrl() && process.env.IMESSAGE_WORKER_SECRET);
}
