"use client";

import { useEffect, useRef, type FormEvent } from "react";
import {
  getWebMcpTool,
  type WebMcpJsonSchema,
  type WebMcpToolName,
} from "@/lib/webmcp/catalog";

declare module "react" {
  interface FormHTMLAttributes<T> extends HTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
    toolautosubmit?: string;
  }
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    toolparamdescription?: string;
  }
}

export type WebMcpResult = Record<string, unknown>;

type ModelContextTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: WebMcpJsonSchema;
  annotations: {
    readOnlyHint: boolean;
    consequentialHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: Record<string, unknown>) => Promise<string>;
};

type ModelContext = {
  registerTool: (
    tool: ModelContextTool,
    options?: { signal?: AbortSignal },
  ) => unknown;
  unregisterTool?: (name: string) => unknown;
};

type AgentSubmitEvent = SubmitEvent & {
  agentInvoked?: boolean;
  respondWith?: (result: Promise<string>) => void;
};

export type WebMcpToolImplementation = {
  name: WebMcpToolName;
  execute: (input: Record<string, unknown>) => Promise<WebMcpResult>;
};

/** `document.modelContext` only exists in WebMCP-enabled Chrome. */
function getModelContext(): ModelContext | null {
  if (typeof document === "undefined") return null;
  const modelContext = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  return typeof modelContext?.registerTool === "function" ? modelContext : null;
}

function serializeResult(result: WebMcpResult): string {
  return JSON.stringify(result);
}

export function webMcpError(error: string, extra?: WebMcpResult): WebMcpResult {
  return { status: "error", error, ...extra };
}

function registerTools(
  implementations: readonly WebMcpToolImplementation[],
  resolve: (name: WebMcpToolName) => WebMcpToolImplementation | undefined,
): () => void {
  const modelContext = getModelContext();
  if (!modelContext) return () => {};
  const controller = new AbortController();
  const registered: string[] = [];
  for (const { name } of implementations) {
    const definition = getWebMcpTool(name);
    if (definition.surface !== "imperative") continue;
    try {
      const pending = modelContext.registerTool(
        {
          name,
          title: definition.title,
          description: definition.description,
          inputSchema: definition.inputSchema,
          annotations: {
            readOnlyHint: definition.readOnly,
            ...(definition.consequential ? { consequentialHint: true } : {}),
            ...(definition.untrustedContent
              ? { untrustedContentHint: true }
              : {}),
          },
          execute: async (input) => {
            const implementation = resolve(name);
            if (!implementation) {
              return serializeResult(webMcpError("This tool is no longer available on this page."));
            }
            try {
              return serializeResult(await implementation.execute(input ?? {}));
            } catch (error) {
              return serializeResult(
                webMcpError(error instanceof Error ? error.message : String(error)),
              );
            }
          },
        },
        { signal: controller.signal },
      );
      registered.push(name);
      if (pending instanceof Promise) pending.catch(() => {});
    } catch (error) {
      console.warn(`[webmcp] Failed to register ${name}`, error);
    }
  }
  return () => {
    controller.abort();
    for (const name of registered) {
      try {
        const pending = modelContext.unregisterTool?.(name);
        if (pending instanceof Promise) pending.catch(() => {});
      } catch {
        // Already removed by the abort signal.
      }
    }
  };
}

/**
 * Registers catalog-defined imperative tools while `enabled` and unregisters
 * them on unmount, sign-out, or when the set of tool names changes. Execute
 * calls always reach the latest render's implementation.
 */
export function useWebMcpTools(
  implementations: readonly WebMcpToolImplementation[],
  enabled: boolean,
) {
  const latest = useRef(implementations);
  useEffect(() => {
    latest.current = implementations;
  });
  const key = enabled ? implementations.map((tool) => tool.name).join("|") : "";
  useEffect(() => {
    if (!key) return;
    return registerTools(latest.current, (name) =>
      latest.current.find((tool) => tool.name === name),
    );
  }, [key]);
}

/** Declarative form attributes for a catalog tool. */
export function webMcpFormAttributes(name: WebMcpToolName) {
  const definition = getWebMcpTool(name);
  return {
    toolname: name,
    tooldescription: definition.description,
    toolautosubmit: "",
  };
}

/** Declarative parameter attributes for one named field of a catalog tool. */
export function webMcpParamAttributes(name: WebMcpToolName, param: string) {
  const definition = getWebMcpTool(name);
  return {
    name: param,
    toolparamdescription: definition.params?.[param],
  };
}

/** Returns the native agent submit event when an agent submitted the form. */
export function agentSubmitEvent(
  event: FormEvent<HTMLFormElement>,
): AgentSubmitEvent | null {
  const native = event.nativeEvent as AgentSubmitEvent;
  return native.agentInvoked ? native : null;
}

/**
 * Returns the structured tool result to the agent. `respondWith` must be
 * called synchronously inside the submit handler, after `preventDefault()`.
 */
export function respondToAgent(
  event: AgentSubmitEvent | null,
  result: Promise<WebMcpResult>,
) {
  if (!event?.respondWith) return;
  event.respondWith(
    result
      .catch((error: unknown) =>
        webMcpError(error instanceof Error ? error.message : String(error)),
      )
      .then(serializeResult),
  );
}

/**
 * Agents fill declarative form fields directly in the DOM. Copy the filled
 * values into React state when the browser activates the tool so controlled
 * inputs show, and keep, what the agent entered.
 */
export function useWebMcpToolActivated(
  name: WebMcpToolName,
  onActivated: () => void,
) {
  const latest = useRef(onActivated);
  useEffect(() => {
    latest.current = onActivated;
  });
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as Event & { toolName?: string }).toolName === name) {
        latest.current();
      }
    };
    window.addEventListener("toolactivated", listener);
    return () => window.removeEventListener("toolactivated", listener);
  }, [name]);
}
