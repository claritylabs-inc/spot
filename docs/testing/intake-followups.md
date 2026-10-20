# Intake follow-up workflow

Actor: applicant using an owner-scoped quote draft on an isolated local Convex
backend. Use synthetic company/contact information and captured email OTPs.
The savings review flow remains unchanged.

1. Complete the ordinary quote questions through insurance history. Continue to
   Application questions (persisted step 29; review retains step 28).
2. Wait for Jev selection. Each selected question appears on its own page with
   Back, Continue/Skip and a saved resume position.
   Each eligible catalog candidate receives an independent
   Noul with the saved application; only probabilities meeting the shared Jev
   threshold qualify. Answer the displayed fields and reload: answers survive.
3. Continue to Additional details (step 30). The generator receives the saved
   application including ACORD answers, and returns only declared input types.
   Answer fields, then go Back: ACORD answers remain editable.
4. Continue to review. Confirm the exact answers, edit each follow-up section,
   return to review and check that the updated answers persist.
5. Submit a synthetic complete application. Verify the accepted typed snapshot,
   operator application view, resubmission changes and Markdown export retain
   question text, source and answer. Do not send live customer communications.
6. Test empty selections, a router failure and stalled generation: show an
   explicit outcome and permit review without inventing questions or replaying
   inference. Navigate/reload without generating a duplicate request for the
   same saved context. Change company/coverage and verify stale worker results
   cannot replace the current context's questions.
7. Repeat relevant inputs with keyboard, narrow width and dark theme. Verify a
   different applicant cannot read/generate/save questions for this draft and
   savings navigation still skips the added quote-only sections.

Cleanup: keep the clearly named synthetic fixture in the gitignored isolated QA
runtime; stop its services when finished. Preserve the existing local database.

## Run — October 20, 2026

| Case | Status | Evidence |
| --- | --- | --- |
| Type checking | Passed | `.context/qa/intake-followups-types.log` |
| Existing local runtime | Blocked | Retired `organizations.operatorStatus` in existing fixture prevented schema validation; original records preserved. |
| Isolated backend | Passed | `.context/qa/followups-runtime/deploy.log`; strict schema installed on local port 3220. |
| Live Jev selection | Passed | Five relevant questions selected from 26 starter candidates for a synthetic contractor; actual `/v1/decide` calls. |
| One question per page | Passed | Helium: each question is the heading and sole input; Back/Continue move within a section before the next section/review. Screenshot: `.context/qa/intake-followups-single-question.png`. |
| Five input primitives | Passed with fixture | Yes/no, short text, number, dropdown and long text answered through Helium against the real owner-authenticated draft. Local deterministic response fixture, not a live LLM result. |
| Save and reload | Passed | Question 4 of 5 and Homeowners selection restored after reload. Other section answers preserved. |
| Review editing | Passed | Edit starts the selected section; Back moves to earlier questions and returns from the first question to review. Edited answer appears in review. |
| Submission and amendments | Passed | Browser submission produced accepted snapshot with 10 questions and five source references. Subsequent edit retained the accepted $50,000 answer while draft became $55,000; comparison rendered both. Restored the synthetic draft answer afterwards. |
| Public Markdown/company boundary | Passed | `.context/qa/followups-runtime/snapshot-check.json`: public.md retains accepted follow-up tables; private.md not populated; company business profile has zero follow-up questions. |
| Mobile/dark layout and keyboard | Passed | Helium iPhone 16 emulation at 393×852; no overflow, visible footer; keyboard dropdown and navigation exercised. |
| Empty selection | Passed | Jev returned zero new questions after existing answers; previously saved answers remained editable, one per page. |
| Router failure | Passed | Explicit failure message and enabled continuation observed after a rejected preparation. No fabricated fallback questions. |
| Live LLM generation | Blocked | Router rejected the temporary QA callback origin: `The job callback is not permitted. (router_rejected)`. Durable job remained prepared; no inference replay. Callback allowlist requires an independently approved integration target. |
| Root/Convex typechecks | Passed | `.context/qa/intake-followups-{types,convex-types}.log`. |
| New generation endpoint authentication | Passed | Unauthenticated `prepareFollowups` rejected with `Customer session required`; `.context/qa/followups-runtime/unauthorized-generation.log`. |
| Existing authorization/context tests | Passed | Nine tests in `convex/requestIntake.auth.test.ts` and `convex/lib/intakeSlackContext.test.ts`; `.context/qa/intake-followups-tests.log`. |
| Lint/diff whitespace | Passed | Zero lint errors (two pre-existing hook warnings); `git diff --check`. |
| Stalled generation, stale worker, light theme, savings browser regression, full operator login | Not run | Saved-position exclusion, token/context checks and savings navigation reviewed in code; these are not claimed as browser passes. |

