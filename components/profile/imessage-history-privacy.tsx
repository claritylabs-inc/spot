"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";

type ImessagePrivacyState = FunctionReturnType<
  typeof api.imessagePrivacy.getPersonalImessageDeletionState
>;
type ImessagePreviewJobId = NonNullable<ImessagePrivacyState["preview"]>["id"];

function useImessagePrivacy() {
  const state = useQuery(
    api.imessagePrivacy.getPersonalImessageDeletionState,
    {},
  );
  const preparePreview = useMutation(
    api.imessagePrivacy.preparePersonalImessageDeletionPreview,
  );
  const requestDeletion = useMutation(
    api.imessagePrivacy.requestPersonalImessageDeletion,
  );
  const [busy, setBusy] = useState(false);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [dismissedPreviewJobId, setDismissedPreviewJobId] =
    useState<ImessagePreviewJobId | null>(null);
  const [pendingPreviewJobId, setPendingPreviewJobId] =
    useState<ImessagePreviewJobId | null>(null);
  const preview = state?.preview;
  const dialogOpen =
    manualDialogOpen ||
    (preview?.id === pendingPreviewJobId &&
      preview.status === "ready" &&
      preview.threadCount > 0 &&
      preview.id !== dismissedPreviewJobId);
  const setDialogOpen = (open: boolean) => {
    setManualDialogOpen(open);
    if (!open && preview) {
      setPendingPreviewJobId(null);
      setDismissedPreviewJobId(preview.id);
    }
  };

  const prepare = async () => {
    setBusy(true);
    try {
      const result = await preparePreview({});
      setPendingPreviewJobId(result.previewJobId);
    } catch (error) {
      setPendingPreviewJobId(null);
      toast.error(
        getUserFacingErrorMessage(error, "Could not prepare deletion"),
      );
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    const previewJobId = state?.preview?.id;
    if (!previewJobId) return;
    setBusy(true);
    try {
      await requestDeletion({ previewJobId });
      toast.success("Personal iMessage history deletion started");
      setDialogOpen(false);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not start deletion"));
    } finally {
      setBusy(false);
    }
  };

  return {
    state,
    busy,
    dialogOpen,
    setDialogOpen,
    prepare,
    confirm,
  };
}

function ImessagePrivacyPanel({
  state,
  busy,
  onPrepare,
  onReview,
}: {
  state: ImessagePrivacyState | undefined;
  busy: boolean;
  onPrepare: () => void;
  onReview: () => void;
}) {
  const active =
    state?.deletion?.status === "queued" ||
    state?.deletion?.status === "running";
  const previewReady = state?.preview?.status === "ready";
  const previewPreparing = state?.preview?.status === "preparing";
  const previewFailed =
    state?.preview?.status === "failed" ||
    state?.deletion?.status === "failed";
  const noHistory =
    previewReady && (state.preview?.threadCount ?? 0) === 0;
  const description = noHistory
    ? "There is no iMessage history to delete."
    : "This does not delete messages from Apple Messages, group chats, or business records such as policies, certificates, and delivery outcomes.";
  return (
    <OperationalPanel>
      <OperationalPanelHeader title="Personal iMessage history" />
      <OperationalPanelBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            Delete conversations stored by Spot
          </p>
          <p
            className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
          >
            {description}
          </p>
          {active && state?.deletion ? (
            <p
              className={`mt-3 text-muted-foreground ${typeStyle("body.default")}`}
            >
              {state.deletion.processedThreadCount} of{" "}
              {state.deletion.threadCount} conversations processed. You can
              leave this page while deletion continues.
            </p>
          ) : null}
          {previewFailed ? (
            <p
              className={`mt-3 text-muted-foreground ${typeStyle("body.default")}`}
            >
              Spot couldn’t check your iMessage history. Try again.
            </p>
          ) : null}
        </div>
        <PillButton
          className={cn(
            "self-start sm:self-center",
            noHistory && "disabled:grayscale",
          )}
          variant="destructive"
          disabled={
            busy ||
            active ||
            previewPreparing ||
            noHistory ||
            state === undefined
          }
          onClick={previewReady ? onReview : onPrepare}
        >
          {busy || previewPreparing || state === undefined ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          Delete iMessage history
        </PillButton>
      </OperationalPanelBody>
    </OperationalPanel>
  );
}

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function ImessagePrivacyDialog({
  open,
  onOpenChange,
  state,
  busy,
  onPrepare,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ImessagePrivacyState | undefined;
  busy: boolean;
  onPrepare: () => void;
  onConfirm: () => void;
}) {
  const preview = state?.preview;
  const preparing = preview?.status === "preparing";
  const ready = preview?.status === "ready";
  const failed =
    preview?.status === "failed" || state?.deletion?.status === "failed";
  const blocked = state?.hasActiveAgentTurn === true;
  const hasHistory = ready && (preview?.threadCount ?? 0) > 0;
  const checking =
    state === undefined || preparing || (busy && !ready) || (!preview && !failed);
  const canConfirm = hasHistory && !blocked && !busy;

  const title = checking
    ? "Checking iMessage history…"
    : failed
      ? "Couldn’t check iMessage history"
      : !hasHistory
        ? "There is no iMessage history to delete"
        : "Delete personal iMessage history?";

  return (
    <Dialog
      open={open && (!ready || hasHistory)}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hasHistory ? (
            <DialogDescription>
              <strong>{countLabel(preview.threadCount, "conversation")}</strong>
              , <strong>{countLabel(preview.messageCount, "message")}</strong>,
              and <strong>{countLabel(preview.fileCount, "file")}</strong> will
              be permanently deleted from Spot.
              {blocked
                ? " Wait for the active iMessage response to finish, then try again."
                : null}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <DialogFooter>
          {hasHistory && !blocked ? (
            <>
              <PillButton
                variant="secondary"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </PillButton>
              <PillButton
                variant="destructive"
                disabled={!canConfirm}
                onClick={onConfirm}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Permanently delete
              </PillButton>
            </>
          ) : failed ? (
            <>
              <PillButton
                variant="secondary"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </PillButton>
              <PillButton disabled={busy} onClick={onPrepare}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Try again
              </PillButton>
            </>
          ) : (
            <PillButton
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {checking ? "Cancel" : "Close"}
            </PillButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImessagePrivacySettings() {
  const privacy = useImessagePrivacy();

  return (
    <>
      <ImessagePrivacyDialog
        open={privacy.dialogOpen}
        onOpenChange={privacy.setDialogOpen}
        state={privacy.state}
        busy={privacy.busy}
        onPrepare={() => void privacy.prepare()}
        onConfirm={() => void privacy.confirm()}
      />
      <ImessagePrivacyPanel
        state={privacy.state}
        busy={privacy.busy}
        onPrepare={() => void privacy.prepare()}
        onReview={() => privacy.setDialogOpen(true)}
      />
    </>
  );
}

export function ProfileSectionTabs({
  active,
  onChange,
}: {
  active: "profile" | "privacy";
  onChange: (value: "profile" | "privacy") => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Profile sections"
      className="mb-4 flex items-center gap-1"
    >
      <PillButton
        variant={active === "profile" ? "primary" : "ghost"}
        size="compact"
        role="tab"
        aria-selected={active === "profile"}
        onClick={() => onChange("profile")}
      >
        Profile
      </PillButton>
      <PillButton
        variant={active === "privacy" ? "primary" : "ghost"}
        size="compact"
        role="tab"
        aria-selected={active === "privacy"}
        onClick={() => onChange("privacy")}
      >
        Privacy
      </PillButton>
    </div>
  );
}
