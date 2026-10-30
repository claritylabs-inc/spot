"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { PillButton } from "@/components/ui/pill-button";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
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

type ContextThread = {
  _id: Id<"teamEmailThreads">;
  source: "forward" | "outreach" | "team";
  client: { _id: Id<"organizations">; name: string } | null;
  request: { requestId: Id<"procurementRequests">; title: string } | null;
  linkSuggestion: {
    requestId: Id<"procurementRequests">;
    clientOrgId: Id<"organizations">;
    requestTitle: string;
  } | null;
};

/**
 * The client and request a conversation belongs to, shown under the reader's
 * title. Unlinked mail shows Spot's suggestion instead. The trailing control
 * links, relinks, or moves the conversation; outreach mail stays with its request.
 */
export function ThreadClientContext({
  thread,
  readOnly,
  onMoved,
}: {
  thread: ContextThread;
  readOnly: boolean;
  /** After the conversation moves to another request. */
  onMoved?: () => void;
}) {
  const clients = useCachedOperatorClients();
  const linkThread = useMutation(api.teamInbox.linkThread);
  const [linking, setLinking] = useState(false);
  const suggestion = thread.client ? null : thread.linkSuggestion;
  const shownClientId = thread.client?._id ?? suggestion?.clientOrgId;
  const shownClient = clients?.find((client) => client._id === shownClientId);
  const editable = !readOnly && thread.source !== "outreach";
  const brand = shownClient ? (
    <OrgBrandIcon
      name={shownClient.name}
      iconUrl={shownClient.iconUrl}
      website={shownClient.website}
      size="xs"
    />
  ) : null;

  async function linkSuggested() {
    if (!suggestion || linking) return;
    setLinking(true);
    try {
      await linkThread({
        threadId: thread._id,
        requestId: suggestion.requestId,
        clientOrgId: suggestion.clientOrgId,
      });
      toast.success("Conversation linked");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not link conversation"));
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className={`flex min-h-14 items-center gap-2 px-4 py-2 ${typeStyle("body.default")} ${suggestion ? "bg-muted/40" : ""}`}>
      {thread.client ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {brand}
          <Link
            href={`/operator/clients/${thread.client._id}`}
            className="min-w-0 shrink truncate text-foreground hover:underline"
          >
            {thread.client.name}
          </Link>
          {thread.request ? (
            <>
              <span aria-hidden="true" className="text-muted-foreground/60">/</span>
              <Link
                href={`/operator/clients/${thread.client._id}/procurement/${thread.request.requestId}`}
                className="min-w-0 shrink-[2] truncate text-foreground hover:underline"
              >
                {thread.request.title}
              </Link>
            </>
          ) : null}
        </span>
      ) : suggestion ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {brand}
          {shownClient ? (
            <>
              <span className="min-w-0 shrink truncate text-foreground">{shownClient.name}</span>
              <span aria-hidden="true" className="text-muted-foreground/60">/</span>
            </>
          ) : null}
          <span className="min-w-0 shrink-[2] truncate text-foreground">{suggestion.requestTitle}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Not linked to a client</span>
      )}
      {editable && suggestion ? (
        <PillButton size="compact" type="button" disabled={linking} onClick={() => void linkSuggested()}>
          {linking ? "Linking…" : "Link"}
        </PillButton>
      ) : null}
      {editable ? (
        <ThreadLinkPicker
          thread={thread}
          label={thread.client ? "Change" : suggestion ? "Other" : "Link"}
          onMoved={onMoved}
        />
      ) : null}
    </div>
  );
}

/**
 * Links an unlinked or client-only conversation to a client and, optionally,
 * one of its requests, or moves a request's conversation to another request of
 * the same client. A failed change keeps the selection so it can be retried.
 */
