// Injected into the active tab by chrome.scripting.executeScript({ func }).
// The function is serialized, so it must stay self-contained.
globalThis.spotCapturePage = function spotCapturePage(limits) {
  const SKIP_TAGS = new Set([
    "script", "style", "noscript", "template", "input", "textarea", "select",
    "option", "datalist", "iframe", "frame", "object", "embed", "canvas",
    "video", "audio", "svg", "head",
  ]);
  const MAX_NODES = 60000;
  const MARKER = "\n\n[Page text shortened]";

  if (location.protocol !== "http:" && location.protocol !== "https:") {
    return { ok: false, reason: "unsupported" };
  }
  let url;
  try {
    const parsed = new URL(location.href);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    url = parsed.href;
    if (url.length > limits.maxUrl) url = parsed.origin + "/";
    if (url.length > limits.maxUrl) return { ok: false, reason: "unreadable" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const title =
    (document.title || "").replace(/\s+/g, " ").trim().slice(0, limits.maxTitle) ||
    new URL(url).hostname;

  const styles = new Map();
  const styleOf = (el) => {
    let style = styles.get(el);
    if (!style) {
      style = getComputedStyle(el);
      styles.set(el, style);
    }
    return style;
  };
  const excluded = (el) =>
    SKIP_TAGS.has(el.localName) ||
    el.hidden ||
    el.getAttribute("aria-hidden") === "true" ||
    el.isContentEditable ||
    el.getAttribute("contenteditable") !== null;

  let total = 0;
  let stopped = false;
  let visited = 0;
  const parts = [];
  const push = (value) => {
    if (!value) return;
    parts.push(value);
    total += value.length;
    if (total > limits.maxText + 1000) stopped = true;
  };

  function collect(root, range) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (++visited > MAX_NODES) {
            stopped = true;
            return NodeFilter.FILTER_REJECT;
          }
          if (node.nodeType === Node.TEXT_NODE) {
            const parent = node.parentElement;
            if (!parent || styleOf(parent).visibility !== "visible") {
              return NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
          if (excluded(node)) return NodeFilter.FILTER_REJECT;
          const style = styleOf(node);
          if (style.display === "none" || style.contentVisibility === "hidden") {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    for (let node = walker.nextNode(); node && !stopped; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const display = styleOf(node).display;
        if (display.startsWith("table-cell")) push(" ");
        else if (display === "list-item" || !display.startsWith("inline")) {
          if (display !== "contents") push("\n");
        }
        continue;
      }
      let text = node.nodeValue || "";
      if (range) {
        if (!range.intersectsNode(node)) continue;
        if (node === range.endContainer) text = text.slice(0, range.endOffset);
        if (node === range.startContainer) text = text.slice(range.startOffset);
      }
      push(text.replace(/\s+/g, " "));
    }
  }

  function tidy(value) {
    return value
      .replace(/[ \t ]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  let usedSelection = false;
  const selection = getSelection();
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    for (let i = 0; i < selection.rangeCount && !stopped; i++) {
      const range = selection.getRangeAt(i);
      let anchor = range.commonAncestorContainer;
      if (anchor.nodeType !== Node.ELEMENT_NODE) anchor = anchor.parentElement;
      if (!anchor || anchor.closest("input,textarea,select,[contenteditable],[aria-hidden='true'],[hidden]")) {
        continue;
      }
      if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
        let text = range.commonAncestorContainer.nodeValue || "";
        text = text.slice(range.startOffset, range.endOffset);
        if (styleOf(anchor).visibility === "visible") push(text.replace(/\s+/g, " "));
      } else {
        collect(range.commonAncestorContainer, range);
      }
      push("\n");
    }
    usedSelection = tidy(parts.join("")).length > 0;
  }
  if (!usedSelection) {
    parts.length = 0;
    total = 0;
    stopped = false;
    visited = 0;
    if (document.body) collect(document.body, null);
  }

  let text = tidy(parts.join(""));
  if (!text) return { ok: false, reason: "empty" };
  const truncated = stopped || text.length > limits.maxText;
  if (truncated) {
    let cut = text.slice(0, limits.maxText - MARKER.length);
    if (text.length > cut.length) {
      const boundary = cut.search(/\s\S{0,200}$/);
      if (boundary > 0) cut = cut.slice(0, boundary);
    }
    text = cut.trimEnd() + MARKER;
  }
  return {
    ok: true,
    truncated,
    context: { title, url, text, selection: usedSelection },
  };
};
