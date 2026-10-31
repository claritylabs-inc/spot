// Whether an HTML email is conversational mail a person wrote, which the reader
// restyles to the app theme, or a designed template (newsletter, receipt,
// notification) whose layout and colours carry meaning and render as sent.
// Works on the raw HTML string so the server and the reader share one answer.

export type EmailHtmlStyle = "conversational" | "designed";

// Markup that only mail clients write for a person's message.
const CLIENT_MARKERS = [
  /class="?[^"'>]*\bgmail_(?:default|quote|signature|attr)\b/i,
  /class="?[^"'>]*\bApple-(?:interchange-newline|tab-span)\b/i,
  /<blockquote[^>]+type="?cite/i,
  /-webkit-nbsp-mode:\s*space/i,
  /class="?[^"'>]*\b(?:MsoNormal|WordSection1)\b/i,
  /id="?(?:divRplyFwdMsg|appendonsend)\b/i,
  /class="?[^"'>]*\b(?:moz-cite-prefix|moz-signature|yahoo_quoted)\b/i,
];

// Markup that only bulk or templated senders write.
const TEMPLATE_MARKERS = [
  /\bunsubscribe\b/i,
  /view (?:this email |it )?(?:in|on) (?:your |a )?(?:web )?browser/i,
  /@media[^{]*\{/i,
  /\b(?:mcnTextContent|mcnImage|hs_cos_wrapper|es-wrapper|bodyTable|templateContainer)\b/,
];

const NEUTRAL_BACKGROUND =
  /^(?:#fff(?:fff)?|white|transparent|none|inherit|initial|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(?:,\s*1(?:\.0+)?\s*)?\))$/i;

function count(html: string, pattern: RegExp) {
  return (
    html.match(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))
      ?.length ?? 0
  );
}

/** Structural facts about the HTML, also the evidence Jev reads for unclear mail. */
export function emailHtmlSignals(html: string) {
  const backgrounds = [
    ...html.matchAll(/\bbgcolor\s*=\s*["']?([^"'\s>]+)/gi),
    ...html.matchAll(/background(?:-color)?\s*:\s*([^;"'}]+)/gi),
  ]
    .map((match) => match[1].replace(/!important/i, "").trim())
    .filter((value) => !NEUTRAL_BACKGROUND.test(value));
  const tableWidths = [
    ...html.matchAll(/<table[^>]*?\bwidth\s*=\s*["']?(\d+)/gi),
    ...html.matchAll(
      /<table[^>]*?style="[^"]*?\b(?:max-)?width\s*:\s*(\d+)px/gi,
    ),
  ].map((match) => Number(match[1]));
  return {
    clientMarkers: CLIENT_MARKERS.filter((pattern) => pattern.test(html))
      .length,
    templateMarkers: TEMPLATE_MARKERS.filter((pattern) => pattern.test(html))
      .length,
    tables: count(html, /<table\b/i),
    layoutTables:
      tableWidths.filter((width) => width >= 480).length +
      count(html, /<table[^>]+role\s*=\s*["']?presentation/i),
    coloredBackgrounds: backgrounds.length,
    backgroundImages: count(
      html,
      /background-image\s*:\s*url|<(?:table|td|body)[^>]+\bbackground\s*=/i,
    ),
    images: count(html, /<img\b/i),
    remoteImages: count(html, /<img[^>]+src\s*=\s*["']?https?:/i),
  };
}

export type EmailHtmlSignals = ReturnType<typeof emailHtmlSignals>;

/**
 * The style the markup settles on its own, or null when it is unclear and Jev
 * decides (`teamEmailMessages.htmlStyle`).
 */
export function classifyEmailHtml(
  signals: EmailHtmlSignals,
): EmailHtmlStyle | null {
  // A forwarded newsletter keeps its layout even inside a client's forward wrapper.
  if (
    signals.templateMarkers > 0 ||
    signals.layoutTables > 0 ||
    signals.backgroundImages > 0
  )
    return "designed";
  // Highlights or coloured cells in a person's message may be decoration or may carry meaning.
  const decorated = signals.coloredBackgrounds >= 3;
  if (signals.clientMarkers > 0) return decorated ? null : "conversational";
  if (decorated) return "designed";
  if (
    signals.tables === 0 &&
    signals.coloredBackgrounds === 0 &&
    signals.remoteImages <= 2
  )
    return "conversational";
  return null;
}

/** The reader's style: what the markup settles, else Jev's stored answer, else as sent. */
export function emailHtmlStyle(
  html: string,
  stored: EmailHtmlStyle | null | undefined,
): EmailHtmlStyle {
  return classifyEmailHtml(emailHtmlSignals(html)) ?? stored ?? "designed";
}
