# Convex section extraction

Status: implemented on the `convex-section-extraction` branch. This is the current extraction design for policies and procurement proposals.

`convex/lib/pdfText.ts` wraps pdf.js parsing in `convex/lib/pdfSourceSpans.ts`. Text pages produce line spans and bounding boxes. `convex/lib/policySectioning.ts` groups pages by printed form number, then uses `clRouterDecide` for remaining page choices, and cuts bounded section PDFs with `pdf-lib`. Every page belongs to one section. `convex/lib/sectionExtraction/` runs each section as a durable router job with a stable invocation key. Declarations finish first; the other sections can run concurrently using their compact summary. Proposals use the same section pipeline in `convex/actions/proposalExtraction.ts`.

The model cites original page numbers and quotes. `convex/lib/citationResolver.ts` resolves these against pdf.js source spans. On scanned pages without a text layer, cited model text is persisted as `model_transcription` evidence spans. Critical facts without resolved source evidence are dropped. Declarations yield an allowlisted preview without a separate queue or model call. Final policy promotion requires the `convex-sections-v1` completion manifest, matching successful section artifacts, complete page coverage, and grounded evidence; `promoteCompletedExtractionInternal` is the only final writer. Operator overrides are preserved. The policy detail Sections tab shows authored sections and citations; `lib/extraction-state.ts` owns shared status presentation.

Spot no longer uses the cl-sdk extraction engine, although it retains cl-sdk schemas, taxonomy, source-tree helpers, PDF form filling, and prompts. Chunking and `documentChunks` retrieval are removed. `convex/lib/policySearch.ts` and `convex/lib/policyLookup.ts` use Convex full-text search plus Jev relevance ranking. The Railway extraction worker, LiteParse, Poppler, OCR, preview queue, `source-tree-v2`, and legacy policy support are removed. Existing schema entries marked `// Deprecated` remain until deployed data is cleaned. `convex/actions/reextractLegacyPolicies.ts` is a bounded post-deploy re-extraction action that defaults to dry-run.

See the post-deploy checklist in [AGENTS.md](../../AGENTS.md#post-deploy-operator-checklist-for-this-extraction-release) before removing the old service or schema.

Document intake classification, including specimen/testing artifacts, uses `clRouterDecide` (`/v1/decide`); specimen wording no longer bypasses classification with a regex decision. Source-tree identity presentation no longer rejects names based on keyword blacklists; semantic extraction and carrier identity decisions remain in the Jev-backed pipeline. Mechanical source-span parsing, printed-form matching, date parsing, evidence offsets and citation checks remain deterministic.

For intake, separate Jev Nouls establish insurance content, bound terms, and
specimen status. Per-candidate insured/carrier questions and one endorsement
question replace the relationship cross-product. Code compares policy numbers
and parsed periods; missing or ambiguous evidence keeps the relationship unknown.
These relationships remain advisory. Jev reads pages as rendered 1280px JPEG images
(quality 60), not as extracted text: intake sends the first six pages, and an
upload can be rejected only when Jev saw every page. Sectioning sends every page
(with its neighbours as context) in 5-page image batches; the text layer stays in code for
form-number boundaries. A batch that exceeds cl-router's 16 MiB limit or Jev's
context (about six full-size pages) is reported as too large and halved. If
rendering or staging fails, decisions fall back to the text digest. Every question
names its original page and state path. Printed form-number equality/change
determines boundaries in code when both pages have form numbers. Router failures
retain the existing complete fallback section plan.

Scanned citations retain one model-transcription span per quote. During
`store_sources`, `citationLocalization.ts` attempts at most 40 unique targets,
prioritizing declarations, with a 120-second deadline from phase entry.
`locateOnPdfPage` pairs presence with a coarse Box and then refines it on a
cropped image. Both presence and final Box confidence must reach the Jev
threshold. Accepted boxes use PDF points and explicit
`bboxCoordinateWidth`/`bboxCoordinateHeight` metadata. Existing text boxes are
preserved. Unmatched page-only citations may receive presentation annotations;
these annotations never enter the text citation index or upgrade grounding.
Asset, rendering, and router failures leave original evidence intact. Image
localization does not participate in promotion eligibility.
