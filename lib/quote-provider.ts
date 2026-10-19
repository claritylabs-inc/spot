import providers from "@/config/quote-providers.json";

/** Public brand metadata only. Provider branding never grants access or changes routing. */
export function getQuoteProvider(value: string | null | undefined) {
  if (!value || !Object.hasOwn(providers, value)) return null;
  return { slug: value, ...providers[value as keyof typeof providers] };
}

export function withQuoteProvider(path: string, value: string | null) {
  const provider = getQuoteProvider(value);
  if (!provider) return path;
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("provider", provider.slug);
  return `${pathname}?${params.toString()}`;
}
