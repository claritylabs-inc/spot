"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Shuffle } from "lucide-react";
import {
  getModelDisplayName,
  ModelProviderLogo,
  ModelRouteLogo,
} from "@/components/model-provider-logo";
import { toast } from "sonner";
import {
  useCachedOperatorGlobalModelSettings,
  useOperatorGlobalModelRouteCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "fireworks"
  | "deepseek";
type Route = { provider: ProviderId; model: string };
type Routes = Record<string, Route | null>;
type ModelCapability = {
  modelName: string;
  known: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  defaultOutputTokens?: number;
  longListOutputTokens?: number;
  taskOutputTokens?: Record<string, number>;
  supportsImageInput?: boolean;
  supportsAudioInput?: boolean;
};
type ProviderConfig = {
  id: ProviderId;
  label: string;
  configured: boolean;
  transport: "direct" | null;
  languageModels: string[];
  audioModels: string[];
  embeddingModels: string[];
};
type TaskConfig = {
  id: string;
  label: string;
  description: string;
  isEmbedding: boolean;
  isAudio: boolean;
  automatedRouting: boolean;
  manualRequired: boolean;
  defaultRoute: Route;
};
type TaskGroupConfig = {
  id: string;
  label: string;
  description: string;
  tasks: string[];
};
type Settings = {
  providers: ProviderConfig[];
  tasks: TaskConfig[];
  groups: TaskGroupConfig[];
  routes: Routes;
  modelCapabilities: Record<string, ModelCapability>;
  updatedAt: number | null;
};

const AUTOMATED_VALUE = "__automated__";
const DEFAULT_ROUTE_VALUE = "__default_route__";
const MANUAL_REQUIRED_VALUE = "__manual_required__";
const PROVIDER_SELECT_WIDTH_CLASS = "w-full @5xl/models:w-44";
const MODEL_SELECT_WIDTH_CLASS = "w-full @5xl/models:w-[30rem]";
const PROVIDER_PRIORITY: ProviderId[] = [
  "fireworks",
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "cohere",
  "deepseek",
];
function ProviderLogo({
  provider,
  size = 14,
}: {
  provider: ProviderId;
  size?: number;
}) {
  return <ModelProviderLogo provider={provider} size={size} />;
}

function formatTokens(value: number | undefined) {
  if (!value) return "unknown";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}m`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return value.toLocaleString();
}

function capabilityKey(route: Route) {
  return `${route.provider}:${route.model}`;
}

function capabilitySummary(
  capability: ModelCapability | undefined,
  taskId?: string,
) {
  if (!capability) return "Caps unknown";
  if (!capability.known) {
    return `${formatTokens(capability.defaultOutputTokens)} preferred / n/a`;
  }
  if (taskId === "voice_transcription" && capability.supportsAudioInput) {
    return "Audio transcription";
  }
  const parts = [
    `${formatTokens(capability.maxInputTokens)} in`,
    `${formatTokens(capability.maxOutputTokens)} out`,
  ];
  const taskBudget = taskId ? capability.taskOutputTokens?.[taskId] : undefined;
  if (taskBudget) {
    parts.push(`${formatTokens(taskBudget)} ${taskId}`);
  } else if (capability.defaultOutputTokens) {
    parts.push(`${formatTokens(capability.defaultOutputTokens)} default`);
  }
  return parts.join(" / ");
}

function providerSortIndex(provider: ProviderId) {
  const index = PROVIDER_PRIORITY.indexOf(provider);
  return index === -1 ? PROVIDER_PRIORITY.length : index;
}

export function ModelsTab() {
  const settings = useCachedOperatorGlobalModelSettings() as
    | Settings
    | undefined;
  const updateRoutes = useMutation(api.modelSettings.updateGlobalRoutes);
  const { patchRoute } = useOperatorGlobalModelRouteCacheActions();
  const [savingTask, setSavingTask] = useState<string | null>(null);

  const providersById = useMemo(() => {
    return Object.fromEntries(
      (settings?.providers ?? []).map((provider) => [provider.id, provider]),
    ) as Record<ProviderId, ProviderConfig>;
  }, [settings?.providers]);
  const modelCapabilities = settings?.modelCapabilities ?? {};

  async function commitRoute(taskId: string, route: Route | null) {
    setSavingTask(taskId);
    try {
      await updateRoutes({ routes: { [taskId]: route } });
      await patchRoute(taskId, route);
      toast.success(
        route
          ? "Model override updated"
          : taskId === "fallback"
            ? "Fallback reset"
            : "Automated routing restored",
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to update model override"),
      );
    } finally {
      setSavingTask(null);
    }
  }

  function modelsForProvider(
    provider: ProviderId,
    isEmbedding: boolean,
    isAudio: boolean,
  ) {
    const item = providersById[provider];
    return isEmbedding
      ? (item?.embeddingModels ?? [])
      : isAudio
        ? (item?.audioModels ?? [])
        : (item?.languageModels ?? []);
  }

  function modelsForTaskProvider(task: TaskConfig, provider: ProviderId) {
    const models = modelsForProvider(provider, task.isEmbedding, task.isAudio);
    if (!task.manualRequired) return models;
    return models.filter(
      (model) =>
        modelCapabilities[capabilityKey({ provider, model })]
          ?.supportsImageInput === true,
    );
  }

  function providersForTask(task: TaskConfig, selectedProvider: ProviderId) {
    return [...(settings?.providers ?? [])]
      .filter((provider) => {
        const hasModels = modelsForTaskProvider(task, provider.id).length > 0;
        return (
          hasModels && (provider.configured || provider.id === selectedProvider)
        );
      })
      .sort(
        (left, right) =>
          providerSortIndex(left.id) - providerSortIndex(right.id),
      );
  }

  function modelsForSelectedRoute(task: TaskConfig, route: Route) {
    const models = modelsForTaskProvider(task, route.provider);
    return models.includes(route.model) ? models : [route.model, ...models];
  }

  function providerTransportLabel(provider: ProviderConfig) {
    if (provider.transport === "direct") return "Env";
    return "Unavailable";
  }

  if (settings === undefined) {
    return (
      <OperationalPanel>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </OperationalPanel>
    );
  }

  return (
    <div className="@container/models grid gap-4">
      {settings.groups.map((group) => {
        const tasks = group.tasks
          .map((taskId) => settings.tasks.find((task) => task.id === taskId))
          .filter((task): task is TaskConfig => !!task);
        if (tasks.length === 0) return null;
        return (
          <OperationalPanel key={group.id}>
            <OperationalPanelHeader title={group.label} />
            <div className="divide-y divide-border px-4">
              {tasks.map((task) => {
                const route = settings.routes[task.id] ?? null;
                const automated = task.automatedRouting && route === null;
                const manualSelectionMissing =
                  task.manualRequired && route === null;
                const saving = savingTask === task.id;

                const selectedRoute = route ?? task.defaultRoute;
                const selectedProvider = providersById[selectedRoute.provider];
                const providerOptions = providersForTask(
                  task,
                  selectedRoute.provider,
                );
                const modelOptions = modelsForSelectedRoute(
                  task,
                  selectedRoute,
                );

                function commitSelectedRoute(nextRoute: Route) {
                  void commitRoute(task.id, nextRoute);
                }

                return (
                  <div
                    key={task.id}
                    className="grid gap-3 py-3.5 @5xl/models:grid-cols-[1fr_auto] @5xl/models:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={`text-foreground ${typeStyle("body.medium")}`}
                        >
                          {task.label}
                        </p>
                        {task.manualRequired || route ? (
                          <span
                            className={`rounded-full bg-muted/55 px-2 py-0.5 text-muted-foreground ${typeStyle("label.tag")}`}
                          >
                            {manualSelectionMissing
                              ? "Required"
                              : task.manualRequired
                                ? "Manual"
                                : "Override"}
                          </span>
                        ) : null}
                      </div>
                      {task.manualRequired ? (
                        <p
                          className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {task.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex w-full flex-col gap-2 justify-self-start @5xl/models:w-auto @5xl/models:flex-row @5xl/models:justify-self-end">
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground @5xl/models:self-center" />
                      ) : null}
                      <Select
                        value={
                          automated
                            ? AUTOMATED_VALUE
                            : manualSelectionMissing
                              ? MANUAL_REQUIRED_VALUE
                              : selectedRoute.provider
                        }
                        onValueChange={(nextProvider) => {
                          if (!nextProvider) return;
                          if (
                            nextProvider === AUTOMATED_VALUE ||
                            nextProvider === DEFAULT_ROUTE_VALUE
                          ) {
                            void commitRoute(task.id, null);
                            return;
                          }
                          const provider = nextProvider as ProviderId;
                          const models = modelsForTaskProvider(task, provider);
                          const model = models.includes(selectedRoute.model)
                            ? selectedRoute.model
                            : models[0];
                          if (!model) return;
                          commitSelectedRoute({ provider, model });
                        }}
                        disabled={saving}
                      >
                        <SelectTrigger className={PROVIDER_SELECT_WIDTH_CLASS}>
                          <SelectValue>
                            {automated ? (
                              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                                <Shuffle className="size-4 shrink-0" />
                                <span
                                  className={`truncate ${typeStyle("body.large")}`}
                                >
                                  Automated routing
                                </span>
                              </span>
                            ) : manualSelectionMissing ? (
                              <span
                                className={`text-muted-foreground ${typeStyle("body.large")}`}
                              >
                                Choose provider
                              </span>
                            ) : (
                              <span className="flex min-w-0 items-center gap-2">
                                <ProviderLogo
                                  provider={selectedRoute.provider}
                                  size={15}
                                />
                                <span
                                  className={`truncate ${typeStyle("body.large")}`}
                                >
                                  {selectedProvider?.label ??
                                    selectedRoute.provider}
                                </span>
                              </span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-56">
                          {manualSelectionMissing ? (
                            <SelectItem value={MANUAL_REQUIRED_VALUE} disabled>
                              Choose a direct provider
                            </SelectItem>
                          ) : null}
                          {task.automatedRouting ? (
                            <>
                              <SelectItem value={AUTOMATED_VALUE}>
                                <span className="flex items-center gap-2 text-muted-foreground">
                                  <Shuffle className="size-4" />
                                  Automated routing
                                </span>
                              </SelectItem>
                              <SelectSeparator />
                            </>
                          ) : route && !task.manualRequired ? (
                            <>
                              <SelectItem value={DEFAULT_ROUTE_VALUE}>
                                <span className="text-muted-foreground">
                                  Reset to default fallback
                                </span>
                              </SelectItem>
                              <SelectSeparator />
                            </>
                          ) : null}
                          {providerOptions.map((provider) => (
                            <SelectItem
                              key={provider.id}
                              value={provider.id}
                              disabled={!provider.configured}
                            >
                              <span className="flex min-w-0 flex-1 items-center gap-2">
                                <ProviderLogo
                                  provider={provider.id}
                                  size={15}
                                />
                                <span
                                  className={`truncate ${typeStyle("body.large")}`}
                                >
                                  {provider.label}
                                </span>
                                <span
                                  className={`ml-auto shrink-0 text-muted-foreground/60 ${typeStyle("caption.default")}`}
                                >
                                  {providerTransportLabel(provider)}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={
                          automated
                            ? AUTOMATED_VALUE
                            : manualSelectionMissing
                              ? MANUAL_REQUIRED_VALUE
                              : selectedRoute.model
                        }
                        onValueChange={(model) => {
                          if (!model) return;
                          commitSelectedRoute({
                            provider: selectedRoute.provider,
                            model,
                          });
                        }}
                        disabled={saving || automated || manualSelectionMissing}
                      >
                        <SelectTrigger className={MODEL_SELECT_WIDTH_CLASS}>
                          <SelectValue>
                            {automated ? (
                              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                                <Shuffle className="size-4 shrink-0" />
                                <span
                                  className={`min-w-0 truncate ${typeStyle("body.default")}`}
                                >
                                  Router selects the model
                                </span>
                              </span>
                            ) : manualSelectionMissing ? (
                              <span
                                className={`text-muted-foreground ${typeStyle("body.default")}`}
                              >
                                Choose provider first
                              </span>
                            ) : (
                              <span className="flex min-w-0 items-center gap-2">
                                <ModelRouteLogo
                                  route={selectedRoute}
                                  size={16}
                                />
                                <span
                                  className={`min-w-0 truncate ${typeStyle("body.default")}`}
                                  title={selectedRoute.model}
                                >
                                  {getModelDisplayName(selectedRoute)}
                                </span>
                              </span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-[min(42rem,calc(100vw-2rem))]">
                          {manualSelectionMissing ? (
                            <SelectItem value={MANUAL_REQUIRED_VALUE} disabled>
                              Choose a provider first
                            </SelectItem>
                          ) : null}
                          {modelOptions.map((model) => {
                            const optionRoute = {
                              provider: selectedRoute.provider,
                              model,
                            };
                            const capability =
                              modelCapabilities[capabilityKey(optionRoute)];
                            return (
                              <SelectItem key={model} value={model}>
                                <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ModelRouteLogo
                                      route={optionRoute}
                                      size={16}
                                    />
                                    <span
                                      className={`truncate ${typeStyle("body.default")}`}
                                      title={model}
                                    >
                                      {getModelDisplayName(optionRoute)}
                                    </span>
                                  </span>
                                  <span
                                    className={`shrink-0 text-muted-foreground/60 ${typeStyle("caption.default")}`}
                                  >
                                    {capabilitySummary(capability, task.id)}
                                  </span>
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          </OperationalPanel>
        );
      })}
    </div>
  );
}
