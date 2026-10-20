# Convex section extraction

Status: implemented on the `convex-section-extraction` branch. This is the current extraction design for policies and procurement proposals.

`convex/lib/pdfText.ts` wraps pdf.js parsing in `convex/lib/pdfSourceSpans.ts`. Text pages produce line spans and bounding boxes. `convex/lib/policySectioning.ts` groups pages by printed form number, then uses `clRouterDecide` for remaining page choices, and cuts bounded section PDFs with `pdf-lib`. Every page belongs to one section. `convex/lib/sectionExtraction/` runs each section as a durable router job with a stable invocation key. For policy PDFs with usable declaration text, a fixed Clairic fast-pass supplies the preview and compact summary before the declarations LLM finishes, so other sections can start in the same advance. Scanned or empty-text policies retain declarations-first ordering. Proposals use the same section pipeline in `convex/actions/proposalExtraction.ts`.

The model cites original page numbers and quotes. `convex/lib/citationResolver.ts` resolves these against pdf.js source spans. On scanned pages without a text layer, cited model text is persisted as `model_transcription` evidence spans. Critical facts without resolved source evidence are dropped. Declarations yield an allowlisted preview without a separate queue. Final policy promotion requires the `convex-sections-v1` completion manifest, matching successful section artifacts, complete page coverage, and grounded evidence; `promoteCompletedExtractionInternal` is the only final writer. Operator overrides are preserved. The policy detail Sections tab shows authored sections and citations; `lib/extraction-state.ts` owns shared status presentation.

Spot no longer uses the cl-sdk extraction engine, although it retains cl-sdk schemas, taxonomy, source-tree helpers, PDF form filling, and prompts. Chunking and `documentChunks` retrieval are removed. `convex/lib/policySearch.ts` and `convex/lib/policyLookup.ts` use Convex full-text search plus Jev relevance ranking. The Railway extraction worker, LiteParse, Poppler, OCR, preview queue, `source-tree-v2`, and legacy policy support are removed. Existing schema entries marked `// Deprecated` remain until deployed data is cleaned. `convex/actions/reextractLegacyPolicies.ts` is a bounded post-deploy re-extraction action that defaults to dry-run.

See the post-deploy checklist in [AGENTS.md](../../AGENTS.md#post-deploy-operator-checklist-for-this-extraction-release) before removing the old service or schema.

Document intake classification, including specimen/testing artifacts, uses `clRouterDecide` (`/v1/decide`); specimen wording no longer bypasses classification with a regex decision. Source-tree identity presentation no longer rejects names based on keyword blacklists; semantic extraction and carrier identity decisions remain in the Jev-backed pipeline. Mechanical source-span parsing, printed-form matching, date parsing, evidence offsets and citation checks remain deterministic.

For intake, separate Jev Nouls establish insurance content, bound terms, and
specimen status. Per-candidate insured/carrier questions and one endorsement
question replace the relationship cross-product. Code compares policy numbers
and parsed periods; missing or ambiguous evidence keeps the relationship unknown.
These relationships remain advisory. Jev reads pages as rendered 1280px JPEG images
(quality 60), not as extracted text: intake sends up to the first six pages (halving the leading sample on a payload-too-large response), and an
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

Extraction decision hygiene keeps exact normalized labeled insured/carrier matches
in code. When labeled policy-number parsing finds nothing, an advisory Choice
selects among at most 127 identifier candidates from the same bounded text slice,
excluding date- and phone-shaped tokens, with a none option. Selection failures
retain the intake classification and leave the number unknown. Number and
period equality remain deterministic. Coverage scoping processes every ambiguous
row in batches of 100. Section-kind choices contrast base forms, endorsements,
form lists, item schedules and declarations; other means none of those types,
while uncertain answers follow the confidence fallback.

Citation localization preserves pdf.js line-position boxes without a model call.
Remaining targets are grouped by page, rendered and staged once, and receive one
presence Noul and Box pair per quote in a payload-splittable request. Confident
coarse matches are cropped once with padding and receive one presence Noul and
Box refinement on that crop. Crop-relative boxes map through the rendered crop
region into PDF points. Cancellation and the phase deadline are
checked before each batch and quote; in-flight requests are not interrupted.

## Declarations fast-pass

`convex/lib/sectionExtraction/declarationsFastPass.ts` joins the original text of
declarations pages, preserving page offsets and dropping whole trailing pages
at 240,000 characters. `clRouterExtract` sends typed fields to the fixed
`POST /v1/extract` endpoint. Spot retains only its existing router credentials;
Cloudflare credentials belong to cl-router. No route is added to the model
catalog or operator settings.

The `declarations_fast_pass` artifact is bound to the section plan. Usable
results write the provisional preview and supply context for concurrent section
jobs. The declarations LLM still extracts parties, coverages, forms, insured
details, premium breakdowns and taxes. Only non-null, source-grounded fast-pass
scalars replace its corresponding fields before section results are stored.
Dates use companion text fields to locate their original evidence because
Clairic's normalized date answers need not contain spans. Existing citation
resolution attaches source IDs during merge; fast-pass output does not bypass
final promotion requirements or operator overrides. Extractor version
`convex-sections-v1.2` invalidates older section results.

Release verification requires the updated router with Workers AI credentials
and an explicitly selected development Spot deployment. Re-extract one or two
authorized policies and inspect the Clairic model-call duration, early preview,
non-declarations submissions in the same advance, and final scalar source-span
IDs. Sub-second latency is an acceptance target, not a measured guarantee.
