/**
 * Compact, public-safe target context for a tool call, shared by the backend
 * (recorded at execution start) and the chat UI (audit fallback for older
 * messages). It never carries full arguments or results: web search yields a
 * hostname when the request names an explicit public domain, otherwise a
 * bounded readable query.
 */
export type ToolActivityContext = { label: string; website?: string };

const MAX_LABEL = 160;
// Hostnames double as labels (160) and websites ("https://" + host, 200).
const MAX_HOSTNAME = MAX_LABEL;
const WEB_TOOLS = new Set(["web_search", "web_research"]);

export function isWebActivityTool(toolName: string) {
  return WEB_TOOLS.has(toolName);
}

// Bare tokens such as "readme.md" or "app.py" are files, not sites, so only
// common site TLDs count without an explicit site: or URL marker.
const BARE_DOMAIN_TLDS = new Set([
  "com",
  "org",
  "net",
  "io",
  "co",
  "ai",
  "app",
  "dev",
  "us",
  "uk",
  "ca",
  "de",
  "fr",
  "au",
  "biz",
  "info",
  "edu",
  "gov",
  "insure",
  "insurance",
  "finance",
  "agency",
]);

function clip(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function readable(value: string) {
  return clip(value.replace(/\s+/g, " ").trim(), MAX_LABEL);
}

/** A plausible public hostname: no IPs, ports, credentials, or local names. */
function publicHostname(value: string): string | undefined {
  const host = value.toLowerCase().replace(/\.$/, "");
  if (host.length > MAX_HOSTNAME || !/^[a-z0-9.-]+$/.test(host))
    return undefined;
  const labels = host.split(".");
  if (labels.length < 2) return undefined;
  if (
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  )
    return undefined;
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,20})$/.test(tld)) return undefined;
  if (
    ["localhost", "local", "internal", "invalid", "test", "example"].includes(
      tld,
    )
  )
    return undefined;
  return host.replace(/^www\./, "");
}

function hostnameFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password || url.port) return undefined;
    return publicHostname(url.hostname);
  } catch {
    return undefined;
  }
}

/** Every distinct public domain the query names, in order. */
function hostsFromQuery(query: string): string[] {
  const hosts = new Set<string>();
  for (const raw of query.split(/\s+/)) {
    const token = raw.replace(/^[("'<]+|[)"'>,;:!?]+$/g, "");
    const site = /^site:(.+)$/i.exec(token);
    let host: string | undefined;
    if (site) {
      host = hostnameFromUrl(
        /^https?:\/\//i.test(site[1]) ? site[1] : `https://${site[1]}`,
      );
    } else if (/^https?:\/\//i.test(token)) {
      host = hostnameFromUrl(token);
    } else if (/^[a-z0-9.-]+$/i.test(token)) {
      // A standalone bare domain only: no path, port, credentials or query.
      const candidate = publicHostname(token);
      if (candidate && BARE_DOMAIN_TLDS.has(candidate.split(".").at(-1) ?? ""))
        host = candidate;
    }
    if (host) hosts.add(host);
  }
  return [...hosts];
}

export function toolActivityContext(
  toolName: string,
  input: unknown,
): ToolActivityContext | undefined {
  if (!WEB_TOOLS.has(toolName)) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const { query, url, allowedDomains } = input as Record<string, unknown>;
  // An explicit URL names the target. Otherwise the domains the query and the
  // allowed-domain scope name decide: exactly one is a site; several are not
  // one site, so they get a readable label and never a single favicon.
  const explicit =
    typeof url === "string" ? hostnameFromUrl(url.trim()) : undefined;
  if (explicit) return { label: explicit, website: `https://${explicit}` };
  const hosts = new Set<string>(
    typeof query === "string" ? hostsFromQuery(query) : [],
  );
  for (const entry of Array.isArray(allowedDomains) ? allowedDomains : []) {
    const host =
      typeof entry === "string"
        ? publicHostname(entry.trim().replace(/^\*\./, ""))
        : undefined;
    if (host) hosts.add(host);
  }
  const [first, ...others] = [...hosts];
  if (first && others.length === 0)
    return { label: first, website: `https://${first}` };
  if (typeof query === "string" && query.trim())
    return { label: readable(query) };
  if (first) return { label: clip(`${first} +${others.length}`, MAX_LABEL) };
  return undefined;
}
