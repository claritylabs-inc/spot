/** Request and response shapes for the customer iMessage inbound handler. */

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

export interface ImessageDeliveryFailure {
  filename: string;
  error?: string;
}
