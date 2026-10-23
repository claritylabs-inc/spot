"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";

import { PillButton } from "@/components/ui/pill-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@claritylabs-inc/ui/components/popover";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useFollowedOpen } from "@/hooks/use-followed-state";
import { useCachedOperatorClients } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const CLIENT_ONLY = "__client_only__";

export type LinkableThread = {
  _id: Id<"teamEmailThreads">;
  source: "forward" | "outreach" | "team";
  client: { _id: Id<"organizations"> } | null;
  request: { _id: Id<"procurementRequests"> } | null;
};

/** Outreach mail stays with its request; a thread with a request is moved, not linked. */
export function canLinkThread(thread: LinkableThread) {
  return thread.source !== "outreach" && !thread.request;
}

/**
 * Attaches an unlinked (or client-only) conversation to a client and,
 * optionally, one of its requests. The choice is explicit; a failed link keeps
 * the selection so it can be retried.
 */
export function LinkThreadAction({
  thread,
  onLinked,
}: {
  thread: LinkableThread;
  onLinked?: () => void;
}) {
  const linkThread = useMutation(api.teamInbox.linkThread);
  const clients = useCachedOperatorClients();
  const { open, onOpenChange } = useFollowedOpen(`inbox:link-thread:${thread._id}:open`);
  const [clientChoice, setClientChoice] = useState("");
  const [requestChoice, setRequestChoice] = useState(CLIENT_ONLY);
  const [linking, setLinking] = useState(false);
  const clientOrgId = (thread.client?._id ?? clientChoice) as
    | Id<"organizations">
    | "";
  const requests = useQuery(
    api.procurementRequests.list,
    open && clientOrgId ? { clientOrgId } : "skip",
  );
  const clientOptions = useMemo(
    () =>
      (clients ?? []).map((client) => ({ value: client._id, label: client.name })),
    [clients],
  );
  const requestOptions = useMemo(
    () => [
      { value: CLIENT_ONLY, label: "No request (client only)" },
      ...(requests ?? []).map((request) => ({
        value: request._id,
        label: request.title,
      })),
    ],
    [requests],
  );
  if (!canLinkThread(thread)) return null;

  async function link() {
    if (!clientOrgId || linking) return;
    setLinking(true);
    try {
      await linkThread({
        threadId: thread._id,
        clientOrgId,
        ...(requestChoice !== CLIENT_ONLY
          ? { requestId: requestChoice as Id<"procurementRequests"> }
          : {}),
      });
      toast.success("Conversation linked");
      onOpenChange(false);
      onLinked?.();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not link conversation"));
    } finally {
      setLinking(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <PillButton
            size="compact"
            type="button"
            variant="ghost"
            label="Link to client or request"
            aria-label="Link to client or request"
          />
        }
      >
        <Link2 className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 p-3">
        {thread.client ? null : (
          <SearchableSelect
            ariaLabel="Client"
            typographyRole="control.menu"
            value={clientChoice}
            options={clientOptions}
            onChange={(value) => {
              setClientChoice(value);
              setRequestChoice(CLIENT_ONLY);
            }}
            placeholder="Choose a client"
          />
        )}
        <SearchableSelect
          ariaLabel="Request"
          typographyRole="control.menu"
          value={requestChoice}
          options={requestOptions}
          disabled={!clientOrgId}
          onChange={setRequestChoice}
          placeholder="Choose a request"
        />
        <div className="flex justify-end">
          <PillButton
            size="compact"
            type="button"
            disabled={!clientOrgId || linking}
            onClick={() => void link()}
          >
            {linking ? "Linking…" : "Link"}
          </PillButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One-click link to the request Spot suggested, for exactly that client and request. */
export function LinkSuggestionBar({
  threadId,
  suggestion,
  onLinked,
}: {
  threadId: Id<"teamEmailThreads">;
  suggestion: {
    requestId: Id<"procurementRequests">;
    clientOrgId: Id<"organizations">;
    requestTitle: string;
  };
  onLinked?: () => void;
}) {
  const linkThread = useMutation(api.teamInbox.linkThread);
  const [linking, setLinking] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-2">
      <p className={`min-w-0 truncate text-muted-foreground ${typeStyle("caption.default")}`}>
        Looks like {suggestion.requestTitle}
      </p>
      <PillButton
        type="button"
        size="compact"
        variant="ghost"
        disabled={linking}
        onClick={async () => {
          setLinking(true);
          try {
            await linkThread({
              threadId,
              requestId: suggestion.requestId,
              clientOrgId: suggestion.clientOrgId,
            });
            toast.success("Conversation linked");
            onLinked?.();
          } catch (error) {
            toast.error(
              getUserFacingErrorMessage(error, "Could not link conversation"),
            );
          } finally {
            setLinking(false);
          }
        }}
      >
        {linking ? "Linking…" : "Link to request"}
      </PillButton>
    </div>
  );
}
