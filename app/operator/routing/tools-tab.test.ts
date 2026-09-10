import { describe, expect, test } from "vitest";
import { modelDefaultRetrievalConfigured } from "./tools-tab";

describe("router web retrieval availability", () => {
  test("does not treat dedicated retrieval credentials as native model retrieval", () => {
    expect(
      modelDefaultRetrievalConfigured(
        [
          { provider: "parallel", configured: true },
          { provider: "exa", configured: true },
          { provider: "openai", configured: false },
          { provider: "google", configured: false },
        ],
        "openai",
      ),
    ).toBe(false);
  });

  test("does not use a different configured native provider", () => {
    expect(
      modelDefaultRetrievalConfigured(
        [
          { provider: "openai", configured: true },
          { provider: "anthropic", configured: false },
        ],
        "anthropic",
      ),
    ).toBe(false);
  });

  test("reports model-default retrieval for the configured selected provider", () => {
    expect(
      modelDefaultRetrievalConfigured(
        [
          { provider: "parallel", configured: false },
          { provider: "anthropic", configured: true },
        ],
        "anthropic",
      ),
    ).toBe(true);
  });
});
