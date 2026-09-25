import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    exclude: [
      ...configDefaults.exclude,
      ".claude/**",
      ".context/**",
      "slack-worker/**",
    ],
  },
});
