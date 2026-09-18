export type OperatorClientPageTab = "wiki" | "team" | "settings";

export function parseOperatorClientSection(
  value: string | null,
): OperatorClientPageTab {
  if (value === "overview") return "settings";
  return value === "team" || value === "settings" ? value : "wiki";
}
