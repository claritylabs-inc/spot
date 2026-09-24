export function isInternalAppHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}
