"use node";
/**
 * SDK Adapter — bridges Vercel AI SDK to CL SDK v0.10.0's callback-based API.
 *
 * Provides: cached pipeline instances, Convex storage implementations,
 * InsuranceDocument helpers, contact extraction, and document context builder.
 */

import { createOpenAI } from "@ai-sdk/openai";
import {
  createExtractor,
  createQueryAgent,
  createApplicationPipeline,
  sanitizeNulls,
  type GenerateText,
  type GenerateObject,
  type EmbedText,
  type InsuranceDocument,
  type DocumentChunk,
  type DocumentStore,
  type MemoryStore,
  type ConversationTurn,
  type ChunkFilter,
  type DocumentFilters,
} from "@claritylabs/cl-sdk";
import { internal } from "./_generated/api";

// ── Provider Callback Adapters ──

type ExtractionImage = { imageBase64: string; mimeType: string };
type ExtractionProviderOptions = Record<string, unknown> & {
  pdfBase64?: string;
  images?: ExtractionImage[];
};

const SECTIONS_EXTRACTOR_PROMPT_MARKER =
  "Extract ALL sections, clauses, endorsements, and schedules from this document";

/**
 * Build the prompt input, attaching the PDF or images as multimodal content
 * when the SDK passes them via providerOptions.
 */
function buildPromptInput(
  prompt: string,
  providerOptions?: Record<string, unknown>,
) {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  const pdfBase64 = options?.pdfBase64;
  const images = options?.images;

  if (images?.length) {
    return {
      messages: [
        {
          role: "user" as const,
          content: [
            ...images.map((img: ExtractionImage) => ({
              type: "image" as const,
              image: img.imageBase64,
              mediaType: img.mimeType,
            })),
            { type: "text" as const, text: prompt },
          ],
        },
      ],
    };
  }

  if (!pdfBase64) {
    return { prompt };
  }

  return {
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: prompt },
          {
            type: "file" as const,
            data: pdfBase64,
            mediaType: "application/pdf",
            filename: "document.pdf",
          },
        ],
      },
    ],
  };
}

function mapUsage(usage?: any) {
  return usage
    ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 }
    : undefined;
}

/** Wrap a Vercel AI SDK LanguageModel into CL SDK's GenerateText callback. */
export function makeGenerateText(model: any): GenerateText {
  return async ({ prompt, system, maxTokens, providerOptions }) => {
    const { generateText } = await import("ai");
    const result = await generateText({
      model,
      system,
      ...buildPromptInput(prompt, providerOptions),
      maxOutputTokens: maxTokens,
      providerOptions: providerOptions as any,
    });
    return {
      text: result.text,
      usage: mapUsage(result.usage),
    };
  };
}

/** Wrap a Vercel AI SDK LanguageModel into CL SDK's GenerateObject callback. */
export function makeGenerateObject(model: any): GenerateObject {
  return async ({ prompt, system, schema, maxTokens, providerOptions }) => {
    const { generateText, Output } = await import("ai");
    try {
      const result = await generateText({
        model,
        system,
        ...buildPromptInput(prompt, providerOptions),
        output: Output.object({ schema }),
        maxOutputTokens: maxTokens,
        providerOptions: providerOptions as any,
      });
      return {
        object: result.output!,
        usage: mapUsage(result.usage),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Sections extractor can return empty on short documents — gracefully handle
      if (prompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER) && message.includes("No output generated")) {
        return { object: { sections: [] } as unknown, usage: undefined };
      }
      throw error;
    }
  };
}

// ── OpenAI Embedding Callback ──

/** Creates an EmbedText callback using OpenAI text-embedding-3-small. */
export function makeEmbedText(): EmbedText {
  return async (text: string): Promise<number[]> => {
    const { embed } = await import("ai");
    const openai = createOpenAI();
    const result = await embed({
      model: openai.textEmbeddingModel("text-embedding-3-small"),
      value: text,
    });
    return result.embedding;
  };
}

// ── Cached Extractor ──

