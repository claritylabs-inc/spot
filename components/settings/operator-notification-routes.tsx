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
      return `Last alert queued ${when}, waiting to send.`;
    case "sending":
      return `Last alert is being sent (${when}).`;
    case "sent":
      return `Last alert sent ${when}.`;
    case "suppressed":
      return `Last alert not sent ${when}: this category was off or had no channel.`;
    case "cancelled":
      return `Last alert cancelled ${when} because the channel changed.`;
    case "failed":
      return `Last alert could not be delivered ${when}. Check that Spot is still in the channel.`;
    default:
      return `Last alert ${when}: delivery could not be confirmed. It may or may not have reached Slack, and Spot will not resend it.`;
  }
}

function RouteRow({
  route,
  label,
  description,
  channels,
  channelsReady,
  readOnly,
}: {
  route: Route;
  label: string;
  description: string;
  channels: SlackChannel[];
  channelsReady: boolean;
  readOnly: boolean;
}) {
  const setRoute = useLeaderOnly(useAction(api.actions.operatorNotifications.setRoute));
  const [saving, setSaving] = useState(false);
  const channelMenu = useFollowedOpen(
    `settings:operator-notifications:${route.category}:channel`,
  );
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);

  const shownChannelId = pendingChannelId ?? route.channelId ?? "";
  const options =
    route.channelId && !channels.some((channel) => channel.id === route.channelId)
      ? [{ id: route.channelId, name: route.channelName ?? route.channelId }, ...channels]
      : channels;
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
  return (
    <div className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={typeStyle("body.medium")}>{label}</p>
          <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>
            {description}
          </p>
        </div>
        <SettingsSwitch
          label={`${label} alerts`}
          checked={route.enabled}
          disabled={disabled || !route.channelId}
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
        disabled={disabled || !channelsReady}
      >
        <SelectTrigger aria-label={`${label} Slack channel`} className="w-full">
          <SelectValue>
            {shown ? `#${shown.name}` : channelsReady ? "Select a channel" : "Loading channels…"}
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
      {route.latestDelivery ? (
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          {deliveryText(route.latestDelivery)}
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
    try {
      setChannels(await listChannels({}));
      setChannelsReady(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [listChannels]);

  useEffect(() => {
    if (!available) return;
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [available, load]);

  return (
    <OperationalPanel>
      <OperationalPanelHeader title="Slack alerts" />
      <OperationalPanelBody>
        <p className={`mb-4 text-muted-foreground ${typeStyle("body.default")}`}>
          Global operator alerts for the whole team, posted to joined channels in
          the internal Spot workspace. Enabling a category does not resend past
          events. A saved Applications channel replaces the single alert sent for
          submitted applications; progress threads are unchanged.
        </p>
        {!data ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
          </div>
        ) : !data.available ? (
          <div
            className={`rounded-lg border border-dashed border-border-emphasized px-3 py-4 text-muted-foreground ${typeStyle("body.default")}`}
          >
            {data.unavailableReason ??
              "Operator Slack alerts are not configured for this environment."}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p
                className={`${loadError ? "text-destructive" : "text-muted-foreground"} ${typeStyle("caption.default")}`}
              >
                {loadError
                  ? "Channels could not be loaded. Refresh and try again."
                  : "Only channels Spot has joined are listed."}
              </p>
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
                    description={entry.description}
                    channels={channels}
                    channelsReady={channelsReady}
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
