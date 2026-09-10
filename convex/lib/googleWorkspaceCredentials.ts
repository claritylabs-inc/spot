import type { OperatorGoogleWorkspaceCredentialStatus } from "./googleWorkspace";

export type GoogleWorkspaceServiceAccountCredentials = {
  clientEmail: string;
  clientId: string;
  privateKey: string;
  privateKeyId: string | null;
};

export type GoogleWorkspaceCredentialEnvelope = {
  status: OperatorGoogleWorkspaceCredentialStatus;
  credentials: GoogleWorkspaceServiceAccountCredentials | null;
  /** Backend-only revision. Never include this in a public return value or audit. */
  revision: string | null;
  error: string | null;
};

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeServiceAccountEmail(value: unknown) {
  const email = nonempty(value)?.toLowerCase() ?? null;
  return email && /^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(email)
    ? email
    : null;
}

function safeClientId(value: unknown) {
  const clientId = nonempty(value);
  return clientId && /^\d+$/.test(clientId) ? clientId : null;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function googleWorkspaceCredentialEnvelope(
  raw = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON,
): Promise<GoogleWorkspaceCredentialEnvelope> {
  const serialized = raw?.trim();
  if (!serialized) {
    return {
      status: { present: false, serviceAccountEmail: null, clientId: null },
      credentials: null,
      revision: null,
      error: "Google Workspace service-account credentials are not configured.",
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const candidate = JSON.parse(serialized) as unknown;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("invalid credential shape");
    }
    parsed = candidate as Record<string, unknown>;
  } catch {
    return {
      status: { present: true, serviceAccountEmail: null, clientId: null },
      credentials: null,
      revision: await sha256(serialized),
      error: "Google Workspace service-account credentials are invalid.",
    };
  }

  const isServiceAccount = parsed.type === "service_account";
  const clientEmail = isServiceAccount
    ? safeServiceAccountEmail(parsed.client_email)
    : null;
  const clientId = isServiceAccount ? safeClientId(parsed.client_id) : null;
  const privateKey = nonempty(parsed.private_key);
  const privateKeyId = nonempty(parsed.private_key_id);
  const status = {
    present: true,
    serviceAccountEmail: clientEmail,
    clientId,
  };
  if (
    !clientEmail ||
    !clientId ||
    !privateKey?.includes("-----BEGIN PRIVATE KEY-----") ||
    !privateKey.includes("-----END PRIVATE KEY-----")
  ) {
    return {
      status,
      credentials: null,
      revision: await sha256(serialized),
      error: "Google Workspace service-account credentials are incomplete.",
    };
  }

  return {
    status,
    credentials: { clientEmail, clientId, privateKey, privateKeyId },
    revision: await sha256(serialized),
    error: null,
  };
}
