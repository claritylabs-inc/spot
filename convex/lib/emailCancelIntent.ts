"use node";

// Compatibility re-exports for existing call sites; controls live in
// ./channelControls. Delete once entrypoints import channelControls directly.
export {
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelIntent,
  isPendingEmailRestoreIntent,
  normalizePendingEmailIntentText,
  pendingEmailCancelConfirmationMessage,
} from "./channelControls";