let _extractor: ReturnType<typeof createExtractor> | null = null;

export function getExtractor() {
  if (!_extractor) {
    const oai = createOpenAI();
    const model = oai("gpt-5.4-mini");
    _extractor = createExtractor({
      generateText: makeGenerateText(model),
      generateObject: makeGenerateObject(model),
      concurrency: 3,
      maxReviewRounds: 2,
      onProgress: (msg) => console.log(`[extraction] ${msg}`),
    });
  }
  return _extractor;
}

// ── Convex DocumentStore (wraps policies table) ──

export function createConvexDocumentStore(
  ctx: any,
  userId: any
): DocumentStore {
  return {
    async save(doc: InsuranceDocument): Promise<void> {
      const policies = await ctx.runQuery(internal.policies.getByUser, { userId });
      const existing = policies.find((p: any) => {
        const raw = p.rawExtracted as any;
        return raw?.id === (doc as any).id;
      });
      if (existing) {
        const fields = documentToUpdateFields(doc);
        await ctx.runMutation(internal.policies.updateExtracted, {
          policyId: existing._id,
          ...fields,
          status: "ready" as const,
        });
      }
    },

    async get(id: string): Promise<InsuranceDocument | null> {
      const policies = await ctx.runQuery(internal.policies.getByUser, { userId });
      for (const p of policies) {
        const raw = p.rawExtracted as any;
        if (!raw) continue;
        if (raw.id === id || p._id === id) return raw as InsuranceDocument;
      }
      return null;
    },

    async query(filters: DocumentFilters): Promise<InsuranceDocument[]> {
      const policies = await ctx.runQuery(internal.policies.getByUser, { userId });
      const results: InsuranceDocument[] = [];
      for (const p of policies) {
        if (p.status !== "ready") continue;
        const raw = p.rawExtracted as any;
        if (!raw) continue;
        if (filters.type && raw.type !== filters.type) continue;
        if (filters.carrier && !raw.carrier?.toLowerCase().includes(filters.carrier.toLowerCase())) continue;
        if (filters.insuredName && !raw.insuredName?.toLowerCase().includes(filters.insuredName.toLowerCase())) continue;
        if (filters.policyNumber && raw.type === "policy") {
          if (raw.policyNumber !== filters.policyNumber) continue;
        }
        if (filters.quoteNumber && raw.type === "quote") {
          if (raw.quoteNumber !== filters.quoteNumber) continue;
        }
        results.push(raw as InsuranceDocument);
      }
      return results;
    },

    async delete(id: string): Promise<void> {
      const policies = await ctx.runQuery(internal.policies.getByUser, { userId });
      const match = policies.find((p: any) => p._id === id || (p.rawExtracted as any)?.id === id);
      if (match) {
        await ctx.runMutation(internal.policies.remove, { policyId: match._id });
      }
    },
  };
}

// ── Convex MemoryStore (vector search over chunks + conversation history) ──

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

