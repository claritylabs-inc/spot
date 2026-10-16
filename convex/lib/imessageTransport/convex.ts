/** Typed client for the customer and operator Spot Convex iMessage endpoints. */

export type ImessageChannelRole = "customer" | "operator";

export function imessageConvexPaths(role: ImessageChannelRole) {
  return role === "operator"
    ? {
        inbound: "/operator-imessage-inbound",
        deliveryEvents: "/operator-imessage-delivery-events",
      }
    : {
        inbound: "/imessage-inbound",
        deliveryEvents: "/imessage-delivery-events",
      };
}

export interface ImessageAttachment {
  data: string; // base64-encoded bytes
  mimeType: string;
  name: string;
}

export interface ImessageRequest {
  fromPhone: string;
  messageText: string;
  chatGuid?: string;
  isGroup?: boolean;
  chatTitle?: string;
  participantsUnavailable?: boolean;
  participants?: Array<{ address: string; displayName?: string }>;
  sourceMessageId?: string;
  receivedAt?: number;
  recoveryFailure?: {
    stage: "raw_message" | "attachment_download";
    error: string;
  };
  attachments?: ImessageAttachment[];
}

export interface ImessageResponseAttachment {
  url: string;
  filename: string;
  mimeType: string;
}

export interface ImessageAppCard {
  url: string;
  title?: string;
  subtitle?: string;
  summary?: string;
}

export interface ImessageResponse {
  response: string;
  attachments?: ImessageResponseAttachment[];
  appCards?: ImessageAppCard[];
  leaveGroup?: boolean;
  chatGuid?: string;
  threadMessageId?: string;
  sendContactCard?: boolean;
}

export type ImessageConvexErrorCode =
  | "request_timeout"
  | "http_error"
  | "network_error";

export class ImessageConvexError extends Error {
  constructor(
    readonly code: ImessageConvexErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ImessageConvexError";
  }
}

export function isImessageConvexTimeout(
  error: unknown,
): error is ImessageConvexError {
  return error instanceof ImessageConvexError && error.code === "request_timeout";
}

export async function sendToConvex(
  siteUrl: string,
  secret: string,
  role: ImessageChannelRole,
  payload: ImessageRequest,
): Promise<ImessageResponse> {
  const paths = imessageConvexPaths(role);
  let res: Response;
  try {
    res = await fetch(`${siteUrl}${paths.inbound}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ImessageConvexError(
        "request_timeout",
        "The Convex request timed out",
      );
    }
    throw new ImessageConvexError(
      "network_error",
      "The Convex request could not be completed",
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new ImessageConvexError(
      res.status === 408 || res.status === 504 ? "request_timeout" : "http_error",
      `Convex responded ${res.status}: ${text}`,
      res.status,
    );
  }

  return res.json() as Promise<ImessageResponse>;
}

export interface ImessageDeliveryFailure {
  filename: string;
  error?: string;
}

export async function reportImessageDeliveryEvent(
  siteUrl: string,
  secret: string,
  role: ImessageChannelRole,
  payload: {
    threadMessageId: string;
    attachmentFailures: ImessageDeliveryFailure[];
  },
): Promise<boolean> {
  const paths = imessageConvexPaths(role);
  let res: Response;
  try {
    res = await fetch(`${siteUrl}${paths.deliveryEvents}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("Convex delivery callback failed:", err);
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    console.warn(`Convex delivery callback failed ${res.status}: ${text}`);
    return false;
  }
  return true;
}
