import { afterEach, expect, test, vi } from "vitest";
import {
  discoverMcpTools,
  mcpHttpsUrl,
  mcpOAuthFetch,
  withMcpClient,
} from "./operatorMcpClient";
import { fetch as pinnedFetch } from "undici";

vi.mock("undici", () => ({
  Agent: class {
    async destroy() {}
  },
  fetch: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

for (const url of [
  "http://example.com/mcp",
  "https://user:secret@example.com/mcp",
  "https://example.com/mcp?token=secret",
  "https://example.com/mcp#fragment",
]) {
  test(`rejects unsafe endpoint ${url}`, () =>
    expect(() => mcpHttpsUrl(url)).toThrow());
}

test("blocks private destinations before sending credentials", async () => {
  await expect(
    withMcpClient("https://127.0.0.1/mcp", "secret", discoverMcpTools),
  ).rejects.toThrow("Private network");
  expect(pinnedFetch).not.toHaveBeenCalled();
});

test("negotiates MCP, reads all catalog pages, and sends a remote call once", async () => {
  const methods: string[] = [];
  vi.mocked(pinnedFetch).mockImplementation(async (_url, init) => {
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers as HeadersInit).get("authorization")).toBe(
      "Bearer secret",
    );
    if (init?.method === "DELETE")
      return new Response(null, { status: 204 }) as never;
    if (init?.method === "GET")
      return new Response(null, { status: 405 }) as never;
    const request = JSON.parse(String(init?.body));
    methods.push(request.method);
    if (request.id === undefined)
      return new Response(null, { status: 202 }) as never;
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "Fixture", version: "1" },
          }
        : request.method === "tools/list"
          ? {
              tools: [
                {
                  name: request.params?.cursor ? "second" : "first",
                  inputSchema: { type: "object" },
                },
              ],
              ...(request.params?.cursor ? {} : { nextCursor: "page2" }),
            }
          : { content: [{ type: "text", text: "done" }] };
    if (request.method === "tools/call")
      return new Response(
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ) as never;
    return Response.json(
      { jsonrpc: "2.0", id: request.id, result },
      { headers: { "mcp-session-id": "fixture-session" } },
    ) as never;
  });
  await withMcpClient("https://8.8.8.8/mcp", "secret", async (client) => {
    expect((await discoverMcpTools(client)).map((tool) => tool.name)).toEqual([
      "first",
      "second",
    ]);
    expect(
      await client.callTool({ name: "first", arguments: { value: null } }),
    ).toMatchObject({ content: [{ text: "done" }] });
  });
  expect(methods.filter((method) => method === "tools/call")).toHaveLength(1);
});

test("does not replay a remote call after a lost response", async () => {
  let calls = 0;
  vi.mocked(pinnedFetch).mockImplementation(async (_url, init) => {
    if (init?.method === "DELETE")
      return new Response(null, { status: 204 }) as never;
    if (init?.method === "GET")
      return new Response(null, { status: 405 }) as never;
    const request = JSON.parse(String(init?.body));
    if (request.id === undefined)
      return new Response(null, { status: 202 }) as never;
    if (request.method === "tools/call") {
      calls++;
      throw new Error("connection lost");
    }
    return Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "Fixture", version: "1" },
      },
    }) as never;
  });
  await expect(
    withMcpClient("https://8.8.8.8/mcp", undefined, (client) =>
      client.callTool({ name: "send", arguments: {} }),
    ),
  ).rejects.toThrow("connection lost");
  expect(calls).toBe(1);
});

test("OAuth token transport rejects private endpoints before sending client credentials", async () => {
  await expect(
    mcpOAuthFetch("https://127.0.0.1/token", {
      method: "POST",
      body: "client_secret=private",
    }),
  ).rejects.toThrow("Private network");
  expect(pinnedFetch).not.toHaveBeenCalled();
});