Defects resolved during the run: invalid extra Jev trace key; reload recaching a
stale recovery draft during “Load saved version”; grouped follow-up inputs
(replaced by one question per page at the user's direction); review Back being
mistaken for advancing to the next generated question; answer edits changing
question order. The ordinary local database was preserved. The isolated QA
backend and response fixture are retained under `.context/qa/followups-runtime/`;
temporary fixture functions were removed from repository source and the final
QA deployment. No production deployment or customer message was sent.


## Catalog replacement — October 20, 2026

Actor/fixture: same owner-authenticated synthetic quote draft on local backend
3220; Helium at localhost:3207. Existing test answers remain saved.

1. Import all ten artifacts from PR #519 commit
   `d982690a2e19bbeb3004d1c3fb920a201109daa0`; compare bytes to the fetched ref.
2. Validate every adapted question against the existing answer-definition
   validator, including stable IDs, primitive options and size limits.
3. Deploy only to the isolated local backend and reload the existing draft.
4. Wait for live Jev selection; inspect the first catalog question and choices.
   Leave it unanswered on question 1 for the user's manual testing.

Results: all ten artifacts match the PR exactly; 475 distinct adapted question
IDs validated. The GL fixture has 139 eligible candidates before Jev, absent
parent answers. Live selection returned eight questions. The first is
`gl.coverage.coverage_basis`, with Occurrence / Claims made / Need advice.
Helium displays Question 1 of 8 with one question/input on the page. Evidence:
`.context/qa/pr-519/intake-catalog.png`. Root and Convex type checks, focused
ESLint, isolated deployment and diff whitespace checks passed.

The source is an original Spot catalog with unverified ACORD mappings, not a
licensed form transcription. Full typed/scoped schedule storage and automatic
within-batch expansion of conditional children are not implemented by this
adapter. Unresolved dependencies/history windows, restricted identifiers and
file references are excluded. Existing upload flows remain available. The
previously recorded live LLM callback restriction remains unresolved; this
catalog replacement does not claim a new live LLM pass. No production deployment
or customer communication occurred. Local services and the test tab remain open.


Subtitle removal: removed the visible “Question N of M” line from both follow-up
sections at the user's request. Helium verified the heading and single input
remain with no count subtitle; saved position/navigation are unchanged. Focused
lint and diff whitespace checks passed. Evidence:
`.context/qa/pr-519/intake-no-subtitle.png`.


Uncertainty wording: follow-up dropdowns and review answers now display “I'm not
sure” for the catalog's “Need advice” option, preserving stored option values.
Helium verified the open coverage-basis dropdown; focused lint and diff checks
passed. Evidence: `.context/qa/pr-519/intake-unsure-option.png`.


Compound-question split: the unanswered legacy subcontracting prompt now expands
into separate work-description and annual-spending pages. Helium verified Skip
moves to the dollar field and Back returns to the description. Entering 12000
formatted as 12,000; the isolated database retained distinct long_text/currency
rows and the saved amount. Temporary amount cleared after verification. Question
IDs are deduplicated after saving the expanded children. Existing answered prose
is preserved instead of heuristically splitting it. Root/Convex type checks,
focused lint and diff whitespace checks passed. Evidence:
`.context/qa/pr-519/intake-subcontractor-spending.png`.


## Live additional-question recovery — October 20, 2026

Actor/fixture: same owner-authenticated synthetic draft, local backend 3220 and
visible Helium. The router rejected the previous durable request's callback
before starting inference. No model output existed for that rejected attempt.

1. Select the existing router synchronous endpoint explicitly for bounded local
   additional-question text generation. Hosted/default calls stay durable.
2. Reset only the exact callback-rejected synthetic fixture through a temporary,
   local-only internal mutation; deploy and remove that mutation after recovery.
3. Reload Additional details and let the real routed LLM generate its schema.
4. Verify saved status/questions and reload without submitting another inference.

Passed: real routed generation returned six questions (currency, long text,
yes/no and number); the database batch is ready. Helium displays the projected
first-year revenue question with a dollar input, one question per page. No
fixture questions were substituted. Existing applicant answers were preserved.
The previous live LLM blocker is resolved for local intake via the explicit local
mode, without callback allowlist changes or provider credentials in Spot.
Evidence: `.context/qa/pr-519/recovered-draft.json`,
`.context/qa/pr-519/intake-additional-ready.png`. The temporary recovery function
was removed from repository source and the final isolated deployment.


## Complete question history and duplicate screening — October 20, 2026

Defect: the first successful generated set re-asked projected revenue, a base
intake fact left blank in this fixture. Raw blank answer values did not tell the
model to reserve that question or show which questions had been skipped.

The context now includes all 28 base question definitions with labeled fields,
answers and statuses, plus 10 previously asked follow-ups with answers/statuses,
all 32 populated/raw answer keys, typed details, prior ACORD questions and upload
metadata. Inspection of `history-context.json` confirmed both revenue fields are
explicitly reserved base facts even while unanswered, and the previous skipped
additional-coverage question is identified. New saves retain granular base-field
skips (including the two revenue substeps) and per-follow-up skips; editing a
follow-up clears its skip flag. Previously blank follow-ups remain reserved.

Live generation with this history and the independent Jev novelty screen produced
four ready questions about flammable materials, hot work, electrical work and
plumbing. No annual/projected revenue or previous subcontracting question was
repeated. Helium displays the flammable-material detail question, correctly
following the applicant's previous Yes to hazardous materials. No old blank
revenue prompt was re-appended from the saved-question union. Existing applicant
answers, including $23,000 subcontractor spending, were preserved. Evidence:
`.context/qa/pr-519/history-context.json`, `history-draft.json`, and
`intake-question-history.png`. Root/Convex types, focused lint, diff checks and
nine existing authorization/Slack-context tests passed. Granular new skip flags
were reviewed in the save/navigation path; this run does not claim a separate
new browser walkthrough of every base skip substep.


## Trucking scenario — October 20, 2026

Ran the user-supplied trucking application on a separate unsubmitted isolated
local copy, preserving the original draft. General liability and commercial-auto
facts, unknown limits, the provided vehicle string, annual revenue, and supplied
skip history were retained without inventing drivers, claims, authority, routes,
VIN corrections, or answers to the selected questions.

Actual pipeline: 176 eligible catalog candidates, 12 selected; then live routed
structured generation and Jev novelty screening produced six additional questions.
Both batches are ready. No revenue question was repeated. Additional generation
saw the selected catalog questions as pending; this is a first-pass scenario,
not a completed interview or a carrier-ready assertion. JSON artifacts are under
`.context/qa/trucking-case/{acord-output,followup-output}.json`. The temporary
local-only seed/prepare/query harness was removed from source and the final
isolated deployment. No original-record write, submission or customer message.

Assessment: required data gaps remain, including incomplete VIN validation,
driver schedules/driving history, physical-damage terms, precise cargo and
operating authority/territory, and carrier-required loss history. Entity-form
inconsistency also needs clarification. Relevance/novelty selection is not a
completeness check; rejected/omitted/explicitly skipped facts must remain visible
as unresolved operator/carrier requirements. The current adapter intentionally
excludes restricted driver identifiers and history-window questions without a
specified window, and does not dynamically expand conditional children during
the same catalog batch. These limits matter for trucking readiness.


## VIN validation and minimal driver intake — October 20, 2026

Use the isolated local backend and the separate synthetic driver-workflow copy.
Do not change or submit the user's original application. Driver names and any
sensitive values entered for browser QA are synthetic.

1. Open vehicle scope with the supplied seven-character VIN: visible error and
   disabled Continue. Test 17 characters with a wrong check digit: blocked.
2. Enter the published-format sample 1M8GDM9AXKP042788: enabled Continue. Clear it:
   navigation succeeds. This sample is only a validator fixture, not a replacement
   VIN for the supplied truck.
3. Verify the driver roster follows commercial-auto vehicle scope. Add two
   synthetic names. Continue omits birth-date/license-number pages by default.
4. Skip optional jurisdiction, class, experience and history for both drivers.
   Each driver is visited; missing history remains blank, not No. Reload on the
   second driver: its position and both names remain. Continue reaches company
   questions; Back returns through both drivers to the roster.
5. Opt into sensitive details. Future birth date is rejected; a valid synthetic
   birth date and test license number save. Server-side model projection returns
   [provided securely] for both fields. Clear the synthetic values and restore
   opt-in off. Existing skip/default behavior remains available.
6. Inspect the shared server submission checks on the unchanged trucking case:
   incomplete VIN and missing roster are reported. Names-only synthetic schedule
   with a blank VIN passes those checks. No actual application was submitted.

All browser cases above passed in Helium. Screenshots:
`.context/qa/trucking-case/vin-invalid.png` and `driver-roster.png`. The temporary
local QA harness was removed from source and the final deployment. The supplied
trucking facts were rerun without inventing driver information: 8 catalog
questions and 6 generated follow-ups, with no repeated revenue or driver base
questions. Results: `drivers-acord-output.json`, `drivers-followup-output.json`.
Still unresolved: actual VIN/roster, vehicle value/physical-damage terms, precise
cargo/territory/authority and carrier-specific history/documents. Initial quoting
may proceed with optional details unknown; firm quote/binding readiness is a
separate carrier-specific determination. No production changes or external
messages were made.
