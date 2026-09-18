const NATIVE_WEB_RETRIEVAL_PROVIDERS = new Set([
  "openai",
  "google",
  "anthropic",
  "xai",
]);

export function modelDefaultRetrievalConfigured(
  providers: Array<{ provider: string; configured: boolean }>,
  selectedModelProvider: string | null,
) {
  if (
    !selectedModelProvider ||
    !NATIVE_WEB_RETRIEVAL_PROVIDERS.has(selectedModelProvider)
  ) {
    return false;
  }
  return (
    providers.find((item) => item.provider === selectedModelProvider)
      ?.configured ?? false
  );
}
