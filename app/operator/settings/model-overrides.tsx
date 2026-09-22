"use client";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { PillButton } from "@/components/ui/pill-button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { typeStyle } from "@/lib/typography";
import { useOperatorRouterCapabilities } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { routerModelSupportsTask } from "@/convex/lib/routerCapabilities";
import { modelDefaultRetrievalConfigured } from "./retrieval-availability";

type Settings = FunctionReturnType<typeof api.modelSettings.getGlobal>;
type Task = Settings["tasks"][number];
type Route = NonNullable<Settings["routes"][Task["id"]]>;
function OverrideEditor({
  settings,
  taskId,
  onClose,
  disabled,
}: {
  settings: Settings;
  taskId: Task["id"] | "web_retrieval";
  onClose: () => void;
  disabled: boolean;
}) {
  const task = settings.tasks.find((task) => task.id === taskId);
  const stored = task ? settings.routes[task.id] : null;
  const [route, setRoute] = useState<Route | null>(stored ?? null);
  const [retrieval, setRetrieval] = useState<
    "parallel" | "exa" | "model_default"
  >(
    settings.webRetrieval.primary === "parallel" ||
      settings.webRetrieval.primary === "exa"
      ? settings.webRetrieval.primary
      : "model_default",
  );
  const [saving, setSaving] = useState(false);
  const update = useMutation(api.modelSettings.updateGlobalRoutes);
  const updateRetrieval = useMutation(
    api.modelSettings.updateGlobalWebRetrieval,
  );
  const { capabilities } = useOperatorRouterCapabilities();
  const unavailable = capabilities?.availability !== "available";
  const routerModels =
    capabilities?.availability === "available" ? capabilities.models : undefined;
  const providerAvailable = (provider: string) =>
    capabilities?.availability !== "available" ||
    capabilities.providers.some(
      (item) => item.provider === provider && item.configured,
    );
  function models(provider: Settings["providers"][number]) {
    if (!task) return [];
    if (routerModels) {
      return routerModels
        .filter(
          (entry) =>
            entry.provider === provider.id &&
            routerModelSupportsTask(task.id, entry),
        )
        .map((entry) => entry.model);
    }
    return route?.provider === provider.id ? [route.model] : [];
  }
  async function save() {
    setSaving(true);
    try {
      if (task) await update({ routes: { [task.id]: route } });
      else await updateRetrieval({ webRetrieval: { primary: retrieval } });
      toast.success("Override saved");
      onClose();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not save override"));
    } finally {
      setSaving(false);
    }
  }
  const provider = route
    ? settings.providers.find((provider) => provider.id === route.provider)
    : undefined;
  const retrievalAvailable =
    capabilities?.availability !== "available" ||
    (retrieval === "model_default"
      ? modelDefaultRetrievalConfigured(
          capabilities.providers,
          settings.routes.chat?.provider ?? null,
        )
      : capabilities.webRetrieval.providers.some(
          (item) => item.provider === retrieval && item.configured,
        ));
  const valid = task
    ? !route
      ? !task.manualRequired
      : !!provider &&
        providerAvailable(route.provider) &&
        models(provider).includes(route.model)
    : retrievalAvailable;
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={task?.label ?? "Web retrieval"}
      footer={
        <>
          <PillButton variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton
            disabled={disabled || saving || !valid}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </PillButton>
        </>
      }
    >
      <div className="space-y-5">
        {unavailable ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Provider availability could not be checked.
          </p>
        ) : routerModels === undefined && task ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Router did not return a model catalog. Existing pins can be kept;
            new pins are unvalidated until cl-router advertises `models`.
          </p>
        ) : null}
        {task ? (
          <>
            {task.manualRequired ? (
              <p className={typeStyle("body.default")}>
                The operator agent requires an explicit model. Changes apply to
                new runs.
              </p>
            ) : null}
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={route?.provider ?? "default"}
                onValueChange={(value) => {
                  if (value === "default") {
                    setRoute(null);
                    return;
                  }
                  const provider = settings.providers.find(
                    (provider) => provider.id === value,
                  );
                  const model = provider && models(provider)[0];
                  if (provider && model)
                    setRoute({ provider: provider.id, model });
                }}
                disabled={saving || disabled}
              >
                <SelectTrigger className="w-full" aria-label="Model provider">
                  <SelectValue>
                    {route
                      ? settings.providers.find(
                          (provider) => provider.id === route.provider,
                        )?.label
                      : task.manualRequired
                        ? "Choose a provider"
                        : "Use router default"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {!task.manualRequired ? (
                    <SelectItem value="default">Use router default</SelectItem>
                  ) : !route ? (
                    <SelectItem value="default" disabled>
                      Choose a provider
                    </SelectItem>
                  ) : null}
                  {settings.providers
                    .filter(
                      (provider) =>
                        models(provider).length ||
                        provider.id === route?.provider,
                    )
                    .map((provider) => (
                      <SelectItem
                        key={provider.id}
                        value={provider.id}
                        disabled={!providerAvailable(provider.id)}
                      >
                        {provider.label}
                        {!providerAvailable(provider.id)
                          ? " · unavailable"
                          : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {route ? (
              <div className="space-y-2">
                <Label>Model</Label>
                <Select
                  value={route.model}
                  onValueChange={(value) => {
                    if (value) setRoute({ ...route, model: value });
                  }}
                  disabled={saving || disabled}
                >
                  <SelectTrigger className="w-full" aria-label="Model">
                    <SelectValue>{route.model}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      ...new Set([
                        route.model,
                        ...(provider ? models(provider) : []),
                      ]),
                    ].map((model) => (
                      <SelectItem
                        key={model}
                        value={model}
                        disabled={
                          !provider || !models(provider).includes(model)
                        }
                      >
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </>
        ) : (
          <div className="space-y-2">
            <Label>Search provider</Label>
            <Select
              value={retrieval}
              onValueChange={(value) => {
                if (
                  value === "parallel" ||
                  value === "exa" ||
                  value === "model_default"
                )
                  setRetrieval(value);
              }}
              disabled={saving || disabled}
            >
              <SelectTrigger className="w-full" aria-label="Search provider">
                <SelectValue>
                  {
                    settings.webRetrievalProviders.find(
                      (provider) => provider.id === retrieval,
                    )?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {settings.webRetrievalProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </SettingsDrawer>
  );
}
export function useModelOverrides(disabled: boolean) {
  const settings = useQuery(api.modelSettings.getGlobal);
  const [selected, setSelected] = useState<Task["id"] | "web_retrieval" | null>(
    null,
  );
  const activeIds = new Set<string>(
    settings?.groups.flatMap((group) => group.tasks) ?? [],
  );
  const activeTasks = settings?.tasks.filter((task) => activeIds.has(task.id));
  const tasks = activeTasks?.filter(
    (task) => task.manualRequired || settings?.routes[task.id],
  );
  return {
    action: settings ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <PillButton variant="secondary" disabled={disabled}>
              Add override
            </PillButton>
          }
        />
        <DropdownMenuContent align="end" className="w-64">
          {activeTasks?.map((task) => (
            <DropdownMenuItem
              key={task.id}
              onClick={() => setSelected(task.id)}
            >
              {task.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null,
    panel: !settings ? (
      <p className={typeStyle("body.default")}>Loading overrides…</p>
    ) : (
      <div className="space-y-4">
        <OperationalPanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Selection</TableHead>
                <TableHead>Mode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks?.map((task) => (
                <TableRow
                  key={task.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Edit ${task.label}`}
                  className="cursor-pointer"
                  onClick={() => setSelected(task.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(task.id);
                    }
                  }}
                >
                  <TableCell>{task.label}</TableCell>
                  <TableCell>
                    {settings.routes[task.id]?.model ?? "Choose a model"}
                  </TableCell>
                  <TableCell>
                    {task.manualRequired ? "Manual route" : "Manual override"}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow
                tabIndex={0}
                role="button"
                aria-label="Edit web retrieval"
                className="cursor-pointer"
                onClick={() => setSelected("web_retrieval")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected("web_retrieval");
                  }
                }}
              >
                <TableCell>Web retrieval</TableCell>
                <TableCell>
                  {
                    settings.webRetrievalProviders.find(
                      (provider) => provider.id === settings.webRetrieval.primary,
                    )?.label
                  }
                </TableCell>
                <TableCell>Provider selection</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </OperationalPanel>
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Unset tasks are auto-routed by primitive and difficulty. Saved
          operator or global picks are submitted as explicit `/v1/manual`
          routes. Brokers have no model-routing or provider-key controls.
        </p>
      </div>
    ),
    drawer:
      selected && settings ? (
        <OverrideEditor
          key={selected}
          settings={settings}
          taskId={selected}
          onClose={() => setSelected(null)}
          disabled={disabled}
        />
      ) : null,
  };
}
