"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { Ellipsis } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LinkedText } from "@/components/email/linked-text";
import { useTheme } from "@/hooks/use-theme";
import {
  isHistoryStartLine,
  isQuoteAttribution,
  isQuotedHeaderBlock,
  splitQuotedText,
} from "@/lib/email-quote";
import { typeStyle } from "@/lib/typography";

const REMOVED_ELEMENTS =
  "script, noscript, iframe, frame, frameset, object, embed, applet, base, link, meta, title";
// Where clients start quoted history: Gmail, Apple Mail, Thunderbird, Yahoo, Outlook web and desktop.
const QUOTE_START = [
  ".gmail_quote_container",
  ".gmail_quote",
  'blockquote[type="cite"]',
  ".moz-cite-prefix",
  ".yahoo_quoted",
  "#appendonsend",
  "#divRplyFwdMsg",
  'div[style*="border-top:solid #e1e1e1" i]',
  'div[style*="border-top: solid #e1e1e1" i]',
].join(", ");
const SAFE_URL = /^(https?:|mailto:|tel:|#|data:image\/(png|gif|jpe?g|webp);)/i;

// Designed mail renders as sent, on white paper in either theme.
const DESIGNED_STYLE = `
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: #111827;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    overflow-wrap: anywhere;
    overflow-x: auto;
    overflow-y: hidden;
  }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; }
  a { color: #2563eb; }
`;

// Inline presentation a person's mail client added; the reader's theme replaces it.
const PRESENTATION_PROPERTIES = [
  "color",
  "background",
  "background-color",
  "background-image",
  "font",
  "font-family",
  "font-size",
  "line-height",
];
const PRESENTATION_ATTRIBUTES = [
  "bgcolor",
  "color",
  "face",
  "size",
  "background",
];

/** The reader's text styling, read from the rendered wrapper so the frame follows the theme. */
type FramePalette = {
  scheme: "light" | "dark";
  color: string;
  muted: string;
  border: string;
  link: string;
  /** The wrapper's `typeStyle("body.default")` font, size and leading. */
  family: string;
  size: string;
  leading: string;
  fontFaces: string;
};

function framePalette(
  element: HTMLElement,
  scheme: "light" | "dark",
): FramePalette {
  const computed = getComputedStyle(element);
  const family = computed.getPropertyValue("font-family");
  return {
    scheme,
    color: computed.color,
    muted:
      computed.getPropertyValue("--muted-foreground").trim() || computed.color,
    border: computed.getPropertyValue("--border").trim() || "currentColor",
    // Matches `LinkedText` in plain-text bodies.
    link: scheme === "dark" ? "#93c5fd" : "#1d4ed8",
    family,
    size: computed.getPropertyValue("font-size"),
    leading: computed.getPropertyValue("line-height"),
    fontFaces: fontFaceRules(family),
  };
}

/** The app's `@font-face` rules for `family`, so the frame can load the app font. */
function fontFaceRules(family: string) {
  const unquote = (name: string) => name.trim().replace(/^["']|["']$/g, "");
  const names = new Set(family.split(",").map(unquote));
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(list))
      if (
        rule instanceof CSSFontFaceRule &&
        names.has(unquote(rule.style.getPropertyValue("font-family")))
      )
        rules.push(rule.cssText);
  }
  return rules.join("");
}

/**
 * Conversational mail takes the reader's font, size, colours and quote styling,
 * overriding the sender client's, so it reads like the rest of the thread.
 */
function conversationalStyle(palette: FramePalette) {
  return `
  ${palette.fontFaces}
  :root { color-scheme: ${palette.scheme}; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: ${palette.color};
    font-family: ${palette.family};
    font-size: ${palette.size};
    line-height: ${palette.leading};
    overflow-wrap: anywhere;
    overflow-x: auto;
    overflow-y: hidden;
  }
  body * {
    color: inherit !important;
    font-family: inherit !important;
    font-size: inherit !important;
    line-height: inherit !important;
    background-color: transparent !important;
    background-image: none !important;
    border-color: ${palette.border} !important;
  }
  a, a * { color: ${palette.link} !important; }
  pre, code, kbd, samp, tt { font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important; font-size: 0.9em !important; }
  pre { white-space: pre-wrap; }
  img { max-width: 100%; height: auto; }
  hr { border: 0 !important; border-top: 1px solid ${palette.border} !important; }
  blockquote {
    margin: 0.75em 0 !important;
    padding: 0 0 0 0.75em !important;
    border: 0 !important;
    border-left: 2px solid ${palette.border} !important;
  }
  .gmail_attr, .moz-cite-prefix { color: ${palette.muted} !important; }
  /* Data tables follow the shared Table: a bordered card, row dividers, a muted header. */
  table[data-email-table] {
    margin: 0.5em 0 !important;
    max-width: 100%;
    border: 1px solid ${palette.border} !important;
    border-collapse: separate !important;
    border-spacing: 0 !important;
    border-radius: 8px;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
  }
  table[data-email-table] :is(td, th) {
    padding: 8px 12px !important;
    border: 0 !important;
    border-bottom: 1px solid color-mix(in srgb, ${palette.color} 6%, transparent) !important;
    text-align: left;
    vertical-align: top;
  }
  table[data-email-table] tr:last-child > :is(td, th) { border-bottom: 0 !important; }
  table[data-email-table] th {
    color: ${palette.muted} !important;
    font-weight: 500;
    white-space: nowrap;
  }
`;
}

type InlineImage = { contentId: string; url: string };

const TEXT_BLOCKS = "div, p, span, font, blockquote, td";

function isQuoteText(text: string | null) {
  return Boolean(
    text && (isQuoteAttribution(text) || isQuotedHeaderBlock(text)),
  );
}

/** The innermost block, else the first text node, for which `matches` holds. */
function firstMatchingNode(
  body: HTMLElement,
  matches: (text: string | null) => boolean,
): Node | null {
  let block = Array.from(body.querySelectorAll(TEXT_BLOCKS)).find((el) =>
    matches(el.textContent),
  );
  while (block) {
    const inner = Array.from(block.querySelectorAll(TEXT_BLOCKS)).find((el) =>
      matches(el.textContent),
    );
    if (!inner) break;
    block = inner;
  }
  const walker = body.ownerDocument.createTreeWalker(
    body,
    NodeFilter.SHOW_TEXT,
  );
  let text: Node | null = walker.nextNode();
  while (text && !matches(text.textContent)) text = walker.nextNode();
  return earliest([block ?? null, text]);
}

function earliest(nodes: (Node | null)[]) {
  return nodes.reduce<Node | null>(
    (first, node) =>
      !node
        ? first
        : !first ||
            first.compareDocumentPosition(node) &
              Node.DOCUMENT_POSITION_PRECEDING
          ? node
          : first,
    null,
  );
}

/**
 * Where quoted history starts: a client's quote container or an attribution
 * ("… wrote:", Outlook headers), whichever comes first; otherwise the line Jev
 * found (`historyStart`).
 */
function quoteStart(
  body: HTMLElement,
  historyStart: string | null | undefined,
): Node | null {
  const known = earliest([
    body.querySelector(QUOTE_START),
    firstMatchingNode(body, isQuoteText),
  ]);
  if (known || !historyStart) return known;
  return firstMatchingNode(body, (text) =>
    Boolean(text && isHistoryStartLine(text, historyStart)),
  );
}

/** Drops the line breaks clients leave above a quoted or forwarded block; its margin spaces it. */
function tightenQuotes(body: HTMLElement) {
  for (const quote of Array.from(body.querySelectorAll("blockquote"))) {
    let previous = quote.previousSibling;
    while (
      previous &&
      (previous.nodeName === "BR" ||
        (previous.nodeType === Node.TEXT_NODE && !previous.textContent?.trim()))
    ) {
      const before: ChildNode | null = previous.previousSibling;
      previous.remove();
      previous = before;
    }
  }
}

/**
 * Marks tables that hold data, not layout, for the shared table styling: a
 * header cell, a sender-drawn border, or a grid of text cells. Signature and
 * layout tables (images, nested tables, a single row or column) are left alone.
 */
function markDataTables(body: HTMLElement) {
  for (const table of Array.from(body.querySelectorAll("table"))) {
    const rows = Array.from(table.rows);
    const grid = rows.length >= 2 && rows.some((row) => row.cells.length >= 2);
    const bordered = Number(table.getAttribute("border")) > 0;
    if (table.querySelector("table, img")) continue;
    if (!table.querySelector("th") && !bordered && !grid) continue;
    table.setAttribute("data-email-table", "");
    for (const name of ["border", "cellpadding", "cellspacing", "width"])
      table.removeAttribute(name);
  }
}

/**
 * Builds a self-contained document for a sandboxed frame. The sandbox blocks
 * scripts; this also drops active content, unsafe URLs and unresolved `cid:`
 * images, trims quoted history unless `keepQuoted`, and restyles conversational
 * mail with `palette`.
 */
function buildEmailDocument(
  html: string,
  inlineImages: InlineImage[],
  keepQuoted: boolean,
  historyStart: string | null | undefined,
  palette: FramePalette | null,
) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const inline = new Map(
    inlineImages.map((image) => [image.contentId, image.url]),
  );
  doc.querySelectorAll(REMOVED_ELEMENTS).forEach((node) => node.remove());
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on") || name === "srcset" || name === "formaction") {
        element.removeAttribute(attr.name);
      } else if (["src", "href", "background", "action"].includes(name)) {
        const resolved = value.toLowerCase().startsWith("cid:")
          ? inline.get(value.slice(4))
          : SAFE_URL.test(value)
            ? value
            : undefined;
        if (resolved) element.setAttribute(attr.name, resolved);
        else element.removeAttribute(attr.name);
      }
    }
    if (palette) {
      for (const name of PRESENTATION_ATTRIBUTES) element.removeAttribute(name);
      if (element instanceof HTMLElement)
        for (const property of PRESENTATION_PROPERTIES)
          element.style.removeProperty(property);
    }
    if (element instanceof HTMLImageElement && !element.getAttribute("src"))
      element.remove();
    if (element instanceof HTMLAnchorElement) {
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
  }

  if (palette) {
    tightenQuotes(doc.body);
    markDataTables(doc.body);
  }

  let trimmed = false;
  const quote = keepQuoted ? null : quoteStart(doc.body, historyStart);
  // Keep the quote when it is the whole message (a bare forward or a reply with no text).
  if (quote) {
    const before = doc.createRange();
    before.setStart(doc.body, 0);
    before.setEndBefore(quote);
    if (before.toString().trim()) {
      const previous =
        quote instanceof Element ? quote.previousElementSibling : null;
      if (previous?.tagName === "HR") previous.remove();
      // Drop the quote and everything after it in document order.
      for (
        let node: Node | null = quote;
        node && node !== doc.body;
        node = node.parentNode
      ) {
        let next = node.nextSibling;
        while (next) {
          const after: ChildNode | null = next.nextSibling;
          next.remove();
          next = after;
        }
      }
      let tail: Node | null = quote.previousSibling ?? quote.parentNode;
      quote.parentNode?.removeChild(quote);
      // Line breaks and empty wrappers that only separated the reply from its history.
      const blank = (node: Node) =>
        node.nodeName === "BR" ||
        (!node.textContent?.trim() &&
          !(node instanceof Element && node.querySelector("img")) &&
          node.nodeName !== "IMG");
      while (tail && tail !== doc.body && blank(tail)) {
        const previous: Node | null = tail.previousSibling ?? tail.parentNode;
        tail.parentNode?.removeChild(tail);
        tail = previous;
      }
      trimmed = true;
    }
  }

  const styles = Array.from(doc.querySelectorAll("style"))
    .map((style) => style.outerHTML)
    .join("");
  doc.querySelectorAll("body style").forEach((style) => style.remove());
  // The sender's styles override the designed defaults; the conversational theme overrides the sender's.
  const head = palette
    ? `${styles}<style>${conversationalStyle(palette)}</style>`
    : `<style>${DESIGNED_STYLE}</style>${styles}`;
  return {
    trimmed,
    srcDoc: `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${doc.body.innerHTML}</body></html>`,
  };
}

