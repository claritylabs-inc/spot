/** Reusable, bounded route value. Coordinates are optional for manually entered cities. */
export type RouteStop = { name: string; longitude?: number; latitude?: number };
export type RouteValue = {
  version: 1;
  stops: RouteStop[];
  maximumDistance: string;
};
export const MAX_ROUTE_STOPS = 8;
export function parseRouteValue(value: string): RouteValue | null {
  try {
    const route = JSON.parse(value);
    if (
      route.version !== 1 ||
      !Array.isArray(route.stops) ||
      route.stops.length > MAX_ROUTE_STOPS ||
      typeof route.maximumDistance !== "string" ||
      route.maximumDistance.length > 100
    )
      return null;
    if (
      route.stops.some(
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
    return route;
  } catch {
    return null;
  }
}
export function routeAnswerComplete(value: string): boolean {
  if (!value.trim()) return true;
  const route = parseRouteValue(value);
  return (
    !!route &&
    ((route.stops.length >= 2 &&
      route.stops.every((stop) => !!stop.name.trim())) ||
      (route.stops.every((stop) => !stop.name.trim()) &&
        !!route.maximumDistance.trim()))
  );
}
export function formatRouteValue(value: string): string {
  const route = parseRouteValue(value);
  if (!route) return value;
  return [
    route.stops
      .map((stop) => stop.name)
      .filter(Boolean)
      .join(" → "),
    route.maximumDistance.trim()
      ? `Maximum travel distance: ${route.maximumDistance.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
}
