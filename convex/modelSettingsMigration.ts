import { paginationOptsValidator } from "convex/server";
import { internalQuery } from "./_generated/server";

function configuredKeyCount(
  providerKeys: Record<string, string | undefined> | undefined,
) {
  if (!providerKeys) return 0;
  return Object.values(providerKeys).filter(
    (value) => typeof value === "string" && value.trim().length > 0,
  ).length;
}

function configuredKeyProviders(
  providerKeys: Record<string, string | undefined> | undefined,
): string[] {
  if (!providerKeys) return [];
  return Object.entries(providerKeys)
    .flatMap(([provider, value]) =>
      typeof value === "string" && value.trim().length > 0 ? [provider] : [],
    )
    .sort();
}

function configuredRouteProviders(
  routes:
    | Record<string, { provider: string; model: string } | undefined>
    | undefined,
): string[] {
  return [
    ...new Set(
      Object.values(routes ?? {}).flatMap((route) =>
        route ? [route.provider] : [],
      ),
    ),
  ].sort();
}

export const auditLegacyProviderKeys = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("brokerModelSettings")
      .paginate(args.paginationOpts);
    const settingsRows = result.page.map((settings) => ({
      settingsId: settings._id,
      brokerOrgId: settings.brokerOrgId,
      configuredKeyProviders: configuredKeyProviders(settings.providerKeys),
      configuredRouteProviders: configuredRouteProviders(settings.routes),
    }));
    const legacyRows = result.page.flatMap((settings) => {
      if (settings.providerKeys === undefined) return [];
      const row = settingsRows.find(
        (candidate) => candidate.settingsId === settings._id,
      );
      return [
        {
          settingsId: settings._id,
          brokerOrgId: settings.brokerOrgId,
          configuredKeyCount: configuredKeyCount(settings.providerKeys),
          configuredKeyProviders: row?.configuredKeyProviders ?? [],
          configuredRouteProviders: row?.configuredRouteProviders ?? [],
        },
      ];
    });
    return {
      scanned: result.page.length,
      legacyFieldRows: legacyRows.length,
      configuredKeyRows: legacyRows.filter(
        (settings) => settings.configuredKeyCount > 0,
      ).length,
      configuredKeyProviders: [
        ...new Set(settingsRows.flatMap((row) => row.configuredKeyProviders)),
      ].sort(),
      configuredRouteProviders: [
        ...new Set(
          settingsRows.flatMap((row) => row.configuredRouteProviders),
        ),
      ].sort(),
      routeRows: settingsRows.filter(
        (row) => row.configuredRouteProviders.length > 0,
      ),
      rows: legacyRows,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
