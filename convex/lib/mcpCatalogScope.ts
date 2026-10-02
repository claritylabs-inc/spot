export const SPOT_MCP_DISCOVERY_VERSION = "2026-07-28";

export type SpotPrincipalKind = "client" | "broker" | "operator";
export type SpotCatalogTool = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
};

/** Brokers receive no tenant tools; read-only connections receive no writes. */
export function filterMcpCatalogForPrincipal<Tool extends SpotCatalogTool>(
  catalog: Tool[],
  principal: SpotPrincipalKind,
  canWrite: boolean,
): Tool[] {
  if (principal === "broker") return [];
  return catalog.filter(
    (tool) => canWrite || tool.annotations?.readOnlyHint === true,
  );
}
