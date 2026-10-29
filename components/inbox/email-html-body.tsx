"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { Ellipsis } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  isHistoryStartLine,
  isQuoteAttribution,
  isQuotedHeaderBlock,
  splitQuotedText,
} from "@/lib/email-quote";

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

const FRAME_STYLE = `
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

type InlineImage = { contentId: string; url: string };

const TEXT_BLOCKS = "div, p, span, font, blockquote, td";

function isQuoteText(text: string | null) {
  return Boolean(text && (isQuoteAttribution(text) || isQuotedHeaderBlock(text)));
}

/** The innermost block, else the first text node, for which `matches` holds. */
function firstMatchingNode(body: HTMLElement, matches: (text: string | null) => boolean): Node | null {
  let block = Array.from(body.querySelectorAll(TEXT_BLOCKS)).find((el) => matches(el.textContent));
  while (block) {
    const inner = Array.from(block.querySelectorAll(TEXT_BLOCKS)).find((el) => matches(el.textContent));
    if (!inner) break;
    block = inner;
  }
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let text: Node | null = walker.nextNode();
  while (text && !matches(text.textContent)) text = walker.nextNode();
  return earliest([block ?? null, text]);
}

function earliest(nodes: (Node | null)[]) {
  return nodes.reduce<Node | null>(
    (first, node) =>
      !node ? first : !first || first.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING ? node : first,
    null,
  );
}

/**
 * Where quoted history starts: a client's quote container or an attribution
 * ("… wrote:", Outlook headers), whichever comes first; otherwise the line Jev
 * found (`historyStart`).
 */
function quoteStart(body: HTMLElement, historyStart: string | null | undefined): Node | null {
  const known = earliest([body.querySelector(QUOTE_START), firstMatchingNode(body, isQuoteText)]);
  if (known || !historyStart) return known;
  return firstMatchingNode(body, (text) => Boolean(text && isHistoryStartLine(text, historyStart)));
}

/**
 * Builds a self-contained document for a sandboxed frame. The sandbox blocks
 * scripts; this also drops active content, unsafe URLs and unresolved `cid:`
 * images, and trims quoted history unless `keepQuoted`.
 */
function buildEmailDocument(
  html: string,
  inlineImages: InlineImage[],
  keepQuoted: boolean,
  historyStart: string | null | undefined,
) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const inline = new Map(inlineImages.map((image) => [image.contentId, image.url]));
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
    if (element instanceof HTMLImageElement && !element.getAttribute("src")) element.remove();
    if (element instanceof HTMLAnchorElement) {
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
  }

  let trimmed = false;
  const quote = keepQuoted ? null : quoteStart(doc.body, historyStart);
  // Keep the quote when it is the whole message (a bare forward or a reply with no text).
  if (quote) {
    const before = doc.createRange();
    before.setStart(doc.body, 0);
    before.setEndBefore(quote);
    if (before.toString().trim()) {
      const previous = quote instanceof Element ? quote.previousElementSibling : null;
      if (previous?.tagName === "HR") previous.remove();
      // Drop the quote and everything after it in document order.
      for (let node: Node | null = quote; node && node !== doc.body; node = node.parentNode) {
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
        (!node.textContent?.trim() && !(node instanceof Element && node.querySelector("img")) && node.nodeName !== "IMG");
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
  return {
    trimmed,
    srcDoc: `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_STYLE}</style>${styles}</head><body>${doc.body.innerHTML}</body></html>`,
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
 * A stored message's HTML body, rendered faithfully in a script-free sandbox
 * with inline images resolved. Shows `fallback` until the HTML is available.
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
  const [showQuoted, setShowQuoted] = useState(keepQuoted);
  const built = useMemo(
    () => (body ? buildEmailDocument(body.html, body.inlineImages, showQuoted, historyStart) : null),
    [body, showQuoted, historyStart],
  );
  const { ref, height } = useFrameHeight(built?.srcDoc ?? null);

  if (!built) return <>{fallback}</>;
  return (
    <div className="space-y-2 dark:rounded-lg dark:bg-white dark:p-3 dark:[&>button]:bg-neutral-200 dark:[&>button]:text-neutral-600">
      <iframe
        ref={ref}
        title="Email message"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={built.srcDoc}
        style={{ height }}
        className="block w-full border-0"
      />
      {built.trimmed ? <ShowQuotedButton onClick={() => setShowQuoted(true)} /> : null}
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
  const { current, quoted } = useMemo(() => splitQuotedText(text, historyStart), [text, historyStart]);
  return (
    <div className="space-y-2">
      <p className={className}>{showQuoted || !quoted ? text : current}</p>
      {quoted && !showQuoted ? <ShowQuotedButton onClick={() => setShowQuoted(true)} /> : null}
    </div>
  );
}
