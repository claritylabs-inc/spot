"use node";

import { convert } from "html-to-text";
import { readWebsitePage } from "./websiteBrand";

const DEFAULT_MAX_CHARS = 12_000;

function pageTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]
    ? convert(match[1], { wordwrap: false }).replace(/\s+/g, " ").trim().slice(0, 300)
    : undefined;
}

/**
 * Fetches one public http(s) page and returns its title and readable text.
 * `readWebsitePage` owns SSRF protection: it resolves DNS once, rejects
 * private/metadata addresses, pins the connection to the vetted address and
 * re-validates every redirect hop.
 */
export async function fetchPublicUrl(
  rawUrl: string,
  maxChars: number = DEFAULT_MAX_CHARS,
) {
  const page = await readWebsitePage(rawUrl);
  const contentType = page.headers["content-type"]?.split(";")[0]?.trim();
  if (!page.html) {
    return {
      url: page.url,
      status: page.status,
      contentType,
      text: "",
      truncated: false,
      warning:
        "Only HTML pages are extracted. For PDFs or other files, pass the url to web_search.",
    };
  }
  const text = convert(page.html, {
    wordwrap: false,
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "noscript", format: "skip" },
      { selector: "svg", format: "skip" },
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    url: page.url,
    status: page.status,
    contentType,
    title: pageTitle(page.html),
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
    ...(page.status >= 400
      ? {
          warning: `The site answered HTTP ${page.status}; the text may be an error or bot-challenge page, not the content.`,
        }
      : {}),
  };
}
