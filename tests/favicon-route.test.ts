import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/favicon/route";

afterEach(() => vi.unstubAllGlobals());

describe("website favicons", () => {
  it("discards Google's decodable fallback image on a missing favicon", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("generic globe", {
      status: 404,
      headers: { "Content-Type": "image/png" },
    })));
    const response = await GET(new Request("https://spot.test/api/favicon?domain=missing.example"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("serves a successful website favicon", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("website icon", {
      headers: { "Content-Type": "image/png" },
    })));
    const response = await GET(new Request("https://spot.test/api/favicon?domain=example.com"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("website icon");
  });
});
