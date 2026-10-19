/**
 * Compact, public-safe target context for a tool call, shared by the backend
 * (recorded at execution start) and the chat UI (audit fallback for older
 * messages). It never carries full arguments or results: web search yields a
 * hostname when the request names an explicit public domain, otherwise a
 * bounded readable query.
 */
export type ToolActivityContext = { label: string; website?: string };

const MAX_LABEL = 160;
// The recorded website ("https://" + host) must stay within 200 characters.
const MAX_HOSTNAME = 190;
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

function hostnameFromQuery(query: string): string | undefined {
  for (const raw of query.split(/\s+/)) {
    const token = raw.replace(/^[("'<]+|[)"'>,;:!?]+$/g, "");
    const site = /^site:(.+)$/i.exec(token);
    if (site) {
      const host = hostnameFromUrl(
        /^https?:\/\//i.test(site[1]) ? site[1] : `https://${site[1]}`,
      );
      if (host) return host;
      continue;
    }
    if (/^https?:\/\//i.test(token)) {
      const host = hostnameFromUrl(token);
      if (host) return host;
      continue;
    }
    // A standalone bare domain only: no path, port, credentials or query.
    if (/^[a-z0-9.-]+$/i.test(token)) {
      const host = publicHostname(token);
      if (host && BARE_DOMAIN_TLDS.has(host.split(".").at(-1) ?? ""))
        return host;
    }
  }
}

export function toolActivityContext(
  toolName: string,
  input: unknown,
): ToolActivityContext | undefined {
  if (!WEB_TOOLS.has(toolName)) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const { query, url, allowedDomains } = input as Record<string, unknown>;
  // An explicit URL names the target; otherwise a domain in the query; one
  // allowed domain is a legitimate scope. Several different domains are not
  // one site, so they never produce a website.
  const scope = [
    ...new Set(
      (Array.isArray(allowedDomains) ? allowedDomains : []).flatMap((entry) => {
        const host =
          typeof entry === "string"
            ? publicHostname(entry.trim().replace(/^\*\./, ""))
            : undefined;
        return host ? [host] : [];
      }),
    ),
  ];
  const host =
    (typeof url === "string" ? hostnameFromUrl(url.trim()) : undefined) ??
    (typeof query === "string" ? hostnameFromQuery(query) : undefined) ??
    (scope.length === 1 ? scope[0] : undefined);
  if (host) return { label: host, website: `https://${host}` };
  if (typeof query === "string" && query.trim())
    return { label: readable(query) };
  if (scope.length > 1) return { label: `${scope[0]} +${scope.length - 1}` };
  return undefined;
}
