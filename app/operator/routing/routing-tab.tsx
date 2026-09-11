"use client";

import dayjs from "dayjs";
import { useAction, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { showOperationalStatusToast } from "@/components/ui/operational-toast";
import { StatusTag } from "@/components/ui/status-tag";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";

type Route = { provider: string; model: string };
export type RoutingEvent = Doc<"modelRoutingEvents">;
type RouterHealth = {
  status: "ok" | "degraded";
  environment: string;
  database: boolean;
  frozen: boolean;
  policyVersion: string | null;
};
type Candidate = Route & {
  rank: number;
  role: "primary" | "challenger" | "fallback" | "quarantined";
  trafficPct: number;
  ratingScore?: number;
  ratingCount?: number;
};
type Policy = {
  id: string;
  version: number;
  taskFamily: string;
  explorationPct: number;
  frozen: boolean;
  frozenRoute: Route | null;
  candidates: Candidate[];
};
type Rollup = {
  hourStart: string;
  taskFamily: string;
  provider: string;
  model: string;
  callCount: number;
  successCount: number;
  fallbackCount: number;
  providerErrorCount: number;
  cacheHitCount: number;
  positiveRatingCount?: number;
  negativeRatingCount?: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  pricedCallCount: number;
  costNanoUsd: string;
};
type DashboardResult = {
  configured: boolean;
  fetchedAt: number;
  health: { data: RouterHealth | null; error: string | null };
  policy: { data: Policy | Policy[] | null; error: string | null };
  rollups: { data: Rollup[] | null; error: string | null };
  controls?: { available: boolean; error: string | null };
};
type FreezeResult = {
  frozen: boolean;
  policyVersion: string;
  controlVersion: string;
};
type HourlyActivity = {
  hourStart: number;
  calls: number;
  successes: number;
  errors: number;
};

export function routeLabel(route: Route | null | undefined) {
  return route ? `${route.provider} / ${route.model}` : "None";
}

export function actualRouteLabel(event: RoutingEvent) {
  if (event.provider && event.model) {
    return routeLabel({ provider: event.provider, model: event.model });
  }
  return event.status === "error" ? "Not reported" : "None";
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatCost(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: value < 0.01 ? 6 : 2,
  }).format(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatIdentifier(value: string | undefined) {
  return value?.replaceAll("_", " ") ?? "—";
}

function formatTokenCount(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString();
}

function formatOptionalBoolean(value: boolean | undefined) {
  return value === undefined ? "—" : value ? "Yes" : "No";
}

function hasUsageTelemetry(event: RoutingEvent) {
  return [
    event.inputTokens,
    event.outputTokens,
    event.reasoningTokens,
    event.cachedInputTokens,
    event.cacheWriteTokens,
    event.maxOutputTokens,
    event.finishReason,
    event.visibleTextLength,
    event.toolCallCount,
  ].some((value) => value !== undefined);
}

export function routingEventOutcome(event: RoutingEvent) {
  if (event.kind === "direct_fallback") {
    return {
      label: "Fell back",
      tone: "warning" as const,
      description:
        "A legacy routed path failed before Spot observed output or tool execution, so the retired consumer transport used a direct fallback route.",
    };
  }
  if (event.status === "error") {
    return {
      label: "Failed",
      tone: "danger" as const,
      description: "The model workflow did not complete.",
    };
  }
  if (event.status === "incomplete") {
    return {
      label: "Incomplete",
      tone: "warning" as const,
      description: event.hitOutputLimit
        ? "The model reached its output limit before completing a usable response."
        : "The model call ended without a usable customer response.",
    };
  }
  if (event.fallbackModel) {
    return {
      label: "Recovered",
      tone: "warning" as const,
      description:
        "The primary route failed before Spot observed output or tool execution, and the configured fallback completed the run.",
    };
  }
  return {
    label: "Succeeded",
    tone: "success" as const,
    description: "The routed model call completed.",
  };
}

export function routingEventSummary(event: RoutingEvent) {
  if (event.kind === "direct_fallback") {
    return event.error ?? "A legacy Spot caller used its retired direct route.";
  }
  if (event.kind === "run") {
    return event.error ?? formatIdentifier(event.completionIssue ?? event.status);
  }
  return formatIdentifier(event.routing?.decision);
}

function eventDetailTitle(event: RoutingEvent) {
  if (event.kind === "direct_fallback") return "Legacy direct fallback";
  if (event.kind === "run") return "Agent run";
  return "Model call";
}

export function RoutingEventDrawer({
  event,
  onClose,
}: {
  event: RoutingEvent;
  onClose: () => void;
}) {
  const outcome = routingEventOutcome(event);
  const route = actualRouteLabel(event);

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={eventDetailTitle(event)}
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag tone={outcome.tone}>{outcome.label}</StatusTag>
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              {formatDisplayDateTime(event.timestamp)}
            </span>
          </div>
          <p
            className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}
          >
            {outcome.description}
          </p>
        </div>

        <OperationalLabelValueList title="Call">
          <OperationalLabelValueRow label="Task" value={event.task} />
          <OperationalLabelValueRow
            label="Surface"
            value={`${event.channel}${event.step ? ` · step ${event.step}` : ""}`}
          />
          <OperationalLabelValueRow
            label="Phase"
            value={`${formatIdentifier(event.phase)} · ${formatIdentifier(event.label)}`}
          />
          <OperationalLabelValueRow label="Actual route" value={route} />
          <OperationalLabelValueRow
            label="Transport"
            value={formatIdentifier(event.transport)}
          />
          {event.fallbackModel ? (
            <OperationalLabelValueRow
              label="Fallback"
              value={`${event.fallbackProvider ?? "unknown"} / ${event.fallbackModel}`}
            />
          ) : null}
          <OperationalLabelValueRow
            label="Request ID"
            value={
              event.requestId ? (
                <code
                  className={`break-all ${typeStyle("technical.codeCompact")}`}
                >
                  {event.requestId}
                </code>
              ) : (
                "—"
              )
            }
          />
          <OperationalLabelValueRow
            label="Run ID"
            value={
              <code
                className={`break-all ${typeStyle("technical.codeCompact")}`}
              >
                {event.runId}
              </code>
            }
          />
          {event.error ? (
            <OperationalLabelValueRow
              label="Error"
              value={<span className="text-destructive">{event.error}</span>}
            />
          ) : null}
          {event.completionIssue ? (
            <OperationalLabelValueRow
              label="Completion issue"
              value={formatIdentifier(event.completionIssue)}
            />
          ) : null}
          {event.fallbackReason && !event.error ? (
            <OperationalLabelValueRow
              label="Fallback reason"
              value={
                <span className="text-warning">{event.fallbackReason}</span>
              }
            />
          ) : null}
        </OperationalLabelValueList>

        {event.routerCode || event.failureAttempts?.length ? (
          <OperationalLabelValueList title="Router failure">
            <OperationalLabelValueRow
              label="Code"
              value={formatIdentifier(event.routerCode)}
            />
            <OperationalLabelValueRow
              label="HTTP status"
              value={event.routerStatus?.toString() ?? "—"}
            />
            <OperationalLabelValueRow
              label="Retryable"
              value={formatOptionalBoolean(event.routerRetryable)}
            />
            <OperationalLabelValueRow
              label="Provider execution started"
              value={formatOptionalBoolean(event.routerExecutionStarted)}
            />
            <OperationalLabelValueRow
              label="Failed attempts"
              value={event.failureAttempts?.length
                ? event.failureAttempts.map((attempt) =>
                    `${attempt.attempt}. ${attempt.provider} / ${attempt.model} · ${formatIdentifier(attempt.errorCode ?? attempt.outcome)}`
                  ).join("; ")
                : "—"}
            />
          </OperationalLabelValueList>
        ) : null}

        {event.kind === "model_step" ? (
          <OperationalLabelValueList title="Routing">
            <OperationalLabelValueRow
              label="Decision"
              value={formatIdentifier(event.routing?.decision)}
            />
            <OperationalLabelValueRow
              label="Route source"
              value={formatIdentifier(
                event.routeSource ?? event.routing?.routeSource,
              )}
            />
            <OperationalLabelValueRow
              label="Attempts"
              value={(event.routing?.attemptCount ?? 1).toLocaleString()}
            />
            <OperationalLabelValueRow
              label="Policy"
              value={event.routing?.policyVersion ?? "—"}
            />
            <OperationalLabelValueRow
              label="Sticky route"
              value={event.routing?.cacheStickinessApplied ? "Yes" : "No"}
            />
            {event.routing?.shadowMode ? (
              <OperationalLabelValueRow
                label="Shadow choice"
                value={`${routeLabel(event.routing.wouldHaveChosen)} · ${event.routing.wouldHaveMatched ? "matched" : "different"}`}
              />
            ) : null}
          </OperationalLabelValueList>
        ) : null}

        {hasUsageTelemetry(event) ? (
          <OperationalLabelValueList title="Usage">
            <OperationalLabelValueRow
              label="Input tokens"
              value={formatTokenCount(event.inputTokens)}
            />
            <OperationalLabelValueRow
              label="Output tokens"
              value={formatTokenCount(event.outputTokens)}
            />
            <OperationalLabelValueRow
              label="Reasoning tokens"
              value={formatTokenCount(event.reasoningTokens)}
            />
            <OperationalLabelValueRow
              label="Output limit"
              value={formatTokenCount(event.maxOutputTokens)}
            />
            <OperationalLabelValueRow
              label="Finish reason"
              value={formatIdentifier(event.finishReason)}
            />
            <OperationalLabelValueRow
              label="Hit output limit"
              value={
                event.hitOutputLimit === undefined
                  ? "—"
                  : event.hitOutputLimit
                    ? "Yes"
                    : "No"
              }
            />
            <OperationalLabelValueRow
              label="Visible response"
              value={
                event.visibleTextLength === undefined
                  ? "—"
                  : `${event.visibleTextLength.toLocaleString()} characters`
              }
            />
            <OperationalLabelValueRow
              label="Cached input"
              value={formatTokenCount(event.cachedInputTokens)}
            />
            <OperationalLabelValueRow
              label="Cache write"
              value={formatTokenCount(event.cacheWriteTokens)}
            />
            <OperationalLabelValueRow
              label="Cost"
              value={
                event.costUsd === null || event.costUsd === undefined
                  ? "Unpriced"
                  : formatCost(event.costUsd)
              }
            />
            {event.kind === "model_step" ? (
              <OperationalLabelValueRow
                label="Tools"
                value={
                  event.hasTools
                    ? event.hasToolResults
                      ? "Used with results"
                      : "Available"
                    : "None"
                }
              />
            ) : null}
            {event.toolCallCount !== undefined ? (
              <OperationalLabelValueRow
                label="Tool calls"
                value={`${event.toolCallCount.toLocaleString()} called · ${event.completedToolCount === undefined ? "completion unknown" : `${event.completedToolCount.toLocaleString()} completed`}`}
              />
            ) : null}
            {event.toolNames?.length ? (
              <OperationalLabelValueRow
                label="Tool names"
                value={event.toolNames.join(", ")}
              />
            ) : null}
          </OperationalLabelValueList>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}

function RateMeter({
  label,
  value,
  description,
  tone,
}: {
  label: string;
  value: number | null;
  description: string;
  tone: "success" | "cache" | "pricing";
}) {
  const percentage =
    value === null ? 0 : Math.min(100, Math.max(0, Math.round(value * 100)));
  const displayValue = value === null ? "—" : `${percentage}%`;

  return (
    <div className="min-w-0 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`text-foreground ${typeStyle("body.medium")}`}>{label}</p>
        <p className={`text-foreground ${typeStyle("data.numeric")}`}>
          {displayValue}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        aria-valuetext={displayValue}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/8"
      >
        <div
          className={cn(
            "h-full rounded-full",
            tone === "success" && "bg-chart-3",
            tone === "cache" && "bg-chart-1",
            tone === "pricing" && "bg-chart-4",
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p
        className={`mt-2 text-muted-foreground ${typeStyle("caption.default")}`}
      >
        {description}
      </p>
    </div>
  );
}

function RoutingActivityChart({ activity }: { activity: HourlyActivity[] }) {
  const maxCalls = Math.max(1, ...activity.map((hour) => hour.calls));
  const totalCalls = activity.reduce((sum, hour) => sum + hour.calls, 0);
  const firstHour = activity[0]?.hourStart;
  const middleHour = activity[Math.floor(activity.length / 2)]?.hourStart;
  const lastHour = activity.at(-1)?.hourStart;

  return (
    <div className="flex h-full min-w-0 flex-col p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            Model attempts by hour
          </p>
          <p
            className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Includes initial, retry, and fallback attempts.
          </p>
        </div>
        {totalCalls > 0 ? (
          <p className={`text-foreground ${typeStyle("data.numeric")}`}>
            {totalCalls.toLocaleString()} attempts
          </p>
        ) : null}
      </div>

      {totalCalls === 0 ? (
        <div
          role="status"
          className={`flex min-h-32 flex-1 items-center justify-center text-muted-foreground ${typeStyle("body.default")}`}
        >
          No model attempts in the last 24 hours.
        </div>
      ) : (
        <>
          <div className="relative mt-4">
            <div
              role="img"
              aria-label={`Hourly routing activity: ${totalCalls.toLocaleString()} model attempts in the last 24 hours`}
              className="grid h-32 grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-1 border-b border-border-emphasized px-1"
            >
              {activity.map((hour) => {
                const successfulCalls = Math.min(hour.successes, hour.calls);
                const errorCalls = Math.min(
                  hour.errors,
                  Math.max(0, hour.calls - successfulCalls),
                );
                const barHeight = hour.calls
                  ? Math.max(4, (hour.calls / maxCalls) * 100)
                  : 0;
                const successHeight = hour.calls
                  ? (successfulCalls / hour.calls) * 100
                  : 0;
                const errorHeight = hour.calls
                  ? (errorCalls / hour.calls) * 100
                  : 0;
                const hourLabel = dayjs(hour.hourStart).format("MMM D, h A");

                return (
                  <div
                    key={hour.hourStart}
                    className="flex h-full min-w-0 items-end"
                    title={`${hourLabel}: ${hour.calls.toLocaleString()} attempts, ${successfulCalls.toLocaleString()} successful, ${errorCalls.toLocaleString()} provider errors`}
                  >
                    {hour.calls ? (
                      <div
                        className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm bg-chart-2/35"
                        style={{ height: `${barHeight}%` }}
                      >
                        {successfulCalls ? (
                          <div
                            className="min-h-px w-full bg-chart-3"
                            style={{ height: `${successHeight}%` }}
                          />
                        ) : null}
                        {errorCalls ? (
                          <div
                            className="min-h-px w-full bg-destructive"
                            style={{ height: `${errorHeight}%` }}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <div className="h-px w-full bg-foreground/8" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className={`mt-2 flex justify-between text-muted-foreground ${typeStyle("caption.default")}`}
          >
            <span>{firstHour ? dayjs(firstHour).format("ddd h A") : "—"}</span>
            <span>
              {middleHour ? dayjs(middleHour).format("ddd h A") : "—"}
            </span>
            <span>{lastHour ? dayjs(lastHour).format("ddd h A") : "—"}</span>
          </div>
          <div
            className={`mt-3 flex flex-wrap gap-x-4 gap-y-2 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-chart-3" />
              Successful attempt
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-destructive" />
              Provider error
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function environmentLabel(environment: string | undefined) {
  if (!environment) return "Environment unavailable";
  if (environment === "production") return "Production";
  if (environment === "dev") return "Dev";
  if (environment === "local") return "Local dev";
  if (environment === "staging") return "Staging (retired)";
  return environment;
}

function compactIdentifier(value: string | null | undefined) {
  if (!value) return "None";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function useRouterDashboard() {
  const getDashboard = useAction(api.clRouterOperations.getDashboard);
  const updateGlobalFreeze = useAction(api.clRouterOperations.setGlobalFreeze);
  const [dashboard, setDashboard] = useState<DashboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [freezeLoading, setFreezeLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDashboard((await getDashboard({})) as DashboardResult);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [getDashboard]);

  useEffect(() => {
    let cancelled = false;
    void getDashboard({})
      .then((result) => {
        if (cancelled) return;
        setDashboard(result as DashboardResult);
        setLoadError(null);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getDashboard]);

  const setGlobalFreeze = useCallback(
    async (frozen: boolean) => {
      setFreezeLoading(true);
      showOperationalStatusToast({
        id: "router-global-freeze",
        title: frozen ? "Freezing autonomous routing" : "Unfreezing routing",
        description: "Updating the global cl-router control.",
        tone: "loading",
        duration: 60_000,
      });
      try {
        const result = (await updateGlobalFreeze({ frozen })) as FreezeResult;
        await refresh();
        showOperationalStatusToast({
          id: "router-global-freeze",
          title: result.frozen
            ? "Autonomous routing frozen"
            : "Autonomous routing enabled",
          description: result.frozen
            ? "Model calls will stay on their frozen routes."
            : "The active routing policy can choose eligible routes.",
          tone: "success",
          duration: 4_000,
        });
      } catch (error) {
        await refresh();
        showOperationalStatusToast({
          id: "router-global-freeze",
          title: "Routing control was not changed",
          description: getUserFacingErrorMessage(
            error,
            "Could not update the global routing freeze.",
          ),
          tone: "error",
          duration: 10_000,
        });
      } finally {
        setFreezeLoading(false);
      }
    },
    [refresh, updateGlobalFreeze],
  );

  return {
    dashboard,
    loading,
    loadError,
    refresh,
    freezeLoading,
    setGlobalFreeze,
  };
}

export type RouterDashboardState = ReturnType<typeof useRouterDashboard>;

export function RoutingTab({
  dashboard,
  loading,
  loadError,
  freezeLoading,
  setGlobalFreeze,
}: Pick<
  RouterDashboardState,
  "dashboard" | "loading" | "loadError" | "freezeLoading" | "setGlobalFreeze"
>) {
  const events = useQuery(api.modelRoutingEvents.listRecent, { limit: 200 });

  const policies = useMemo(() => {
    const value = dashboard?.policy.data;
    if (!value) return [];
    return (Array.isArray(value) ? value : [value])
      .slice()
      .sort((left, right) => left.taskFamily.localeCompare(right.taskFamily));
  }, [dashboard?.policy.data]);

  const recentRuns = useMemo(
    () => (events ?? []).filter((event) => event.kind === "run"),
    [events],
  );
  const shadowMode = (events ?? []).find(
    (event) => event.routing?.shadowMode !== undefined,
  )?.routing?.shadowMode;
  const health = dashboard?.health.data;
  const posture = health?.frozen
    ? "Frozen"
    : shadowMode === true
      ? "Shadow"
      : health
        ? "Autonomous"
        : "Unknown";
  const retiredStagingRouter = health?.environment === "staging";
  const controlError =
    dashboard?.controls?.error ??
    (dashboard?.configured
      ? "Router control metadata is unavailable. Refresh after the latest Convex functions are deployed."
      : null);
  const routerHealthy = health?.status === "ok" && health.database;
  const controlsAvailable = dashboard?.controls?.available === true;
  const routerStatus = retiredStagingRouter
    ? { label: "Retired environment", tone: "warning" as const }
    : routerHealthy
      ? { label: "Healthy", tone: "success" as const }
      : health
        ? { label: "Degraded", tone: "danger" as const }
        : { label: "Unavailable", tone: "neutral" as const };
  const controlNotice = loadError
    ? { title: "Router data unavailable", description: loadError }
    : retiredStagingRouter
      ? {
          title: "Connected to the retired staging router",
          description:
            "Spot now has dev and production only. Confirm CL_ROUTER_URL before changing this retired router.",
        }
      : !controlsAvailable && controlError
        ? {
            title: "Freeze control unavailable",
            description: controlError,
          }
        : null;
  const shadowSummary =
    shadowMode === undefined ? "No comparison yet" : shadowMode ? "On" : "Off";

  const last24HourRollups = useMemo(() => {
    const cutoff = dayjs().subtract(24, "hour");
    return (dashboard?.rollups.data ?? []).filter((row) =>
      dayjs(row.hourStart).isAfter(cutoff),
    );
  }, [dashboard?.rollups.data]);
  const totals = useMemo(
    () =>
      last24HourRollups.reduce(
        (sum, row) => ({
          calls: sum.calls + row.callCount,
          successes: sum.successes + row.successCount,
          fallbacks: sum.fallbacks + row.fallbackCount,
          errors: sum.errors + row.providerErrorCount,
          cacheHits: sum.cacheHits + row.cacheHitCount,
          positiveRatings:
            sum.positiveRatings + (row.positiveRatingCount ?? 0),
          negativeRatings:
            sum.negativeRatings + (row.negativeRatingCount ?? 0),
          pricedCalls: sum.pricedCalls + row.pricedCallCount,
          weightedP50: sum.weightedP50 + row.latencyP50Ms * row.callCount,
          peakP95: Math.max(sum.peakP95, row.latencyP95Ms),
          cost: sum.cost + Number(row.costNanoUsd) / 1_000_000_000,
        }),
        {
          calls: 0,
          successes: 0,
          fallbacks: 0,
          errors: 0,
          cacheHits: 0,
          positiveRatings: 0,
          negativeRatings: 0,
          pricedCalls: 0,
          weightedP50: 0,
          peakP95: 0,
          cost: 0,
        },
      ),
    [last24HourRollups],
  );
  const hourlyActivity = useMemo(() => {
    const byHour = new Map<
      number,
      { calls: number; successes: number; errors: number }
    >();
    for (const row of last24HourRollups) {
      const hourStart = dayjs(row.hourStart).startOf("hour").valueOf();
      const current = byHour.get(hourStart) ?? {
        calls: 0,
        successes: 0,
        errors: 0,
      };
      current.calls += row.callCount;
      current.successes += row.successCount;
      current.errors += row.providerErrorCount;
      byHour.set(hourStart, current);
    }

    const currentHour = dayjs().startOf("hour");
    return Array.from({ length: 24 }, (_, index) => {
      const hourStart = currentHour.subtract(23 - index, "hour").valueOf();
      return {
        hourStart,
        ...(byHour.get(hourStart) ?? {
          calls: 0,
          successes: 0,
          errors: 0,
        }),
      };
    });
  }, [last24HourRollups]);
  const failedRuns = recentRuns.filter(
    (run) => run.status === "error" || run.status === "incomplete",
  ).length;
  const workflowRuns = recentRuns.filter(
    (run) => (run.workflowOutcomeCount ?? 0) > 0,
  );
  const workflowFailures = workflowRuns.filter(
    (run) => (run.workflowFailureCount ?? 0) > 0,
  ).length;
  const summaryMetrics = [
    {
      label: "Model attempts",
      value: totals.calls.toLocaleString(),
      description: "Initial calls plus every retry and fallback attempt.",
    },
    {
      label: "Recorded cost",
      value: formatCost(totals.cost),
      description: "Known model costs; price coverage shows completeness.",
    },
    {
      label: "Fallback attempts",
      value: totals.fallbacks.toLocaleString(),
      description: "Attempts superseded before a later route completed.",
    },
    {
      label: "Provider errors",
      value: totals.errors.toLocaleString(),
      description: "Attempts that ended in an error or timeout.",
    },
    {
      label: "Typical / tail latency",
      value: totals.calls
        ? `${Math.round(totals.weightedP50 / totals.calls).toLocaleString()} / ${totals.peakP95.toLocaleString()} ms`
        : "—",
      description: "Weighted hourly median / highest hourly p95.",
    },
    {
      label: "Human ratings",
      value: `${totals.positiveRatings.toLocaleString()} up / ${totals.negativeRatings.toLocaleString()} down`,
      description:
        "Explicit user and operator ratings attached to exact model requests.",
    },
    {
      label: "Workflow failures",
      value: `${workflowFailures.toLocaleString()} / ${workflowRuns.length.toLocaleString()}`,
      description:
        "Runs with a failed workflow outcome / runs with outcomes, from the latest 200 events.",
    },
    {
      label: "Incomplete runs",
      value: failedRuns.toLocaleString(),
      description:
        "Whole agent runs that failed or ended without a usable response, from the latest 200 events.",
    },
  ];

  const unconfigured = dashboard !== null && !dashboard.configured;

  return (
    <div className="flex w-full flex-col gap-4">
      {unconfigured ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Router not connected" />
          <OperationalPanelBody
            className={`text-muted-foreground ${typeStyle("body.default")}`}
          >
            CL_ROUTER_URL is not set on this Convex deployment, so router
            health, task policies, and rollups are unavailable. Set
            CL_ROUTER_URL and CL_ROUTER_ADMIN_SECRET on the deployment with npx
            convex env set to connect cl-router. Conductor workspace setup
            intentionally removes router environment variables, so this is
            expected in isolated dev deployments.
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <>
          <OperationalPanel>
            <OperationalPanelHeader
              title="Router state"
              description={`${environmentLabel(health?.environment)} · Database ${health?.database ? "connected" : "unavailable"}`}
              action={
                <StatusTag tone={routerStatus.tone}>
                  {routerStatus.label}
                </StatusTag>
              }
            />
            {controlNotice ? (
              <div
                role="alert"
                className="border-b border-warning/15 bg-warning/[0.06] px-4 py-3"
              >
                <p className={`text-warning ${typeStyle("body.medium")}`}>
                  {controlNotice.title}
                </p>
                <p
                  className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {controlNotice.description}
                </p>
              </div>
            ) : null}
            <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Global freeze
                </p>
                <p
                  className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {health?.frozen
                    ? "Autonomous route changes are paused; model calls continue on the frozen route."
                    : "The active routing policy can select eligible routes and evaluate challengers."}
                </p>
              </div>
              <div className="flex shrink-0 justify-end">
                <SettingsSwitch
                  checked={health?.frozen ?? false}
                  onCheckedChange={() =>
                    void setGlobalFreeze(!(health?.frozen ?? false))
                  }
                  label={
                    health?.frozen
                      ? "Unfreeze global routing"
                      : "Freeze global routing"
                  }
                  disabled={
                    !health || loading || freezeLoading || !controlsAvailable
                  }
                />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-px border-t border-border bg-foreground/6 lg:grid-cols-4">
              {[
                ["Operating mode", posture],
                ["Shadow comparison", shadowSummary],
                ["Routing policy", compactIdentifier(health?.policyVersion)],
                [
                  "Last refreshed",
                  dashboard
                    ? formatDisplayDateTime(dashboard.fetchedAt)
                    : loading
                      ? "Loading"
                      : "Unavailable",
                ],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 bg-card px-4 py-3">
                  <dt
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    {label}
                  </dt>
                  <dd
                    className={cn(
                      "mt-1 truncate text-foreground",
                      label === "Routing policy"
                        ? typeStyle("technical.codeCompact")
                        : typeStyle("body.medium"),
                    )}
                    title={
                      label === "Routing policy"
                        ? (health?.policyVersion ?? undefined)
                        : undefined
                    }
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </OperationalPanel>

          <OperationalPanel>
            <OperationalPanelHeader
              title="Recent routing events"
              description="Hourly attempt telemetry covers the last 24 hours. Workflow totals use the latest 200 Spot events."
            />
            {dashboard?.rollups.error ? (
              <OperationalPanelBody
                className={`text-destructive ${typeStyle("body.default")}`}
              >
                {dashboard.rollups.error}
              </OperationalPanelBody>
            ) : (
              <div>
                <div className="grid divide-y divide-border lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)] lg:divide-x lg:divide-y-0">
                  <RoutingActivityChart activity={hourlyActivity} />
                  <div className="divide-y divide-border">
                    <RateMeter
                      label="Successful attempts"
                      value={
                        totals.calls ? totals.successes / totals.calls : null
                      }
                      description="Completed normally or with a recoverable soft failure."
                      tone="success"
                    />
                    <RateMeter
                      label="Cached input"
                      value={
                        totals.calls ? totals.cacheHits / totals.calls : null
                      }
                      description="Reused provider-cached input tokens; not an app or browser cache."
                      tone="cache"
                    />
                    <RateMeter
                      label="Price coverage"
                      value={
                        totals.calls ? totals.pricedCalls / totals.calls : null
                      }
                      description={`${totals.pricedCalls.toLocaleString()} of ${totals.calls.toLocaleString()} attempts have known pricing.`}
                      tone="pricing"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-px border-t border-border bg-foreground/6 sm:grid-cols-2 lg:grid-cols-4">
                  {summaryMetrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="min-w-0 bg-card px-4 py-3"
                    >
                      <p
                        className={`text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {metric.label}
                      </p>
                      <p
                        className={`mt-1 text-foreground ${typeStyle("data.numeric")}`}
                      >
                        {metric.value}
                      </p>
                      <p
                        className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {metric.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </OperationalPanel>

          <OperationalPanel>
            <OperationalPanelHeader
              title="Task policies"
              description="The active route, rating-based challengers, and reserved static fallback for each task."
            />
            {dashboard?.policy.error ? (
              <OperationalPanelBody
                className={`text-destructive ${typeStyle("body.default")}`}
              >
                {dashboard.policy.error}
              </OperationalPanelBody>
            ) : policies.length === 0 ? (
              <OperationalPanelBody
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                No active router policies.
              </OperationalPanelBody>
            ) : (
              <div className="table-scrollbar overflow-x-auto">
                <table
                  className={`w-full min-w-[780px] text-left ${typeStyle("body.default")}`}
                >
                  <thead
                    className={`border-b border-border text-muted-foreground ${typeStyle("label.table")}`}
                  >
                    <tr>
                      <th
                        className={`px-4 py-2.5 ${typeStyle("caption.default")}`}
                      >
                        Task
                      </th>
                      <th
                        className={`px-4 py-2.5 ${typeStyle("caption.default")}`}
                      >
                        State
                      </th>
                      <th
                        className={`px-4 py-2.5 ${typeStyle("caption.default")}`}
                      >
                        Executing route
                      </th>
                      <th
                        className={`px-4 py-2.5 ${typeStyle("caption.default")}`}
                      >
                        Challengers
                      </th>
                      <th
                        className={`px-4 py-2.5 ${typeStyle("caption.default")}`}
                      >
                        Static fallback
                      </th>
                      <th
                        className={`px-4 py-2.5 ${typeStyle("caption.default")}`}
                      >
                        Primary rating / votes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {policies.map((policy) => {
                      const primary = policy.candidates.find(
                        (candidate) => candidate.role === "primary",
                      );
                      const challengers = policy.candidates.filter(
                        (candidate) => candidate.role === "challenger",
                      );
                      const fallback = policy.candidates.find(
                        (candidate) => candidate.role === "fallback",
                      );
                      const primaryRatingCounts = (
                        dashboard?.rollups.data ?? []
                      )
                        .filter(
                          (row) =>
                            row.taskFamily === policy.taskFamily &&
                            row.provider === primary?.provider &&
                            row.model === primary?.model,
                        )
                        .reduce(
                          (counts, row) => ({
                            positive:
                              counts.positive +
                              (row.positiveRatingCount ?? 0),
                            negative:
                              counts.negative +
                              (row.negativeRatingCount ?? 0),
                          }),
                          { positive: 0, negative: 0 },
                        );
                      const primaryRatingCount =
                        primaryRatingCounts.positive +
                        primaryRatingCounts.negative;
                      const primaryRatingScore =
                        (primaryRatingCounts.positive + 5) /
                        (primaryRatingCount + 10);
                      return (
                        <tr key={policy.id}>
                          <td
                            className={`px-4 py-3 ${typeStyle("body.medium")}`}
                          >
                            {policy.taskFamily}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {policy.frozen ? "Frozen" : "Autonomous"} · v
                            {policy.version}
                          </td>
                          <td className="px-4 py-3">
                            {routeLabel(policy.frozenRoute ?? primary)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {challengers.length
                              ? challengers.map(routeLabel).join(", ")
                              : "None"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {routeLabel(fallback)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {!primary
                              ? "Unscored"
                              : formatPercent(primaryRatingScore)}
                            {" · "}
                            {primaryRatingCount.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </OperationalPanel>
        </>
      )}

    </div>
  );
}
