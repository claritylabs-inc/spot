import { Marked, type MarkedToken, type Token, type Tokens } from "marked";

const markdownLexer = new Marked();
const BLOCK_SEPARATOR = "\n\n";
const LIST_INDENT = "  ";
const TABLE_CELL_SEPARATOR = " | ";

function renderInlineTokens(tokens: Token[]): string {
  return tokens.map(renderInlineToken).join("");
}

function renderLink(token: Tokens.Link) {
  const label = renderInlineTokens(token.tokens);
  return label === token.href ? token.href : `${label} (${token.href})`;
}

function renderImage(token: Tokens.Image) {
  return token.text ? `${token.text} (${token.href})` : token.href;
}

function renderHtml(value: string) {
  return value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
}

function renderInlineToken(token: Token): string {
  const markedToken = token as MarkedToken;
  switch (markedToken.type) {
    case "strong":
    case "em":
    case "del":
      return renderInlineTokens(markedToken.tokens);
    case "codespan":
      return markedToken.text;
    case "br":
      return "\n";
    case "link":
      return renderLink(markedToken);
    case "image":
      return renderImage(markedToken);
    case "escape":
      return markedToken.text;
    case "text":
      return markedToken.tokens
        ? renderInlineTokens(markedToken.tokens)
        : markedToken.text;
    case "html":
      return renderHtml(markedToken.text);
    case "checkbox":
      return "";
    default:
      if ("tokens" in markedToken && markedToken.tokens) {
        return renderInlineTokens(markedToken.tokens);
      }
      if ("text" in markedToken && typeof markedToken.text === "string") {
        return markedToken.text;
      }
      return "";
  }
}

function renderList(list: Tokens.List) {
  const lines: string[] = [];
  for (const [index, item] of list.items.entries()) {
    const marker = list.ordered
      ? `${(list.start === "" ? 1 : list.start) + index}. `
      : "• ";
    const checkbox = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
    const rendered = renderBlockTokens(item.tokens);
    const [first = "", ...rest] = rendered.split("\n");
    lines.push(`${marker}${checkbox}${first}`);
    lines.push(...rest.map((line) => `${LIST_INDENT}${line}`));
  }
  return lines.join("\n");
}

function renderTable(table: Tokens.Table) {
  const renderRow = (cells: Tokens.TableCell[]) =>
    cells
      .map((cell) => renderInlineTokens(cell.tokens))
      .join(TABLE_CELL_SEPARATOR);
  return [renderRow(table.header), ...table.rows.map(renderRow)].join("\n");
}

function renderBlockquote(quote: Tokens.Blockquote) {
  return renderBlockTokens(quote.tokens);
}

function renderBlockToken(token: Token): string {
  const markedToken = token as MarkedToken;
  switch (markedToken.type) {
    case "heading":
    case "paragraph":
      return renderInlineTokens(markedToken.tokens);
    case "code":
      return markedToken.text;
    case "blockquote":
      return renderBlockquote(markedToken);
    case "list":
      return renderList(markedToken);
    case "table":
      return renderTable(markedToken);
    case "hr":
      return "———";
    case "space":
    case "def":
      return "";
    default:
      return renderInlineToken(token);
  }
}

function renderBlockTokens(tokens: Token[]) {
  return tokens.map(renderBlockToken).filter(Boolean).join(BLOCK_SEPARATOR);
}

export function imessagePlainText(value: string) {
  return renderBlockTokens(markdownLexer.lexer(value)).trim();
}