export function createConvexMemoryStore(
  ctx: any,
  userId: any,
  embedFn: EmbedText
): MemoryStore {
  return {
    async addChunks(chunks: DocumentChunk[]): Promise<void> {
      for (const chunk of chunks) {
        let embedding: number[] | undefined;
        try {
          embedding = await embedFn(chunk.text);
        } catch (e) {
          console.warn(`Embedding failed for chunk ${chunk.id}:`, e);
        }
        await ctx.runMutation(internal.documentChunks.saveChunkWithEmbedding, {
          userId,
          chunkId: chunk.id,
          documentId: chunk.documentId,
          type: chunk.type,
          text: chunk.text,
          metadata: sanitizeNulls(chunk.metadata),
          embedding,
        });
      }
    },

    async search(
      query: string,
      options?: { limit?: number; filter?: ChunkFilter }
    ): Promise<DocumentChunk[]> {
      const limit = options?.limit ?? 10;

      // Get query embedding
      let queryEmbedding: number[];
      try {
        queryEmbedding = await embedFn(query);
      } catch (e) {
        console.warn("Query embedding failed, falling back to text search:", e);
        // Fallback to text search
        const results = await ctx.runQuery(internal.documentChunks.searchByText, {
          userId,
          query,
          type: options?.filter?.type,
        });
        return results.slice(0, limit).map((r: any) => ({
          id: r.chunkId,
          documentId: r.documentId,
          type: r.type,
          text: r.text,
          metadata: r.metadata || {},
        }));
      }

      // Load all user chunks and compute cosine similarity
      let allChunks: any[];
      if (options?.filter?.type) {
        allChunks = await ctx.runQuery(internal.documentChunks.getByUserAndType, {
          userId,
          type: options.filter.type,
        });
      } else {
        allChunks = await ctx.runQuery(internal.documentChunks.getByUser, {
          userId,
        });
      }

      // Apply additional filters
      if (options?.filter?.documentId) {
        allChunks = allChunks.filter((c: any) => c.documentId === options.filter!.documentId);
      }

      // Score and rank by cosine similarity
      const scored = allChunks
        .filter((c: any) => c.embedding && c.embedding.length > 0)
        .map((c: any) => ({
          chunk: c,
          score: cosineSimilarity(queryEmbedding, c.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // If not enough embedded chunks, supplement with text matches
      if (scored.length < limit) {
        const embeddedIds = new Set(scored.map((s) => s.chunk.chunkId));
        const textMatches = allChunks
          .filter((c: any) => !embeddedIds.has(c.chunkId))
          .filter((c: any) => c.text.toLowerCase().includes(query.toLowerCase().slice(0, 50)))
          .slice(0, limit - scored.length);

        for (const c of textMatches) {
          scored.push({ chunk: c, score: 0.3 });
        }
      }

      return scored.map((s) => ({
        id: s.chunk.chunkId,
        documentId: s.chunk.documentId,
        type: s.chunk.type,
        text: s.chunk.text,
        metadata: s.chunk.metadata || {},
      }));
    },

    async addTurn(turn: ConversationTurn): Promise<void> {
      let embedding: number[] | undefined;
      try {
        embedding = await embedFn(turn.content);
      } catch (e) {
        console.warn("Turn embedding failed:", e);
      }
      await ctx.runMutation(internal.conversationTurns.add, {
        userId,
        turnId: turn.id,
        conversationId: turn.conversationId,
        role: turn.role,
        content: turn.content,
        toolName: turn.toolName,
        toolResult: turn.toolResult,
        embedding,
        timestamp: turn.timestamp,
      });
    },

    async getHistory(
      conversationId: string,
      options?: { limit?: number }
    ): Promise<ConversationTurn[]> {
      const turns = await ctx.runQuery(internal.conversationTurns.getHistory, {
        conversationId,
        limit: options?.limit,
      });
      return turns.map((t: any) => ({
        id: t._id,
        conversationId: t.conversationId,
        role: t.role as "user" | "assistant" | "tool",
        content: t.content,
        toolName: t.toolName,
        toolResult: t.toolResult,
        timestamp: t.timestamp,
      }));
    },

    async searchHistory(
      query: string,
      conversationId?: string
    ): Promise<ConversationTurn[]> {
      // Get recent turns for the user and score by embedding similarity
      const turns = conversationId
        ? await ctx.runQuery(internal.conversationTurns.getHistory, {
            conversationId,
            limit: 50,
          })
        : await ctx.runQuery(internal.conversationTurns.getByUser, {
            userId,
            limit: 50,
          });

      let queryEmbedding: number[] | undefined;
      try {
        queryEmbedding = await embedFn(query);
      } catch (_) {}

      if (queryEmbedding) {
        const scored = turns
          .filter((t: any) => t.embedding && t.embedding.length > 0)
          .map((t: any) => ({
            turn: t,
            score: cosineSimilarity(queryEmbedding!, t.embedding),
          }))
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, 10);

        return scored.map((s: any) => ({
          id: s.turn._id,
          conversationId: s.turn.conversationId,
          role: s.turn.role,
          content: s.turn.content,
          toolName: s.turn.toolName,
          toolResult: s.turn.toolResult,
          timestamp: s.turn.timestamp,
        }));
      }

      // Fallback: text match
      const queryLower = query.toLowerCase();
      return turns
        .filter((t: any) => t.content.toLowerCase().includes(queryLower))
        .slice(0, 10)
        .map((t: any) => ({
          id: t._id,
          conversationId: t.conversationId,
          role: t.role,
          content: t.content,
          toolName: t.toolName,
          toolResult: t.toolResult,
          timestamp: t.timestamp,
        }));
    },
  };
}

// ── Query Agent Factory ──

/**
 * Create a query agent instance with Convex-backed stores.
 * Call this inside a Convex action handler.
 */
export function getQueryAgent(ctx: any, userId: any) {
  const oai = createOpenAI();
  const model = oai("gpt-5.4-mini");
  const embedFn = makeEmbedText();

  return createQueryAgent({
    generateText: makeGenerateText(model),
    generateObject: makeGenerateObject(model),
    documentStore: createConvexDocumentStore(ctx, userId),
    memoryStore: createConvexMemoryStore(ctx, userId, embedFn),
    concurrency: 3,
    maxVerifyRounds: 1,
    retrievalLimit: 10,
    onProgress: (msg) => console.log(`[query-agent] ${msg}`),
  });
}

// ── Application Pipeline Factory ──

/**
 * Create an application pipeline instance with Convex-backed stores.
 * Call this inside a Convex action handler.
 */
export function getAppPipeline(ctx: any, userId: any, pdfBase64?: string) {
  const oai = createOpenAI();
  const model = oai("gpt-5.4-mini");
  const embedFn = makeEmbedText();

  return createApplicationPipeline({
    generateText: makeGenerateText(model),
    generateObject: makeGenerateObject(model),
    documentStore: createConvexDocumentStore(ctx, userId),
    memoryStore: createConvexMemoryStore(ctx, userId, embedFn),
    concurrency: 4,
    onProgress: (msg) => console.log(`[application] ${msg}`),
    ...(pdfBase64 ? { providerOptions: { pdfBase64 } } : {}),
  });
}

// ── Document → Policy Fields Mapper ──

/** Maps SDK policyTypes array to a user-friendly category string. */
function detectCategoryFromPolicyTypes(policyTypes: string[]): string {
  if (!policyTypes || policyTypes.length === 0) return "other";
  const t = policyTypes[0];
  if (t === "personal_auto") return "auto";
  if (t === "renters_ho4") return "renters";
  if (
    [
      "homeowners_ho3",
      "homeowners_ho5",
      "condo_ho6",
      "dwelling_fire",
      "mobile_home",
    ].includes(t)
  )
    return "homeowners";
  if (t === "flood_nfip" || t === "flood_private") return "flood";
  if (t === "earthquake") return "earthquake";
  if (t === "personal_umbrella") return "umbrella";
  if (t === "pet") return "pet";
  if (t === "travel") return "travel";
  if (t === "watercraft" || t === "recreational_vehicle") return "recreational";
  if (t === "farm_ranch") return "farm";
  if (
    t.startsWith("commercial_") ||
    t.startsWith("bop") ||
    t.startsWith("workers_comp") ||
    t.startsWith("professional_liability")
  )
    return "commercial";
  return "other";
}

/** Fallback keyword-based category detection. */
function detectCategoryKeyword(doc: InsuranceDocument): string {
  const text = JSON.stringify(doc).toLowerCase();
  const autoKeywords = [
    "auto", "automobile", "vehicle", "car", "collision", "comprehensive",
    "bodily injury", "uninsured motorist", "underinsured", "motor", "driver", "vin",
  ];
  const tenantKeywords = [
    "tenant", "renter", "renters", "personal property",
    "habitational", "apartment", "lease", "landlord", "contents",
  ];
  const homeKeywords = [
    "homeowners", "homeowner", "ho-3", "ho-5", "ho3", "ho5", "dwelling",
    "condo", "ho-6", "ho6",
  ];
  const autoScore = autoKeywords.filter((k) => text.includes(k)).length;
  const tenantScore = tenantKeywords.filter((k) => text.includes(k)).length;
  const homeScore = homeKeywords.filter((k) => text.includes(k)).length;
  if (homeScore > autoScore && homeScore > tenantScore && homeScore >= 2) return "homeowners";
  if (autoScore > tenantScore && autoScore > homeScore && autoScore >= 2) return "auto";
  if (tenantScore > autoScore && tenantScore > homeScore && tenantScore >= 2) return "renters";
  return "other";
}

/** Detect category from an InsuranceDocument. */
export function detectCategory(doc: any): string {
  if (doc.policyTypes && doc.policyTypes.length > 0) {
    return detectCategoryFromPolicyTypes(doc.policyTypes);
  }
  return detectCategoryKeyword(doc);
}

/**
 * Map an InsuranceDocument to the flat fields expected by policies.updateExtracted.
 * This bridges the rich SDK type to the existing Convex mutation shape.
 */
export function documentToUpdateFields(doc: any, extractionResult?: any) {
  const isPolicy = doc.type === "policy";
  return {
    carrier: doc.carrier || undefined,
    policyNumber: isPolicy ? (doc as any).policyNumber || undefined : undefined,
    effectiveDate: isPolicy ? (doc as any).effectiveDate || undefined : undefined,
    expirationDate: isPolicy ? (doc as any).expirationDate || undefined : undefined,
    premium: doc.premium || undefined,
    insuredName: doc.insuredName || undefined,
    coverages: doc.coverages || undefined,
    policyTypes: doc.policyTypes || undefined,
    rawExtracted: sanitizeNulls(doc),
    category: detectCategory(doc),
    ...(extractionResult?.reviewReport
      ? { extractionReport: sanitizeNulls(extractionResult.reviewReport) }
      : {}),
    ...(extractionResult?.tokenUsage
      ? {
          extractionUsage: sanitizeNulls({
            tokenUsage: extractionResult.tokenUsage,
            usageReporting: extractionResult.usageReporting,
          }),
        }
      : {}),
  };
}

// ── Contact Extraction from Document Parties ──

interface ExtractedContact {
  name: string;
  email: string;
  label?: string;
}

/**
 * Extract contacts from an InsuranceDocument's party fields.
 * Pulls from: additionalInsureds, lossPayees, mortgageHolders,
 * claimsContacts, producer, insurer.
 */
export function extractContactsFromDocument(
  doc: any
): ExtractedContact[] {
  const contacts: ExtractedContact[] = [];

  // Helper to extract from EndorsementParty arrays
  function addParties(
    parties: any[] | undefined,
    defaultLabel: string
  ) {
    if (!parties) return;
    for (const party of parties) {
      if (party.contact?.email) {
        contacts.push({
          name: party.name || party.contact?.name || "Unknown",
          email: party.contact.email,
          label: party.role || defaultLabel,
        });
      } else if (party.name && party.address) {
        // No email, skip — we need email for contacts
      }
    }
  }

  // Helper to extract from Contact objects
  function addContacts(
    contactList: any[] | undefined,
    defaultLabel: string
  ) {
    if (!contactList) return;
    for (const c of contactList) {
      if (c.email) {
        contacts.push({
          name: c.name || "Unknown",
          email: c.email,
          label: c.type || defaultLabel,
        });
      }
    }
  }

  addParties(doc.additionalInsureds, "additional_insured");
  addParties(doc.lossPayees, "loss_payee");
  addParties(doc.mortgageHolders, "mortgage_holder");
  addContacts(doc.claimsContacts, "claims");
  addContacts(doc.regulatoryContacts, "regulatory");
  addContacts(doc.thirdPartyAdministrators, "tpa");

  // Producer (agent/broker)
  if (doc.producer && (doc.producer as any).email) {
    const p = doc.producer as any;
    contacts.push({
      name: p.name || p.agencyName || "Agent",
      email: p.email,
      label: "agent",
    });
  }

  // Insurer
  if (doc.insurer && (doc.insurer as any).email) {
    const ins = doc.insurer as any;
    contacts.push({
      name: ins.name || doc.carrier || "Carrier",
      email: ins.email,
      label: "carrier",
    });
  }

  return contacts;
}

// ── Document Context Builder (replaces removed buildDocumentContext) ──

/**
 * Build a text context string from InsuranceDocument objects for the LLM system prompt.
 * Replaces the removed buildDocumentContext() from CL SDK v0.2.
 */
export function buildDocumentContextFromDocs(
  documents: any[]
): string {
  if (documents.length === 0) return "No documents on file.";

  const sections: string[] = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const parts: string[] = [];
    const docLabel =
      doc.type === "quote" ? `Quote ${i + 1}` : `Policy ${i + 1}`;

    parts.push(`--- ${docLabel} ---`);
    parts.push(`Type: ${doc.type}`);
    if (doc.carrier) parts.push(`Carrier: ${doc.carrier}`);
    if (doc.insuredName) parts.push(`Insured: ${doc.insuredName}`);

    if (doc.type === "policy") {
      const p = doc as any;
      if (p.policyNumber) parts.push(`Policy #: ${p.policyNumber}`);
      if (p.effectiveDate) parts.push(`Effective: ${p.effectiveDate}`);
      if (p.expirationDate) parts.push(`Expires: ${p.expirationDate}`);
    } else {
      const q = doc as any;
      if (q.quoteNumber) parts.push(`Quote #: ${q.quoteNumber}`);
      if (q.proposedEffectiveDate)
        parts.push(`Proposed Effective: ${q.proposedEffectiveDate}`);
    }

    if (doc.premium) parts.push(`Premium: ${doc.premium}`);
    if (doc.policyTypes?.length)
      parts.push(`Lines: ${doc.policyTypes.join(", ")}`);

    // Coverages
    if (doc.coverages && doc.coverages.length > 0) {
      parts.push(`\nCoverages:`);
      for (const cov of doc.coverages) {
        let line = `  - ${cov.name}`;
        if (cov.limit) line += ` | Limit: ${cov.limit}`;
        if (cov.limitType) line += ` (${cov.limitType})`;
        if (cov.deductible) line += ` | Deductible: ${cov.deductible}`;
        parts.push(line);
      }
    }

    // Enriched coverages (more detail)
    if (doc.enrichedCoverages && doc.enrichedCoverages.length > 0) {
      parts.push(`\nDetailed Coverages:`);
      for (const ec of doc.enrichedCoverages) {
        let line = `  - ${ec.name}`;
        if (ec.limit) line += ` | Limit: ${ec.limit}`;
        if (ec.deductible) line += ` | Deductible: ${ec.deductible}`;
        if (ec.sublimit) line += ` | Sublimit: ${ec.sublimit}`;
        if (ec.formNumber) line += ` | Form: ${ec.formNumber}`;
        if (!ec.included) line += ` (EXCLUDED)`;
        parts.push(line);
      }
    }

    // Endorsements
    if (doc.endorsements && doc.endorsements.length > 0) {
      parts.push(`\nEndorsements:`);
      for (const end of doc.endorsements) {
        let line = `  - ${end.title}`;
        if (end.formNumber) line += ` (${end.formNumber})`;
        if (end.endorsementType) line += ` [${end.endorsementType}]`;
        parts.push(line);
        if (end.content) {
          const content =
            end.content.length > 200
              ? end.content.slice(0, 200) + "..."
              : end.content;
          parts.push(`    ${content}`);
        }
      }
    }

    // Exclusions
    if (doc.exclusions && doc.exclusions.length > 0) {
      parts.push(`\nExclusions:`);
      for (const exc of doc.exclusions) {
        parts.push(`  - ${exc.name}`);
        if (exc.content) {
          const content =
            exc.content.length > 200
              ? exc.content.slice(0, 200) + "..."
              : exc.content;
          parts.push(`    ${content}`);
        }
      }
    }

    // Conditions
    if (doc.conditions && doc.conditions.length > 0) {
      parts.push(`\nConditions:`);
      for (const cond of doc.conditions) {
        let line = `  - ${cond.name}`;
        if (cond.conditionType) line += ` [${cond.conditionType}]`;
        parts.push(line);
      }
    }

    // Declarations summary
    if (doc.declarations) {
      parts.push(`\nDeclarations: ${JSON.stringify(doc.declarations).slice(0, 500)}`);
    }

    // Locations
    if (doc.locations && doc.locations.length > 0) {
      parts.push(`\nInsured Locations: ${doc.locations.length}`);
    }

    // Vehicles
    if (doc.vehicles && doc.vehicles.length > 0) {
      parts.push(`\nInsured Vehicles: ${doc.vehicles.length}`);
      for (const v of doc.vehicles) {
        parts.push(`  - ${(v as any).year || ""} ${(v as any).make || ""} ${(v as any).model || ""} VIN: ${(v as any).vin || "N/A"}`);
      }
    }

    // Loss history
    if (doc.lossSummary) {
      parts.push(`\nLoss Summary: ${JSON.stringify(doc.lossSummary)}`);
    }

    // Named insureds (with addresses)
    if (doc.namedInsureds && doc.namedInsureds.length > 0) {
      parts.push(`\nNamed Insureds:`);
      for (const ni of doc.namedInsureds) {
        let line = `  - ${ni.name}`;
        if (ni.relationship) line += ` (${ni.relationship})`;
        if (ni.address) {
          const a = ni.address;
          line += ` — ${[a.street1, a.city, a.state, a.zip].filter(Boolean).join(", ")}`;
        }
        parts.push(line);
      }
    }

    // Drivers (auto policies — includes age, marital status, driving record)
    if (doc.drivers && doc.drivers.length > 0) {
      parts.push(`\nDrivers:`);
      for (const d of doc.drivers) {
        let line = `  - ${d.name}`;
        if (d.dateOfBirth) line += ` | DOB: ${d.dateOfBirth}`;
        if (d.gender) line += ` | ${d.gender}`;
        if (d.maritalStatus) line += ` | ${d.maritalStatus}`;
        if (d.relationship) line += ` | ${d.relationship}`;
        if (d.yearsLicensed) line += ` | Licensed ${d.yearsLicensed} yrs`;
        if (d.goodStudentDiscount) line += ` | Good Student`;
        if (d.defensiveDriverDiscount) line += ` | Defensive Driver`;
        parts.push(line);
        if (d.violations && d.violations.length > 0) {
          for (const v of d.violations) {
            parts.push(`      Violation: ${v.description || v.type || "unknown"}${v.date ? ` (${v.date})` : ""}`);
          }
        }
        if (d.accidents && d.accidents.length > 0) {
          for (const a of d.accidents) {
            parts.push(`      Accident: ${a.description || "unknown"}${a.date ? ` (${a.date})` : ""}${a.atFault ? " [at-fault]" : ""}`);
          }
        }
      }
    }

    // Producer/Broker
    if (doc.producer) {
      const p = doc.producer;
      let line = `\nBroker/Agent: ${p.name || p.agencyName || "Unknown"}`;
      if (p.phone) line += ` | ${p.phone}`;
      if (p.email) line += ` | ${p.email}`;
      parts.push(line);
    }

    // Insurer
    if (doc.insurer) {
      const ins = doc.insurer;
      let line = `Insurer: ${ins.name || "Unknown"}`;
      if (ins.naic) line += ` (NAIC: ${ins.naic})`;
      parts.push(line);
    }

    // Additional parties
    if (doc.additionalInsureds && doc.additionalInsureds.length > 0) {
      parts.push(`\nAdditional Insureds:`);
      for (const ai of doc.additionalInsureds) {
        parts.push(`  - ${ai.name} (${ai.role || "additional_insured"})`);
      }
    }

    // Loss payees
    if (doc.lossPayees && doc.lossPayees.length > 0) {
      parts.push(`\nLoss Payees:`);
      for (const lp of doc.lossPayees) {
        parts.push(`  - ${lp.name}${lp.role ? ` (${lp.role})` : ""}`);
      }
    }

    // Mortgage holders
    if (doc.mortgageHolders && doc.mortgageHolders.length > 0) {
      parts.push(`\nMortgage Holders:`);
      for (const mh of doc.mortgageHolders) {
        parts.push(`  - ${mh.name}${mh.role ? ` (${mh.role})` : ""}`);
      }
    }

    // Sections (policy text — include summaries for context)
    if (doc.sections && doc.sections.length > 0) {
      parts.push(`\nPolicy Sections:`);
      for (const sec of doc.sections) {
        let line = `  - ${sec.title}`;
        if (sec.formNumber) line += ` (${sec.formNumber})`;
        parts.push(line);
        if (sec.content) {
          const content = sec.content.length > 300
            ? sec.content.slice(0, 300) + "..."
            : sec.content;
          parts.push(`    ${content}`);
        }
      }
    }

    // Quote-specific fields
    if (doc.type === "quote") {
      const q = doc as any;
      if (q.subjectivities?.length) {
        parts.push(`\nSubjectivities: ${q.subjectivities.length}`);
      }
      if (q.underwritingConditions?.length) {
        parts.push(
          `Underwriting Conditions: ${q.underwritingConditions.length}`
        );
      }
      if (q.premiumBreakdown?.length) {
        parts.push(`\nPremium Breakdown:`);
        for (const pb of q.premiumBreakdown) {
          parts.push(`  - ${pb.description || pb.line}: ${pb.amount || pb.premium}`);
        }
      }
    }

    sections.push(parts.join("\n"));
  }

  return `The user has ${documents.length} document(s) on file:\n\n${sections.join("\n\n")}`;
}

// ── Partial Policy Detection ──

/** Check if an InsuranceDocument looks like a partial/incomplete extraction. */
export function isPartialPolicy(doc: any): boolean {
  const hasCoverages = doc.coverages && doc.coverages.length > 0;
  const hasCarrier = !!doc.carrier;
  const hasInsuredName = !!doc.insuredName;
  const hasPremium = !!doc.premium;

  let hasDates = false;
  let hasPolicyNumber = false;
  if (doc.type === "policy") {
    const p = doc as any;
    hasDates = !!p.effectiveDate && !!p.expirationDate;
    hasPolicyNumber = !!p.policyNumber;
  }

  // Has carrier/policy number + dates but no coverages → likely just a declarations page
  if ((hasCarrier || hasPolicyNumber) && hasDates && !hasCoverages) return true;

  // Only 1 or fewer key fields → stub/partial
  const fieldCount = [hasCarrier, hasPolicyNumber, hasDates, hasPremium, hasCoverages]
    .filter(Boolean).length;
  if (fieldCount <= 1) return true;

  return false;
}

/** Build a human-readable summary from an InsuranceDocument. */
export function buildPolicySummary(doc: any): string {
  const parts: string[] = [];
  if (doc.carrier) parts.push(`Carrier: ${doc.carrier}`);
  if (doc.type === "policy" && (doc as any).policyNumber) {
    parts.push(`Policy #: ${(doc as any).policyNumber}`);
  }
  if (doc.type === "policy" && (doc as any).effectiveDate && (doc as any).expirationDate) {
    parts.push(`Coverage: ${(doc as any).effectiveDate} to ${(doc as any).expirationDate}`);
  }
  if (doc.premium) parts.push(`Premium: ${doc.premium}`);
  if (doc.coverages && doc.coverages.length > 0) {
    const topCoverages = doc.coverages
      .slice(0, 4)
      .map((c: any) => {
        let line = c.name;
        if (c.limit) line += ` (${c.limit})`;
        return line;
      })
      .join("\n  - ");
    parts.push(`Key coverages:\n  - ${topCoverages}`);
  }
  return parts.join("\n");
}
