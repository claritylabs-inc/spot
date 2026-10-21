export type WorkJurisdiction = { country: string; region: string };
export type WorkJurisdictionsAnswer = { version: "work-jurisdictions-v1"; locations: WorkJurisdiction[]; legacy?: string };
export function parseWorkJurisdictions(value: string): WorkJurisdictionsAnswer | undefined {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== "work-jurisdictions-v1" || !Array.isArray(parsed.locations) || parsed.locations.length > 30 ||
      (parsed.legacy !== undefined && (typeof parsed.legacy !== "string" || parsed.legacy.length > 2000)) ||
      parsed.locations.some((row: WorkJurisdiction) => !row || typeof row.country !== "string" || typeof row.region !== "string" || row.country.length > 100 || row.region.length > 150)) return;
    return parsed;
  } catch { return; }
}
export function workJurisdictionsComplete(value: string) {
  if (!value || value === "I'm not sure") return true;
  const parsed = parseWorkJurisdictions(value);
  if (!parsed) return !value.trim().startsWith("{");
  return !!parsed.locations.length && parsed.locations.every(row=>row.country.trim() && row.region.trim());
}
export function formatWorkJurisdictions(value: string) {
  const parsed = parseWorkJurisdictions(value);
  if (!parsed) return value;
  return [...(parsed.legacy ? [`Previous answer: ${parsed.legacy}`] : []), ...parsed.locations.map(row=>[row.region,row.country].filter(Boolean).join(", "))].join("\n");
}