function ThreadLinkPicker({
  thread,
  label,
  onMoved,
}: {
  thread: ContextThread;
  label: string;
  onMoved?: () => void;
}) {
  const linkThread = useMutation(api.teamInbox.linkThread);
  const updateThread = useMutation(api.procurementRequests.updateEmailThread);
  const clients = useCachedOperatorClients();
  const { open, onOpenChange } = useFollowedOpen(`inbox:link-thread:${thread._id}:open`);
  const [clientChoice, setClientChoice] = useState("");
  const [requestChoice, setRequestChoice] = useState(CLIENT_ONLY);
  const [saving, setSaving] = useState(false);
  const predictLink = useAction(api.actions.teamEmailForwarding.predictLink);
  const [prediction, setPrediction] = useState<{
    threadId: Id<"teamEmailThreads">;
    requestId: Id<"procurementRequests">;
    reason: string;
  } | null>(null);
  const predictedFor = useRef<string | null>(null);
  const moving = Boolean(thread.request);

  // Spot's guess prefills the pickers once per thread; it never overrides a choice already made.
  useEffect(() => {
    if (!open || moving || predictedFor.current === thread._id) return;
    predictedFor.current = thread._id;
    let cancelled = false;
    predictLink({ threadId: thread._id })
      .then((result) => {
        if (cancelled || !result) return;
        setPrediction({ threadId: thread._id, requestId: result.requestId, reason: result.reason });
        setClientChoice((current) => current || result.clientOrgId);
        setRequestChoice((current) => (current === CLIENT_ONLY ? result.requestId : current));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (predictedFor.current === thread._id) predictedFor.current = null;
    };
  }, [open, moving, predictLink, thread._id]);
  const clientOrgId = (thread.client?._id ?? clientChoice) as Id<"organizations"> | "";
  const requests = useQuery(
    api.procurementRequests.list,
    open && clientOrgId ? { clientOrgId } : "skip",
  );
  const clientOptions = useMemo(
    () =>
      (clients ?? []).map((client) => ({
        value: client._id,
        label: client.name,
        icon: (
          <OrgBrandIcon name={client.name} iconUrl={client.iconUrl} website={client.website} size="xs" />
        ),
      })),
    [clients],
  );
  const requestOptions = useMemo(
    () => [
      ...(moving ? [] : [{ value: CLIENT_ONLY, label: "No request (client only)" }]),
      ...(requests ?? [])
        .filter((request) => request._id !== thread.request?.requestId)
        .map((request) => ({ value: request._id, label: request.title })),
    ],
    [moving, requests, thread.request?.requestId],
  );

  async function save() {
    if (!clientOrgId || saving || (moving && requestChoice === CLIENT_ONLY)) return;
    setSaving(true);
    try {
      if (moving) {
        await updateThread({
          emailThreadId: thread._id,
          requestId: requestChoice as Id<"procurementRequests">,
        });
        toast.success("Conversation moved");
      } else {
        await linkThread({
          threadId: thread._id,
          clientOrgId,
          ...(requestChoice !== CLIENT_ONLY
            ? { requestId: requestChoice as Id<"procurementRequests"> }
            : {}),
        });
        toast.success("Conversation linked");
      }
      onOpenChange(false);
      setRequestChoice(CLIENT_ONLY);
      if (moving) onMoved?.();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, moving ? "Could not move conversation" : "Could not link conversation"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<PillButton size="compact" type="button" variant="ghost" />}>
        {label}
        <ChevronDown className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 p-3">
        <SearchableSelect
          ariaLabel="Client"
          typographyRole="control.menu"
          value={clientOrgId}
          options={clientOptions}
          disabled={Boolean(thread.client)}
          onChange={(value) => {
            setClientChoice(value);
            setRequestChoice(CLIENT_ONLY);
          }}
          placeholder="Choose a client"
        />
        <SearchableSelect
          ariaLabel="Request"
          typographyRole="control.menu"
          value={requestChoice === CLIENT_ONLY && moving ? "" : requestChoice}
          options={requestOptions}
          disabled={!clientOrgId}
          onChange={setRequestChoice}
          placeholder={moving ? "Move to request" : "Choose a request"}
        />
        {moving ? (
          <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
            A conversation on a request moves only within its client.
          </p>
        ) : prediction?.threadId === thread._id && requestChoice === prediction.requestId ? (
          <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
            Suggested by Jev{prediction.reason ? `: ${prediction.reason}` : ""}
          </p>
        ) : null}
        <div className="flex justify-end">
          <PillButton
            size="compact"
            type="button"
            disabled={!clientOrgId || saving || (moving && requestChoice === CLIENT_ONLY)}
            onClick={() => void save()}
          >
            {moving ? (saving ? "Moving…" : "Move") : saving ? "Linking…" : "Link"}
          </PillButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}
