"use client";

import { useEffect, useId, useState, useRef } from "react";
import Image from "next/image";
import { ArrowRight, MapPin, Plus } from "lucide-react";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { Card } from "@claritylabs-inc/ui/components/card";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { PillButton } from "./pill-button";
import { RemoveButton } from "./remove-button";
import { useTheme } from "@/hooks/use-theme";
import { typeStyle } from "@/lib/typography";
import {
  MAX_ROUTE_STOPS,
  MAX_ROUTES,
  emptyRouteValue,
  type RouteStop,
  type RouteValue,
} from "@/lib/route-input";

const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
type Feature = {
  properties: {
    full_address?: string;
    name: string;
    place_formatted?: string;
    coordinates: { longitude: number; latitude: number };
  };
};

/** City search is permanent because applicants save the chosen place in their draft. */
async function searchCities(
  query: string,
  signal: AbortSignal,
): Promise<RouteStop[]> {
  const params = new URLSearchParams({
    q: query,
    types: "place",
    limit: "5",
    language: "en",
    permanent: "true",
    access_token: token ?? "",
  });
  const response = await fetch(
    `https://api.mapbox.com/search/geocode/v6/forward?${params}`,
    { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) },
  );
  if (!response.ok) throw new Error("City search unavailable");
  const data = (await response.json()) as { features: Feature[] };
  return data.features
    .map(({ properties: p }) => ({
      name:
        p.full_address ??
        [p.name, p.place_formatted].filter(Boolean).join(", "),
      longitude: p.coordinates.longitude,
      latitude: p.coordinates.latitude,
    }))
    .filter((stop) => stop.name.length <= 140);
}

