/** Bounded route groups; legacy single-route values remain readable. */
export type RouteStop = { name: string; longitude?: number; latitude?: number };
export type RoutePath = { stops: RouteStop[] };
export type RouteValue = {
  version: 2;
  routes: RoutePath[];
  legacyMaximumDistance?: string;
};
export const MAX_ROUTE_STOPS = 12;
export const MAX_ROUTES = 6;
export function emptyRouteValue(): RouteValue {
  return { version: 2, routes: [{ stops: [{ name: "" }, { name: "" }] }] };
}
export function parseRouteValue(value: string): RouteValue | null {
  try {
    const input = JSON.parse(value);
    if (
      input.version === 1 &&
      (typeof input.maximumDistance !== "string" ||
        input.maximumDistance.length > 100)
    )
      return null;
    const route: RouteValue =
      input.version === 1
        ? {
            version: 2,
            routes: [{ stops: input.stops }],
            ...(input.maximumDistance
              ? { legacyMaximumDistance: input.maximumDistance }
              : {}),
          }
        : input;
    if (
      route.version !== 2 ||
      !Array.isArray(route.routes) ||
      route.routes.length > MAX_ROUTES ||
      (route.legacyMaximumDistance !== undefined &&
        (typeof route.legacyMaximumDistance !== "string" ||
          route.legacyMaximumDistance.length > 100))
    )
      return null;
    for (const path of route.routes) {
      if (
        !path ||
        !Array.isArray(path.stops) ||
        path.stops.length > MAX_ROUTE_STOPS
      )
        return null;
      if (
        path.stops.some(
          (stop: RouteStop) =>
            !stop ||
            typeof stop.name !== "string" ||
            stop.name.length > 140 ||
            (stop.longitude !== undefined &&
              (!Number.isFinite(stop.longitude) ||
                Math.abs(stop.longitude) > 180)) ||
            (stop.latitude !== undefined &&
              (!Number.isFinite(stop.latitude) ||
                Math.abs(stop.latitude) > 85)) ||
            (stop.longitude === undefined) !== (stop.latitude === undefined),
        )
      )
        return null;
    }
    return route;
  } catch {
    return null;
  }
}
export function routeAnswerComplete(value: string): boolean {
  if (!value.trim() || value === "I'm not sure") return true;
  const route = parseRouteValue(value);
  if (!route) return false;
  const entered = route.routes.filter((path) =>
    path.stops.some((stop) => stop.name.trim()),
  );
  return entered.length > 0
    ? entered.every(
        (path) =>
          path.stops.length >= 2 &&
          path.stops.every((stop) => !!stop.name.trim()),
      )
    : !!route.legacyMaximumDistance?.trim();
}
export function formatRouteValue(value: string): string {
  const route = parseRouteValue(value);
  if (!route) return value;
  return [
    ...route.routes
      .filter((path) => path.stops.some((stop) => stop.name.trim()))
      .map(
        (path, index) =>
          `${route.routes.length > 1 ? `Route ${index + 1}: ` : ""}${path.stops
            .map((stop) => stop.name)
            .filter(Boolean)
            .join(" → ")}`,
      ),
  ]
    .filter(Boolean)
    .join("\n");
}
