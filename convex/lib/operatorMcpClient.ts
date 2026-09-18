"use node";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Agent, fetch as pinnedFetch } from "undici";
import { resolvePublicAddress } from "./websiteBrand";

export function mcpHttpsUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new Error(
      "Use an HTTPS URL without credentials, query parameters, or a fragment.",
    );
  }
  return url.toString();
}

export async function withMcpClient<T>(
  url: string,
  token: string | undefined,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const endpoint = mcpHttpsUrl(url);
  const address = await resolvePublicAddress(new URL(endpoint).hostname);
  const dispatcher = new Agent({
    connect: {
      lookup: (_host, options, callback) =>
        callback(
          null,
          options.all ? [address] : address.address,
          options.all ? undefined : address.family,
        ),
    },
    connectTimeout: 10_000,
    headersTimeout: 30_000,
    bodyTimeout: 60_000,
    pipelining: 0,
  });
  const deadline = AbortSignal.timeout(90_000);
  const client = new Client(
    { name: "spot-operator", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
    fetch: async (input, init) => {
      if (String(input) !== endpoint) throw new Error("MCP endpoint changed");
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const response = await pinnedFetch(endpoint, {
        method: init?.method,
        headers,
        body: init?.body as string | undefined,
        signal: init?.signal
          ? AbortSignal.any([init.signal, deadline])
          : deadline,
        redirect: "error",
        dispatcher,
      });
      let bytes = 0;
      const reader = response.body?.getReader();
      const body = reader
        ? new ReadableStream<Uint8Array>({
            async pull(controller) {
              const chunk = await reader.read();
              if (chunk.done) {
                controller.close();
                return;
              }
              bytes += chunk.value.byteLength;
              if (bytes > 1_000_000) {
                await reader.cancel();
                controller.error(new Error("MCP response exceeds 1 MB"));
                return;
              }
              controller.enqueue(chunk.value);
            },
            async cancel(reason) {
              await reader.cancel(reason);
            },
          })
        : null;
      return new Response(body, {
        status: response.status,
        headers: new Headers([...response.headers]),
      });
    },
  });
  try {
    await client.connect(transport, { timeout: 30_000 });
    return await run(client);
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
    await dispatcher.destroy();
  }
}

export async function discoverMcpTools(client: Client) {
  const tools = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, {
      timeout: 30_000,
    });
    tools.push(...page.tools);
    if (
      tools.length > 250 ||
      Buffer.byteLength(JSON.stringify(tools), "utf8") > 250_000
    )
      throw new Error("MCP tool catalog is too large");
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor))
      throw new Error("MCP server repeated its catalog cursor");
    if (cursor) seen.add(cursor);
    if (seen.size > 25) throw new Error("MCP tool catalog has too many pages");
  } while (cursor);
  return tools;
}

/** OAuth metadata and token requests use public, pinned destinations without redirects. */
export async function mcpOAuthFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input));
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("OAuth requires public HTTPS endpoints");
  const address = await resolvePublicAddress(url.hostname);
  const dispatcher = new Agent({
    connect: {
      lookup: (_host, options, callback) =>
        callback(
          null,
          options.all ? [address] : address.address,
          options.all ? undefined : address.family,
        ),
    },
    connectTimeout: 10_000,
  });
  try {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const response = await pinnedFetch(url, {
      method: init?.method,
      headers,
      body: init?.body as string | URLSearchParams | undefined,
      dispatcher,
      redirect: "error",
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (response.body)
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 250_000) throw new Error("OAuth response is too large");
        chunks.push(chunk);
      }
    return new Response(
      response.status === 204 || response.status === 304
        ? null
        : Buffer.concat(chunks),
      { status: response.status, headers: new Headers([...response.headers]) },
    );
  } finally {
    await dispatcher.destroy();
  }
}
