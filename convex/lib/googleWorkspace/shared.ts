import type { Id } from "../../_generated/dataModel";
import type { OperatorGoogleWorkspaceConfig } from "../googleWorkspace";
import type { GoogleWorkspaceProvider } from "../googleWorkspaceProvider";

export const TOOL_WORK_BUDGET_MS = 60_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type StoredAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

type AttachmentStorage = {
  store(blob: Blob): Promise<Id<"_storage">>;
  delete(fileId: Id<"_storage">): Promise<void>;
  read(file: StoredAttachment): Promise<unknown>;
};

export type GoogleWorkspaceToolDependencies = {
  config: OperatorGoogleWorkspaceConfig;
  provider: GoogleWorkspaceProvider;
  cursorSecret: string;
  attachmentStorage: AttachmentStorage;
  /** The calling operator's address, used when a scan omits its mailbox. */
  operatorMailbox?: string;
};
