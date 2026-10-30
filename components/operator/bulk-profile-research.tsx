"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import { PillButton } from "@/components/ui/pill-button";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const MAX_CLIENTS = 50;

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Bulk action for checked clients: public profile research, 1–50 per run. */
export function BulkProfileResearch({
  orgIds,
  disabled,
}: {
  orgIds: Id<"organizations">[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = useMutation(api.clientProfileBatchResearch.start);
  const tooMany = orgIds.length > MAX_CLIENTS;

  async function confirm() {
    setBusy(true);
    try {
      const { queued, results } = await start({ orgIds });
      const running = results.filter(
        (result) => result.outcome === "already_running" && !result.research.settled,
      ).length;
      const skipped = results.length - queued - running;
      const summary = [
        `${queued} queued`,
        running ? `${running} already running` : null,
        skipped ? `${skipped} skipped` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`Profile research: ${summary}`);
      setOpen(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not start profile research"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!orgIds.length) return null;
  return (
    <>
      <PillButton
        type="button"
        variant="secondary"
        size="compact"
        disabled={disabled || tooMany}
        title={tooMany ? `Select up to ${MAX_CLIENTS} clients` : undefined}
        onClick={() => setOpen(true)}
      >
        <Globe className="size-3.5" />
        Research public profiles
      </PillButton>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              Research public profiles for {plural(orgIds.length, "client")}
            </DialogTitle>
            <DialogDescription>
              Searches public sources for year founded, employees, operations,
              industry, headquarters, locations and ownership. Only each
              client&apos;s name, website and city are shared with the search
              provider. Verified, cited facts are added to the client&apos;s
              company profile.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              type="button"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy ? "Starting…" : `Research ${plural(orgIds.length, "client")}`}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
