# Intake goal-loop QA — October 20, 2026

Checkpoint: `623484d7`, branch `codex/adaptive-insurance-intake`.
Actor: owner-authenticated synthetic local applicant; separate QA drafts so the human's trucking test draft remains intact. Browser: visible Helium, local Next 3207 / isolated Convex 3220. Email capture only; Slack/iMessage disabled. No live communications or production writes.

## Workflow matrix

For each case: open fixture, exercise listed transitions and edits, reload and inspect persisted result; inspect review and errors. Seeded base answers are fixture setup, not claimed as browser-tested account creation.

| Case | Actions / expected result | Status |
|---|---|---|
| GL consultant | No insurance → claims → cancellations → catalog → follow-ups → review; no auto schedule/value; skipped revenue never repeats; edit/save/reload | Passed — live catalog and generation; answers/skips persisted, base limits repaired through review links; refreshed batch advances without repeating historic rows. |
| Retail property + workers compensation | Scope location preserved; no vehicles/drivers; quote questions relevant to property/workforce; review clean | Passed — property-only scope retained; optional policy upload → claims; live 29-question selection inspected. Fixed-limit duplicate found and removed in adapter v5. |
| Canadian multi-vehicle fleet | VIN blank/invalid handling, 2 dollar value pages, 2 driver pages; country/province; Back/reload and optional DOB/license disabled | Passed — two separate currency pages ($35,000/$12,500), two named drivers, optional PII bypass, Back/reload. VIN validation covered in preceding linked workflow. |
| Fleet cursor recovery | Out-of-range vehicle/driver indexes clamp to displayed record; removal and reload do not edit wrong record | Passed cursor-clamp and reload; removal followed by reload not run in this iteration. |
| Removed auto | Legacy driver/freight draft remains recoverable; no auto pages, facts excluded from model/accepted projection | Passed — browser submission; raw draft retains one dormant driver, accepted and original snapshots contain zero drivers and no freight. |
| Cyber/professional services | Fixed facts excluded; Yes reveals screened conditional details; No/unsure hides; parent edits clear obsolete answers | Partial — live catalog prepared and inspected; recursive inactive/cyclic visibility passed helper probes. Full cyber conditional browser completion not run; equipment Yes/No/clear covered in preceding workflow. |
| Unknown coverage | Continue to company; Back returns coverage selection; no empty scope/driver pages | Passed — freeform scope → company, Back → scope → selection without invalid limits pages. |
| Savings | Required PDF upload, ordinary company details, no quote/driver/AI pages; stale follow-up resume goes review | Passed — required synthetic PDF uploaded, company → review → submitted receipt; stale quote resume redirects to review. |
| Conditional driver resume | Stale accident details with parent No → parent; opt-in disabled → jurisdiction; one question at a time | Passed — No accident detail resume → parent; disabled private details → jurisdiction. Canada/Ontario keyboard selection verified. |
| Final review | Shared row primitives, business names, empty optional fields, one edit section then return, review Back resumes last visible follow-up | Passed — stacked shared question rows, optional dormant data hidden, missing-limit links reach correct inputs, section editing preserves scope. |
| Failure/revision recovery | Pending/failed generation, stale result rejection, duplicate-generation suppression, cross-draft access | Passed stale token/context/duplicate callback, failed-batch reload without replay, capacity/group/cycle probes. Cross-draft authorization covered by existing 9-test suite. |
| Responsive/accessibility | Narrow/light and desktop/dark, keyboard dropdown, footer visibility, long question/value wrapping | Passed desktop/dark and 393×852/dark wrapping/footer; keyboard province search. Light theme not run in restricted applicant session. |

Acceptance: no observed blocking defects remain; every row has passed/blocked/not-run evidence; types, focused lint and existing required tests pass; fixes checkpointed. A quote-ready intake is not a carrier's live quote engine. Coverage requirements vary by insurer, so this run checks collection and handoff behavior rather than universal carrier acceptance.

## Agent findings and iterations

- Navigation: clamp cursors and resume applicability; savings bypass AI pages; unknown coverage Back; last visible follow-up on review Back.
- Question quality: deterministic fixed-field exclusion, quote-stage wording, screened conditional child questions for all known subjects, recursive ancestor visibility, drop malformed individual generated controls.
- Review/persistence: shared row primitives for driver summaries, hide dormant auto and inactive children, readable change labels and optional empty values.
- Memory monitor initially reported raw macOS free RAM as <0.1 GiB; native `memory_pressure` reported 30% system-wide available (~4.8 GiB). Keep local validation sequential and use native pressure rather than interpreting unused physical RAM as reclaimable availability.

Before isolated server-boundary probes, failure modes are: a stale token changing another batch; a changed application accepting old generation; a failed batch being resurrected by a duplicate callback; a 61st saved row or severed conditional parent/detail group; a cyclic/inactive ancestor showing details; dormant auto identifiers entering a non-auto accepted snapshot. These races/invariants are not reliably induced by ordinary browser timing, so local temporary internal fixture calls exercise the existing production helpers/writers. Temporary functions are removed before the final commit.

## Evidence and validation

Ignored artifacts: `.context/qa/intake-goal-loop/` contains synthetic fixtures, persisted-state inspections, failure probes, type/test/lint logs, a synthetic policy PDF, and `review-mobile.png` / `review-desktop.png`. The human trucking draft was not reset. Local submitted savings and non-auto fixtures remain for inspection. Temporary local internal fixture functions were removed and the isolated backend redeployed.

Existing auth/Slack tests: 9 passed. Root and Convex types passed. Focused lint and diff review recorded in final logs. No live email, Slack, production deployment, carrier quote, or policy binding was performed. Not-run items above are explicit coverage limits; they do not establish carrier acceptance or every possible applicant scenario.
