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
 *   DEEPSEEK_API_KEY — DeepSeek V3 (primary for tool-calling Q&A)
 *   MOONSHOTAI_API_KEY — Kimi K2.5 (reasoning tasks)
 *   ANTHROPIC_API_KEY — Claude Haiku (classification), Claude Sonnet (fallback)
 *   OPENAI_API_KEY — GPT models (optional)
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
 *   - DeepSeek V3: Q&A with tool use (~$0.001/call vs $0.014 for Claude Sonnet = 14x cheaper)
 *   - Kimi K2.5: reasoning tasks (analysis, email writing)
 *   - Claude Haiku: fast classification
 *
 * Cost tiers (approximate $/1M tokens, input/output):
 *   DeepSeek V3:       $0.27 / $1.10   (cheapest with good tool calling)
 *   Kimi K2.5:         ~$0.60 / $2     (excellent value, 256K context)
 *   Claude Haiku:      $0.80 / $4      (fast, cheap)
 *   Gemini Flash:      $0.075 / $0.30  (cheapest overall)
 *   Claude Sonnet:     $3 / $15        (premium fallback)
 */
const MODEL_CONFIG: Record<ModelTask, () => any> = {
  // DeepSeek V3 — agentic Q&A with tool use (good tool calling, 14x cheaper than Sonnet)
  qa:                   () => deepseek()("deepseek-chat"),

  // Kimi K2.5 — reasoning tasks at low cost
  health_check:         () => moonshot()("kimi-k2.5"),
  portfolio_analysis:   () => moonshot()("kimi-k2.5"),
  renewal_comparison:   () => moonshot()("kimi-k2.5"),
  email_generate:       () => moonshot()("kimi-k2.5"),
  email_reply:          () => moonshot()("kimi-k2.5"),
  qa_simple:            () => moonshot()("kimi-k2.5"),

  // Claude Haiku — fast classification
  image_classify:       () => anthropic()("claude-haiku-4-5-20251001"),
  extraction_classify:  () => anthropic()("claude-haiku-4-5-20251001"),
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
