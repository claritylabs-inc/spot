"use client";

import { Component, type ReactNode, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { PillButton } from "@/components/ui/pill-button";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";

type Subscription =
  FunctionReturnType<typeof api.mcpEvents.listSubscriptions>[number];

const EVENT_LABELS: Record<string, string> = {
  "compliance.status_changed": "Compliance status changed",
  "vendor.policy_expiring": "Vendor policy expiring",
  "policy.ready": "Policy ready",
  "policy.review_required": "Policy review required",
  "proposal.review_ready": "Proposal review ready",
  "procurement.request_updated": "Procurement request updated",
};

function eventLabel(name: string) {
  return EVENT_LABELS[name] ?? name.replaceAll(".", " · ");
}

function filterLabel(name: string) {
  return name.replaceAll("_", " ");
}

function filterValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null) return "none";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function scopeLabel(filters: Record<string, unknown>) {
  const entries = Object.entries(filters);
  if (entries.length === 0) return "All matching records";
  return entries
    .map(([key, value]) => `${filterLabel(key)}: ${filterValue(value)}`)
    .join(" · ");
}

function subscriptionState(subscription: Subscription): {
  label: string;
  tone: "danger" | "warning" | "success";
} {
  if (!subscription.active) {
    return { label: "Revoked", tone: "danger" };
  }
  if (subscription.expiresAt <= Date.now()) {
    return { label: "Expired", tone: "warning" };
  }
  return { label: "Active", tone: "success" };
}

function SubscriptionRow({
  subscription,
  stopping,
  onStop,
}: {
  subscription: Subscription;
  stopping: boolean;
  onStop: () => void;
}) {
  const status = subscriptionState(subscription);
  const canStop = status.label === "Active";

  return (
    <div className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className={`text-foreground ${typeStyle("body.medium")}`}>
          {eventLabel(subscription.name)}
        </p>
        <p
          className={`mt-1 break-all text-muted-foreground ${typeStyle("technical.codeCompact")}`}
        >
          {subscription.callbackOrigin}
        </p>
      </div>

      <div className="min-w-0">
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Scope
        </p>
        <p
          className={`mt-0.5 break-words text-foreground ${typeStyle("body.default")}`}
        >
          {scopeLabel(subscription.filters)}
        </p>
      </div>

      <div>
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Expires
        </p>
        <p className={`mt-0.5 text-foreground ${typeStyle("body.default")}`}>
          {dayjs(subscription.expiresAt).format("MMM D, YYYY h:mm A")}
        </p>
        <StatusTag tone={status.tone} className="mt-1">
          {status.label}
        </StatusTag>
      </div>

      <PillButton
        type="button"
        variant="destructive"
        size="compact"
        disabled={!canStop || stopping}
        onClick={onStop}
        aria-label={`Stop ${eventLabel(subscription.name)} subscription`}
      >
        {stopping ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {stopping ? "Stopping…" : "Stop"}
      </PillButton>
    </div>
  );
}

function McpEventSubscriptionsContent() {
  const subscriptions = useQuery(api.mcpEvents.listSubscriptions);
  const revokeSubscription = useMutation(api.mcpEvents.revokeSubscription);
  const [stoppingId, setStoppingId] = useState<Subscription["_id"] | null>(
    null,
  );

  async function stopSubscription(subscriptionId: Subscription["_id"]) {
    setStoppingId(subscriptionId);
    try {
      await revokeSubscription({ subscriptionId });
      toast.success("Event subscription stopped");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not stop event subscription"),
      );
    } finally {
      setStoppingId(null);
    }
  }

  return (
    <OperationalPanel>
      <OperationalPanelHeader
        title="MCP event subscriptions"
        description="Subscriptions created by ChatGPT after callback verification."
        className="px-5 py-3.5"
      />

      {subscriptions === undefined ? (
        <OperationalPanelBody className="px-5 py-8 text-center">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          <p
            className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}
          >
            Loading subscriptions…
          </p>
        </OperationalPanelBody>
      ) : subscriptions.length === 0 ? (
        <OperationalPanelBody className="px-5 py-8 text-center">
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No event subscriptions yet.
          </p>
          <p
            className={`mt-1 text-muted-foreground/70 ${typeStyle("caption.default")}`}
          >
            Ask ChatGPT to watch a compliance update; subscriptions appear here
            after the callback is verified.
          </p>
        </OperationalPanelBody>
      ) : (
        <div className="divide-y divide-border">
          {subscriptions.map((subscription) => (
            <SubscriptionRow
              key={subscription._id}
              subscription={subscription}
              stopping={stoppingId === subscription._id}
              onStop={() => void stopSubscription(subscription._id)}
            />
          ))}
        </div>
      )}

      <div className="border-t border-border px-5 py-4">
        <p className={`text-foreground ${typeStyle("body.medium")}`}>
          Ask ChatGPT to watch Spot
        </p>
        <p
          className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
        >
          Try: “Watch compliance for changes and tell me what needs attention.”
          For follow-ups, ask: “Draft a response, but do not send it.” Spot does
          not create subscriptions from this screen.
        </p>
      </div>
    </OperationalPanel>
  );
}

class McpEventSubscriptionsErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <OperationalPanel>
          <OperationalPanelHeader
            title="MCP event subscriptions"
            className="px-5 py-3.5"
          />
          <OperationalPanelBody className="px-5 py-8 text-center">
            <p className={`text-foreground ${typeStyle("body.default")}`}>
              Subscriptions could not be loaded.
            </p>
            <PillButton
              type="button"
              variant="secondary"
              size="compact"
              className="mt-3"
              onClick={this.props.onRetry}
            >
              Try again
            </PillButton>
          </OperationalPanelBody>
        </OperationalPanel>
      );
    }

    return this.props.children;
  }
}

export function McpEventSubscriptions() {
  const [attempt, setAttempt] = useState(0);

  return (
    <McpEventSubscriptionsErrorBoundary
      key={attempt}
      onRetry={() => setAttempt((current) => current + 1)}
    >
      <McpEventSubscriptionsContent />
    </McpEventSubscriptionsErrorBoundary>
  );
}
