"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import dayjs from "dayjs";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import {
  OPERATOR_NOTIFICATION_CATEGORIES,
  type OperatorNotificationCategory,
} from "@/convex/lib/operatorNotificationTypes";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  useFollowedOpen,
  useIsFollowing,
  useLeaderOnly,
} from "@/hooks/use-followed-state";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type SlackChannel = { id: string; name: string };

type Route = {
  category: OperatorNotificationCategory;
  enabled: boolean;
  channelId?: string;
  channelName?: string;
  revision: number;
  latestDelivery?: { status: string; errorCode?: string; createdAt: number };
};

function deliveryText(delivery: NonNullable<Route["latestDelivery"]>) {
  const when = dayjs(delivery.createdAt).format("MMM D, h:mm A");
  switch (delivery.status) {
    case "pending":
      return `Queued · ${when}`;
    case "sending":
      return `Sending · ${when}`;
    case "sent":
      return `Sent · ${when}`;
    case "suppressed":
      return null;
    case "cancelled":
      return null;
    case "failed":
      return `Delivery failed · ${when}. Check Spot’s channel access.`;
    default:
      return `Delivery unconfirmed · ${when}. Check Slack.`;
  }
}

function RouteRow({
  route,
  label,
  channels,
  available,
  channelsReady,
  loadError,
  readOnly,
}: {
  route: Route;
  label: string;
  channels: SlackChannel[];
  available: boolean;
  channelsReady: boolean;
  loadError: boolean;
  readOnly: boolean;
}) {
  const setRoute = useLeaderOnly(useAction(api.actions.operatorNotifications.setRoute));
  const [saving, setSaving] = useState(false);
  const channelMenu = useFollowedOpen(
    `settings:operator-notifications:${route.category}:channel`,
  );
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);

  const shownChannelId = pendingChannelId ?? route.channelId ?? "";
  const choices = channelsReady ? channels : [];
  const options =
    route.channelId && !choices.some((channel) => channel.id === route.channelId)
      ? [{ id: route.channelId, name: route.channelName ?? route.channelId }, ...choices]
      : choices;
  const shown = options.find((channel) => channel.id === shownChannelId);

  async function save(next: { enabled: boolean; channelId?: string }, failure: string) {
    setSaving(true);
    try {
      await setRoute({
        category: route.category,
        enabled: next.enabled,
        channelId: next.channelId,
        expectedRevision: route.revision,
      });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, failure));
    } finally {
      setPendingChannelId(null);
      setSaving(false);
    }
  }

  const disabled = readOnly || saving;
  const delivery = route.latestDelivery && deliveryText(route.latestDelivery);
  return (
    <div className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <p className={`min-w-0 ${typeStyle("body.medium")}`}>{label}</p>
        <SettingsSwitch
          label={`${label} alerts`}
          checked={route.enabled}
          disabled={
            disabled ||
            !route.channelId ||
            (!route.enabled && !(available && channelsReady))
          }
          onCheckedChange={() =>
            void save(
              { enabled: !route.enabled, channelId: route.channelId },
              "Notification setting could not be saved.",
            )
          }
        />
      </div>
      <Select
        {...channelMenu}
        value={shownChannelId || null}
        onValueChange={(next) => {
          if (typeof next !== "string" || next === route.channelId) return;
          setPendingChannelId(next);
          void save(
            { enabled: route.enabled, channelId: next },
            "Slack channel could not be saved.",
          );
        }}
        disabled={disabled || !available || !channelsReady}
      >
        <SelectTrigger aria-label={`${label} Slack channel`} className="w-full">
          <SelectValue>
            {shown
              ? `#${shown.name}`
              : !available
                ? "Unavailable"
                : channelsReady
                  ? "Select a channel"
                  : loadError
                    ? "Channels unavailable"
                    : "Loading channels…"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((channel) => (
            <SelectItem key={channel.id} value={channel.id}>
              #{channel.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {delivery ? (
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          {delivery}
        </p>
      ) : null}
    </div>
  );
}

export function OperatorNotificationRoutes({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const data = useQuery(api.operatorNotifications.getRoutes, {});
  const listChannels = useAction(api.actions.operatorNotifications.listSlackChannels);
  const following = useIsFollowing();
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [channelsReady, setChannelsReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const available = data?.available === true;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setChannelsReady(false);
    try {
      setChannels(await listChannels({}));
      setChannelsReady(true);
    } catch {
      setChannels([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [listChannels]);

  useEffect(() => {
    if (!available) {
      const reset = window.setTimeout(() => setChannelsReady(false), 0);
      return () => window.clearTimeout(reset);
    }
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [available, load]);

  return (
    <OperationalPanel>
      <OperationalPanelHeader title="Slack alerts" />
      <OperationalPanelBody>
        {!data ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
          </div>
        ) : (
          <div className="space-y-4">
            {!data.available ? (
              <div
                className={`rounded-lg border border-dashed border-border-emphasized px-3 py-4 text-muted-foreground ${typeStyle("body.default")}`}
              >
                {data.unavailableReason ??
                  "Connect Slack to enable alerts."}
              </div>
            ) : (
              <div className="flex items-center justify-end gap-3">
                {loadError || (channelsReady && channels.length === 0) ? (
                  <p className={`${loadError ? "text-destructive" : "text-muted-foreground"} ${typeStyle("caption.default")}`}>
                    {loadError
                      ? "Couldn’t load channels. Try refreshing."
                      : "Invite Spot to an internal Slack channel, then refresh."}
                  </p>
                ) : null}
                <PillButton
                  variant="secondary"
                  size="small"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  {loading ? (
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Refresh channels
                </PillButton>
              </div>
            )}
            <div className="divide-y divide-border">
              {OPERATOR_NOTIFICATION_CATEGORIES.map((entry) => {
                const route = data.routes.find(
                  (candidate) => candidate.category === entry.category,
                ) ?? { category: entry.category, enabled: false, revision: 0 };
                return (
                  <RouteRow
                    key={`${entry.category}:${route.revision}:${following ? "following" : "own"}`}
                    route={route}
                    label={entry.label}
                    channels={channels}
                    available={available}
                    channelsReady={channelsReady}
                    loadError={loadError}
                    readOnly={disabled || following}
                  />
                );
              })}
            </div>
          </div>
        )}
      </OperationalPanelBody>
    </OperationalPanel>
  );
}
