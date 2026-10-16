import config from "@/config/browser-extension.json";

export const BROWSER_EXTENSION_ORIGIN = `chrome-extension://${config.extensionId}`;
export const BROWSER_EXTENSION_WELCOME_URL = "https://spot.insure/extension/welcome";

export function notifyBrowserExtension(type: "spot:mounted" | "spot:sign-in") {
  window.parent.postMessage({ type, version: config.protocolVersion }, BROWSER_EXTENSION_ORIGIN);
}
export const BROWSER_EXTENSION_READY = {
  type: "spot:ready",
  version: config.protocolVersion,
} as const;

export type BrowserPageContext = {
  title: string;
  url: string;
  text: string;
  selection: boolean;
};

/** The bridge only stages reference material; it cannot submit or execute tools. */
export function parseBrowserPageContext(value: unknown): BrowserPageContext | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (
    message.type !== "spot:page-context" ||
    message.version !== config.protocolVersion ||
    !message.context ||
    typeof message.context !== "object"
  ) return null;
  const context = message.context as Record<string, unknown>;
  if (
    typeof context.title !== "string" ||
    context.title.length > config.maxTitleLength ||
    typeof context.url !== "string" ||
    context.url.length > config.maxUrlLength ||
    typeof context.text !== "string" ||
    !context.text.trim() ||
    context.text.length > config.maxTextLength ||
    typeof context.selection !== "boolean"
  ) return null;
  try {
    const url = new URL(context.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash
    ) return null;
  } catch {
    return null;
  }
  return {
    title: context.title,
    url: context.url,
    text: context.text,
    selection: context.selection,
  };
}
