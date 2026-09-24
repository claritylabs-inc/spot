# Convex-native section extraction (implementation spec)

Status: implemented. This document is the shared contract for the packets that
replaced the Railway extraction worker. It supersedes the worker, LiteParse,
preview-queue and `source-tree-v2` sections of `AGENTS.md`; `AGENTS.md` has been
rewritten to match.

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
  `runSourceTreeExtraction`, `chunkDocument`, coverage recovery). Chunking is
  removed entirely: no `documentChunks` writes, no chunk embeddings, no re-chunk or
  backfill tools; agent retrieval ranks source nodes and uses each policy's
  operational profile. Spot keeps cl-sdk
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
| `resolveCarrierIdentityDecision` / `CarrierIdentityDecision` in `convex/lib/carrierIdentitySource.ts`; `carrierDecision` param on `sourceTreePolicyFields` | P4 (P3 calls it) | Jev carrier choice |

## Packets

Implementation history, in landing order: **P1** built `pdfText.ts` and
`citationResolver.ts` on pdf.js, migrating callers off LiteParse. **P2** added
`policySectioning.ts` (form-number grouping + Jev page classification). **P3**
rewrote the policy pipeline (`convex/actions/policyExtraction.ts`,
`convex/lib/sectionExtraction/**`) onto per-section durable router jobs and the
`convex-sections-v1` promotion gate. **P4** replaced extraction heuristics with
Jev classifiers (intake, carrier identity, coverage scoping, post-process,
field review, source tree). **P7** removed cl-sdk extraction-engine usage
outside the core pipeline. **P5** deleted `extraction-worker/` and all worker
endpoints/tables/env/scripts/CI/config, moved procurement proposal extraction
onto the same Convex section pipeline, and updated docs and skills.

## Invariants

These invariants hold across the implementation:

- Read `convex/_generated/ai/guidelines.md` before touching Convex code.
- Source evidence remains canonical: spans → nodes → operational profile, with
  `sourceSpanIds`/`sourceNodeIds` on every critical fact.
- `promoteCompletedExtractionInternal` stays the only writer of `final`.
- Operator overrides (`policyDetailOverrides`) are never touched by extraction.
- No provider keys in Spot; all model calls go through cl-router.
- Do not remove schema tables that may hold production documents; mark them
  deprecated in a comment and leave data migration for a later change.