export function RouteInput({
  value,
  onChange,
}: {
  value: RouteValue;
  onChange: (value: RouteValue) => void;
}) {
  const paths = value.routes.length ? value.routes : emptyRouteValue().routes;
  function update(routeIndex: number, stops: RouteStop[]) {
    onChange({
      ...value,
      routes: paths.map((path, index) =>
        index === routeIndex ? { stops } : path,
      ),
    });
  }
  return (
    <div className="space-y-5">
      {paths.map((path, routeIndex) => {
        const stops = path.stops.length
          ? path.stops
          : [{ name: "" }, { name: "" }];
        const startName = stops[0].name.split(",")[0].trim();
        const endName = stops
          .slice(1)
          .filter((stop) => stop.name.trim())
          .at(-1)
          ?.name.split(",")[0]
          .trim();
        const routeName =
          startName && endName
            ? `${startName} to ${endName}`
            : `Route ${routeIndex + 1}`;
        return (
          <Card key={routeIndex} className="gap-5 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2
                aria-label={routeName}
                className={`flex min-w-0 flex-wrap items-center gap-2 text-pretty ${typeStyle("heading.section")}`}
              >
                {startName && endName ? (
                  <>
                    <span>{startName}</span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    />
                    <span>{endName}</span>
                  </>
                ) : (
                  routeName
                )}
              </h2>
              {paths.length > 1 && (
                <RemoveButton
                  label={`Remove Route ${routeIndex + 1}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      routes: paths.filter((_, i) => i !== routeIndex),
                    })
                  }
                />
              )}
            </div>
            <div className="space-y-4">
              {stops.map((stop, index) => (
                <div
                  key={index}
                  data-route-group={routeIndex}
                  data-route-stop={index}
                  className="flex items-start gap-2 sm:gap-3"
                >
                  <CityInput
                    label={
                      index === 0
                        ? "Start"
                        : stops.length === 2
                          ? "Stop"
                          : `Stop ${index}`
                    }
                    value={stop}
                    onChange={(city) =>
                      update(
                        routeIndex,
                        stops.map((current, i) =>
                          i === index ? city : current,
                        ),
                      )
                    }
                  />
                  <div className="mt-8 flex h-12 shrink-0 items-center">
                    <RemoveButton
                      label={`Remove Route ${routeIndex + 1} city ${index + 1}`}
                      disabled={stops.length <= 2 && !stop.name}
                      onClick={() =>
                        update(
                          routeIndex,
                          stops.length <= 2
                            ? stops.map((current, i) =>
                                i === index ? { name: "" } : current,
                              )
                            : stops.filter((_, i) => i !== index),
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <PillButton
                type="button"
                variant="secondary"
                size="large"
                disabled={stops.length >= MAX_ROUTE_STOPS}
                onClick={() => update(routeIndex, [...stops, { name: "" }])}
              >
                <Plus className="size-4" />
                Add a stop
              </PillButton>
            </div>
            <RouteMap stops={stops} />
          </Card>
        );
      })}
      <PillButton
        type="button"
        variant="secondary"
        size="large"
        disabled={paths.length >= MAX_ROUTES}
        onClick={() =>
          onChange({
            ...value,
            routes: [...paths, { stops: [{ name: "" }, { name: "" }] }],
          })
        }
      >
        <Plus className="size-4" />
        Add route
      </PillButton>
    </div>
  );
}

function CityInput({
  label,
  value,
  onChange,
  autoFocus,
}: {
  autoFocus?: boolean;
  label: string;
  value: RouteStop;
  onChange: (stop: RouteStop) => void;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<RouteStop[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [active, setActive] = useState(-1);
  const [resultQuery, setResultQuery] = useState("");
  const query = value.name.trim();
  const searching =
    focused && value.longitude === undefined && query.length >= 2 && !!token;
  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus("loading");
      setResults([]);
      setActive(-1);
      searchCities(query, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) {
            setResultQuery(query);
            setResults(rows);
            setStatus("ready");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus("error");
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searching]);
  function choose(stop: RouteStop) {
    onChange(stop);
    setFocused(false);
    setActive(-1);
  }
  const open =
    searching &&
    status !== "idle" &&
    (status !== "ready" || resultQuery === query);
  return (
    <Field className="relative min-w-0 flex-1 gap-2">
      <FieldLabel htmlFor={id} className={typeStyle("body.root")}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        className={`h-12 ${typeStyle("body.root")}`}
        autoFocus={autoFocus}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-cities`}
        aria-activedescendant={
          open && active >= 0 ? `${id}-city-${active}` : undefined
        }
        autoComplete="off"
        value={value.name}
        placeholder="Search for a city"
        maxLength={140}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          onChange({ name: event.target.value });
          setResults([]);
          setStatus("idle");
          setActive(-1);
          setFocused(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setFocused(false);
            event.stopPropagation();
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) =>
              Math.max(
                0,
                Math.min(
                  results.length - 1,
                  current + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            event.stopPropagation();
            if (results[active]) choose(results[active]);
          }
        }}
      />
      {open && (
        <Card
          className="absolute top-full z-30 mt-1 max-h-64 w-full gap-0 overflow-auto rounded-lg p-1 shadow-lg"
          onPointerDown={(event) => event.preventDefault()}
        >
          <div
            role="listbox"
            id={`${id}-cities`}
            aria-label={`${label} suggestions`}
          >
            {status === "loading" ? (
              <p
                role="status"
                className={`flex items-center gap-2 p-3 ${typeStyle("body.default")}`}
              >
                <Spinner className="size-4" />
                Finding cities…
              </p>
            ) : status === "error" || !results.length ? (
              <p
                role="status"
                className={`p-3 text-muted-foreground ${typeStyle("body.default")}`}
              >
                {status === "error"
                  ? "City search is unavailable. You can enter the city, state and country yourself."
                  : "No cities found. Try adding a state or country, or enter the city yourself."}
              </p>
            ) : (
              results.map((stop, index) => (
                <div
                  key={stop.name}
                  id={`${id}-city-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`cursor-pointer rounded-md px-3 py-2 hover:bg-accent ${index === active ? "bg-accent" : ""} ${typeStyle("body.default")}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(stop);
                  }}
                >
                  <span className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    {stop.name}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      )}
    </Field>
  );
}

function RouteMap({ stops }: { stops: RouteStop[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 288 });
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(1, Math.min(1280, Math.round(entry.contentRect.width))),
        height: Math.max(1, Math.round(entry.contentRect.height)),
      }),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const { resolved } = useTheme();
  const [route, setRoute] = useState<{
    key: string;
    geometry?: string;
    failed?: boolean;
  }>();
  const [failedImage, setFailedImage] = useState<string>();
  const points = stops.filter(
    (stop) => stop.longitude !== undefined && stop.latitude !== undefined,
  );
  const key = points
    .map((stop) => `${stop.longitude},${stop.latitude}`)
    .join(";");
  const complete = points.length === stops.length && points.length >= 2;
  useEffect(() => {
    if (!complete || !token) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${key}?overview=simplified&geometries=polyline&access_token=${encodeURIComponent(token!)}`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(12000),
            ]),
          },
        );
        if (!response.ok) throw new Error("Route unavailable");
        const data = await response.json();
        if (!controller.signal.aborted)
          setRoute({
            key,
            geometry: data.routes?.[0]?.geometry,
            failed: !data.routes?.[0]?.geometry,
          });
      } catch {
        if (!controller.signal.aborted) setRoute({ key, failed: true });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, complete]);
  const overlays = stops.flatMap((stop, index) =>
    stop.longitude === undefined
      ? []
      : [`pin-s-${index + 1}+2563eb(${stop.longitude},${stop.latitude})`],
  );
  if (complete && route?.key === key && route.geometry)
    overlays.unshift(
      `path-4+2563eb-0.85(${encodeURIComponent(route.geometry)})`,
    );
  const source =
    token && points.length
      ? `https://api.mapbox.com/styles/v1/mapbox/${resolved === "dark" ? "dark-v11" : "light-v11"}/static/${overlays.join(",")}/${points.length === 1 ? `${points[0].longitude},${points[0].latitude},6` : "auto"}/${size.width}x${size.height}@2x?${points.length > 1 ? "padding=60&" : ""}access_token=${encodeURIComponent(token)}`
      : "";
  const loading = complete && route?.key !== key && !!token;
  return (
    <Card className="gap-0 overflow-hidden rounded-xl py-0">
      <div
        ref={container}
        className="relative flex h-64 items-center justify-center bg-muted/30 sm:h-72"
      >
        {source && failedImage !== source ? (
          <Image
            key={source}
            src={source}
            alt={`Route stops: ${stops
              .map((stop) => stop.name)
              .filter(Boolean)
              .join(" to ")}`}
            fill
            unoptimized
            loading="eager"
            className="object-cover"
            onError={() => setFailedImage(source)}
          />
        ) : (
          <div
            className={`flex max-w-xs flex-col items-center gap-3 p-6 text-center text-muted-foreground ${typeStyle("body.default")}`}
          >
            <MapPin className="size-6" />
            <span>
              {!token
                ? "Map preview unavailable. You can still enter your cities."
                : !points.length
                  ? "Your route will appear here as you choose cities."
                  : "Map preview unavailable. Your cities are still saved."}
            </span>
          </div>
        )}
      </div>
      {loading && (
        <div role="status" className="sr-only">
          Drawing your route…
        </div>
      )}
      {complete && route?.key === key && route.failed && (
        <p
          role="status"
          className={`px-4 py-3 text-muted-foreground ${typeStyle("body.default")}`}
        >
          Route preview unavailable. Your cities are still saved.
        </p>
      )}
    </Card>
  );
}
