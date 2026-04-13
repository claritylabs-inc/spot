"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createDeepSeek } from "@ai-sdk/deepseek";

/**
 * Centralized model configuration for Spot.
 *
 * Maps each task type to a provider + model. Tune costs and quality from one place.
 * All models are accessed via Vercel AI SDK's provider-agnostic interface —
 * generateText/tool calls work identically regardless of provider.
 *
 * Env vars needed:
 *   OPENAI_API_KEY — GPT-5.4 Mini (primary for Q&A, extraction, reasoning)
 *   ANTHROPIC_API_KEY — Claude Haiku (classification), Claude Sonnet (fallback)
 *   MOONSHOTAI_API_KEY — Kimi K2.5 (optional, legacy)
 *   DEEPSEEK_API_KEY — DeepSeek V3 (optional, legacy)
 *   GOOGLE_GENERATIVE_AI_API_KEY — Gemini models (optional)
 */

// Provider factories (lazy — only created when first used)
let _anthropic: ReturnType<typeof createAnthropic> | null = null;
let _openai: ReturnType<typeof createOpenAI> | null = null;
let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let _moonshot: ReturnType<typeof createMoonshotAI> | null = null;
let _deepseek: ReturnType<typeof createDeepSeek> | null = null;

function anthropic() {
  if (!_anthropic) _anthropic = createAnthropic();
  return _anthropic;
}

function openai() {
  if (!_openai) _openai = createOpenAI();
  return _openai;
}

function google() {
  if (!_google) _google = createGoogleGenerativeAI();
  return _google;
}

function moonshot() {
  if (!_moonshot) _moonshot = createMoonshotAI();
  return _moonshot;
}

function deepseek() {
  if (!_deepseek) _deepseek = createDeepSeek();
  return _deepseek;
}

/**
 * Task types used throughout the codebase.
 * Each maps to a specific model optimized for cost/quality tradeoff.
 */
export type ModelTask =
  | "qa"                  // Agentic Q&A with tool use (handleQuestion)
  | "qa_simple"           // Simple Q&A without tools
  | "image_classify"      // Image intent classification (document vs question)
  | "email_generate"      // AI-written email body
  | "email_reply"         // Inbound email reply handling
  | "health_check"        // Post-upload policy analysis
  | "portfolio_analysis"  // Multi-policy portfolio analysis
  | "renewal_comparison"  // Old vs new policy comparison
  | "extraction_classify" // Document type classification (policy vs quote)
  ;

/**
 * Model configuration — change these to swap providers/models per task.
 *
 * Current strategy:
 *   - GPT-5.4 Mini: primary model for Q&A, reasoning, email, analysis
 *   - GPT-5.4 Nano: fast classification (image intent, document type)
 *   - Claude Sonnet: fallback when OpenAI is down
 */
const MODEL_CONFIG: Record<ModelTask, () => any> = {
  // GPT-5.4 Mini — primary for all reasoning and tool-calling tasks
  qa:                   () => openai()("gpt-5.4-mini"),
  qa_simple:            () => openai()("gpt-5.4-mini"),
  health_check:         () => openai()("gpt-5.4-mini"),
  portfolio_analysis:   () => openai()("gpt-5.4-mini"),
  renewal_comparison:   () => openai()("gpt-5.4-mini"),
  email_generate:       () => openai()("gpt-5.4-mini"),
  email_reply:          () => openai()("gpt-5.4-mini"),

  // GPT-5.4 Nano — fast classification
  image_classify:       () => openai()("gpt-5.4-nano"),
  extraction_classify:  () => openai()("gpt-5.4-nano"),
};

/**
 * Get the model for a given task.
 * Falls back to Claude Sonnet if the preferred provider isn't configured.
 */
export function getModel(task: ModelTask) {
  const factory = MODEL_CONFIG[task];
  if (!factory) {
    console.warn(`Unknown model task "${task}", falling back to qa`);
    return MODEL_CONFIG.qa();
  }
  try {
    return factory();
  } catch (err) {
    console.warn(`Provider for task "${task}" not available, falling back to Claude Sonnet`);
    return anthropic()("claude-sonnet-4-6");
  }
}

/**
 * The fallback model — Claude Sonnet. Used when primary provider fails at runtime.
 */
function fallbackModel() {
  return anthropic()("claude-sonnet-4-6");
}

/**
 * generateText with automatic fallback.
 *
 * Tries the primary model first. If it fails (provider outage, rate limit,
 * timeout, bad response), retries once with Claude Sonnet.
 *
 * Usage — drop-in replacement for AI SDK's generateText:
 *   import { generateTextWithFallback } from "./models";
 *   const result = await generateTextWithFallback({ model: getModel("qa"), ... });
 */
export async function generateTextWithFallback(
  options: Parameters<typeof import("ai").generateText>[0]
): Promise<Awaited<ReturnType<typeof import("ai").generateText>>> {
  const { generateText } = await import("ai");
  try {
    return await generateText(options);
  } catch (err: any) {
    const modelId = (options.model as any)?.modelId || "unknown";
    const isFallbackAlready = modelId.includes("claude-sonnet");
    if (isFallbackAlready) {
      // Already on fallback — don't retry, just throw
      throw err;
    }
    console.warn(
      `Primary model (${modelId}) failed: ${err.message || err}. Retrying with Claude Sonnet fallback.`
    );
    return await generateText({
      ...options,
      model: fallbackModel(),
    });
  }
}

/**
 * generateObject with automatic fallback. Same pattern as generateTextWithFallback.
 */
export async function generateObjectWithFallback(
  options: any
): Promise<any> {
  const { generateObject } = await import("ai");
  try {
    return await generateObject(options);
  } catch (err: any) {
    const modelId = (options.model as any)?.modelId || "unknown";
    const isFallbackAlready = modelId.includes("claude-sonnet");
    if (isFallbackAlready) throw err;
    console.warn(
      `Primary model (${modelId}) failed for generateObject: ${err.message || err}. Retrying with Claude Sonnet.`
    );
    return await generateObject({
      ...options,
      model: fallbackModel(),
    });
  }
}

/**
 * Check which providers are available based on env vars.
 */
export function availableProviders(): string[] {
  const providers: string[] = [];
  if (process.env.DEEPSEEK_API_KEY) providers.push("deepseek");
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (process.env.MOONSHOTAI_API_KEY) providers.push("moonshot");
  if (process.env.OPENAI_API_KEY) providers.push("openai");
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) providers.push("google");
  return providers;
}
