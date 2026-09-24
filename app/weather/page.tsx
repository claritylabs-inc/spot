"use client";

import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Shuffle, SlidersHorizontal } from "lucide-react";
import {
  getModelDisplayName,
  ModelProviderLogo,
  ModelRouteLogo,
  type ModelProviderId,
} from "@/components/model-provider-logo";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { SpotWordmark } from "@claritylabs-inc/ui/components/brand/spot-wordmark";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";
import {
  MODEL_ROUTE_LABELS,
  PROVIDER_LABELS,
} from "@/convex/lib/modelCatalog";

type WeatherProviderId = ModelProviderId | "moonshot";
type WeatherRoute = {
  task: string;
  taskLabel?: string;
  model?: string;
  provider?: WeatherProviderId;
  providerLabel?: string;
  routing: "automatic" | "manual";
};

const TASK_LABELS: Record<string, string> = MODEL_ROUTE_LABELS;
const PROVIDER_NAMES: Record<string, string> = PROVIDER_LABELS;

function humanizeIdentifier(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function ProviderMark({ provider }: { provider: WeatherProviderId }) {
  if (provider === "moonshot") return null;
  return (
    <ModelProviderLogo
      provider={provider}
      size={16}
      className={
        provider === "openai" || provider === "xai" ? "dark:invert" : undefined
      }
    />
  );
}

function ModelMark({
  provider,
  model,
}: {
  provider: WeatherProviderId;
  model: string;
}) {
  if (provider === "moonshot") return null;
  const needsDarkModeInversion =
    provider === "openai" || provider === "xai" || model.includes("gpt-oss");
  return (
    <ModelRouteLogo
      route={{ provider, model }}
      size={17}
      className={needsDarkModeInversion ? "dark:invert" : undefined}
    />
  );
}

function RoutingBadge({ routing }: { routing: "automatic" | "manual" }) {
  const automatic = routing === "automatic";
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {automatic ? <Shuffle /> : <SlidersHorizontal />}
      {automatic ? "Automatic" : "Manually set"}
    </Badge>
  );
}

function WeatherTableSkeleton() {
  return (
    <OperationalPanel as="div">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[32%]">Task</TableHead>
            <TableHead className="w-[20%]">Provider</TableHead>
            <TableHead className="w-[30%]">Model</TableHead>
            <TableHead className="w-[18%]">Routing</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, index) => (
            <TableRow key={index} className="hover:bg-transparent">
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-36" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-24 rounded-full" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

export default function WeatherPage() {
  const config = useCachedQuery("modelConfig.list", api.modelConfig.list, {});
  const routes: WeatherRoute[] = config?.routes ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-4xl px-4 py-16 sm:py-24">
        <div className="mb-10">
          <Link
            href="https://claritylabs.inc"
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 text-foreground/60 transition-colors hover:text-foreground ${typeStyle("control.buttonCompact")}`}
          >
            <SpotWordmark />
          </Link>
          <h1 className={`mt-4 ${typeStyle("heading.page")}`}>
            AI Weather Report
          </h1>
          <p className={`mt-1 text-foreground/50 ${typeStyle("body.default")}`}>
            Current model routing across Spot.
          </p>
        </div>

        {!config ? (
          <WeatherTableSkeleton />
        ) : (
          <OperationalPanel as="div">
            <Table className="min-w-[760px]">
              <TableCaption className="sr-only">
                Current provider and model routing for every Spot AI task.
              </TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[32%]">Task</TableHead>
                  <TableHead className="w-[20%]">Provider</TableHead>
                  <TableHead className="w-[30%]">Model</TableHead>
                  <TableHead className="w-[18%]">Routing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((route) => (
                  <TableRow key={route.task} className="hover:bg-transparent">
                    <TableCell
                      className={`text-foreground ${typeStyle("body.medium")}`}
                    >
                      {route.taskLabel ??
                        TASK_LABELS[route.task] ??
                        humanizeIdentifier(route.task)}
                    </TableCell>
                    {route.provider && route.model ? (
                      <>
                        <TableCell>
                          <span className="flex items-center gap-2 text-foreground">
                            <ProviderMark provider={route.provider} />
                            {route.providerLabel ??
                              PROVIDER_NAMES[route.provider] ??
                              humanizeIdentifier(route.provider)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2 text-foreground">
                            <ModelMark
                              provider={route.provider}
                              model={route.model}
                            />
                            <span title={route.model}>
                              {getModelDisplayName(route.model)}
                            </span>
                          </span>
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={2} className="text-muted-foreground">
                        Chosen per request
                      </TableCell>
                    )}
                    <TableCell>
                      <RoutingBadge routing={route.routing} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </OperationalPanel>
        )}
      </main>
    </div>
  );
}
