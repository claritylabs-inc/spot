import { describe, it, expect } from "vitest";
import { parseScopesFromToken, assertScope } from "../../convex/lib/apiAuth";

describe("Auth middleware — scope enforcement", () => {
  it("invalid stored scopes cannot grant write access", () => {
    const scopes = parseScopesFromToken(["unsupported"]);
    expect(scopes).toEqual(["read"]);
    expect(() => assertScope(scopes, "write")).toThrow("insufficient_scope");
  });
});
