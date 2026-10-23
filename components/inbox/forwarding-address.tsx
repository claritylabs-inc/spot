"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

async function writeClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    toast.error("Could not copy to the clipboard");
    return false;
  }
}

/**
 * Copies the signed-in operator's own team address for forwarding. A default
 * address that has no inbox yet is set up first through the self-only
 * `ensureInbox` action; nothing is provisioned until the operator asks to copy.
 * The request's legacy address is only a fallback when team email is not
 * configured in this environment.
 */
export function useForwardingCopy(
  fallbackAddress?: string | null,
  readOnly = false,
) {
  const router = useRouter();
  const settings = useQuery(api.operatorEmailSettings.get, {});
  const ensureInbox = useAction(api.operatorEmailSettings.ensureInbox);
  const [busy, setBusy] = useState(false);

  const address =
    settings?.configured && settings.address ? settings.address : null;

  const copy = useCallback(async () => {
    if (!settings || busy) return;
    const openProfile = {
      label: "Open Profile",
      onClick: () => router.push("/operator/profile"),
    };
    if (!settings.configured) {
      if (fallbackAddress && (await writeClipboard(fallbackAddress)))
        toast.success("Copied the request address; team email is not set up here");
      else if (!fallbackAddress) toast.error("Team email is not configured");
      return;
    }
    if (!settings.address) {
      toast.error("Set a team address in Profile first", { action: openProfile });
      return;
    }
    if (settings.status === "needs_name") {
      toast.error("Add your full name in Profile to set up your team address", {
        action: openProfile,
      });
      return;
    }
    // The address to copy and whether only the local capture stub exists. After
    // a provision, trust its result: the profile may have changed meanwhile.
    let target = settings.address;
    let captured = settings.status === "captured";
    if (settings.status === "needs_setup") {
      if (readOnly) {
        toast.error("Team inbox setup is unavailable while viewing as a client");
        return;
      }
      setBusy(true);
      try {
        const result = await ensureInbox({});
        if (result.status === "failed") {
          toast.error(result.message, { action: openProfile });
          return;
        }
        target = result.address;
        captured = result.status === "captured";
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Your team inbox could not be set up."),
        );
        return;
      } finally {
        setBusy(false);
      }
    }
    if (!(await writeClipboard(target))) return;
    toast.success(
      captured
        ? "Address copied; local capture mode does not create an inbox"
        : "Forwarding address copied",
    );
  }, [busy, ensureInbox, fallbackAddress, readOnly, router, settings]);

  return { address, busy, loading: settings === undefined, copy };
}
