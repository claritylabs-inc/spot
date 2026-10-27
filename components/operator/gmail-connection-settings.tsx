"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@claritylabs-inc/ui/components/alert-dialog";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

/** Messages for the `reason` the OAuth callback adds to `?gmail=error`. */
const CALLBACK_ERRORS: Record<string, string> = {
  invalid_request: "The Google sign-in response was not valid. Try connecting again.",
  expired: "The Google sign-in expired. Try connecting again.",
  denied: "Google access was not granted.",
  domain_not_allowed: "That Google account is not on an allowed domain.",
  missing_scopes: "Allow every requested Gmail permission to connect.",
  no_refresh_token: "Google did not return offline access. Try connecting again.",
  address_in_use: "That Gmail address is connected to another operator.",
  failed: "Gmail could not be connected.",
};

/** Reports the OAuth callback result once, then removes it from the URL. */
function useGmailCallbackToast() {
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    const url = new URL(window.location.href);
    const result = url.searchParams.get("gmail");
    if (!result) return;
    handled.current = true;
    if (result === "connected") toast.success("Gmail connected");
    else if (result === "error")
      toast.error(
        CALLBACK_ERRORS[url.searchParams.get("reason") ?? ""] ??
          CALLBACK_ERRORS.failed,
      );
    url.searchParams.delete("gmail");
    url.searchParams.delete("reason");
    window.history.replaceState(null, "", url);
  }, []);
}

export function GmailConnectionSettings() {
  const connection = useQuery(api.operatorGmail.myConnection, {});
  const start = useAction(api.actions.operatorGmail.start);
  const disconnect = useAction(api.actions.operatorGmail.disconnect);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  useGmailCallbackToast();

  if (connection === undefined) return null;

  async function connect() {
    setBusy("connect");
    try {
      const { url } = await start({});
      window.location.assign(url);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Gmail could not be connected."));
      setBusy(null);
    }
  }

  async function confirmDisconnect() {
    setBusy("disconnect");
    try {
      await disconnect({});
      setConfirmingDisconnect(false);
      toast.success("Gmail disconnected");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Gmail could not be disconnected."));
    } finally {
      setBusy(null);
    }
  }

  const needsReconnect = connection?.status === "needs_reconnect";

  return (
    <div className="mt-4">
      <InlineFieldCard title="Gmail">
        {connection ? (
          <>
            <InlineFieldRow label="Connected account">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="break-all">{connection.address}</span>
                <Badge variant={needsReconnect ? "destructive" : "outline"}>
                  {needsReconnect ? "Needs reconnect" : "Active"}
                </Badge>
              </div>
            </InlineFieldRow>
            {connection.sendError ? (
              <InlineFieldRow label="Last send error">
                <span role="alert" className="text-destructive">
                  {connection.sendError}
                </span>
              </InlineFieldRow>
            ) : null}
            <InlineFieldRow label="Actions">
              <div className="flex flex-wrap items-center gap-2">
                <PillButton
                  type="button"
                  variant="secondary"
                  size="compact"
                  disabled={busy !== null}
                  onClick={() => void connect()}
                >
                  {busy === "connect" ? "Opening Google…" : "Reconnect"}
                </PillButton>
                <PillButton
                  type="button"
                  variant="ghost"
                  size="compact"
                  disabled={busy !== null}
                  onClick={() => setConfirmingDisconnect(true)}
                >
                  Disconnect
                </PillButton>
              </div>
            </InlineFieldRow>
          </>
        ) : (
          <InlineFieldRow label="Google account">
            <div className="flex flex-wrap items-center gap-2">
              <PillButton
                type="button"
                variant="secondary"
                size="compact"
                disabled={busy !== null}
                onClick={() => void connect()}
              >
                {busy === "connect" ? "Opening Google…" : "Connect Google"}
              </PillButton>
            </div>
          </InlineFieldRow>
        )}
        <InlineFieldRow label="How it works">
          <span className="text-muted-foreground">
            Spot only sees Gmail mail that copies your team address. Emails you
            send from Gmail in Spot copy it automatically.
          </span>
        </InlineFieldRow>
      </InlineFieldCard>
      <AlertDialog
        open={confirmingDisconnect}
        onOpenChange={(open) => {
          if (busy !== "disconnect") setConfirmingDisconnect(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Gmail?</AlertDialogTitle>
            <AlertDialogDescription>
              Spot revokes its access to {connection?.address} and you can no
              longer send from it in Spot. Mail already in the Inbox is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <PillButton
              variant="secondary"
              disabled={busy === "disconnect"}
              onClick={() => setConfirmingDisconnect(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={busy === "disconnect"}
              onClick={() => void confirmDisconnect()}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </PillButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
