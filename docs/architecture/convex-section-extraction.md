# Convex-native section extraction (implementation spec)

Status: in progress. This document is the shared contract for the packets that
replace the Railway extraction worker. It supersedes the worker, LiteParse,
preview-queue and `source-tree-v2` sections of `AGENTS.md` once the packets land;
the final packet rewrites `AGENTS.md` to match.

## Decisions

- Policy and proposal extraction run entirely in Convex. The `extraction-worker/`
  service, its Railway deployment, LiteParse, Poppler, Tesseract OCR, page
  screenshots, the synchronous `/liteparse/convert` endpoint, and all worker
  claim/lease/heartbeat/compatibility code are removed.
- PDF text and positioned spans come from pdf.js in Convex
  (`convex/lib/pdfSourceSpans.ts`, wrapped by `convex/lib/pdfText.ts`). Scanned
  PDFs without a text layer are still extracted: the model reads the PDF itself;
  citations then resolve to page-level evidence only.
- Models read the PDF directly. Each call receives one **section slice** of the
  original PDF (cut with `pdf-lib`), never the whole document, so memory, the
  cl-router 12 MiB per-asset limit, and model context stay bounded.
- Sections are planned by `convex/lib/policySectioning.ts`: deterministic grouping
  by printed form numbers first, then Jev (`clRouterDecide`) per-page
  classification for the rest, then deterministic contiguous grouping. Every page
  belongs to exactly one section.
- Each section is one durable router job (`executeDurableRouterRequest`, `"yield"`
  mode, stable invocation key `policy:<runId>:<sectionId>:<sectionHash>`),
  continued by the existing leased pipeline `advance` loop on `RouterJobPending`.
  Declarations run first; the remaining sections run concurrently with a compact
  declarations summary as context.
- Section outputs cite `{ page, quote }` (original 1-based page number and a short
  verbatim quote). `convex/lib/citationResolver.ts` maps each citation onto stored
  pdf.js source spans (span IDs + bounding boxes), falling back to page-level
  evidence. Uncited or unresolvable critical facts are dropped exactly as the
  current grounding rules drop them.
- Section results merge deterministically into the existing extraction result
  shape (compatibility `InsuranceDocument` + `operationalProfile` + source tree),
  so post-processing, `sourceTreePolicyFields`, promotion, embeddings,
  `post_process`, declaration facts, versions and notifications are unchanged.
- The provisional preview queue is removed. When the declarations section
  completes, its allowlisted fields are written with the existing
  `updatePreviewExtractionInternal` semantics (`extractionDataStage: "preview"`),
  so the preview UX survives with zero extra model calls.
- The promotion gate adds protocol `convex-sections-v1`: the completion manifest
  has one section per planned section, every page is covered exactly once, and
  every section has a persisted `section_result` artifact with matching
  fingerprint/hash and `succeeded` status. The per-field evidence checks are
  unchanged. `source-tree-v2` and the external-worker protocol are removed.
- Jev (`clRouterDecide`) replaces heuristic judgment where we pick among known
  candidates: policy intake (document class + relationship to existing policies),
  page sectioning, carrier identity, coverage scoping / ACORD line assignment,
  grounding fallback when exact source matching fails, and organization-name
  normalization. Jev never produces values (dates, amounts, names); it only
  chooses among candidates that deterministic code or the model already produced.
  Low-confidence answers route to operator review rather than guessing.
- Spot stops using cl-sdk's extraction engine (`createExtractor`, `getExtractor`,
  `chunkDocument`, `runSourceTreeExtraction`, coverage recovery). Spot keeps cl-sdk
  schemas, source-tree helpers, ACORD taxonomy, PDF form filling and agent prompts.
  cl-sdk marks the engine `@deprecated` separately.

## Shared module contracts

Stub files with these exact exported signatures exist on the base branch. Owners
implement bodies and may add exports; changing an existing signature requires
manager approval.

| Module | Owner packet | Purpose |
|---|---|---|
| `convex/lib/pdfText.ts` | P1 | pdf.js text, spans, chunks, page texts for any PDF |
| `convex/lib/citationResolver.ts` | P1 | `{page, quote}` → span IDs / bbox |
| `convex/lib/policySectioning.ts` | P2 | section plan + PDF slicing |
| `convex/lib/policyIntakeClassification.ts` | P4 | Jev intake gate + relationship |
| `convex/lib/policyChunks.ts` | P7 | Spot-owned replacement for cl-sdk `chunkDocument` |
| `resolveCarrierIdentityDecision` / `CarrierIdentityDecision` in `convex/lib/carrierIdentitySource.ts`; `carrierDecision` param on `sourceTreePolicyFields` | P4 (P3 calls it) | Jev carrier choice |

## Packets

- **P1 — pdf text + citations.** Implement `pdfText.ts` and `citationResolver.ts`;
  migrate every `liteparsePreprocessor.ts` caller except `policyExtraction.ts`
  (P3) onto `pdfText.ts`; keep `liteparsePreprocessor.ts` compiling for P3 until
  integration (P5 deletes it).
- **P2 — sectioning.** Implement `policySectioning.ts` with tests.
- **P3 — section extraction core.** Rewrite the policy pipeline in
  `convex/actions/policyExtraction.ts`, add `convex/lib/sectionExtraction/**`,
  update `convex/lib/extractionPromotion.ts` and the promotion/start/retry/preview
  functions in `convex/policies.ts`, remove the external-worker and preview-queue
  branches in those files.
- **P4 — Jev classifiers.** `policyIntakeClassification.ts`,
  `carrierIdentitySource.ts`, `coverageScoping.ts`, `extractionPostProcess.ts`,
  `extractionFieldReview.ts`, `sourceTree.ts`, `carrierIdentityBackfill.ts` and
  their tests.
- **P7 — cl-sdk engine removal outside the core.** `policyChunks.ts`,
  `convex/actions/extractSupplementary.ts`, `convex/actions/rechunkPolicy.ts`,
  `convex/actions/backfillChunks.ts`, `convex/lib/extraction.ts`.
- **P5 — worker removal (after P3).** Delete `extraction-worker/`, worker
  endpoints/tables/env/scripts/CI/config, move procurement proposal extraction to
  the same Convex section pipeline, update docs (`AGENTS.md`, README,
  `docs/deployment/environments.md`, skills).

## Invariants every packet keeps

- Read `convex/_generated/ai/guidelines.md` before touching Convex code.
- Source evidence remains canonical: spans → nodes → operational profile, with
  `sourceSpanIds`/`sourceNodeIds` on every critical fact.
- `promoteCompletedExtractionInternal` stays the only writer of `final`.
- Operator overrides (`policyDetailOverrides`) are never touched by extraction.
- No provider keys in Spot; all model calls go through cl-router.
- Do not remove schema tables that may hold production documents; mark them
  deprecated in a comment and leave data migration for a later change.
