"use node";

import { marked, Renderer, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import { convert } from "html-to-text";
import { stripConfidenceMarkers } from "./confidence";
import { stripInternalAgentActivity } from "./agentMessageHistory";

const EMOJI_SEQUENCE = /(?:[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;

export function cleanAgentMarkdownForTransport(value: string): string {
  return stripConfidenceMarkers(stripInternalAgentActivity(value));
}

function escapeSlackText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeLink(href: string): string | null {
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
      ? href
      : null;
  } catch {
    return null;
  }
}

class SlackMrkdwnRenderer extends Renderer {
  override code({ text }: Tokens.Code) {
    return `\`\`\`${escapeSlackText(text)}\`\`\`\n\n`;
  }

  override blockquote({ tokens }: Tokens.Blockquote) {
    return `${this.parser
      .parse(tokens)
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`;
  }

  override html({ text }: Tokens.HTML | Tokens.Tag) {
    return escapeSlackText(text);
  }

  override heading({ tokens }: Tokens.Heading) {
    return `*${this.parser.parseInline(tokens)}*\n\n`;
  }

  override hr() {
    return "────────\n\n";
  }

  override list(token: Tokens.List) {
    return `${token.items
      .map((item, index) => {
        const marker = token.ordered
          ? `${Number(token.start ?? 1) + index}.`
          : "•";
        return `${marker} ${this.listitem(item).replaceAll(
          "\n",
          `\n${" ".repeat(marker.length + 1)}`,
        )}`;
      })
      .join("\n")}\n\n`;
  }

  /** Keep every block inside an item on its own line so nested lists stay readable. */
  override listitem(item: Tokens.ListItem) {
    const task = item.task
      ? this.checkbox({ type: "checkbox", raw: "", checked: item.checked === true })
      : "";
    return `${task}${item.tokens
      .filter((token) => token.type !== "checkbox")
      .map((token) => this.parser.parse([token]).trim())
      .filter((block) => block.length > 0)
      .join(item.loose ? "\n\n" : "\n")}`;
  }

  override checkbox({ checked }: Tokens.Checkbox) {
    return checked ? "[x] " : "[ ] ";
  }

  override table(token: Tokens.Table) {
    const cell = (candidate: Tokens.TableCell) =>
      this.parser.parseInline(candidate.tokens).trim();
    const header = token.header
      .map((candidate) => {
        const text = cell(candidate);
        return text ? `*${text}*` : text;
      })
      .join(" | ");
    const rows = token.rows.map((row) => row.map(cell).join(" | "));
    return `${[header, ...rows].filter(Boolean).join("\n")}\n\n`;
  }

  override paragraph({ tokens }: Tokens.Paragraph) {
    return `${this.parser.parseInline(tokens)}\n\n`;
  }

  override strong({ tokens }: Tokens.Strong) {
    return `*${this.parser.parseInline(tokens)}*`;
  }

  override em({ tokens }: Tokens.Em) {
    return `_${this.parser.parseInline(tokens)}_`;
  }

  override codespan({ text }: Tokens.Codespan) {
    return `\`${escapeSlackText(text)}\``;
  }

  override br() {
    return "\n";
  }

  override del({ tokens }: Tokens.Del) {
    return `~${this.parser.parseInline(tokens)}~`;
  }

  override link({ href, tokens }: Tokens.Link) {
    const label = this.parser.parseInline(tokens);
    const safeHref = safeLink(href);
    if (!safeHref) return label;
    const target = escapeSlackText(safeHref);
    return target === label ? `<${target}>` : `<${target}|${label}>`;
  }

  override image({ href, text }: Tokens.Image) {
    const safeHref = safeLink(href);
    const label = escapeSlackText(text || "image");
    return safeHref ? `<${escapeSlackText(safeHref)}|${label}>` : label;
  }

  override text(token: Tokens.Text | Tokens.Escape) {
    return "tokens" in token && token.tokens
      ? this.parser.parseInline(token.tokens)
      : escapeSlackText(token.text);
  }
}

function renderWith(renderer: Renderer, markdown: string): string {
  return String(
    marked.parse(cleanAgentMarkdownForTransport(markdown), {
      async: false,
      gfm: true,
      renderer,
    }),
  ).trim();
}

export function renderSlackMrkdwn(markdown: string): string {
  return renderWith(new SlackMrkdwnRenderer(), markdown)
    .replace(EMOJI_SEQUENCE, "")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderAgentMarkdownHtml(markdown: string): string {
  const rendered = String(
    // Single line breaks are kept: hand-edited drafts and "•" lists rely on them.
    marked.parse(cleanAgentMarkdownForTransport(markdown), {
      async: false,
      gfm: true,
      breaks: true,
    }),
  );
  return sanitizeHtml(rendered, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "a",
      "ul",
      "ol",
      "li",
      "blockquote",
      "code",
      "pre",
      "h1",
      "h2",
      "h3",
      "h4",
    ],
    allowedAttributes: {
      a: ["href", "title"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
  });
}

export function renderAgentMarkdownText(markdown: string): string {
  return convert(renderAgentMarkdownHtml(markdown), {
    wordwrap: false,
    selectors: [
      {
        selector: "a",
        options: { hideLinkHrefIfSameAsText: true },
      },
    ],
  }).trim();
}
