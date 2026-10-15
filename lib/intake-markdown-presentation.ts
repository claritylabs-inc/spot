/** Rendering only. Source and its managed application markers remain intact. */
export function hideApplicationControlMarkers(markdown: string) {
  return markdown
    .replace(/^\s*<!-- spot-current-application:(?:start|end) -->\s*$/gm, "")
    .trim();
}
