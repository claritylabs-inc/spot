"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { ChevronDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

type SlackChannel = {
  id: string;
  name: string;
  isMember: boolean;
  isPrivate: boolean;
  isShared: boolean;
};

export function SlackConnectionFields({
  clientOrgId,
  currentChannelId,
  knownChannels,
  supportChannelId,
  canEdit,
  refreshToken = 0,
}: {
  clientOrgId: Id<"organizations">;
  currentChannelId?: string;
  knownChannels: Array<{
    channelId: string;
    channelName: string;
    isPrivate: boolean;
    isShared: boolean;
  }>;
  supportChannelId?: string;
  canEdit: boolean;
  refreshToken?: number;
}) {
  const listChannels = useAction(
    api.slackOnboarding.listAvailableChannels,
  );
  const selectChannel = useAction(
    api.slackOnboarding.selectAutomaticChannel,
  );
  const joinPublicChannel = useAction(
    api.slackOnboarding.joinPublicChannel,
  );
  const leavePublicChannel = useAction(
    api.slackOnboarding.leavePublicChannel,
  );
  const [channels, setChannels] = useState<SlackChannel[]>(
    knownChannels.map((channel) => ({
      id: channel.channelId,
      name: channel.channelName,
      isMember: true,
      isPrivate: channel.isPrivate,
      isShared: channel.isShared,
    })),
  );
  const [selectedChannelId, setSelectedChannelId] = useState(
    currentChannelId ?? "",
  );
  const [loading, setLoading] = useState(canEdit);
  const [loadError, setLoadError] = useState(false);
  const [changingChannelId, setChangingChannelId] = useState<string | null>(
    null,
  );
  const joinedChannels = channels.filter((channel) => channel.isMember);
  const selectedChannel = joinedChannels.find(
    (channel) => channel.id === selectedChannelId,
  );
  const autoSave = useLocalFirstAutoSave({
    mutationName: `client.slackChannel.select.${clientOrgId}`,
    args: { clientOrgId, channelId: selectedChannelId },
    valueKey: selectedChannelId,
    resetKey: `${clientOrgId}:${currentChannelId ?? "unselected"}`,
    enabled: canEdit,
    canSave: Boolean(selectedChannelId && selectedChannel),
    delayMs: 0,
    flush: selectChannel,
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Slack channel could not be changed"),
  });

  const loadChannels = useCallback(async () => {
    if (!canEdit) return;
    setLoading(true);
    setLoadError(false);
    try {
      const result = await listChannels({ clientOrgId });
      setChannels(result.channels);
      const active = result.channels.filter((channel) => channel.isMember);
      if (active.length === 1) {
        setSelectedChannelId(active[0].id);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [canEdit, clientOrgId, listChannels]);

  useEffect(() => {
    if (!canEdit) return;
    const timeout = window.setTimeout(() => void loadChannels(), 0);
    return () => window.clearTimeout(timeout);
  }, [canEdit, loadChannels, refreshToken]);

  async function addChannel(channelId: string) {
    setChangingChannelId(channelId);
    try {
      const result = await joinPublicChannel({ clientOrgId, channelId });
      setChannels(result.channels);
      const active = result.channels.filter((channel) => channel.isMember);
      if (active.length === 1) setSelectedChannelId(active[0].id);
      toast.success(`Spot added to #${result.channel.name}`);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Spot could not be added to the channel",
        ),
      );
    } finally {
      setChangingChannelId(null);
    }
  }

  async function removeChannel(channelId: string) {
    setChangingChannelId(channelId);
    try {
      const result = await leavePublicChannel({ clientOrgId, channelId });
      setChannels(result.channels);
      if (selectedChannelId === channelId) {
        const active = result.channels.filter((channel) => channel.isMember);
        setSelectedChannelId(active[0]?.id ?? "");
      }
      toast.success(`Spot removed from #${result.channel.name}`);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Spot could not be removed from the channel",
        ),
      );
    } finally {
      setChangingChannelId(null);
    }
  }

  const selectedLabel = loading
    ? "Loading channels…"
    : joinedChannels.length === 0
      ? "Select channels"
      : `${joinedChannels.length} ${joinedChannels.length === 1 ? "channel" : "channels"} active`;

  return (
    <div className="space-y-5">
      {canEdit ? (
        <div className="space-y-1.5">
          <label
            htmlFor="slack-channel-picker"
            className={`text-muted-foreground ${typeStyle("label.field")}`}
          >
            Channels
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={loading || changingChannelId !== null}
              render={
                <button
                  id="slack-channel-picker"
                  type="button"
                  className={`flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-popover px-3 text-left text-foreground outline-none transition-colors hover:border-border-hover focus-visible:border-border-focus focus-visible:ring-1 focus-visible:ring-input disabled:cursor-not-allowed disabled:opacity-50 ${typeStyle("control.button")}`}
                >
                  <span className="truncate">{selectedLabel}</span>
                  {changingChannelId ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
                  ) : (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              }
            />
            <DropdownMenuContent align="start">
              {channels.length > 0 ? (
                channels.map((channel) => (
                  <DropdownMenuCheckboxItem
                    key={channel.id}
                    checked={channel.isMember}
                    disabled={channel.isPrivate || channel.isShared}
                    onCheckedChange={(checked) => {
                      if (checked && !channel.isMember) {
                        void addChannel(channel.id);
                      } else if (!checked && channel.isMember) {
                        void removeChannel(channel.id);
                      }
                    }}
                  >
                    #{channel.name}
                  </DropdownMenuCheckboxItem>
                ))
              ) : (
                <DropdownMenuItem disabled>No channels available</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {loadError ? (
            <p className={`text-destructive ${typeStyle("caption.default")}`}>
              Channels could not be loaded. Refresh and try again.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>Active channels</p>
        {joinedChannels.length > 0 ? (
          <div className="divide-y divide-border rounded-lg border border-border bg-popover px-3">
            {joinedChannels.map((channel) => (
              <div
                key={channel.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <p className={`min-w-0 truncate text-foreground ${typeStyle("body.default")}`}>
                  #{channel.name}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  {channel.id === supportChannelId ? (
                    <Badge variant="outline">Support</Badge>
                  ) : null}
                  {channel.id === selectedChannelId ? (
                    <Badge variant="outline">Default</Badge>
                  ) : null}
                  {canEdit && !channel.isPrivate && !channel.isShared ? (
                    <button
                      type="button"
                      onClick={() => void removeChannel(channel.id)}
                      disabled={changingChannelId !== null}
                      aria-label={`Remove Spot from #${channel.name}`}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-emphasized disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {changingChannelId === channel.id ? (
                        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`rounded-lg border border-dashed border-border-emphasized px-3 py-4 text-muted-foreground ${typeStyle("body.default")}`}>
            No active channels.
          </div>
        )}
      </div>

      {joinedChannels.length > 1 ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="slack-channel-name"
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              Default channel
            </label>
            <AutoSaveStatus status={autoSave.status} />
          </div>
          <Select
            value={selectedChannelId || null}
            onValueChange={(nextChannelId) => {
              if (typeof nextChannelId === "string") {
                setSelectedChannelId(nextChannelId);
              }
            }}
            disabled={!canEdit || loading}
          >
            <SelectTrigger id="slack-channel-name" className="w-full">
              <SelectValue>
                {selectedChannel
                  ? `#${selectedChannel.name}`
                  : "Select default"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {joinedChannels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {canEdit ? (
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Add or remove private and Slack Connect channels in Slack.
        </p>
      ) : null}
    </div>
  );
}