/** Sizes the frame to its content, following late image loads and layout changes. */
function useFrameHeight(srcDoc: string | null) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const frame = ref.current;
    if (!frame || !srcDoc) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (doc?.documentElement) setHeight(doc.documentElement.scrollHeight);
    };
    const attach = () => {
      measure();
      const body = frame.contentDocument?.body;
      observer?.disconnect();
      if (!body) return;
      observer = new ResizeObserver(measure);
      observer.observe(body);
    };
    frame.addEventListener("load", attach);
    if (frame.contentDocument?.readyState === "complete") attach();
    return () => {
      frame.removeEventListener("load", attach);
      observer?.disconnect();
    };
  }, [srcDoc]);
  return { ref, height };
}

/**
 * A stored message's HTML body in a script-free sandbox with inline images
 * resolved: conversational mail in the reader's theme, designed mail as sent on
 * white paper (`lib/email-html-style.ts`). Shows `fallback` until the HTML is available.
 */
export function EmailHtmlBody({
  messageId,
  keepQuoted,
  historyStart,
  fallback,
}: {
  messageId: Id<"teamEmailMessages">;
  /** First line of quoted history found by Jev, used when no known marker matches. */
  historyStart?: string | null;
  /** Show quoted history up front, as for a forwarded message. */
  keepQuoted: boolean;
  fallback: ReactNode;
}) {
  const body = useQuery(api.teamInbox.getMessageHtml, { messageId });
  const { resolved } = useTheme();
  const wrapper = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<FramePalette | null>(null);
  const [showQuoted, setShowQuoted] = useState(keepQuoted);
  const conversational = body?.style === "conversational";
  useLayoutEffect(() => {
    if (conversational && wrapper.current)
      setPalette(framePalette(wrapper.current, resolved));
  }, [conversational, resolved]);
  const built = useMemo(
    () =>
      body && (!conversational || palette)
        ? buildEmailDocument(
            body.html,
            body.inlineImages,
            showQuoted,
            historyStart,
            conversational ? palette : null,
          )
        : null,
    [body, conversational, palette, showQuoted, historyStart],
  );
  const { ref, height } = useFrameHeight(built?.srcDoc ?? null);

  if (!body) return <>{fallback}</>;
  return (
    <div
      ref={wrapper}
      className={
        conversational
          ? `space-y-2 text-foreground ${typeStyle("body.default")}`
          : "space-y-2 dark:rounded-lg dark:bg-white dark:p-3 dark:[&>button]:bg-neutral-200 dark:[&>button]:text-neutral-600"
      }
    >
      {built ? (
        <iframe
          ref={ref}
          title="Email message"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={built.srcDoc}
          // Matching the frame's color-scheme keeps its canvas transparent.
          style={{
            height,
            colorScheme: conversational ? palette?.scheme : undefined,
          }}
          className="block w-full border-0"
        />
      ) : null}
      {built?.trimmed ? (
        <ShowQuotedButton onClick={() => setShowQuoted(true)} />
      ) : null}
    </div>
  );
}

/** The folded-history control shown under a message with hidden quoted text. */
export function ShowQuotedButton({
  onClick,
  label = "Show quoted text",
  expanded,
}: {
  onClick: () => void;
  label?: string;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      onClick={onClick}
      className="flex h-4 items-center rounded-sm bg-muted px-1.5 text-muted-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Ellipsis className="size-4" />
    </button>
  );
}

/** Plain-text body with quoted history folded behind `ShowQuotedButton`. */
export function EmailTextBody({
  text,
  historyStart,
  className,
}: {
  text: string;
  historyStart?: string | null;
  className: string;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { current, quoted } = useMemo(
    () => splitQuotedText(text, historyStart),
    [text, historyStart],
  );
  return (
    <div className="space-y-2">
      <p className={className}>
        <LinkedText text={showQuoted || !quoted ? text : current} />
      </p>
      {quoted && !showQuoted ? (
        <ShowQuotedButton onClick={() => setShowQuoted(true)} />
      ) : null}
    </div>
  );
}
