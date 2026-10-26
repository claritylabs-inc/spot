# Insurance request round-trip QA — October 23, 2026

## Actors, fixtures and boundaries

Native-local Convex :3220 / app :3207, email delivery mode confirmed `capture` before executing. Use isolated synthetic client/request/provider records marked `full-insurance-workflow-20261023`. Operator browser uses the existing normal signed-in operator session; client uses a separate visible in-app browser, signing in normally if needed. No production changes, external provider/customer sends, real insurance placement, unit tests or database migrations.

## Workflow inventory and acceptance

1. Client creates a fresh quote request, enters company/contact/coverage data, answers conditional intake, reviews, submits, reloads and retains the accepted application. Empty required data must not submit; saving/reloading preserves drafts.
2. Operator selects two synthetic providers, reviews exact recipients/sender/packet/cadence and launches outreach. Actual scheduled delivery runs through the capture transport; one initial message per provider, no duplicates. Ineligible recipients, stale identity and closed requests must be held.
3. Deliver synthetic provider replies through the existing parser and inbound persistence/routing path. Explicit grounded questions become request-owned questions automatically. Test overlap, distinct coverages/periods, conditional questions, quoted history, HTML, unknown correspondents and duplicate delivery.
4. Operator answers known information inline, creates separate question batches and opens the client email composer. Captured invitation has the correct form URL and questions; questions already in a batch stay out of Draft. Prerequisites are retained, conditionally irrelevant questions excluded.
5. Client opens the form via the invitation, saves answers, reloads, navigates conditional inputs, reviews and submits. Correct provider associations, source provenance and submitted status appear in operator view. Original intake remains intact.
6. Client replies by email with additional answers; only grounded explicit answers apply. Duplicate replies do not re-extract or overwrite. Operator may correct values; client may edit/resubmit, with stale revisions and conflicting operator corrections rejected.
7. Exercise cancelled forms, partial batches, unsure/blank answers, unauthorized/signed-out access, wrong account, future questions after submission, and persistence across reload. Verify submitted forms still expose Email client and do not schedule unanswered-form reminders.
8. Inspect keyboard/narrow/theme paths and relevant empty/error/disabled states. Capture visual evidence. Clean up temporary backend fixtures; keep named synthetic data and captured evidence for repeatability. Keep the dev server running.

## Goal loop

For each workflow: execute → inspect UI plus persisted state/captured delivery → record failure → fix the existing owner if actionable → repeat original and adjacent cases. No inferred pass from a route load. Distinguish native-local success from untested live webhook authentication, actual mailbox delivery and hosted durable callbacks.

## Results

Local round-trip passed. Evidence: gitignored `.context/qa/full-insurance-workflow/`.

- Fresh client application with General liability and Cyber, 38 saved additional answers, required-contact validation, draft reload and accepted submission.
- 14 captured outbound messages across five synthetic requests; 20 synthetic inbound deliveries exercised routing (including duplicate and unknown-sender cases), with 18 extraction jobs. Capture proves message construction and send-worker execution, not external delivery.
- Four fresh simultaneous-provider-reply trials passed: four distinct questions, five requirements, one shared question with two providers, conditional dependency retained and reminders stopped in every trial.
- 28 aggregate round-trip assertions passed, plus 8 authorization/revision guards and 10 form lifecycle/conflict cases. These overlap and are not claimed as 46 independent workflows.
- Provider overlap, different currencies/reporting periods, HTML versus quoted history, hostile instructions, failed-head queue recovery, grounded client email count/date answers and uncertain answers passed.
- Operator inline answer provenance; client conditional No/Yes, real PDF upload, review, submission, draft correction and resubmission passed. Original accepted application stayed unchanged; both answer versions and the attachment survived.
- Partial email responses retired the stale batch; replacement included only remaining questions. Submitted/cancelled forms immediately closed their own reminders. Email from an already submitted form captured once without reminders.
- Wrong-account recovery UI passed. Anonymous reads/writes, client access to operator data, stale revisions, missing confirmation, repeated submission, cancelled uploads and conflicting operator corrections were rejected. Failed writes preserved stored facts.
- Desktop, 393px layout, light/system theme and keyboard submission inspected. No horizontal overflow observed. Theme and viewport overrides restored.

## Defects found and repaired

1. Concurrent provider replies could extract against the same old context and duplicate a shared question. Added an atomic per-request extraction claim and queue drain. Inference starts only for the oldest running job; deadlines begin at actual claim. Failed work releases the queue. Legacy jobs without a claim marker are never replayed. Active-job lookup uses a request/status index rather than a history scan limit. The original synthetic duplicate was archived through ordinary operator mutations after retaining failure evidence; four fresh trials independently verified the fix.
2. An accepted initial application could show Additional details as In progress after background preparation restarted. Submitted unchanged applications now derive completion from their accepted answered rows.
3. Form submission/cancellation left reminder records active until send-time checks. Those transitions now terminalize only the exact linked client sequence and cancel pending steps atomically.
4. Submitted-form email composer showed automatic follow-ups even though the send backend disabled them. The form-aware composer now displays No follow-ups and prevents changing that cadence.

## Evidence and repeatability

Primary request: `zh7c7sb4w0ebp8mc11z3ysss458gv7rq`; company Roundtrip Workflow QA LLC; owner `extraction-qa@example.com`. Two explicitly synthetic provider contacts use `provider.example` addresses. Main form `px7r7w10qebxk0b3fq4tfkgnb98gtc7g` retains the PDF and corrected USD 80,000 answer.

Machine-readable artifacts: `final-assertions.json`, `concurrent-results.json`, `concurrent-final-results.json`, `guard-results.json`, `form-edge-results.json`, `failed-head-drain.json`, `scope-html-results.json`, `post-cleanup-public-readback.json`. Browser proof: `client-resubmitted.png`, `client-followup-review.png`, `operator-submitted-answers.png`, `submitted-form-email.png`, `operator-light.png`, `operator-narrow-light.png`.

Temporary internal QA endpoints and synthetic captured inbox were removed, then local functions synchronized. Clearly marked synthetic records and private evidence remain for reproduction; evidence/session material is ignored and must not be committed. Local TEAM_EMAIL_DOMAIN was configured to team.dev.spot.insure; EMAIL_DELIVERY_MODE remains capture. No production changes, deployments or real sends occurred. Dev services remain running.

## Limits

Live Receiving/Svix authentication, real mailbox delivery and hosted durable callback execution were not exercised. Synthetic inbound messages passed through the existing parser, event claim, persistence/routing and actual scheduled cl-router inference; the capture-only inbox/correlation fixture substitutes for transport metadata that capture delivery does not create. Native-local inference uses the supported bounded synchronous path.

Signed-out API guards passed; a clean signed-out browser check remains unverified. Trying an alternate local origin was blocked by Next dev allowedDevOrigins, and the private-window attempt was interrupted by a user app change. Wrong-account recovery was verified on the normal localhost origin. This is not a claim of production release readiness.

## Validation

Existing suite: 20 files / 133 tests passed. Full lint: zero errors and nine existing warnings. Root and Convex typechecks and focused changed-file lint passed; see the corresponding logs in the evidence directory. No new unit tests or database migrations were added.
