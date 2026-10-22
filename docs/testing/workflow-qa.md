# Platform workflow QA

## Introduction spacing refinement — October 20, 2026

Local Chrome real-component preview passed top-aligned introduction content,
wider desktop content/footer alignment, roomier topic rows, and removal of the
icon/counter/bottom note. At 393×700 the content ended at 504px and footer began
at 627px; there was no horizontal overflow. Evidence:
`.context/qa/intake-polish/introduction-top-aligned-{desktop,mobile}.png`.
The introduction-only IntakeFrame layout leaves ordinary form layout intact.
Touched-component lint passed; temporary preview route was removed.

## Intake integrated questions and inferred Booleans — October 20, 2026

Isolation failure modes identified before implementation: confidence below 0.70
or invalid probability; Unknown selected; unsupported question/control; overwritten
human answers or explicit skips; inactive conditional child; stale token/context
or provisional batch accepting inferred answers; forged prefill provenance.
These inference/write races cannot reliably be established in browser E2E.
`convex/lib/intakePrefills.test.ts` defines the compact decision/merge invariants
before implementation. Browser coverage will check coverage-owned vehicle fields,
review/edit of prefills, multiple routes and the final removal of reorder/clear/distance controls.

Results: local Chrome component workflows passed for adding/removing independent
routes and stops; Start/Stop vs Stop 1/Stop 2 labels; endpoint naming with an SVG
ArrowRight; legacy single-route input and reload recovery; hidden maximum-distance
values; absent reorder/Clear route/banner/help copy; equal 48px large secondary add
buttons; and 393px layout without horizontal overflow. Route reload recovery here
uses fixture session storage. Separately, the user draft showed Saved and reached
review with three routes after the local backend validator sync fixed the reported
save rejection. Production was not deployed.

Coverage component QA passed two independent vehicle answers, conditional equipment
details clearing on No, and combined vehicle/quote/driver review under Coverage.
Vehicle and Locations headings had identical computed size (14px), weight (500),
and color. The Prefilled review label rendered; exact review editing uses the
existing follow-up edit path. Live Jev returned No with 0.98 joint confidence on
explicit synthetic non-hazardous-freight evidence; output is in
`.context/qa/intake-integrated/live-jev.json`. This probe verifies router decisions,
not an entire live applicant-prefill turn. The decision/merge isolation suite and
existing owner/revision tests passed (8 checks). Stale-evidence/provenance guards
were reviewed in the production writer, but not raced through browser sessions.

Evidence and repeatable fixture source are under `.context/qa/intake-integrated/`
(`page.tsx`, `qaIntakeInference.ts`, routes/review desktop/mobile PNGs). Temporary
preview and backend probe modules were removed after the run. Final root/Convex
typechecks and touched-file lint are recorded there; lint retains the existing
application effect-dependency warning.


## Intake loading and section introductions — October 20, 2026

Actor: local Chrome component preview using the real intake components, with
synthetic callback state and no backend writes. Temporary preview route:
`/intake/qa-polish`, removed after verification; fixture retained at
`.context/qa/intake-polish/page.tsx` for repeatability.

1. Inspect each quote section introduction: icon, section label, heading,
   description, topic preview and Back/begin actions; verify section navigation.
2. Check savings policy introduction without quote section numbering.
3. Continue into pending follow-ups: show one announced status and decorative
   form skeletons. Switch to the initial application loading variant.
4. Check desktop and 393px layouts for wrapping and footer overlap. Verify
   loading placeholders are hidden from accessibility and motion is conditional.
5. Remove the temporary preview route. No draft edits or submissions.

Results: passed in local Chrome for all six quote introduction variants,
savings policy upload introduction, begin/back callbacks, both initial and
question-preparation loading cards, and 393px/desktop layouts. Mobile scroll
width matched the 393px viewport; topics, supporting copy and footer stayed
readable. The status region retained visible copy, and the spinner/skeleton
subtrees were marked decorative. Reduced-motion classes were source-checked;
OS preference emulation was not run. Screenshots:
`.context/qa/intake-polish/{introduction,loading}-{desktop,mobile}.png`.
The temporary route was removed. Node 24 typecheck and whitespace checks passed;
lint had no errors and the existing `application.tsx` effect-dependency warning.
This component preview does not establish live inference, authentication or
handoff timing. No unit tests were added.

## Intake review disclosures and grouped labels — October 20, 2026

Actor: existing signed-in local synthetic Lakeview Freight Test LLC applicant at
`localhost:3207`; no submission or external delivery.

1. Open Review from the section navigation: land directly on the final review.
2. Toggle Application questions, Additional details, Commercial auto details and
   Driver schedule with pointer/keyboard; each body must expand and collapse.
3. Expand Application questions: vehicle facts share a vehicle heading, labels
   omit the repeated vehicle prefix and “Include the units”, and saved answers
   and skipped states remain visible. Inactive conditional answers stay hidden.
4. Use Application questions Edit: grouped vehicle labels use `body.root` like
   Location name and inputs use the same 48px sizing; return to review.
5. Check narrow layout for wrapping/overflow. Cleanup: leave draft unsubmitted.

Results: local Chrome passed direct Review entry, pointer open/close for all
four added disclosures, keyboard Enter toggling for Driver schedule, the missing
driver empty state, grouped Vehicle 1 answers/skips, and a labeled General
questions group. Vehicle/general subheadings use `heading.micro` and render
smaller than the main section title. At 393px the page had no horizontal
overflow. Edit opened the saved application-question position; grouped-field
`body.root` typography and 48px input sizing were checked in source but not
visually reached in this fixture. Multi-vehicle, savings, light theme, and
inactive-child regression cases were not run. No submission was made.
Evidence: `.context/qa/intake-review-grouped.png` and
`.context/qa/intake-review-mobile.png`. Node 24 root typecheck, touched-file lint,
and diff whitespace checks passed. No unit tests were added.

## Intake follow-up questions — October 20, 2026

Helium verified one-question-per-page ACORD and generated follow-up sections,
per-section Back/Continue/Skip, saved answers and resume position, five input
primitives, review editing, local synthetic submission, immutable accepted
answers and amendment comparison, public Markdown projection, and 393px dark
mobile layout. Live Jev selection passed. The LLM response UI used an explicit
deterministic fixture after the router rejected the temporary QA callback
origin; live LLM generation remains blocked by the callback allowlist. Nine
existing authorization/context tests and both typechecks passed. See
[intake follow-ups](intake-followups.md) for the full ledger and remaining
not-run cases. Evidence: `.context/qa/intake-followups-single-question.png` and
`.context/qa/followups-runtime/snapshot-check.json`.

## Clairic fast-pass deadline — October 20, 2026

Source `8af88b01a7afb1bca8b0437c9a963d15fb8933bc`. Only
`declarationsFastPass.ts` and the section-extraction architecture doc changed;
`clRouterClient.ts` and other router callers are unchanged.
`runDeclarationsFastPass` races `clRouterExtract` against a 15-second timer.
At expiry the timer first rejects with a `ClRouterRequestError` of kind
`timeout`, then aborts the request through the existing `abortSignal`. The
timer is cleared in `finally`. `executionStarted` is left unset, and source
checks run before the timer starts.

Failure modes were listed before the change: a fetch that stalls before
headers, a body that stalls after headers, a late result after expiry,
cleanup on success and error, no replay after an unknown outcome, and no
effect on other router callers.

Checks: focused ESLint on `declarationsFastPass.ts`, Convex `tsc --noEmit` and
root `tsc --noEmit` passed. Each ran once. No unit tests were added.

Scratch fault injection (not a test file) used real `fetch` against a loopback
HTTP server, with the router URL overridden in-process:

| Case | Result |
| --- | --- |
| No response headers | `timeout` at 15,003 ms; server socket closed at 15,004 ms |
| 200 headers, then body stalls | `timeout` (not `invalid_response`) at 15,001 ms; socket closed at 15,002 ms |
| Response scheduled 500 ms after the deadline | `timeout` at 15,000 ms; the connection had already closed, so no late result arrived |
| Body arrives at 14 s, completion telemetry takes 2 s | `timeout` at 15,001 ms; the result is discarded |
| Success | result returned in 30 ms; timer cleared, never fired |
| Typed HTTP 500 | `server` / `router_internal`, `executionStarted: true` preserved; timer cleared |
| Invalid JSON, connection refused | `invalid_response` and `connection`, unchanged; timer cleared |
| No text layer | plain error; no request and no timer |
| Direct `clRouterExtract`, reply at 16.5 s | succeeds at 16,505 ms; no global deadline |

Timeout errors never set `executionStarted`. No unhandled rejection
occurred. Source inspection of `policyExtraction.ts`: the `started` marker is
saved before the call. Any error, including `timeout`, logs the failure class,
records a trace error, marks the fast pass `skipped` and continues
declarations-first. An interrupted `started` marker is also skipped, so the
call is never replayed. The helper has no retry.

Two telemetry notes, neither blocking: the deadline also covers the start
telemetry mutation inside `clRouterExtract`; and when completion telemetry
straddles the deadline, the model-call record says `complete` even though the
fast pass fell back. After a timeout, the error telemetry mutation finishes
after the helper has returned.

Live: the original From/To fixture ran once through the wrapped helper on
shared dev `tangible-warbler-253`. It returned 2026-01-15 / 2027-01-15, both
cited, with router latency 477 ms and wall time 984 ms (request
`1bdd3316-91d6-4425-9ac6-00925988e772`). The process exited after 1.08 s, so no
15-second timer was left behind. Artifacts are in `.context/clairic/timeout/`.
No preview, deployment, customer data, or Spot write was used.

## Clairic fast-pass dates and lists — October 20, 2026

Source `1c0af6a084ea97a25142e9e8e6986945f7b3f67b`. Only
`declarationsFastPass.ts` and the section-extraction architecture doc changed.
The request omits `linesOfBusiness` and `coverageSummaries`.
`fastPassAsOutput` returns both empty, even for restored artifacts. Date
instructions name the start and end of the policy period, From/To pairs and
labeled dates, and forbid inferred dates. The evidence and calendar gates are
unchanged.

Checks: focused ESLint on `declarationsFastPass.ts`, Convex `tsc --noEmit` and
root `tsc --noEmit` passed. Each ran once. No unit tests were added.

Offline scratch execution (not a test file) confirmed:

- Unchanged date gates: a calendar-invalid value, a value with a time, a value
  holding two dates, a value missing from its evidence quote, evidence without
  a span or with an out-of-range span, and evidence with a null value all map
  to null.
- Legacy list answers are ignored. A restored artifact that still stores lines
  of business and coverages produces empty lists in the output, preview fields
  and summary, and keeps its scalars and forms.
- `overlayFastPass` keeps the LLM's lines of business and coverages.

Live synthetic `/v1/extract` on shared dev `tangible-warbler-253` (router
`12ca9ec2`). Each case ran once and passed, so none was repeated:

| Case | Result | Request |
| --- | --- | --- |
| `Policy Period: From 01/15/2026 to 01/15/2027 12:01 A.M. standard time` (previously expiration null, pNull 0.85) | 2026-01-15 / 2027-01-15, both cited; expiration pNull 0.0004 | `613872b6-a485-4d01-a74a-e9bf99ca75cf` |
| From March 1, 2026 to March 1, 2027 at 12:01 A.M. | 2026-03-01 / 2027-03-01, cited | `2e9359e0-bb92-490d-a7e5-0ae6a7fcc9d8` |
| Labeled effective/expiration/retroactive with a Date Issued distractor | 2026-06-01 / 2027-06-01 / 2019-09-15, cited; issue date not used | `51478e9e-990c-432a-aba6-1c66366f0f8c` |
| Effective date only, no end date | expiration null (pNull 0.997), no invented date; summary omits Policy period | `e10db628-1a7e-4da4-80cb-4eeeada9a413` |

No response contained list answers for lines of business or coverages, and every
summary omitted both. Router latency was 383–566 ms (wall 551–1245 ms). In the
first case Clairic returned the form `IL 00 17 11` without its `98` edition
suffix; form mapping is outside this change. These are single samples, so model
nondeterminism is not ruled out. Artifacts are in `.context/clairic/quality/`. No
preview, deployment, customer data, or Spot write was used.

## Clairic declarations fast-pass — October 20, 2026

Independent Opus review covered the fixed router endpoint, request/response
contract, citation offsets, null/list mapping, date evidence, once-per-plan
execution and unknown outcomes, early preview/context, and scalar authority
across multiple declarations sections. No unit tests were added.

Router acceptance on Node 24.14.1: `npm run openapi:generate` and `npm run check`
passed (lint, workspace typechecks, 439 existing tests passed / one skipped,
build, OpenAPI consistency). The committed router snapshot source is
`dce080468fcac24b96ca62c0aca50d45e76512bb`. Router credentials use `CF_API_KEY`
and `CLOUDFLARE_ACCOUNT_ID`; Spot has no new credential configuration.

Spot acceptance: `npm run check:cl-router-contract` passed (20 fixtures,
11 operations); `npm run lint` passed with three warnings in untouched intake
files. Root and Convex `tsc --noEmit` passed after completing the artifact-kind
union and organization ID type boundary. Final reviewed code: `f00e03a6`.
The extraction parser copy and exact OpenAPI bytes match the pinned router
revision. No additional broad checks were repeated after the type-only fixes.

Artifacts: `.context/clairic/review/` and `.context/clairic/review/logs/`.
No Vercel preview, deployment, production mutation, or live policy re-extraction
was used. Live Clairic latency under one second, preview-before-LLM timing,
same-advance non-declarations submission, and final scalar `sourceSpanIds`
remain unverified. Repeat the workflow in
`docs/architecture/convex-section-extraction.md` on an explicitly selected
development target with both updated services before claiming those results.

## Safari detail-panel dropdowns — October 19, 2026

Reproduced through native Safari computer use on `/operator/clients`: opening
Status scrolled the resizable detail panel horizontally by 325px, shifting its
header, fields, and footer. No production fields were changed. A local synthetic
fixture using `AppShellPanelLayout`, the app shell's positioned right-panel
wrapper, `SettingsDrawer`, and the shared Select reproduced a 360px scroll.
The positioned wrapper is necessary to reproduce; a drawer-only fixture misses it.

The desktop right-panel wrapper now uses `overflow: clip`, preventing popup
focus from expanding the ancestor panel's scrollable overflow without adding
another scroll container. Native Safari checks passed for opening, keyboard
selection, reopening, Escape dismissal, and reopening after keyboard panel
resize; the local scroll measurement remained zero. Mobile clipping is unchanged.
Artifacts from this run: `.context/safari-drawer/{before,after}.png` and
`.context/safari-drawer/page.tsx` (temporary fixture source; no public QA route
is retained). Full authenticated local-client and other-browser checks were not run.

## Live agent activity — October 19, 2026

The local Chrome component workflow passed for the real `ChatAssistantTurn`,
`ThinkingSummary`, disclosure, and display-preference components with synthetic
message/viewer state. Covered: unset activity preference defaults visible;
requested/running labels; failed and awaiting-approval labels; model waiting;
streaming disabled without losing activity; explicit activity opt-out; completion
removes the spinner; and 390px mobile layout without horizontal overflow.
Artifacts: `.context/progress-fixes/browser/{run.mjs,fixture.tsx,convex.ts,stubs.tsx,result.json,running-desktop.png,running-mobile.png}`.
The fixture substitutes authentication/query data and answer rendering; it does
not establish an authenticated agent workflow or live router callback delivery.
No Vercel preview or production deployment was used.

Integrated verification: Spot root and Convex typechecks, touched-file lint,
existing `convex/routerJobs.test.ts` (8 passing), and router contract check
(17 fixtures/10 operations) passed. cl-router's integrated `npm run check`
passed (433 tests, one skipped); the router worker separately reported the
existing waterfall transport scenarios passing (31/31). No unit tests were
added to the commits. Live tool metadata delivery across the two deployed
services remains unverified and requires the updated router plus an approved
Spot callback endpoint. Tool-request progress never authorizes execution;
actual tool execution still waits for the terminal model result.

## MCP Events — September 30, 2026

Local isolation coverage passes for tenant/operator boundaries, removed
membership and revoked OAuth access, deterministic renewal, private settings
DTOs, callback cache isolation/expiry, secret encryption/AAD tampering, public-IP
validation/DNS pinning, redirect rejection, signed challenges, body/time limits,
dual-key signatures, event deduplication, stale leases, and terminal `410`.
These failure modes were selected before their corresponding implementations;
they require isolation checks because browser E2E cannot reliably reproduce
SSRF, signature, authorization, or concurrent lease races.
Tests: `convex/mcpEvents.test.ts`, `convex/actions/mcpEvents.test.ts`,
`convex/lib/mcpEventProtocol.test.ts`, and
`convex/lib/mcpEventWebhook.test.ts`. Artifacts:
`.context/mcp-events/focused-tests-final.log` (45 passing checks), with red-first
cache/error logs beside it. No deployment or Vercel preview was used.

The full authenticated ChatGPT subscribe/refresh/unsubscribe lifecycle and
mounted tenant/operator settings browser workflow remain **not run**. Execute
`docs/architecture/mcp-events.md`'s smoke workflow only after approved endpoint
composition and environment configuration; local tests do not establish
ChatGPT compatibility or deployed delivery.

Operator invitations: `node scripts/operator-invitations-e2e.mjs` runs against native-local Convex and the app on localhost:8080. It creates synthetic operator identities, captures email locally, verifies Settings Team invitation and OTP entry, rejects anonymous/customer/alias-conflicting invitations, and exercises the MCP shared approval/execution/replay path. Artifacts: `.context/qa/operator-invitations/results.json`, `settings.png`, and `accepted.png`. No live email or production data is used.

Current packet-link contract: active links now serve live saved shared content
and released files. Snapshot/immutability passes below are historical and do
not establish browser coverage for this behavior. Live additions, visibility
changes, and open-page updates need a new browser pass; backend regression
coverage is in `convex/procurementDomain.test.ts`.

Follow `.agents/skills/cl-workflow-qa/SKILL.md`. This guide captures the user's
cloud-Chrome method and September 8, 2026 feedback. Scripts below specify desired
behavior before execution. Evidence lives in `.context/qa/platform/`.

Use the native-local app at `http://localhost:8080`, visible desktop Chrome,
local email-capture OTPs, and seeded operator (`terry@claritylabs.inc`), client
(`adyan@cove.dev`), and broker (`terry@example-risk.example`) identities. Keep each
role in an isolated context. Use synthetic fixtures for writes and restore
original values afterward. Do not send live email, change shared router state,
bind coverage, or alter production while testing.

For every edit: verify autosave, immediate close, reopen/reload, record switching,
failed-save recovery, keyboard operation, mobile width, and light/dark rendering
where relevant. Tables contain data and sidebar navigation; record actions and
uploads belong in sidebars. Use organization icons in selectors, toast progress,
and concise labels. Explicit creation and consequential actions remain explicit.

## Inline Markdown card follow-up — September 15, 2026

The real-component fixture in `.context/request-tabs-browser/inline-editor.mjs`
passed in headless local Chrome: Notes has only Edit request, Shared has only
Share link, and the main card switches between Preview and Write. A revision
conflict preserves the draft while opening request settings and prevents a tab
change until discard; successful tab changes save only the selected file.
Opening the link sidebar reads the existing URL without rotation; its footer
explicitly regenerates it. Desktop/mobile light/dark modes have no overflow.
Company wiki inline editing, autosave and preview passed in the same fixture.
Requirement-note editors retain existing autosave/permission coverage through
focused tests; their full record workflow was not browser-retested in this pass.
Backend tests verify unchanged rows on link reads, token exclusion from model,
client and public projections, operator-only retrieval, rotation invalidation,
and legacy/revoked/expired behavior. The fixture uses synthetic data and does not
establish authenticated production workflow coverage.

## Shared UI adoption — September 24, 2026

Registry `@claritylabs-inc/ui@0.2.1` was installed with a clean `npm ci`.
`node scripts/qa/capture-ui-adoption.mjs <output-dir> <local-url> <fresh-convex-log>`
uses the seeded operator and fresh captured OTP, checks authenticated route entry,
row/sidebar access, empty/filled create-form validation, Escape cancellation,
client-side record navigation, and synthetic OAuth-error toast dismissal. It
creates desktop (1440×900) and mobile (390×844) screenshots plus a private
`auth-state.json`; never publish the auth state. No client or external connection
is created. Install Playwright Chromium with `npx playwright install chromium`
if absent. `npx convex logs` supplies the local capture log.

Compare with `node scripts/qa/compare-ui-adoption.mjs <baseline-dir> <after-dir>
<diff-dir>`. The comparator reports pixels with an RGB channel delta above 12.
Baseline routes came from `f5039c7d709438a4f4a89c1d4d7f3f93ddb774a1`.
The supplemental toast baseline uses that source with the installed dependency
set and the equivalent Base UI OTP export rename. Evidence and the full file
mapping are in [the review gallery](https://41841dba-c31c-4f23-801f-78831a73c9f0.conductor.show/)
and `.context/qa/ui-adoption/`. These headless local Chrome checks do not establish
production, dark-theme, or every-component parity. The shell adoption is deferred.
The workflow passed. Fourteen of 16 screenshots have no changed pixels above the
threshold; the OTP button edge differs by 3 pixels and the mobile drawer close
icon by 17 (0.0052% of that image). Full pixel identity is not claimed.
Validation passed: 138 test files / 761 tests, Next and Convex typechecks, worker
builds, production build, package/router contracts, and lint (three existing
warnings).

## Scripted user outcomes

| ID | Actor / entrypoint | Steps and desired behavior |
| --- | --- | --- |
| AUTH | All / login | Enter email, submit invalid then captured valid OTP, verify correct portal, sign out, verify protected deep links reject access. Exercise resend and expired/invalid invite links. |
| ONBOARD | Public / signup, onboarding | Inspect client signup and broker setup, validate required fields, create a synthetic account locally and follow setup; no broker-owned client assumption. Existing users return to their allowed portal. |
| CLIENT | Operator / Clients | Search Cove, open with keyboard, inspect overview, edit name/website and close immediately, reopen and restore; create a synthetic client with local invite capture, verify its sidebar and navigation. |
| BROKER | Operator / Brokers | Search/filter supplier status, open profile, edit website/address/writing states and close, verify persistence; change status while filtered and retain editor; create a standalone synthetic broker; no accidental account invitation. |
| BPROFILE | Broker / Profile | Edit website/address/lines, verify automatic persistence and live updates without lost draft; confirm member restrictions and operator-only network status. |
| TEAM | Client/broker / Team | Open member from row, edit allowed profile fields, invite synthetic member with local capture, inspect pending invite, resend/revoke in sidebar; verify own-role and last-admin protections. |
| PROFILE | Operator/client / Profile | Edit name and valid phone, reject invalid/duplicate phone without losing draft, reload; inspect verified-email change and privacy controls; switch light/dark/system. |
| THREAD | Operator / Threads | Open seeded thread from keyboard row, inspect messages and context, archive/restore from sidebar footer, reopen; create local task and inspect pending/running/cancel/error states. |
| AGENT | Client / Agent | Start policy question, verify grounded response, inspect attachments/history, archive/restore, keyboard composer and cancel; no cross-client data. |
| POLICY | Operator/client / Policies | Filter/open final sample, inspect details/coverages/source PDF and evidence, download; operator edit persists, client stays read-only; use synthetic upload to inspect extraction/retry states. |
| CERT | Operator/client / Certificates | Open generation sidebar, choose policy and holder, inspect requirements/gaps, generate synthetic PDF locally when prerequisites permit, download/history; never claim unmet requirements satisfied. |
| COMPLIANCE | Operator/client / Compliance | Add synthetic requirement, edit limits/line, inspect matched evidence, unmet/expiring state and certificate path, archive; ensure scope is retained. |
| FILE | Operator/client / Files | Upload synthetic PDF, inspect progress toast, rename/share in sidebar, download without navigation, archive/restore; client sees only allowed files, switching rows never leaks drafts. |
| WIKI | Operator/client / Company wiki | Open the Markdown document, import/edit/download allowed prose, close/reload, preserve text during live source updates; client admin rights and audited impersonation hold. |
| REQUEST | Operator/client / Requests | Create a synthetic request, edit shared details/status, verify the client allowlisted view, archive if supported; `private.md`, proposals, and market activity never appear for client or broker. |
| PACKET | Operator / Request packet | Import/edit/download `private.md` and `public.md`, immediate close/reopen, concurrent stale edit retains draft, verify filename-fixed readership, verify existing links update after shared edits, file additions and visibility changes; public page excludes `private.md`; explicit link replacement revokes the old URL. |
| PROPOSAL | Operator / Proposals | Choose branded broker, edit request-specific contacts, upload multiple/revised PDFs, reject invalid files, inspect PDFs/Terms tabs, review gap and stale packet revision; no selection/binding during QA. |
| EMAIL | Operator / Request correspondence | Inspect forwarding address, imported synthetic email and attachment, file to correct broker/request; ambiguity requires explicit selection and replay cannot duplicate records. |
| CONNECT | Client / Vendors and Clients | Inspect empty/populated lists, create local synthetic connection request, view/revoke pending request, inspect shared policy access; exercise invalid public request token. |
| ORG | Client / Settings organization | Edit name/website and company Markdown, verify autosave and required-field errors; branding and access stay standalone. |
| SETTINGS | Client / Agent and workflow settings | Exercise each visible tab, wiki/channels/behavior, certificate settings, notifications and beta flags; persist reversible local toggles and restore. |
| NOTIFICATIONS | Client / Notification tray | Inspect empty/populated tray, open a scoped record link, mark individual/all items read, reload and verify persisted state; synthetic local items only. |
| INTEGRATE | Client / Mailboxes and integrations | Open create/detail panels, validate missing/invalid input, inspect disconnect/recovery and OAuth denial; mark external authentication untested without a disposable account. |
| CHANNEL | Operator / Channels | Inspect Slack/iMessage/MCP setup and linked identity, edit reversible local identity and restore; exercise mock Slack where configured; do not send to live channels. |
| GWORKSPACE | Operator / Channels and agent | Sign in with captured local OTP, configure manual and Directory mailbox modes in the Google Workspace tab, verify validation, persistence, disabled/missing-credential failures, role boundaries, and the shared operator tool registry. Exercise a synthetic registered-tool model path and protected attachment behavior without Gmail writes; report live delegated-mailbox search/read/download as blocked unless an authorized service-account credential is present. |
| GWSCAN | Operator / Channels and affected records | Use the read-only `scan_workspace_mailbox` operator tool; [retired scheduled-scan coverage](workspace-scan.md) is historical. Verify access control and confirm there are no writes or sends. |
| ROUTING | Operator / Routing | Inspect routing call history, filters, and details; verify long data/mobile rendering. Model and web retrieval settings have no UI. |
| TELEMETRY | Operator / Telemetry | Switch extraction/model views, inspect empty/populated failures and drill-down, verify recoverable errors and navigation. |
| WEBMCP | Agent / signup, onboarding, client workspace | Run `node scripts/webmcp-e2e.mjs --seeded-client adyan@cove.dev`. Declarative signup/login/onboarding tools respond with structured results. A brand-new business reaches its workspace without an invite. Every client UI action runs directly as a tool through the UI's Convex functions. Tools register only for onboarded clients on their pages, with admin tools for admins only and read-only hints on reads, and all unregister on sign-out. |
| PUBLIC | Anonymous / share, OAuth, weather | Inspect valid synthetic packet/email/iMessage links where fixture exists; invalid tokens fail safely, OAuth invalid requests disclose no secrets, weather renders responsively. |

## Coverage ledger

A page-load sweep is discovery, not a passed use case. Each row needs an actual
outcome and evidence before being marked passed. Prior procurement QA is useful
baseline evidence, not a substitute for this run's regression checks.

| IDs | Status | Evidence / findings |
| --- | --- | --- |
| AUTH, ONBOARD | Passed exercised local paths | Invalid email/OTP, valid captured OTP recovery, protected route/logout, fresh signup and reload passed. Fixed retired operator-only upload offered during client onboarding and removed single-choice signup detour. Expiry/rate-limit simulation remains untested. |
| BROKER, BPROFILE | Partial pass | Autosave/error/filter persistence and role boundary passed. Standalone supplier creation and SVG logo upload passed; retaining the new editor while its status is filtered out passed. Same-field concurrent edits remain untested. |
| TEAM | Passed exercised shared workflows | Client and broker keyboard member editing/invite/cancel passed. Client acceptance, role changes, primary contact, email-change cancellation, removal/fallback passed. Hidden service-account admin regression covered. |
| THREAD | Passed exercised local workflows | Sidebar keyboard opening, archive/restore, full conversation navigation and grounded operator policy task passed after local model setup and rich-tool argument fix. Stop persists as cancelled after reload; a subsequent turn succeeds. |
| PROFILE | Partial pass | Operator/client name persistence, invalid-phone recovery, appearance and mobile rendering passed. Privacy/email panels inspected; irreversible account deletion excluded. |
| POLICY, CERT, FILE | Partial pass | Client read-only policy details/source preview, client allowed-file isolation/download, synthetic certificate generation/version 2/download/archive/restore passed. Fixed PDF Download opening tabs and client read-only visibility switch changing visually. Operator storage-failure/retry/extraction, correction persistence and file lifecycle passed; requirement-backed certificate launch correctly blocked when evidence is insufficient. |
| WIKI, ORG, SETTINGS | Passed exercised edits | Wiki immediate-close/offline/retry and required-name validation passed; behavior/certificate/beta toggles restored. Notification autosave and restoring inherited defaults passed. |
| INTEGRATE, CONNECT | Partial / external prerequisite blocks | Invalid vendor input and local pending invitation creation passed; cancel/sidebar and invalid mailbox inputs fixed and browser verified. Live IMAP/OAuth/Slack reinstall requires disposable credentials. |
| CHANNEL, ROUTING, TELEMETRY | Passed exercised local flows | Local identities, read-only routing/models/telemetry, grounded mock Slack and operator terminal turns, browser thread mirrors, real local MCP consent/read/revocation passed. Native-local model configuration only; live channels excluded. |
| GWORKSPACE | Passed exercised dev DWD and local paths | Rendered native-local operator setup, authorization, validation, manual/Directory persistence, disabled and incomplete-credential behavior, compact settings rendering, live delegated Directory verification, bounded mailbox listing/search/thread reads, current-context reasoning, and five protected originals passed. The actual registered model followed short continuations and attachment references. Cross-channel registry, replay, revocation, and protected-original boundaries also passed focused automated coverage. User-visible desktop Chrome was not run because this cloud workspace exposes no desktop/browser control. |
| PUBLIC | Passed exercised public paths | Invalid/revoked links and missing/unknown OAuth clients fail safely; routing-weather report responsive. Valid packet snapshot download, immutability and private-file exclusion passed. |
| CLIENT, COMPLIANCE | Passed exercised edits | Synthetic operator client/supplier creation, client search, website/name autosave and restoration passed. Manual requirement/source autosave, invalid-draft recovery, accurate evidence gap, disabled certificate generation and archive cleanup passed. Operator policy upload/retry is recorded in POLICY. |
| REQUEST | Partial | Client seeded packet exposes `public.md` and allowed files without `private.md`, proposals, or market activity. Synthetic client request submitted and persisted in list; attachment sidebar/upload-failure recovery/download and direct navigation after creation passed. |
| AGENT | Passed exercised local flows | Client policy question returns correct seeded declarations/limits and survives reload; cancellation, archive/restore and mobile rendering passed. A synthetic PDF can be staged/removed/restaged, read accurately, reopened from history and previewed after reload. |
| PACKET, PROPOSAL, EMAIL | Passed exercised local flows | Packet-file autosave, immutable/revoked snapshots, public download/privacy, proposal gap/staleness, two-PDF extraction/review and email replay/classification/revision/download passed. Concurrency/failed-switch safeguards covered by focused tests; advanced edges listed below. |
| LEADS (historical; public demo removed) | Passed synthetic populated lifecycle before removal | Keyboard detail opening, stored lead facts/conversation, delete cancellation, confirmed deletion and mobile rendering passed. Internal fixture creation does not prove live public-demo ingress. |
| WEBMCP (historical catalog) | Passed scripted headless run (September 24, 2026), with model steps blocked | 171/174 checks passed. The other 3 were blocked because the local router rejected every job with 422: deeper requirement check, requirement import, and agent drafting. Artifact: `.context/qa/webmcp/results.json` plus screenshots. The run executed 95 imperative and all 7 declarative tools against native-local Convex, with email in capture mode. Policy upload: the client drawer, `upload_policy` combined/separate/duplicate/non-PDF, a member-role upload, own-upload archive/restore/cancel, extraction started, and Archive shown only on client uploads. Direct Convex calls: operator upload still works; connected clients, broker orgs, staff-upload archive, and extraction on another user's policy are rejected. Extraction completion needs the extraction worker, which was not running. Not executed: Slack, IMAP mailbox, and destructive profile deletion. It used a stub `modelContext`. |
| NOTIFICATIONS | Passed local tray workflow | Empty baseline and two synthetic user-scoped items; opening a thread marks one read, mark-all clears the badge, both read states persist after reload. No outbound deliveries. |

## Batch 1: broker editing and reusable method

Observed before: Website edits disappeared on sidebar close, profile forms
required Save, and filtered list membership controlled the selected editor.
Broker mutations rewrote unrelated profile fields, and a broker admin could
supply a new network status. Browser editors now autosave field-specific edits;
logo updates touch only the logo; selected details survive filter changes;
network status changes require an operator. The broker table emphasizes name,
status, writing states and lines, with secondary activity in the sidebar.

Design review inspected desktop light/dark, broker profile, and 390px sidebar
screenshots. Deslop removed duplicated hand-written query DTOs and the old
subscription-reset effect that could erase an active broker draft. Verification:
28 procurement-domain tests (including partial-update/status authorization
regression) and four autosave sequencing tests passed. Root/Convex TypeScript,
changed-file ESLint, production build, and `git diff --check` passed.

Evidence: `broker-before.png`, `broker-autosave-after.png`, `broker-mobile.png`,
`broker-dark.png`, `broker-profile-after.png`; browser scripts and check logs
are under `.context/qa/platform/`. Temporary broker website/status changes were
restored. The new skill passes the skill-creator validator.

## Batch 2: threads and team management

The thread inbox now retains list context while showing the shared conversation
renderer in a sidebar. Archive/restore and full conversation navigation use its
footer. Team profile edits autosave partial field changes; changing access
roles remains explicit. Pending invitations have a keyboard-accessible sidebar
with cancellation in its footer; member activation and account actions move
out of rows into the member footer. The table emphasizes identity/email/access,
with phone in the editor. Broker navigation waits for organization identity and
skips forbidden tenant-thread subscriptions.

Screenshots: `thread-restored.png`, `thread-mobile.png`, `team-autosave-after.png`,
`team-pending-invitation.png`, and `team-mobile.png`. The local QA invitation was
cancelled and the client's title restored. Operator chat testing produced an
honest failure: local `resolveOperatorAgentRoute` reports no configured model.
That attempt was not a successful agent workflow; local model configuration
and the grounded rerun passed in Batch 3. Client settings navigation discovery covered every exposed settings
tab, with screenshots/text recorded; those loads are not mutation coverage.

A second-person invite exposed hidden Slack service-account membership in
primary-contact and last-admin logic. The backend now counts human memberships
for demotion/removal and fallback, and rejects service accounts as explicit
primary contacts. The regression suite covers those access/data consequences.

Batch 2 validation: 34 focused tests passed (29 Convex domain/access tests,
four autosave sequencing tests, one team failed-save/retry test). Root and
Convex TypeScript, changed-file ESLint, production build and diff whitespace
checks passed. Design review covered the thread/team desktop and mobile
screenshots, and team dark mode. Deslop reused the shared conversation and
input components, removed row event guards made obsolete by removing actions,
removed the now-unused phone formatter, and avoided viewport-height arithmetic.
The accepted synthetic member and its pending email change were removed; the
original client is now the persisted primary contact. Synthetic user/auth
records remain local. Do not reset the fixture database to clean up QA.

## Browser continuation

Persistent operator Chrome uses CDP9222/profile `.context/qa/chrome`; client uses
CDP9223/profile `.context/qa/platform/client-chrome`; the procurement lane uses
CDP9224/profile `.context/qa/platform/public-chrome`. Browsers close at safe
checkpoints to release memory. Reopen only the active role profile. Earlier
storage snapshots may be stale. A missing fresh OTP capture is an execution
failure, not evidence that authentication or rate-limit behavior passed.

## Batch 3: local workflow repairs

Browser evidence exposed broken broker Team context wiring, forbidden client
onboarding upload, wiki/notification close-loss, silent empty organization
names, PDF downloads opening tabs, and operator rich reads passing an unexpected
idempotency argument. Repairs reuse existing contexts, auth entrypoints, autosave,
blob downloads, and the audited action boundary. At the time of this historical run, the native-local operator Models view selected the existing OpenAI GPT 5.6 Terra route; a fresh browser task returned
Cove limits grounded in Declarations page 1. Shared router configuration was not
changed.

`SettingsDrawer` now supplies dialog naming, focus entry/restoration, and Escape
through the caller's save guard. Its explicit sidebar portal avoids body-level
layout shifts; the nonmodal design preserves sibling PDF previews. Actual footer
mount/resize measurements keep toasts above actions. Browser testing caught and
fixed transient missing-portal, placement, and footer-measurement regressions
before delivery. The drawer regression test checks containment and keyboard focus.

Evidence includes `certificate-generate-after.png`,
`certificate-generate-mobile-after.png`, `certificate-version2.png`,
`client-file-preview-after.png`, `settings-wiki-after.png`,
`settings-wiki-dark-after.png`, `public-broker-team-mobile.png`,
`public-onboarding-after-mobile.png`, and `operator-chat-rich-fixed-outcome.png`.
Detailed independent scripts/results are in `public-auth-findings.md`,
`settings-connections-findings.md`, and `operator-findings.md` under the evidence
directory. Temporary certificate is archived; wiki text and profile edits are
restored. Synthetic signup accounts/organizations remain local and named as QA.

Two broad route sweeps exhausted VM memory, interrupting browser/dev/X processes.
The native-local database and browser profiles survived. Cloud development now
sets a 2 GiB Turbopack cache target; builds run separately from development to
leave room for role-specific visible Chrome. Interrupted attempts are not passes.
Restart the existing services/profiles, never setup/seed-reset for cleanup.

## Settings and connection follow-up

Visible client Chrome verified wiki immediate-close autosave, invalid-draft
retention, offline/reconnect recovery, and Escape closure after correction.
Organization names reject whitespace with accessible feedback. Notification
sidebar toggles persist on close; **Use defaults** removes the current user's
event overrides, and **Use Spot defaults** restores severity-based defaults for
an entire channel. Both inheritance paths survived reload and restored the
fixture's original notification behavior.

Connection rows now open a keyboard-accessible detail sidebar. Request context,
compliance information, and footer actions share that sidebar. The synthetic
vendor invitation was cancelled from its footer and remained revoked after
reload; its row contains no actions. Tenant-admin cancellation and relationship
revocation invalidate pending invitation access and OTPs atomically. Focused
Convex tests cover tenant/admin isolation, token reuse rejection, and notification
reset isolation. A revoked synthetic audit row remains locally.

Mailbox creation now uses native form validation. Cloud Chrome rejected an
invalid email and ports 0, 65536, and 1.5, focusing the invalid field before any
connection action; correcting to a valid email and port 993 passed validity.
Live IMAP account connection, external MCP OAuth, and Slack reinstallation remain
blocked by disposable account/provider prerequisites and were not marked passed.

Design review covered desktop light/dark and 390px connection/wiki sidebars.
Evidence and exact scripts: `.context/qa/platform/settings-connections-findings.md`,
`settings-followup-results.json`, `settings-vendor-invitation-sidebar.png`,
`settings-vendor-invitation-revoked.png`, `settings-vendor-mobile-after.png`,
`settings-vendor-dark-after.png`, `settings-notification-defaults-restored.png`,
and `settings-mailbox-validation-after.png`. Idle Chrome9225 was closed after
this checkpoint to release memory.

Batch 3 validation: 43 focused tests across nine files passed, including rich-tool
execution/audit replay, invitation/token revocation, notification inheritance,
wiki/compliance draft recovery, and sidebar focus/containment. Root and Convex
TypeScript passed; changed-file lint and diff whitespace checks passed. Production
build passed before final small browser-polish edits, which passed subsequent
TypeScript and focused checks. Deslop removed unused onboarding upload code,
manual save state, and unrelated formatter churn; frontend-design reviewed actual
desktop/mobile/light/dark evidence. Client creation remains without implicit
invitation; new broker profiles retain their editor for adding a logo.

The reusable skill now includes `scripts/watch-memory.mjs`: samples every 15s,
logs available memory, pauses new work below 4 GiB, and prioritizes controlled
cleanup below 2 GiB. Run `--once` between workflows. Idle role browsers were
closed at verified checkpoints; never clear auth profiles or local data. Current
browser continuation uses operator9222 and client9223; public9224 and settings9225
are intentionally closed. Resume them only when their lane is active.

## Batch 4: uploads, request files, and client conversations

The operator policy uploader used to clear staged PDFs and close even when its
callback caught an error. Both upload surfaces now clear only on explicit success;
one progress toast becomes the error on failure. A synthetic storage503 retained
the PDF, retry completed real local extraction, and the policy correction editor
persisted a premium change before restoration. Operator Details now reuses the
shared typed details/editor; raw extraction inspection remains in Extraction
history. Client policy Details remains read-only. Client Overview uses its
breadcrumb identity and shows required-name errors inline.

Client request creation now navigates directly to the created record. Request
file rows open a sidebar with preview/download; Add file opens a staged sidebar
uploader. Browser testing proved that the previous raw storage link navigated
away instead of downloading. The shared blob download now keeps the app open;
a503 upload failure keeps the selected file, and retry succeeds. Request editors
are keyed by request ID. Shared dropzones ignore drag/drop while disabled, so
another drop cannot replace an upload in progress.

A real client policy question returned the seeded policy number, insurer and
E&O/cyber/media limits; reload retained the answer. A subsequent read-only turn
was cancelled and displayed Response cancelled. Thread archive/restore and mobile
rendering passed. Archived list rows now navigate to their conversation; restore
uses its existing action instead of an extra hover button in the list. Archive
uses the destructive PillButton treatment.

Evidence: `request-file-before.log`, `request-upload-failed-after.png`,
`request-upload-retry-after.png`, `request-created-after.png`,
`request-upload-dark-after.png`, `request-upload-mobile-after.png`,
`client-agent-progress.png`, `client-agent-cancelled.png`,
`client-agent-mobile-after.png`, and `client-policy-read-only-after.png`.
Operator cases and synthetic fixture IDs are in `accounts-files-policy-findings.md`.
The client QA conversation and compliance records are archived; two named client
requests and an isolated operator QA client/policy remain local for regression.

Validation: 31 policy-upload/domain tests passed, plus the disabled-drop regression;
root TypeScript and changed-file lint passed. Frontend-design inspected the
rendered client/record/editor/upload light/dark/mobile cases. The independent
deslop review removed the redundant archive mutation path and found the disabled
drop and destructive-icon issues before commit. The memory watcher remained
active; idle role browsers were closed at successful checkpoints.

## Later memory checkpoint

At 3.35 GiB available, new browser work paused. The procurement browser closed
after its completed email assertions; the channel browser closed after lead
cleanup. Extraction logs and the local proposal job audit confirmed no pending
extraction before the development group restarted. Available memory recovered
to 14.18 GiB. Persistent sessions and database contents were retained. The
Turbopack setting controls its cache target, not total Next server RSS; stagger
type checks, browser lanes and builds even when that setting is enabled.

## Batch 5: procurement correspondence and channel completion

Imported email rows now open by keyboard. Classification autosaves; close and
email switching wait for a successful save. Failed drafts remain visible,
acknowledged fields no longer overwrite a later operator's changes, and newer
edits survive an in-flight save. Read-only previews close normally. Downloads
use the shared download owner. Filing attachments against a reviewed proposal
explicitly creates a revision with the exact superseded proposal ID; selected
proposals remain protected. Redundant classification/reconciliation headings
are removed, with decision-relevant ambiguity and revision information retained.

The packet pass verified `private.md` and `public.md` persistence, immutable old snapshots,
revoked rotated links, anonymous PDF downloads and private-file exclusion.
Original packet text was restored. Two synthetic proposal PDFs completed real
local extraction and review; insufficient evidence remains unverified and no
proposal was confirmed, selected or bound. The seeded review correctly became
stale after packet changes. Synthetic forwarded-email replay remained one event.
Both Client/Broker file switches persisted through close and reload; a regenerated
public snapshot excluded the file while sharing was disabled and included it
again after restoring the original settings.

Mock Slack and operator terminal turns returned grounded policy answers, with
matching browser history. Slack evidence recovery now names an available policy
tool rather than allowing a reaction instruction to consume its retry; tests
also prove a prior write prevents retry. Terminal admission uses Spectrum's
transport predicates, fixing silently ignored terminal messages. Nullable policy
filters now behave as omitted filters, while actual expiry windows still apply.

Real local MCP consent, read tools and policy lookup passed. Revocation accepts
form-encoded access/refresh tokens and invalidates their stored pair, preserving
legacy Bearer requests. A supplied mismatched client cannot revoke another
client's token. Expected grant failures use structured Convex errors, so a revoked
refresh token returns OAuth `400 invalid_grant`. The final native check confirmed
policy lookup success, revoke 200, subsequent access 401 and refresh 400. All
temporary OAuth tokens were revoked; raw tokens were not retained in artifacts.

Demo leads now expose recorded facts above the conversation and keep deletion
in the sidebar footer with confirmation. Synthetic lead deletion/cancellation,
keyboard and mobile cases passed. The notification tray persisted individual
read/read-all state. Client PDF chat staging, exact attachment facts, preview,
reload and archive passed. Operator cancellation persisted across reload and
allowed a later turn; archive now uses the destructive footer treatment.

Final evidence: `procurement-regression.md`, `channel-leads-findings.md`,
`thread-attachment-cancel-findings.md`, `mcp-form-revoke-retest.json`,
`public-procurement-email-final-mobile-dark.png`, `leads-after-mobile.png` and
`channel-terminal-browser-mirror.png` under `.context/qa/platform/`.

Remaining coverage limits: no live IMAP/OAuth-provider connection, Slack
reinstallation or Photon traffic; these need
disposable external accounts/authorization. No binding, selection or account
deletion was attempted. Expired-by-clock snapshots/OTPs, same-field broker races,
two-browser stale packet editing and broker-specific snapshot variants were not
re-exercised in this continuation. Email race/failure boundaries have automated
coverage; the browser verified normal classification persistence. The lead
“dark” screenshot was still light, so lead dark mode is explicitly not claimed.
The source reports record retained synthetic fixtures and restored values.

Final validation passed: 66 focused regressions across 15 files, root and Convex
TypeScript, changed-file ESLint, the iMessage worker build, production Next build,
shared-package version alignment, skill validation and diff whitespace checks.
Frontend-design inspected actual desktop/mobile and applicable dark screenshots;
deslop review checked draft/write boundaries, revision guards, token revocation
and transport isolation. All 29 workflow groups now have recorded local outcomes
and explicit coverage limits. Observed actionable defects from this run are
resolved. Browser profiles/database remain intact; temporary browsers and the
terminal closed before final validation. The memory watcher continues sampling.

## Batch 6: operator Google Workspace Gmail

This pass used the preserved native-local database and normal captured-OTP
operator sign-in. Rendered Chrome verified the operator-only Google Workspace
tab, manual mailbox normalization and deduplication, Directory administrator
validation and normalization, failed-save draft retention, disable/re-enable,
missing and incomplete credential states, verification invalidation after a
credential revision change, and tenant denial. The settings surface also rendered
at 390 by 844 after the normal operator-agent overlay was minimized. Synthetic
settings and credential values were removed before a separately authorized live
delegated-development credential was provisioned memory-only from the shared dev
environment. That credential was removed after acceptance, and the local
integration finished disabled.

The first manual-mode verification failure returned zero checked mailboxes but
showed no reason. A shared typed, sanitized aggregate error and credential-health
presentation fixed the defect. Focused rendered retests then showed malformed
JSON as **Credential incomplete** with verification disabled, while a synthetic
metadata-present credential with an invalid key allowed an explicit verification
attempt and displayed the safe incomplete-credential reason in diagnostics. No
credential payload appeared in the UI, model output, audit evidence, or tracked
artifacts.

A real local operator-agent turn selected `list_company_mailboxes` through the
shared registry. Stored message metadata recorded exactly one tool call. The
operator audit recorded an authorized read-capability attempt on the chat channel;
it failed before provider access because the synthetic credential was incomplete,
and the model accurately reported that no mailbox results were returned. This
passes model selection, tool registration, audit wiring, and fail-closed behavior;
it is not evidence of delegated Gmail access. Focused automated coverage verifies
the same four read tools across chat, Slack, iMessage, and MCP, including greater-
than-8-KiB replay, disabled-operator revocation, mailbox/thread ownership,
protected operator-thread attachment delivery, replay, and absence from tenant
files.

The authorized live continuation then verified the Directory subject and every
eligible mailbox without exposing credentials. Exact backend cursors completed a
bounded all-mailbox search with zero mailbox errors, and bounded thread reads
returned complete bodies and attachment metadata with mailbox, message, thread,
and MIME-part provenance. Private oracle checks confirmed that the model used the
newest available source, did not revive answered questions from quoted history,
kept a withdrawn option distinct from preliminary activity, and used the current
deadline. Only redacted counts and statuses are tracked here.

Two model-boundary defects were reproduced before repair. First, model-emitted
`null` values for optional fields failed strict leaf validation; `79275b8`
normalizes only omittable nulls while preserving clearable nulls, and `25a18ed`
keeps nonempty-update checks correct after normalization. Second, the model
altered long opaque provider cursors and attachment IDs even though full action
audits proved the backend values were lossless. `8f7e95c` returns short,
authorization-bound continuation references while retaining raw signed cursors
in the backend audit, and `674f006` exposes unique parent-local MIME-part
references while keeping provider attachment IDs backend-only. The unchanged
prompts then completed mailbox continuation and retrieved all five expected
originals. Each original matched private filename and size-band expectations,
matched freshly read parent provenance, produced a bounded extraction outcome,
registered to the protected operator thread, and rendered an authorized link.
One PDF original opened through the existing preview and exposed its download
control. No base64 or public URL reached the model.

| Outcome | Cases |
| --- | --- |
| Passed | Rendered OTP/setup and configuration workflows; manual and Directory validation/persistence; draft recovery; unauthenticated, tenant, disabled-config, incomplete-credential, and disabled-operator boundaries; live dev DWD Directory verification; bounded all-mailbox listing/search/thread reads with explicit completeness; current-context model reasoning; five parent-bound protected originals with bounded extraction and rendered preview; synthetic cross-channel, replay, revocation, and attachment assertions. |
| Failed, then fixed and passed | Manual-mode zero-checked verification lacked an actionable reason; the sanitized aggregate diagnostic passed rendered retest. Model-emitted optional nulls initially failed validation, and long opaque cursors and attachment IDs were altered in later model calls; omittable normalization plus short authorization-bound continuation/MIME-part references passed the unchanged live prompts. No unresolved defect remains from the exercised cases. |
| Blocked | None in the authorized live delegated-development acceptance. Production provisioning and post-deploy verification belong to the root release workflow and are not claimed by this workspace. |
| Not run | User-visible cloud desktop Chrome because no desktop/browser-control surface is available; live Slack, iMessage, or MCP traffic; Gmail sends, labels, scheduling, ingestion, or production writes. Headless system Chrome supplied rendered supplemental evidence only; cross-channel behavior is automated evidence rather than live traffic. |

Private screenshots, browser scripts, redacted prerequisite notes, and model/audit
checks remain under `.context/qa/google-workspace/`. The tracked scenario contains
no live mailbox addresses, message/thread identifiers, filenames, transcripts,
insurance facts, or credentials. Integration-owner validation on the preceding
checkpoint passed 103 files and 299 tests, native-local Convex deployment, app
TypeScript/build, and changed-source ESLint; the retained provider, verification,
header-parser, replay, attachment, and authorization updates subsequently passed
103 files and 300 tests plus native-local Convex deployment. The final integrated
model-boundary and short-reference changes passed 103 files and 304 tests, their
focused runtime/auth/replay/checkpoint regressions, application build and
TypeScript, changed-source ESLint, diff checks, and native-local Convex codegen,
typecheck, and deployment. Those full checks were not redundantly rerun in this
workspace.


## Workspace scan coverage

The scheduled Workspace scan was removed. The [historical ledger](workspace-scan.md) is retired; current acceptance should invoke the read-only `scan_workspace_mailbox` operator tool with an authorized operator, then verify that no request, policy, or outbound message was created. Agent-scheduled workflows are tracked in Linear CLA-171.

## Historical cloud live-review setup — September 14, 2026

This section records behavior before Convex section extraction and removal of the operator Models UI. Its parser and model-setting steps are no longer runnable acceptance procedures.

This run prepared a live review environment in the cloud workspace.
It does not replace the platform-wide coverage ledger above. Screenshots,
browser scripts, persistent profiles, redacted diagnostics, and restart
instructions are in `.context/qa/live-review/`. Credentials and OTPs remain
untracked. The interactive desktop viewer uses workspace port 6080; the app uses
8080 with the preserved native-local Convex database on 8083/8084.

| Case | Actions / observed result | Status |
| --- | --- | --- |
| Desktop | Connected through password-authenticated noVNC to headed Chrome on display `:99`; a coordinate mouse click through the desktop viewer changed the broker Team page to Profile. Evidence: `desktop-viewer.png`, `viewer-check.mjs`. | Passed |
| Role sign-in | Requested fresh captured OTPs for the operator, Cove client, and Montgomery Risk broker in separate persistent Chrome profiles; all reached their expected portal and retained sessions after reload. Evidence: `operator-reload.png`, `client-reload.png`, `broker-reload.png`. | Passed exercised paths |
| Seeded review | Opened the operator renewal request, packet, private proposal with gap status, and its PDFs sidebar. Client request showed its shared packet and two shared files. Evidence: `operator-packet.png`, `operator-proposal.png`, `9223-inspect.png`. | Passed read-only paths |
| Client boundary | Client renewal detail contained shared packet/files and no proposal or market controls. Seeded policy card matched expected carrier and policy number. Backend authorization attacks and exhaustive policy editing checks were not part of this setup. | Passed visible boundary only |
| Broker boundary | Profile and Team showed the seeded broker/admin with profile/team navigation. No procurement navigation was exposed. Evidence: `broker-reload.png`, `desktop-viewer.png`. | Passed visible boundary only |
| Service readiness | Local Convex agent health reported `ok: true`; extraction, mock Slack, customer terminal iMessage, and operator terminal iMessage reported healthy local operation. Email remains capture-only. | Passed |
| Historical native PDF conversion (retired worker) | Initial HTTP conversions failed because Amazon Linux glibc was too old for LiteParse. An isolated workspace-local glibc 2.41 loader repaired the worker launch; authenticated synthetic PDF conversion returned 200, expected text, two source spans, and one page image. Evidence: `parser-result.json`, `parser-smoke.mjs`. | Failed setup prerequisite, repaired and passed |
| Historical operator agent setup | Required local operator route was initially unset. Selected OpenAI `gpt-5.6-terra` through the rendered Models tab, verified persistence, then submitted a read-only policy lookup through the portal. The response matched the seeded Cove policy and carrier. Shared router policy was unchanged. | Passed |

The clearly named local QA agent thread and required local model selection are
retained for review. Existing business fixtures and database were preserved.
At the end of the run, all local services and three headed Chrome profiles were running. The
workspace-local README includes restart commands and profile switching.

No platform-wide editing, upload/extraction lifecycle, invalid-OTP recovery,
protected deep-link attack, public snapshot revocation, full model/tool sweep,
mobile/theme, or real external channel acceptance is claimed. No live outreach,
production mutation, binding, or deployment was performed. The desktop
viewer itself was checked using a separate headless browser; all product checks
used the actual headed Chrome profiles, including desktop mouse control.

Validation: authenticated service checks, rendered role/session checks, a real
router-backed read-only agent response, synthetic native PDF conversion, and
`git diff --check`. This setup phase changed only documentation; the subsequent
UI fixes and their validation are recorded below. Memory remained above the workflow's
4-GiB pause threshold.

### Desktop mouse-and-keyboard continuation

At the user's request, the continuation drove the actual cloud desktop through
noVNC using coordinate clicks, scrolling, and keyboard input, inspecting desktop
screenshots between steps. CDP was used only to bring an existing signed-in role
window forward. `desktop-control.mjs` controls the desktop viewer, not the app DOM;
`desktop-actions.jsonl` records the inputs and screenshot names.

| Workflow | Observed outcome | Evidence in `.context/qa/live-review/` |
| --- | --- | --- |
| Proposal review and source | Opened Terms, inspected the unconfirmed cyber gap, followed Open evidence to page 1, and read the synthetic quote showing CAD 2 million offered versus CAD 3 million requested. | `desktop-02-terms.png` through `desktop-04-evidence.png` |
| PDF download | Used Chrome's PDF download control and native Save dialog; Chrome reported Done and the saved synthetic PDF was present at 1,412 bytes. | `desktop-05-download.png`, `desktop-06-saved.png` |
| Contact autosave | Changed the proposal contact from Terry Wang to Terry Wang QA, immediately closed/reopened, reloaded Chrome, reopened, and verified persistence; restored Terry Wang and verified reopen. | `desktop-08-contact.png` through `desktop-12-restored.png` |
| Client review | Inspected the shared request, navigated to the final policy, opened Coverages, and displayed the source PDF beside matching limits. | `desktop-13-client.png` through `desktop-18-policy-source.png` |
| Client access boundary | Typed the operator Clients URL in the client browser's address bar; the app returned to the client's Policies page. | `desktop-19-client-boundary.png` |
| Broker team | Opened the own-member sidebar; self-role control was disabled. Opened Invite, submitted an invalid email, and observed native validation with no invitation created; closed the draft. | `desktop-20-broker-team.png` through `desktop-25-invite-closed.png` |

Two visible UX defects were reproduced and have now been fixed:

- **Broker invite role descriptions were stale.** Member copy claimed policies and
  agent access, and Admin copy mentioned connections/settings. This contradicted
  the current broker profile/team-only boundary. Reproduce: broker → Team →
  Invite member → toggle Member/Admin. Evidence: `desktop-22-invite.png`,
  `desktop-24-admin-copy.png`. This is an observed copy defect, not evidence of
  an authorization bypass. The shared invitation drawer now receives the target
  organization context and shows broker-specific Member/Admin descriptions.
  Client and operator-managed client invitations retain the client descriptions.
- **Broker navigation highlighted Profile and Team simultaneously.** Reproduce:
  broker → Team, then open a member so the pointer is away from navigation.
  Both entries retained the selected background. Evidence:
  `desktop-21-member.png`. Sidebar matching now treats `/broker` as an exact
  destination and checks path-segment boundaries for nested destinations.

The temporary contact edit was restored. No invitation was sent, proposal
conclusion confirmed, or coverage bound. The synthetic downloaded PDF and
screenshots remain available for review. These are bounded desktop acceptance
results; the untested platform-wide cases listed above still apply except where
this continuation explicitly records additional coverage.

Final desktop agent check passed: typed and submitted a read-only renewal
comparison using the visible composer. The completed response correctly stated
CAD 3 million requested, CAD 2 million offered, a CAD 1 million gap, and the
outstanding signed application and current loss runs. Evidence:
`desktop-27-agent-query.png`, `desktop-28-agent-result.png`.

### UI fix verification

Both reported UI defects passed visible cloud-desktop retests using mouse and
keyboard controls. Broker Team highlights only Team; broker Profile highlights
only Profile. Both broker invitation roles show profile/team permissions, while
the client invitation retains its policy/agent description. Evidence:
`.context/qa/live-review/fixes-01-broker-member.png`,
`fixes-02-broker-admin.png`, `fixes-03-profile-active.png`, and
`fixes-07-client-invite.png`.

Changed-file ESLint, `npx tsc --noEmit`, and `git diff --check` passed. No unit
tests were added for copy/navigation presentation, per the testing guide. No
backend authorization or invitation delivery behavior changed. No invitations
were sent during retesting.

### Frontend Markdown narrowing verification (2026-09-14)

Headed local Chrome passed the seeded operator packet workflow for the exact
`private.md` and `public.md` files, including Markdown import, autosave/reopen,
download naming, responsive layout, dark theme, and fixture cleanup. The seeded
client request exposed shared details without private filenames, proposals,
market activity, or visibility controls, and its creation drawer used
plain-language request copy. Mailbox copy used company-wiki terminology and the
manual compliance drawer omitted the retired “Internal notes” wording. The local
fixture had no requirement-source row, so the renamed source Notes field was not
browser-reachable; OAuth coverage was limited to invalid-client rejection, with
no external connection or grant attempted.

### OAuth and requirement-source closure (2026-09-14)

The remaining local gaps passed in headed Chrome against the worktree-native
backend. Disposable localhost-only clients dynamically registered through
Spot’s OAuth endpoint for both the seeded operator and client administrator.
Each identity completed normal OTP sign-in and consent, PKCE code exchange, an
authenticated MCP tool listing, refresh-token rotation, rejection of the old
access and refresh tokens, and final revocation. The client revoked through the
Connected apps UI; the operator used the native form-encoded revocation
endpoint. The active access and refresh tokens then failed closed. Raw codes,
tokens, verifiers, cookies, and OTPs were not retained in evidence.

A synthetic client-owned requirement source opened by keyboard and showed the
Notes field without a visibility control or the retired “Internal notes” label.
The note persisted across immediate close/reopen, its original value persisted
after restoration and reload, and the source was archived locally afterward.
No extraction, external provider, account grant, or live send occurred.

The adjacent Markdown audit found one concrete inconsistency: the company-wiki
drawer exposed a native file picker and accepted file text before parsing it.
It now uses the shared compact Import action, validates the Markdown document,
and clears rejected selections so the same file can be retried. Browser import,
autosave/reopen, reload, and fixture restoration passed at narrow dark width.
Ignored evidence is under `.context/qa/oauth-compliance-evidence/`.

## Web streaming preferences — September 17, 2026

Headless cloud Chrome with fresh captured local OTP sign-ins passed operator and
client profile checks: independently toggle Stream responses and Show thinking,
use the keyboard, reload to verify persistence, inspect desktop light and 390px
mobile dark layouts, then restore defaults. The operator agent panel was minimized
before testing the mobile profile. Evidence and scripts are in
`.context/qa/streaming/`. This VM has no visible desktop. Live provider-to-browser
streaming, inline approvals, and completion cards were not exercised by this
profile check; durable callback ordering and cancellation have backend coverage.

## Client onboarding logo import — September 24, 2026

Headless Chrome against the native-local Convex deployment used fresh captured
local OTP sign-ups for three synthetic client users. A new client entering
`vercel.com` in onboarding step 1 received a stored logo with no extra click.
An org that already had an uploaded logo kept that exact storage ID after step 1
set its website. An unreachable website produced no logo, no error toast, and a
server warning; reloading onboarding and entering a reachable website retried and
stored a logo. Settings → Organization showed no Research company action, and
Pull from website replaced the logo. Evidence, `results.json`, and the repeatable
script (`run.mjs`) are in `.context/qa/logo-onboarding/`.


## Shared shell adoption — September 24, 2026

Registry UI 0.5.0 uses package-owned sidebar restoration readiness before nested
layouts mount. Headless Chromium passed local synthetic operator/client OTP
login, client list/detail/form validation and cancel, SPA navigation, toast
dismissal, legacy collapsed/expanded migration and both toggle directions after
reload. Mobile drawers retain Spot's unblurred backdrop and 120ms slide treatment
through shared Dialog; focus entry, Escape/outside focus return, same-route close
and changed-route close passed. Opening navigation closes a competing operator
panel. Title tests cover focus, Escape/empty rejection, a second edit while an
offline save is pending, saving status, serialized reconnection and reload.
The synthetic title fixture is archived after each run; no external sends occur.

Operator navigation resize/collapse and detail keyboard resize survive reload.
The detail separator restores exactly at 961.59px after navigation expands to
289.5px, matching baseline behavior. This resolves the UI 0.4.0 restoration-order
regression without consumer-owned restoration state.

Captures cover login, OTP, home, list/detail, settings, dialog/form and toast at
1440×900 and 390×844 in both themes. All 16 light captures are unchanged above
per-channel delta 12. Dark differences affect at most 0.0781% of a capture:
primary-button text now matches the original pre-adoption background-colored
foreground instead of the initial adapter's forced black. The baseline is
`5a7a693d` (latest-main merge before shell adoption), with only the newly added
operator invitation's shared-panel import repaired for compilation.

Run against the local native Convex synthetic fixture from the developer setup:

```sh
npx convex logs > .context/logs/convex-capture.log
# In another terminal:
npm run dev
# In another terminal, run sequentially:
node scripts/qa/capture-ui-adoption.mjs .context/qa/shell/after-light http://localhost:8080
UI_ADOPTION_THEME=dark node scripts/qa/capture-ui-adoption.mjs .context/qa/shell/after-dark http://localhost:8080
node scripts/qa/check-shell-adoption.mjs http://localhost:8080 .context/qa/shell/behavior
node scripts/qa/compare-ui-adoption.mjs .context/qa/shell/before-light .context/qa/shell/after-light .context/qa/shell/diff-light
node scripts/qa/compare-ui-adoption.mjs .context/qa/shell/before-dark .context/qa/shell/after-dark .context/qa/shell/diff-dark
```

Capture the baseline with the same commands against its separate local server.
Capture/auth scripts reject non-loopback origins. `UI_ADOPTION_HEADED=1` selects
visible Chrome when a display exists; this VM has none, so all recorded results
are explicitly headless. Auth snapshots and OTP logs remain private. Screenshots,
comparison JSON, commands and the complete remaining-owner inventory are in the
[review gallery](https://41841dba-c31c-4f23-801f-78831a73c9f0.conductor.show/shell/).


Final drawer follow-up covers client and operator navigation at 390px, Escape
close, intermediate horizontal positions on both open and close with reduced
motion disabled, resize to 1440px while open, desktop click/Tab access, and
390px reopen/focus. Both roles pass in light and dark headless Chromium. The
hidden-modal risk was not reproduced before the fix; the shell now explicitly
closes at the desktop breakpoint. Frame sampling reproduced interrupted CSS
transitions from shared corner measurement; app-owned drawer keyframes preserve
the 120ms slide without disabling child smoothing or owning modal behavior.

```sh
SHELL_RESPONSIVE_ONLY=1 node scripts/qa/check-shell-adoption.mjs http://localhost:8080 .context/qa/shell/responsive-final
UI_ADOPTION_THEME=dark SHELL_RESPONSIVE_ONLY=1 node scripts/qa/check-shell-adoption.mjs http://localhost:8080 .context/qa/shell/responsive-final-dark
```

Each run saves per-role open/close animation frame JSON, resize/reopen PNGs,
a desktop settings PNG, and `responsive-results.json`. No fixture writes or
credential exports are needed for this bounded case.

## Agent activity disclosure — September 25, 2026

`node .context/activity-qa/check.mjs` exercises the real shared `ChatDisclosure`
component in headless Chrome using the bundled fixture in `.context/activity-qa/`.
Passed: activity remains expanded while working, completion collapses the content,
completed activity reopens, a resumed turn resets expansion on completion, keyboard
activation works, and reduced motion collapses immediately. ESLint passed for both
changed chat components. This isolated browser fixture does not establish full
 authenticated client/operator streaming workflow coverage or visual styling parity.

## Agent dock sidebar transition — September 28, 2026

`node .context/qa/dock-transition/check.mjs` compares the baseline and updated
`AgentDockLayout` in headless local Chrome at 1440×900 with a synthetic app
and stubbed dock controls/provider. Frame samples cover full → collapsed,
collapsed → expanded, expanded → full, full → expanded, and expanded → collapsed.
The app/card height mismatch fell from about 405px to 0px across all transitions.
Artifacts: `.context/qa/dock-transition/results.json` and the repeatable script.
This verifies the real dock animation geometry, not authenticated app workflows
or the complete sidebar. Focused ESLint passed.

## Shared browser tasks and PDF adapter — September 29, 2026

`node scripts/qa/background-tasks/run.mjs` runs the real policy upload hook and
client request detail/upload component in Chrome, with a persistent provider and
synthetic network/auth boundary. First run `npm ci` and `npm run build`; the fixture
uses the app's compiled CSS. It starts a loopback Vite server on port 4179 and
shuts down the browser/server afterward. No credentials, actual policy extraction,
external file storage or production writes are used.

Workflow: submit two policy PDFs twice in the same tick; hold storage responses,
navigate away and back, verify measured progress and a disabled upload, then
accept the extraction handoff. Completion must keep the current route and offer
an Open policy action. Cancel a hash-duplicate confirmation, fail a storage write,
and verify the upload unlocks. Start a request attachment, navigate away/back,
verify duplicate submission stays disabled, finish while away, and use Open request.
The browser log includes the intentionally injected storage failure.

Artifacts: `.context/qa/background-tasks/results.json`, `trace.zip`,
`policy-navigation.png`, `policy-handoff.png`, and `request-result.png`.
This is browser integration coverage with actual Spot UI, not authenticated
Convex E2E or evidence of backend extraction completion. The shared clarity-ui
suite separately verifies native reload warnings, result/error/partial counts,
retention cleanup and late completion after provider teardown. No unit tests
were added. Chrome is headless because this VM has no desktop display.

The PDF adapter preserves Spot's context and panel props. Shared PDF behavior was
browser-validated by the manager; Spot's typecheck and production build validate
the re-export against the released dependency. No separate authenticated Spot PDF
workflow is claimed by the upload fixture.

Recorded validation with registry `@claritylabs-inc/ui@0.10.0`: clean `npm ci`,
production `npm run build` (including TypeScript), focused ESLint, and the browser
script passed. The script also verifies separate-file policy registration/handoff
and captures `request-mobile-dark.png`. Desktop/light and mobile/dark artifacts
were visually reviewed. The package/lockfile contain registry URLs only.

Correction coverage: the same mounted uploader observes synthetic queued/preview
policy rows after upload handoff. Neither a ready nor failed notification may
appear while extracting. Later ready and failed snapshots must produce their
separate outcome notifications without navigation; clicking Open then navigates.
Artifacts: `extraction-queued.png` and `extraction-terminal.png`. The pending-ID
observer remains route-scoped and is lost on unmount; only browser upload/handoff
state survives navigation. Duplicate confirmation cancellation reports the final
message “Upload cancelled before any files were uploaded.”

Insurance intake workflow coverage and outstanding validation: [insurance-intake.md](insurance-intake.md).

### Local operator router recovery — October 15, 2026

Manually reproduced the operator failure in Helium against local Spot/Convex. Read the persisted run failure rather than treating the web HTTP 200 as agent success: first the explicit operator model route was absent, then the production router rejected the local callback host. Initialized local model settings, configured the explicit OpenAI GPT-5.4 route, and added the approved exact HTTPS tunnel host to the production router Convex callback/asset configuration and Railway worker callback/asset configuration. No provider credentials were copied into Spot. Confirmed router jobs reached succeeded and the operator run reached completed; the reply appeared in the browser. Application lookup verification uses the existing procurement tools. No automated test suite was run.

The final fresh operator chat listed all three local client organizations, read their procurement requests, compared submitted applications, and returned the latest applicant (Zac Yungblut / Tools for Enlightenment, Ltd.) with D&O limits of $500,000 and workers’ compensation marked unsure. Confirmed both persisted run status `completed` and the rendered browser reply. The exact-host tunnel remains required and running for this native-local session; its temporary hostname is not a permanent development endpoint. Railway's variable rollout rebuilt the service's configured repository source (the latest manual-model catalog commit) rather than just restarting the former CLI image; its deployment succeeded with eight replicas online.


## Structured intake refactor — October 15, 2026

Local schema/functions compiled and full TypeScript checking passed. The additive migrations component dry run and applied local run each processed 12 procurement records. Canonical accepted applications prefer the last acknowledged baseline, with original snapshots retained; administrator-owned submissions promote typed company profiles. No production migration or deployment was performed. No automated test suite was run.

The client request detail was also moved to direct structured rendering, gated by the existing shared application block with attachment references omitted from that DTO. Browser verification for this refactor is pending: the native browser tool reports the Mac is locked. Repeat the owner intake review/edit/resubmit workflow, verify draft changes stay out of operator Application and active public packets until resubmission, compare per-coverage row cards, inspect company Notes, and switch Shared preview/source without revision changes. Confirm control tags survive, authored notes remain editable, generated facts reject Markdown edits, and private notes/unreleased files remain absent from client/broker views.

Browser access resumed after unlock. Verified the existing submitted operator Application renders separate D&O and workers’ compensation cards, correct date/currency, business addresses/locations, and retained claims history. Verified Shared projection before removing its duplicate tab, with equivalent accepted facts and per-coverage tables. Company Notes renders the structured business profile; authored procurement notes remain intact. Removed Shared navigation and kept Share link on Application, with legacy URL mapping. The final owner amendment/resubmission and public-link checks remain outstanding.

Verified the updated operator Application in the native browser: compact 14px body typography, no Shared/Notes tabs, editable Internal notes above Contact details with existing private prose preserved, and only Edit request / Share link in the header. No import/download/source controls remain on procurement Application. TypeScript passed after the inline notes change.

October 15 follow-up: verified operator autosave on a disposable local request, including a vehicle with year/make but no model or VIN. The stored canonical application retained those partial details without applicant authorization being manufactured. Confirmed delete cancellation leaves the fixture intact, and confirmed deletion soft-deletes it. The disposable request was removed after QA. Verified Profile document controls appear in the navbar and Locations uses the shared 15px/500 heading style. The searchable make menu's empty live region now has zero height (7px normal search-to-first-option spacing). Commercial auto initializes one empty vehicle. All questionnaire information steps now accept skips on both the browser and server; local draft saves resumed after restarting the stalled Convex watcher. Only one relevant Skip/Continue action is rendered. Enrichment failures remain server-only and never replace entered answers. No automated test suite was run.

### Supporting documents on intake review — October 15, 2026

Supporting documents is now an always-visible artifact section, outside the questionnaire accordions and completion statuses. Review exposes categorized uploads through the existing intake upload flow, including other supporting documents. TypeScript passed. Browser verification of owner uploads before and after submission remains outstanding; the available Helium session was on an operator editing page. Repeat by opening an owned application review, confirming the section has no disclosure or status badge, uploading a document with its category, and checking the resulting file link and submitted-change state.

### Operator company fields and Notes card — October 15, 2026

Verified the local client Profile in Chrome: structured business details remain above a bordered Notes card; import, download and Preview/Markdown controls live in that card, while Edit profile remains in the page toolbar. Opened the independent Company notes source editor without changing content. Operator `update_client_business_profile` now uses the same authorized/version-checked writer as the profile editor; `get_organization` exposes the current typed business profile and tool guidance prefers structured edits over prose. TypeScript passed. Existing operator action, family and MCP catalog suites passed; orgWiki has one outdated failure expecting the removed keyword blacklist to reject policy-number prose (21/22 selected tests passed). A fresh model-driven field-edit workflow remains unverified; no existing client facts were changed during this check.

### Intake documents and admin tab cleanup — October 15, 2026

Supersedes the earlier standalone Supporting documents review treatment: request requirements and other documents now render as rows in the existing request card; policies and loss runs render in the history card. The section Edit action is the entry point for changes. Upload steps expose a right-aligned plain gray X with no Uploaded label. Owner-scoped removal detaches the intake association, hides matching current request releases, retains stored evidence and issued snapshots, and makes submitted file changes reviewable.

Verified local admin Profile pill tabs, compact logo/change control, and the responsive two-column location editor in Chrome without changing client facts. Verified procurement has one field-group tab row including Brokers, no outer Application/Files tabs, 14px row text, and requirements documents under Request details. Internal notes are in Request details and are flushed before tab changes. Operator uploads retain their section category. Operator/MCP application field tools project from the shared registry and use the existing version-checked direct editor writer. TypeScript passed. Operator actions, family selection, MCP catalog and procurement-domain checks passed (45 tests). The additional existing intake auth suite has one stale submission fixture lacking the now-required explicit applicant confirmation; 49/50 tests passed in that broader run. Owner browser removal/replacement and a fresh model-driven correction remain outstanding.

Intake follow-up: submission now retains the mounted application review after the Convex mutation instead of assigning the same URL and reloading the document. This removes the second initial-loading cycle after the reactive submitted state appears. Submission still clears local draft recovery, resets confirmation/editing state and scrolls to the top. The final upload-row treatment is a plain gray X without a status label. Requirements, policy and loss-run attachments are rows inside the existing request/history cards, without separate document headings or Update buttons.

### Procurement notes sidebar and document rows — October 15, 2026

Supersedes the inline Internal notes and separate document-table presentation above. Notes now opens beside Edit using the existing app-shell right-panel slot and `SettingsDrawer`, with the existing `PacketWorkspace` autosave/revision owner. Close and tab changes flush pending notes. Verified in Chrome that the existing private note appears in the shared resizable sidebar and the Request details card includes the insurance requirement attachment directly as a row. No additional sidebar implementation was introduced. Category-specific row uploads preserve their category; file controls retain the existing file editor. TypeScript and targeted ESLint passed; no client facts or notes were changed in this browser check.

### Always-editable admin records — October 15, 2026

Added `components/ui/inline-fields.tsx` for readable label/value cards with live controls. Client profiles and procurement applications no longer switch into Edit/Back views; normal edits use their existing autosave/revision owners, with immediate blur/tab flushes. Account identity and typed company name/website stay synchronized. Business application editing includes addresses, revenue, related entities and locations in the same business tab. Coverage selection uses a compact add selector and inline removal; existing choices use dropdowns in inline editors. Operator company notes open directly in the rich editor. Policy overview, parties and extracted breakdowns render their existing authorized editors in place. Slack member identity is directly editable rather than a separate change/save drawer. Other provider, file, team and profile editors already save directly. Destructive actions and server authorization retain their existing owners.

Verified Chrome rendering of editable procurement contact rows with no Edit button. Created a disposable local client and request through normal UI, saved a DBA by changing tabs, and confirmed `intakeBusinessProfile.answers.dba` persisted. Edited a procurement contact directly, changed tabs, and confirmed canonical `intakeSubmittedApplication.answers.name` plus incremented revision, without setting applicant submission consent. The QA client was soft-deleted; its procurement history remains retained under that deleted client. TypeScript and targeted ESLint passed. Policy UI could not be exercised locally because this deployment has no policies; existing mutation paths were retained.

Added a thin `border-border-subtle` divider above Changes to resubmit, with 24px top spacing. Targeted lint passed for that styling change.

### Profile row consistency and notes sidebar — October 15, 2026

- Account, business, addresses, related entities, revenue, and locations use the shared inline label/value row cards. Revenue now has explicit annual/projected period and amount rows; opening the tab preserves stored values.
- Related entity and location add actions live in the profile header. Removal is a labeled action inside each card. Shared row controls inherit the label body typography.
- Removed the profile Notes tab. Its header action opens the existing SettingsDrawer through the app-shell rightPanel slot, retaining the company Markdown editor, revision/autosave owner, suggestions, and import/export controls without nested panels.
- Browser checked the real local ReLease profile without editing facts: Revenue showed all four rows with existing amounts; Notes opened alongside Revenue with the existing resize handle and close/import/download controls. TypeScript and targeted ESLint passed.

### Admin field placement — October 15, 2026

- Shared inline rows retain side-by-side label/value columns, with every value left-aligned at the same edge and labels vertically centered. Dropdown chevrons are hidden until focus/open. Single-line input and dropdown heights are both 36px.
- Browser checked Revenue after tab switches: dropdown and amount fields each measured 36px, all values aligned; dropdown still opened and dismissed without changing data. Targeted ESLint passed.

- Long-text inline fields now use content sizing with a one-line minimum instead of the shared textarea two-line minimum. Their labels align to the first line as the field grows. Browser verified the existing business description is a single compact row (approximately 36px), with no fact edits; targeted lint passed.

### Procurement request row parity — October 15, 2026

- Request metadata uses the same inline row cards as Profile, including labeled/searchable policy selects, centered status display, 36px controls, and hidden idle chevrons. Document rows share the value column and have labeled Remove actions. Removed the empty questionnaire timing flag and duplicate Business details tab. Coverage limits and prose use row cards too.
- Delete request moved to the navbar, invoking the original confirmation/soft-delete flow. Browser opened and canceled that confirmation without deleting the real request.
- Request document removal is an operator-only soft detach: marks the association removed, hides client/broker releases, removes the matching intake association, bumps packet revision, and audits the operation while keeping company evidence and issued snapshots. The editor flushes pending edits first and adopts the returned request version.
- Browser verified real local request rendering without changing facts: no Business details tab or empty timing row; policy select height 36px, transparent idle border/chevron; status control/value/icon-text centers all measured 229.8046875px. Removal controls present and document labels left-aligned.
- Disposable local request association roundtrip passed: attached an existing company file privately, detached it, verified omission from request details, repeated removal idempotently, then soft-deleted the QA request. Existing file-visibility/ownership regression test passed. TypeScript and targeted ESLint passed.

### Vehicle manufacturer logo audit — October 15, 2026

- Reviewed every local manufacturer SVG. Replaced the unrelated Greater Manchester Council GMC asset with the automotive GMC mark. Removed separate captions from Acura, Chevrolet, Lincoln, Renault and Suzuki; replaced Mazda/Volvo wordmarks and the broken Peugeot wordmark with emblems. Dodge uses only its two slashes. Fiat uses its compact badge. Added Ram and Buick and enabled the previously unmapped GMC, Jeep, Kia, Mazda, Lincoln and Volvo assets.
- All 32 assets are mapped. Minimal identifying lettering remains for brands whose primary mark is lettering and inside badges. Removed the inaccurate General Motors → GMC alias. Existing make-label text and generic fallback remain. Bumped the SVG cache version.
- Repeatable visual review: run `node scripts/audit-vehicle-logos.mjs`, then open `docs/testing/artifacts/vehicle-logos/audit.html` in a browser. It embeds the current SVGs and displays each at 64px and the actual 20px picker size in both themes. `audit.png` preserves the full reviewed contact sheet (74px enlarged, 20px actual).
- Browser review covered all 32 makes, 128 image instances, zero decode failures, and verified 20×20 picker dimensions. Reviewed both halves of the grid in the local browser. SVG rasterization also decoded every file. Targeted ESLint passed with the existing Next.js native-image advisory; TypeScript passed. No business records were changed.
- Source URLs are pinned to upstream versions where replaced; modifications and attribution are in `public/vehicle-logos/sources.json`, with Cardog's MIT license retained.

### Coverage hierarchy and quiet removal actions — October 15, 2026

- Coverage Requested uses one titled row card per coverage, with limits and additional requests together. Add coverage lives in the navbar. Properties and vehicles are nested row cards with their own headings and gray X actions, preserving location/vehicle typed fields and vehicle catalog controls. Existing legacy coverage notes remain editable in one notes card when present.
- “I'm not sure” is visible only for blank/unknown limits, including the customer questionnaire. Populated amounts hide that choice.
- Shared `RemoveButton` provides accessible plain gray X actions for coverage, entity, location, vehicle, document, policy line/insured, compliance limit, and queued-message removal. Navbar request deletion and archive/confirmation workflows retain their existing semantics.
- Document labels align to the top of multi-content rows; Add document is a right-aligned secondary action. Pill typography now retains the shared role despite legacy operator-form density rules. Browser measured Add document and Share link at the same 32px height / 11.2px font.
- Browser inspected the real request without editing facts: nested Property → Location 1 card, gray header X icons, right-aligned document actions, and top-aligned document labels. TypeScript and targeted lint passed; the existing vehicle-logo image lint warning remains. Vehicle nesting uses the same card path, but no vehicle-bearing record was changed for browser QA.

### Shared request documents in context — October 15, 2026

- Shared packet navigation now says Request Details. The redundant standalone Request heading immediately before Contact details is hidden in presentation only; stored Markdown and managed markers are untouched.
- Authorized released file DTOs now include their document category, falling back to the request's staged intake association for older uploads. Requirements/supporting files render with Request details; requirements/policies with Coverage; policies/loss runs with Insurance history. The same authorized set remains available under All files at the end.
- Reuses one file-list renderer for contextual and complete lists; listed-only files remain non-downloadable, and downloads keep the existing token endpoint.
- Browser verified the existing shared request: no redundant Request heading, Request Details navigation, requirement/policy files inside Coverage, policy/loss-run files in Insurance history, and all five released files in the final list. No facts or sharing settings were changed. TypeScript, targeted lint, and the existing visibility/ownership regression passed.

- Shared attachment presentation correction: contextual files now append labeled `OperationalLabelValueRow` entries directly to the existing two-column Markdown row card, using the intake review pattern (category label and underlined document links). Removed standalone icon/download-button lists and divider strips. All files uses the same grouped row presentation. Arbitrary multi-column authored tables are preserved; sections without a compatible row card receive the shared label/value card. Browser verified Request details attachments inside the existing card, with top-aligned labels and simple filename links. TypeScript and targeted lint passed.

- Restored formation jurisdiction to the editable Business tab as State / province of formation and Country of formation rows, backed by the existing typed registrationState/registrationCountry fields with legacy formation-answer display fallback. Browser confirmed the existing client shows Ontario / Canada without changing its facts. Targeted lint and TypeScript passed.

- Formation rows now show Country before State/province, with a divider under each row. The Business editor shows FEIN only for a U.S. formation country and Canadian business number only for Canada, preserving hidden stored values. Browser verified Canada → Ontario order, both dividers, Canadian field present, FEIN absent without editing facts. Targeted lint and TypeScript passed.

### Neutral root-route loading — October 15, 2026

- `/` uses the shared RootLoading transition through authentication, organization lookup, and redirects. It renders a centered accessible Loading status with a subtle spinner, without destination-specific skeletons or app-shell navigation.
- Root route classification is shell-less; the existing intake-only redirect guard remains active for root. Customer, broker, operator, invitation, and onboarding redirect owners remain unchanged.
- Browser opened `/`: initial visible state was only Loading, then the existing operator redirect completed to `/operator/clients`. Targeted lint and TypeScript passed. No account/session settings were changed for alternate-role QA.

### Intake location layout — October 15, 2026

- Location cards now use one thin border (the shared card ring is disabled), and the questionnaire lays out all location fields vertically at full width.
- Name, address, ownership and staff inputs use the same 48px height. The shared intake count control uses compact up/down chevrons, retaining minimum-zero and integer behavior.
- Validation: targeted ESLint and TypeScript checks; browser intake verification remains manual because the available browser session is authenticated as an operator.

### PostHog browser analytics and numeric affordances — October 15, 2026

- Created the Spot US PostHog project (667578), enabled session replay for all sessions, applied Total privacy masking, and disabled console recording. Browser Activity verified pageview, pageleave, web-vitals and identified opaque-user events with sanitized `:id` routes.
- Added browser-wide analytics, explicit intake milestones, first-party ingestion/static proxy, privacy controls, and operational documentation. Production deployment and full intake success-event QA remain separate from local verification.
- Shared intake counts reveal chevrons only while the input group contains focus; native numeric spinners follow focus-only styling. Client/admin control heights remain separately owned.
- Follow-up browser verification: PostHog listed both intake and operator recordings; opened the operator replay and confirmed masked content. Bundled `posthog-js/full/no-external` after runtime recorder downloads failed. Retained structural styling attributes through a selective replay attribute mask to preserve layout while redacting content-bearing attributes.

### Admin navbar action sizing — October 15, 2026

- Centralized operator top-bar action dimensions in the existing app-shell action slot: 32px height, common horizontal padding/gap, shared compact typography, 14px icons and 32px icon-only targets. The rule overrides page-local compact/default size differences and does not affect client navigation or page content controls.

### PR #451 merge validation — October 15, 2026

- Fixed intake lint failures: mutation callback names no longer look like hooks, local-storage/handoff state updates are deferred, event-only ref callbacks have a narrowly documented compiler-lint exception, and controls use existing typography roles.
- Updated existing fixtures for explicit submission consent/revisions, current submitted-application storage, broker visibility defaults, the shared session identity helper, and Jev-owned classification/identity semantics. Authorization, stale-write, immutable-snapshot and metadata-ownership assertions remain enforced.
- Full local suite: 183 test files passed, one skipped; 1,110 tests passed, 23 skipped. Full ESLint has zero errors (10 existing warnings); router contract validation and Convex typechecking pass. Final Next.js typecheck/build and required GitHub checks are verified before merge.

### Policy savings intake — October 15, 2026

- Browser QA with a synthetic local applicant: opening purpose choice → contact → required PDF upload → business questions → review → “We have your policies” confirmation. Request timing, coverage and procurement questions are skipped. Missing policy disables Continue.
- Verified the uploaded PDF appears under the same business’s admin Policies table with client provenance. Procurement displayed “No procurement requests yet.” The synthetic PDF is not evidence of insurance; extraction completion is outside this flow verification.
- Existing intake authorization/domain tests cover owner boundaries, revision conflicts and submission consent. Savings uses the same boundaries, accepted-review uploads/removals are blocked, repeated non-resubmit submission returns the original result, and staged files link to one policy each. No new isolated tests were added.
- Local evidence: `/tmp/spot-savings-confirmation.png`; synthetic tenant: Disposable Savings Workflow QA.
- Final validation: 1,110 existing tests passed (23 skipped); ESLint zero errors (10 existing warnings), application and Convex TypeScript checks, production build, and whitespace checks passed. Changes are local on `codex/policy-savings-intake`; no production deployment was performed.

## Browser agent sidebar (2026-10-15)

Repeat with the native-local app/backend and seeded Cove fixture running:
`node scripts/browser-extension-e2e.mjs`. It builds an unpacked local extension,
loads it in installed Chrome via the browser CDP extension API, signs in with a
fresh captured OTP when needed, temporarily toggles synthetic client access and
restores it. It does not deploy or use Vercel previews. QA conversations retain
`QA SIDEBAR-427` for identification. No unit tests were added.

Artifacts: `.context/qa/extension/results.json`, `sidebar.png`, `preview.png`,
`sidebar-dark.png`. The committed script is the repeatable workflow artifact.
The VM has no desktop/display, so the run uses actual Chrome in headless mode.
The toolbar action opens a real side panel; the same packaged panel page is also
opened in a tab for Playwright interaction and screenshots.

Passed in the final integrated Chrome 155 run (18 checks): normal app session reuse in the
sandboxed iframe; intake and signed-out gates; no capture on open; temporary tab
permission denial/recovery and toolbar grant; whole-page and selection capture;
source preview and exclusion of form values, hidden content and URL query/hash;
draft preservation; removal without reattachment; rejection of wrong-origin,
stale-session, oversized and invalid-URL messages; excluded selections never
widening to whole-page capture; message/file persistence after reload; capture in
an existing conversation; narrow dark rendering; visible/dismissible pending
capture in history; preservation of the main app's dock layout; Escape keeping
the sidebar open; and links outside the layout opening in a separate app tab.

Blocked: live model response. The unmodified web dock and the sidebar both hit
`router_rejected: The job callback is not permitted` in this local environment.
Message/upload persistence passes independently; no router allowlist was changed.
Not run: Edge, browser-store review, a visible desktop run, live model-generated
certificates/email approvals and production HTTPS authentication. Those are not
claimed by this workflow.

### Test suite pruning — October 16, 2026

At the user's request, reduced the full default suite from 1,110 passing tests to
109 (over 90% removed). Removed ordinary UI/state/formatting suites, mocked model
and adapter tests, duplicated helper contracts, opt-in evals, and their obsolete
catalog snapshot. Twelve root test files and the Slack HTTP boundary suite remain.

The retained core exercises intake ownership/revisions, Markdown authorization,
router job idempotency/cancellation, verified operator identity, OAuth resource
binding, exact single-use approvals, complete extraction promotion, authenticated
operator email, API authorization, email executor send/attachment boundaries,
website SSRF bounds, and Slack HTTP authentication/delivery. Browser workflow QA
owns broader feature behavior. This intentionally removes substantial automated
regression coverage; the historical workflow results above are not new coverage.

No production code or replacement tests were added. Final checks run the reduced
suite, TypeScript, lint, worker checks and production build before merging.

### Google Ads signup contact conversion — October 16, 2026

Observed on production in Helium: marketing `/landing/form` contains the
`AW-18451509957` base tag; its email form redirects to `/signup?email=…`.
The signup page contains no Google tag before this fix. Google Ads' existing
**Landing form completed** action is primary, counts One, and reports no tag
pings in seven days (last recorded September 29). Its event destination matches
the marketing site's older form implementation. Tag Assistant could not connect
in the test Helium session; this does not establish tag delivery or absence.

Implementation adds the base tag only on production intake routes and queues the
existing contact-lead conversion only after `/api/intake` accepts the contact.
Privacy, production-host/route gating, concurrent/reload deduplication, blank-ID
rejection, and tracker/storage failure invariants were listed before code and
covered by `lib/google-ads.test.ts` (5 checks). Evidence is in the local ignored
`.context/qa/google-ads/` directory. Focused ESLint passes.

Live Helium test: landing-to-signup email prefill passed. The first test with
`zac@spot.insure` was rejected; source inspection confirms customer signup
intentionally blocks operator-domain emails. A second authorized synthetic
identity (`Spot Conversion Test`, an example.com address, and a reserved
fictional phone number) successfully saved contact details and reached the
first intake question with a Saved status. The live app still has no Google
Ads script at this point, confirming the tracking gap. Evidence:
`.context/qa/google-ads/signup-test-passed.jpg`. A synthetic draft remains; no
insurance application was submitted and no real business details were entered.
Post-deployment Tag Assistant conversion delivery and attribution remain
**not run**; local invariant checks do not establish either. Follow the production QA procedure in
`docs/architecture/product-analytics.md` after the release is deployed.
Production build passes after applying the repository's required `postinstall`
UI patch; the initial install intentionally skipped lifecycle scripts, so its
missing date-field error was resolved by running the existing patch step.

### Extension welcome and reusable reviewer — 2026-10-16

- `node scripts/browser-extension-onboarding-e2e.mjs`: native-local Chrome,
  signed-out toolbar hidden, normal-tab OTP sign-in, fixed website redirect,
  automatic authenticated sidebar reconnection: 4 passed. Artifacts:
  `.context/qa/extension-onboarding/results.json`, `signed-out.png`, `reconnected.png`.
  The guide body is stubbed; its responsive page checks live in clarity-landing.
- `node scripts/reviewer-account-e2e.mjs`: 7 passed against explicitly pinned
  native-local backend. Wrong credentials, forbidden signup/reset/OTP/identities,
  real demo workspace sign-in and policies, client sidebar access, session
  invalidation, rejected old password and accepted new password. Artifacts:
  `.context/qa/reviewer/results.json` and screenshots. Generated local passwords
  are rotated at the end and excluded from reports. Existing five prewritten
  authorization/isolation tests also passed.
- GitHub production workflow uses repository secrets; local QA does not deploy
  or provision production accounts. No Vercel previews used.

### Edge Add-ons draft and origin support (2026-10-16)

- Helium computer-use workflow registered Tools for Enlightenment Inc. as a US
  company publisher, verified the contact email, and uploaded Spot 0.1.3.
  Microsoft reports the package verified and all five draft listing sections
  complete. Product: `2ea28992-245b-434c-a872-0a372379d202`; Edge CRX:
  `bjdellngobanihjicilhpiodbocglhhh`. Not published. The company's Certificate
  of Incorporation was retrieved from Google Drive and submitted under
  Formation documents. Microsoft confirmed successful submission and says
  review should complete within five days; business approval remains pending.
- Focused origin boundary check passes for the Chrome and Edge IDs, rejects
  unlisted/lookalike origins, and verifies outgoing messages never use `*`.
  Local artifact: `.context/edge-addons/check-origin-bridge.cjs`. Targeted ESLint,
  `tsc --noEmit --incremental false`, and `git diff --check` pass.
- The Edge origin app change is not deployed. Real Edge sidebar sign-in,
  capture, and rejected-origin workflow QA remain required before release.

### Compact extension and optional passwords (2026-10-16)

- `node scripts/browser-extension-e2e.mjs`: 19 browser checks pass after the compact-header change, including a CDP request without user activation being rejected. Artifacts: `.context/qa/extension/results.json`, `sidebar.png`, `sidebar-dark.png`, `preview.png`. Live local model response remains blocked by the router's local callback policy.
- `node scripts/browser-extension-onboarding-e2e.mjs`: 4 checks pass for welcome, normal login tab, bounded redirect, and automatic reconnection. The guide body is stubbed only in this local auth test; the deployed guide is independently verified.
- Optional password workflow: `node scripts/password-login-e2e.mjs`; artifacts `.context/qa/password-login/`. 9 checks pass on the integrated atomic password writer: email-code default, opt-in, normal sign-in, rejected wrong/old passwords, cross-browser session revocation, and removed reviewer page.
- Demo account workflow: `node scripts/reviewer-account-e2e.mjs` uses ordinary `/login` and `password`, with seeded policies and session rotation; no reviewer-only auth gates. The final integrated run passes all 5 checks.

- `node scripts/password-account-e2e.mjs` and `node scripts/password-account-boundary-e2e.mjs`: integrated backend workflows pass 5/5 and 4/4; closed public signup/reset, hash-only opt-in, revoked JWTs and concurrent credential writes. Artifacts: `.context/qa/password/results.json` and `boundary-results.json`. The author also verified the stale-session case (6/6) on the same backend correction; see `docs/testing/password-account.md`.

### Agent decision traces and failure diagnostics — October 19, 2026

Actor: authenticated operator on the production operator portal. Use the existing
email-code login; keep OTPs and browser sessions out of tracked artifacts.

1. Start a read-only broker lookup that requires loading a tool family. Observe
   preparation, model/tool selection, requested calls, and actual tool execution.
2. Confirm the response completes, reopen its activity, and reload to verify
   retained history. A completed turn must have no running indicators.
3. Inspect a failed run: concise error summary, collapsed Error details, then
   expand safe request/attempt diagnostics. No raw prompts, provider bodies, or
   credentials may appear. Error details remain accessible with Show thinking off.
4. Check narrow viewport layout and streaming/activity preferences. Do not replay
   the original broker-creation request or send external messages during QA.

Status: passed against production Spot `3cf9c46a` and cl-router `ca325298`.
Headed cloud Chrome used the ordinary email-code login. No Vercel preview or
business write was used. Read-only broker lookup and public website research
exercised family expansion and the web-search tool.

- Before: public research repeatedly failed with provider 400; the diagnostic
  rollout narrowed this to `provider_400_param_tool_choice`. The OpenAI adapter
  treated the consumer function `web_search` as a hosted-tool choice. Router
  PR71 requires the single selected function without using that reserved name
  as the choice type. Deterministic rejections now stop after one attempt.
- After: run `q97xms99j67jbkxa1tn3rwb3pn8gj1px` completed with three web-search
  calls and a sourced answer. Seventeen observed stages survived browser reload;
  settled activity was collapsed and no running indicator remained.
- The real failed turn exposed a descriptive summary and collapsed Error
  details. Expanding and copying preserved safe request/message references,
  retry disposition and the provider-attempt code. Narrow viewport overflow
  passed. Turning Show thinking off retained Error details; the original
  preference was restored.
- Existing Spot suite: 117 tests passed. Router full check and both production
  release workflows passed. Shared-component browser checks also covered
  streaming disabled, interrupted activity and merged legacy tool history.

Evidence: `.context/progress-followup/browser/` contains
`live-success-result.json`, `live-error-result.json`,
`production-success.png`, `production-error-expanded.png` and
`production-error-mobile.png`. These workspace artifacts contain no OTP or
browser-session credentials. The failure reference is
`81daa5ed-1d3c-49dc-b514-0bc43736532a`; successful request reference
`137f3caf-77ad-4752-aa00-c517cadce071`.

### Operator planning and corrective tool iterations — October 19, 2026

Acceptance workflow:

1. Submit a simple answer-only question: no business plan when all four Jev answers confidently say no.
2. Submit the original 13 broker domains as a read-only directory comparison. Observe complexity assessment, a distinct saved plan before the first business call, per-target searches or a disclosed bounded list, and an answer covering every target. A rejected batch is not a no-match result.
3. Reload while planning and after completion; the plan is retained and the durable planner invocation is reused. Stop a new run during planning; no business tool may execute after cancellation.
4. Ask for a read using an invalid identifier, then recover via an authoritative lookup. Verify structured error code, corrected call and final answer. Persistently invalid calls must exhaust after three corrective model iterations, not loop or claim absence. Do not manufacture production writes to test failures.
5. Recheck collapsed Plan/error disclosures, Show thinking preference and narrow viewport. The single Retry button must start a new attempt directly, include existing error context automatically for failed turns, and remain disabled during an active run. Existing approval, authorization and unknown-outcome boundaries receive code review and existing automated coverage.

Production acceptance on release `5fa0c71f` (PR #481), through authenticated
headed cloud Chrome at `app.spot.insure/operator/brokers`:

- Simple answer: four Jev probabilities confidently said no, no plan or tools,
  answer `4`. Run `q97ngbryceg0460dm1f1fz9rqh8gje06`.
- Complex comparison: a separate three-step plan retained all 13 targets before
  13 individual directory searches. Every target appeared in the final answer;
  Montgomery Risk was matched by website, unrelated fuzzy candidates were not
  treated as exact matches, and absent records were qualified to the searched
  directory. No writes or web research. Run `q97ynk9wm5s1tmj10npfn9w8198gkfd3`.
  Reload during planning and execution retained the plan. Router request
  `88122f9e-d532-4b5b-b3f3-8558d8698109` was the distinct planner call.
- Correctable failure: `get_organization` returned `invalid_identifier`; the
  agent searched for the organization, used the returned ID for a successful
  read, then finished without repeating successful calls. Run
  `q97knd1zacd5qjdxs9z3tkqads8gj28v`.
- Cancellation: Stop during Creating a plan cancelled run
  `q97tzd9wf1xexx4qpkg762d17s8gjqcf`; reload confirmed zero business calls.
- Retry: one click produced a new completed run with answer `4`
  (`q97y04dmh7x9dp0ge3msvddszh8gjtf2`), without a menu. The button disabled
  immediately. Failed-turn error-context selection is automatic in the handler;
  no write-bearing failed production turn was replayed for QA.
- Presentation: Plan starts collapsed, expands, survives reload, and remains
  available with Show thinking off. At 390px there was no horizontal overflow.
  Show thinking and desktop viewport were restored afterward.
- Recovery exhaustion: the deliberately invalid, unidentified read stopped
  after the initial iteration plus three corrective iterations, with no guessed
  target or writes. It exposed malformed provisional model prose in the final
  answer (run `q97vdt392ktref0we48f5h7jgh8gkzs1`). PR #484 fixed provisional
  streaming and continuation-history contamination. Retest on production
  `5e2978b0` passed: run `q97nb9sxpjxjgrw840nv5c8z9s8gjef7` completed after
  four model iterations (initial failure plus three corrective opportunities),
  with one failed read, no guessed target, and a clean final report using the
  recorded code and guidance. No provisional recovery prose appeared during
  observation. Successful correction was rechecked in run
  `q97j9dzsvak6p65cpzna59saf98gjx27`: invalid ID, authoritative search, corrected
  successful read, then a normal final answer with no extra failed attempts.
  Release validation, deployment and production readiness passed.

Artifacts are under `.context/operator-planning/browser/`: `simple-evidence.json`,
`complex-evidence.json`, `recovery-evidence.json`, `cancel-evidence.json`,
`retry-evidence.json`, `plan-ui-evidence.json`, `plan-expanded.png`,
`plan-mobile.png`, `recovery-complete.png`, `exhaustion-fixed-evidence.json`,
`exhaustion-fixed.png`, and `recovery-fixed-evidence.json`. These contain no browser session
credentials. Release CI and production readiness passed; no new unit tests or
Vercel previews were used. Existing authorization, approval and unknown-write
boundaries were reviewed and their existing automated checks retained.

## Intake Slack answer values — October 19, 2026

The owner requested all saved applicant/contact facts in #submissions and an
edit of the existing incident message. The scoped backend change renders typed
answers and structured per-coverage limits, preserving unknown vs blank values.
Revision-keyed summary events edit the original thread message on same-question
autosaves; file additions/removals refresh it as well. Progress remains threaded,
with @here reserved for accepted submissions/resubmissions. Internal exact-target
backfill checks revision, thread timestamp and configured destination.

Failure modes were specified before implementation: missing literal answer
values; stale derived coverage values; Markdown/mention injection; silent text
truncation; repeated-save duplication; old queued summary snapshots overwriting
new answers; delivery lease overlap; and wrong-target backfills. Focused tests
cover these boundaries and the existing owner/revision authorization suite.
The full root suite passes 122 checks across 16 files. App and Convex types,
focused lint and deployment dry run are recorded with the release. The real
backfill is owner-authorized incident repair, not a synthetic submission test.
No applicant contact details or access capabilities are committed here.


### 2026-10-19 — operator diagnostics for unlinked intake

Production Ask Spot failed to read an exact saved draft because the procurement
reader requires a company. The exact-ID operator reader now checks active operator
identity and returns allowlisted draft answers, typed details, progress, revision,
timestamps and at most 40 Slack delivery events. It does not attach a company or
change any fulfillment, sharing or writer authorization. Draft answers remain
unaccepted until submission. Registry version 2 and AGENT_TOOLS.md describe this.

Before implementation, the isolation test defined these failure modes: customers
and disabled operators gaining access, deleted drafts remaining readable, inbox
or verification capabilities leaking, and a diagnostic read changing saved state.
The test checks each boundary. Incident records and personal details are excluded
from this ledger.

The preceding Slack repair was deployed to the verified production target and
PR #479 merged. A revision- and original-thread-bound backfill edited the existing
bot parent successfully; delivery was verified without changing the application.

Validation: all 123 tests pass across 17 files; Convex typecheck, focused ESLint
and git diff --check pass. Production rollout is tracked by the follow-up PR.


## Referring-provider intake header — October 19, 2026

Local signup header QA at localhost:8080 covers the registered Montgomery provider,
normal Spot entry without a provider, unknown-provider fallback and mobile layout.
The public branding registry is exported from the broker-network ledger; incoming
values cannot set image URLs or home links. TypeScript and focused ESLint checks
were run. Two existing application hook dependency warnings remain outside this
change. The local Convex backend was unavailable, so authenticated submission,
verification and post-signup continuation were not exercised. No live contact details
were submitted and no production deployment was performed. Provider selection is
visual branding only and does not grant account or request access.

Provider signup layout follow-up: compact brand lockup (32px artwork), shorter header,
centered progress indicator, 528px desktop form content, smaller signup heading and
44px contact controls. Signup footer content shares the form's horizontal edges.
TypeScript and focused ESLint checks passed. Desktop and 390px mobile previews were
inspected; branding and the provider query contract are unchanged. Preview evidence:
`.context/qa/provider-signup/compact-desktop.jpg` (local only).

## Replay visibility — October 19, 2026

Before implementation, boundary tests specified readable ordinary inputs/text/attributes,
blocked password/revealed-password/OTP/hidden controls, capability attribute redaction,
and access-URL sanitization with network headers/bodies disabled. The initial run
failed on ordinary visibility and credential selectors. Configuration now removes
blanket replay text/input/attribute masking while retaining explicit credential and
document exclusions. OTP controls and the shared PDF wrapper are ph-no-capture.
Previously masked recording data cannot be recovered. Use synthetic fixtures only
when verifying new replay visibility.

Validation: 126 tests pass across 18 files; full Next.js typecheck and ESLint
pass (three pre-existing warnings). Local provider signup renders correctly;
recording ingestion/playback and the production rollout are verified separately.

Live ingestion/playback follow-up: a refreshed localhost signup sent a synthetic
name/email fixture to the existing Spot PostHog project without submitting the
form. Replay `01a1557f-5770-7433-9da9-a6aece2cc728` visibly shows the page labels,
name and email after the fresh pageview; its earlier snapshots remain masked.
The local fixture was cleared afterward. No application record was created.


October 20, 2026: replaced intake boilerplate with PR #519's canonical 475-question
Spot catalog (ACORD mappings unverified). Exact source comparison, all adapted
definitions, root/Convex types, focused lint, isolated deploy and Helium first
question/dropdown checks passed. Live Jev selected eight questions for the GL
fixture, one per page. See [intake follow-ups](intake-followups.md) for evidence
and adapter limitations; the existing live LLM callback blocker is unchanged.


October 20, 2026: resolved the intake additional-question callback failure for
local QA. Explicit bounded local generation uses the same router synchronous
endpoint; default/hosted generation remains durable. Actual LLM generated six
saved questions and Helium rendered the first currency question. See the live
recovery run in [intake follow-ups](intake-followups.md); this supersedes its
previous local LLM callback blocker. No mocked generation or production changes.


October 20, 2026: added full base/follow-up question history with paired answers
and skip status, reserved blank base facts, explicit skip persistence and an
independent Jev novelty screen. Live regeneration returned four new underwriting
detail questions with no repeated revenue/subcontracting facts; Helium verified
the new first question. Existing typed answers were preserved. Context inspection,
root/Convex types, focused lint and nine existing tests passed. See the complete
question-history run in [intake follow-ups](intake-followups.md).


October 20, 2026: tested the supplied trucking example on a separate local copy.
Live selection chose 12/176 eligible catalog questions; live generation/novelty
screen returned six follow-ups with no revenue repeat. Both batches ready.
Underwriting completeness did not pass: VIN, driver/history, physical-damage,
authority/cargo and data-consistency gaps remain. Full results/limitations are
recorded in the trucking scenario in [intake follow-ups](intake-followups.md).


October 20, 2026: VIN/driver workflow QA passed for short VIN, invalid check digit,
valid/blank VIN, two-driver navigation, reload recovery, optional sensitive data,
entered-date validation and model-context redaction. Names define the initial
schedule; DOB/license numbers are opt-in and optional, other driver facts can be
skipped. Rerun of the supplied trucking example: 8 catalog + 6 follow-ups, with
VIN/roster still unresolved rather than invented. See the minimal-driver run in
[intake follow-ups](intake-followups.md) for evidence and limits.

### 2026-10-20 commercial-auto follow-up polish
Actor: existing synthetic local applicant, isolated backend 3220, Next 3207. Verify scope textarea removal; Back from driver roster reaches per-vehicle dollar value then freight; enter/save value and freight, continue to roster; inspect driver label/placeholder with helper paragraph removed; insurance-history No routes established business to uninsured reason then existing claims question. Preserve synthetic draft and do not submit. Artifacts: `.context/qa/trucking-case/driver-polish.png` and `auto-*.log`.

Observed result: passed vehicle → freight → value → roster and reverse navigation, $25,000 and synthetic freight persistence, No current insurance → reason → claims and reverse navigation. Driver class screenshot confirms shared FieldLabel, example placeholder, no helper paragraph. Header section navigation was corrected to jump directly rather than run the current driver’s Back logic. Existing auth/Slack suite: 9 passed; type checks passed; focused lint has only the two existing application hook warnings. New per-vehicle skip metadata is included in model history. No production deployment or application submission.

### 2026-10-20 named driver questions and license jurisdiction
Existing synthetic local two-driver draft, Helium at 3207/backend 3220: driver headings now name the active driver; Label/Field primitives render a 16px foreground name with 8px control gap. License jurisdiction uses shared SearchableSelect for flag-bearing countries, US states and Canadian provinces; other countries retain a region input. Verified country search → United States → Ohio, country switch clears Ohio → Canada → Ontario, and reload recovery. Existing saved jurisdiction strings are retained until edited. No schema or model-tool contract changes. TypeScript and focused lint passed. Screenshots under `.context/qa/trucking-case/driver-named-*.png`.

### 2026-10-20 scoped catalog controls and conditional equipment details
Actor: existing synthetic local applicant at 3207/3220. Use current vehicle equipment question: Yes → separate catalog-authored text details; save a synthetic detail, Back → No → detail hidden and obsolete text cleared. Two-vehicle adapter check confirms distinct IDs and named prompts. No-answer parent does not reveal child. Shared question controls remain one per page. Retired uninsured reason must be absent from navigation/resume; uninsured businesses still get claims. Business-name presentation must show A&A Bonita Trucking LLC instead of “the business” while preserving approval/save identity. Existing auth/Slack suite: 9 passed; scoped type/lint logs and screenshots under `.context/qa/trucking-case/scoped-*`. No application submitted.

Final validation: root and Convex TypeScript checks passed; existing 9 auth/Slack tests passed; focused lint has no errors and only the two pre-existing application hook warnings. Temporary local scoped-catalog helper was removed and local functions redeployed. Generated follow-ups now have separate Jev novelty and input-fit checks, both requiring threshold confidence. Existing user-entered test answers were preserved; only QA equipment detail text was cleared when its parent was changed to No.

### 2026-10-20 intake goal loop
Checkpoint `623484d7`, branch `codex/adaptive-insurance-intake`. Three parallel agent audits plus visible Helium workflow testing covered consultant GL, retail/property/WC, Canadian fleet, unknown coverage, savings, stale resumes, removed auto, follow-up failures, review editing and mobile layout. Found defects were fixed and retested; see [matrix and explicit coverage limits](intake-goal-loop.md). Synthetic local savings and non-auto applications submitted successfully; no live communications or production writes. Shared review/submission validation, active-data snapshots, atomic batch capacity and non-replay guards now agree across UI/server.

### 2026-10-20 grouped vehicle catalog page
Synthetic Lakeview Freight Test LLC draft, local Helium 3207/backend 3220. Vehicle weight, annual distance and equipment choice render together with concise labels and shared controls under “More about 2018 INTERNATIONAL XLSV 4300”. Verified Continue → cargo question, Back → complete vehicle group; existing weight/equipment answers retained, blank annual distance marked skipped. Grouping retains approved per-question answer IDs and does not merge different vehicle subjects. Conditional child visibility keeps the shared parent predicate. Screenshot: `.context/qa/fresh-application/vehicle-group.png`.

### 2026-10-20 follow-up preparation ahead of section entry
Actor: existing owner-authenticated synthetic QA applicant on local Next 3207/backend 3220; use a separate QA draft, not the human's live answers. Enter Insurance history to start provisional additional-question generation; answer history and visit catalog while it runs; enter Additional details and verify the latest question/answer/skip history is screened before any candidate is ready. Check prepared state never renders answer controls, pending preparation has a shared Spinner with reduced-motion support, Continue is disabled until ready, and savings never starts generation. Existing same-context pending/failed inference deduplication and token/context finalization guards must remain intact. Artifacts under `.context/qa/fresh-application/preload-*`; no submission or external communications.

Before isolated progressive-enrichment probes, failure modes are: accepting a stale/wrong token, replacing or dropping an already issued page when capacity is exhausted, appending twice after completion, and discarding usable initial questions when enrichment fails. These atomic races are not reliably timed through the browser; temporary local-only synthetic fixtures exercise the production append writer and are removed afterward.

Observed browser result: at insurance-history step25, catalog was already ready (five questions) and eight additional candidates were prepared. Entering catalog rendered its vehicle group immediately. Skipping all five catalog facts then entering Additional details screened against those five skips: one initial question became ready, then a background full-context pass appended one distinct question. The initial question ID/order and saved No answer remained unchanged; final enrichment status cleared. Types, focused lint and existing auth/Slack checks are recorded under `.context/qa/fresh-application/preload-*`. Shared loader screenshot is `preload-loading.png`; provisional candidates are excluded from the public draft DTO and ready-answer approval set.

Progressive-enrichment isolated production-writer probes passed: wrong token ignored; issued page retained with sixty historic rows and no capacity for additions; duplicate completion ignored; failed enrichment retained initial questions and cleared the pending indicator. Temporary local probe functions were removed and the isolated backend redeployed.

### 2026-10-20 section introductions
Actor: separate authenticated synthetic QA draft at local3207/3220. Visit each of the seven section headers: show a short shared-frame introduction, Continue into the existing fields, revisit/reload without repeating it, and confirm Review introduction does not submit. Test a savings policy introduction with its PDF gate intact, review editing bypass, and intro Back without marking unseen questions skipped. Seen-section state is draft UI metadata, excluded from accepted facts and inference hashes so opening introductions cannot restart generation. Company switching must preserve this state and request-owned drivers/freight already entered before company selection.

Observed: all seven introduction → field transitions passed in visible Helium. Review Continue opened the review without submitting; saved additional No and five catalog skips remained intact. New company → restore saved company retained one driver and seen sections [0,1,2], without replaying the company introduction. A new savings draft showed request → policy introduction → required PDF upload with Continue disabled until upload; reload did not repeat the acknowledged policy introduction. Existing draft/accepted views remain editable/read-only under their ordinary rules. Evidence: `section-introduction.png`, `introduction-company-switch.json`, and `introductions-*` logs in `.context/qa/fresh-application/`.

### Commercial-auto route input — 2026-10-20

Actor: existing synthetic local intake owner, isolated route draft (human drafts untouched).
Workflow: select Cleveland → Columbus → Cincinnati; inspect map; reorder and remove stops; edit a city; enter maximum distance; reload; verify readable review. Adjacent cases: empty skip, partial route cannot continue, keyboard suggestions, narrow viewport, provider failure/manual city entry. Cleanup: remove local-only fixture function; retain synthetic test draft for user review. Evidence: `.context/qa/routes/`.

Outcome: passed visible Helium QA for three selected Ohio cities, keyboard selection, pointer selection of a UK city, reorder/remove, clear-to-skip, incomplete-step blocking, review's incomplete-route link, readable review, reload persistence, and manual no-result city entry. An Ohio→London route returned no road path and retained numbered stops without drawing a fabricated connection. Fixed the provider's single-marker padding rejection and narrow-screen input/overflow/map-cropping issues. Final 393px viewport had equal document/client widths (378px after scrollbar). Artifacts: `route-desktop.png`, `route-mobile.png`, `route-no-road.png`. Root and Convex type checks passed; existing intake authorization/Slack suites passed 9 tests; focused lint had no errors and one pre-existing application effect warning. Temporary local fixture source removed and local backend redeployed. Dark theme was exercised in the application; light theme and its loaded map were verified in a temporary, synthetic-only primitive harness (`route-light.png`), with the original system theme restored and harness removed. A forced network outage was not separately exercised. The memory helper's macOS free-only estimate reported critical; native memory_pressure showed 32% available, so checks ran sequentially with existing services retained.

2026-10-20 requirement prefill: local callback rejection diagnosed and the known unaccepted job repaired once. Actual Program Manager Agreement extraction selected professional liability; grounded $1,000,000 unspecified minimum corrected to aggregate without another model call. Eleven merge/prefill and request authorization checks pass. Artifacts: `.context/qa/requirements-prefill/`. Browser verification of this newer request was blocked by the selected browser account’s request ownership; saved typed details and source both confirm aggregate 1000000 and blank each_claim.

2026-10-20 intake polish: browser verified Back from the first business question reopens its introduction, Let’s begin returns to the question, and Skip moves forward within the section. Company name uses the requested optional trading-name placeholder; next page shows legal name and website with a static title. Multiline description expanded from 126px to 760px with scrollHeight equal to clientHeight and content sizing enabled, then the original answer was restored. Copied base coverage summary was removed only when the existing draft matched the source exactly; aggregate remains 1000000. Live ACME Inc / acme.com lookup completed with zero verified identity facts, correctly leaving autofill blank. Artifacts: `.context/qa/requirements-prefill/`.

Applicant-provided website follow-up: removed intake company-name matching and read the supplied site plus same-site business/about pages. Live site retrieval for the entered ACME example returned freeware, software-library and mapping-tool operations despite the entered name differing. Website content remains evidence; other company research retains identity verification. No new tests or dev migrations were added for this follow-up.

2026-10-20 description industry and empty gaps: browser verified Jev filled Professional Services from Business management consulting, preserved it after a conflicting retail description edit, and restored the original description. A ready empty additional batch automatically reached review without the gap intro or empty answer screen. Screenshots: `.context/qa/requirements-prefill/industry-prefilled.png` and `empty-gaps-review.png`. Date controls reuse the shared DateField, generated kind selection uses Jev Choice, and legacy questions use read-only rendering hints. Root/Convex TypeScript and touched-file lint pass apart from the existing application data dependency warning. No new tests or dev migrations were written.

Continue-gap gate live QA: a saved Continue produced a completed Jev Yes and three screened yes/no follow-ups in the existing QA draft. The original description and temporary trading name were restored through the UI. Date-kind schema, rendering hints, final calendar validation and applicant-only prompt guidance passed root/Convex typechecking; no new tests or dev migrations were written. Review address typography now follows the shared row role.

### 2026-10-20 final applicant walkthrough
Actor: owner-authenticated synthetic QA applicant, local frontend 3207/backend 3220; reuse isolated QA draft, preserve entered baseline answers. Native memory_pressure reports 40% available (6.4GiB); helper's macOS free-only estimate is not available-memory accounting. Run sequentially with watcher.
1. Reopen review; edit company name → verify optional trading-name then static legal-name/website page, Back introduction, Skip/Continue and reload persistence.
2. Edit coverage/routes → verify multiple routes, Start/Stop labeling, endpoint heading/icon, matching add actions, delete alignment, no reorder/clear/distance/helper text; Continue must save without invalid-followup errors.
3. Go through history and follow-ups → verify typed controls, applicant-answerable prompts, ready-empty section skipping, final review reached without starter.
4. Expand review → commercial auto/driver schedule nested in Coverage, vehicle labels match Locations and address/body sizes match. Check 393px layout and console.
Failure cases: partial route blocks progression; blank optional answers remain skipped; existing industry not replaced. Model/network failures must retain answers without inference replay. Requirements extraction and website/industry live prefill have prior evidence; rerun only where current workflow supplies fixture.
Cleanup: restore temporary synthetic edits, reset viewport, retain draft without submission. Evidence under `.context/qa/intake-walkthrough/`; record observed coverage and unexercised paths separately.

Final-list regression result: passed route partial-stop blocking, removal back to
Start/Stop, successful route Continue with no Invalid follow-up answer console
error, and saved routes retained. Review title now reads “Review your insurance
application before submitting”; completed Additional details shows Complete.
Generated-question evidence and all context/token finalization hashes now exclude
final LLM answers, while previous definitions are exclusion-only. Disabled the
automatic enrichment pass after provisional-list screening. Backend snapshot
comparison before/after unchanged Continue and a deliberate final-answer No→Yes
edit found the entire ready batch and gap assessment byte-for-byte unchanged;
enriching stayed false. Restored No, reloaded review, and reopened the section
without a preparation screen. Screenshot `review-complete.png`; 393px review
has scrollWidth=clientWidth=378px (`review-mobile.png`), viewport restored.
Root/Convex types and diff whitespace checks passed; focused lint has only the
existing application effect dependency warning. No new tests, migrations,
application submission or production deployment. This run focused on the route,
review and terminal-question regressions; earlier prefill/date/navigation evidence
above was not regenerated in this pass.

### Request-notes coverage preselection — 2026-10-20
Actor: existing owner-authenticated synthetic route QA draft, local 3207/3220.
Enter request notes asking for commercial tenant insurance for a rented office;
continue to coverage and expect relevant lines selected, previous commercial-auto
selection retained, no loading banner, no invented limits/ownership. Reload and
verify saved selections/source deduplication; explicit deselection must remain.
Restore notes and remove only new QA coverage selections. No submission.

Observed: the tenant-office note selected Commercial Property, retained existing
Commercial auto, left amounts unspecified, and showed no inference banner.
Selection survived reload. Manual Property deselection survived another reload
with the note unchanged. Restored blank notes and removed the new QA line through
the UI; existing auto/driver/route data retained. Screenshot:
`.context/qa/intake-walkthrough/notes-coverages.png`. Root/Convex type checks pass;
focused lint has only the pre-existing application effect dependency warning.
No new tests or migrations; local backend sync only.

2026-10-20 coverage layout/loading follow-up: local Convex history for the supplied
request showed catalog selection at 4.026s, preceded by an additional gate failure
(`Additional-question assessment uncertain`), not an indefinite generator. The
700ms browser warmup could cancel on navigation; saved-progress backend warmup
now starts catalog preparation during Coverage. New pending-token deduplication
retains in-flight work. Logs and bounded diagnosis are under
`.context/qa/intake-walkthrough/loading-diagnosis.json`. Applicant wording, one-page
location hierarchy, industry placeholders and subsection intro metadata passed
root typechecking and focused lint (one pre-existing effect warning); no new tests
or migrations. The supplied screenshots show the live subsection progression;
a full fresh browser rerun of the reordered Coverage flow remains unexercised in
this pass. No application submitted or production deployment performed.


### Local baked coverage packs and consolidated review — 2026-10-20
Actor: owner-authenticated synthetic QA draft `zh742ma43782we1bmbxzdad48d8gm612`, local Next 3207 / Convex 3220. Preserve existing auto, drivers and routes; add a named QA property for regression evidence. No submission.

Actions/outcomes: opening standard Coverage questions returned immediately without model preparation. Hired vehicles Yes exposed its catalog-authored cost child; Back initially failed exact-definition validation because Convex reordered condition-object keys. Comparing condition fields fixed this; repeat Continue/Back passed, and No hid the child without save errors. Vehicle ownership now renders five large radio choices, and Yes/No/unsure controls share the same extracted `radio-choices.tsx` primitive; operator inline dropdowns retain their compact contract.

Added QA WeWork with the Mapbox-selected 100 University Avenue address, activities, leased occupancy, four staff, contents and replacement value. Review displays all entered location facts in a single named row card, with no Other coverage details or General questions wrapper. Location heading uses the standard micro subheading. General catalog answers are assigned to their coverage and sorted by pack order before scoped locations. Screenshot: `.context/qa/intake-walkthrough/consolidated-location-review.png`. Synthetic property retained as a review regression fixture; existing auto/driver/routes preserved. No applicant authorization checkbox or Submit used.

Empty/failed optional generation is hidden and routes directly to review; source inspection verifies the failed text and error toast are removed and both forward/back paths bypass unavailable empty batches. A forced generation-failure browser case was not injected in this pass. The supplied live request's remaining tail question was confirmed as the historical `catalog1_eo_terms_extended_reporting`; shared visibility now retires it across drafts/review/exports while allowing preserved history to save. No production or historical database backfill performed.

Root/Convex type checks and diff whitespace checks passed. Focused lint reports only the existing application effect dependency warning. No new tests or migrations; local backend sync only.

### Business-first intake, typed inputs and conditional payroll — 2026-10-20
Actor: existing owner-authenticated synthetic drafts on local Next 3207 / Convex
3220. No submission, no production deployment, no new tests/migrations.

- Passed: request notes → Your business introduction; saved-business Continue →
  Coverage (caught and fixed the old history shortcut). Progress and review use
  Business before Coverage. Screenshot: `business-before-coverage.png` under
  `.context/qa/intake-walkthrough/`.
- Passed: 2022 Ford F-150 has Pickup truck suggested into its blank body field;
  identity-only scope and named fixed vehicle detail pages render. Earlier scalar
  currency/percentage unsure answers saved/reloaded, including largest contract
  value; industry multi-select saved two selections. Percentage 234 clamps to 100
  on blur. Applicant textarea unsure checkbox aligns to the first text line.
- Passed: missing privacy and terms links render shared URL input-group controls
  (`type=url`, URL placeholder, link icon, unsure). User-entered Stripe privacy and
  terms URLs saved through the normal revision writer. Screenshot:
  `cyber-url-field.png`. Synthetic fixture deliberately uses a different company
  name to exercise applicant-provided website research.
- Background cyber job exercised: first local extraction failed the bounded
  inline-task allowlist; added the exact task/trace to the existing text-only
  3,000-token path. A subsequent changed-context run completed with no supported
  proposals, so no cyber answers were filled. Nonempty verified-proposal merge
  and stale-proposal rejection are source-reviewed, not claimed as live browser
  passes. Failure never blocked the form. Diagnostics: `cyber-runtime.log`.
- Passed: workers’ compensation owner elections Yes exposes the details child;
  entered a synthetic owner/role, returned and chose No; child became hidden and
  its saved answer cleared/skipped. Payroll now belongs to WC, including with
  other coverages selected (pack ownership precedes generic catalog groups).
- Passed: payroll groups Office staff (4, USD240000) and Warehouse staff (2,
  USD120000) for the next 12 months saved, survived Back and full reload, and
  rendered separate human-readable group summaries in review. Blank/incomplete
  structured groups disable Continue. Fixed money primitive comma normalization
  without losing the entered group. Legacy saved next/last-12-month periods remain
  supported alongside annual/monthly/biweekly/weekly and custom-date entry.
  Screenshot: `structured-payroll.png`. Custom dates/currency alternatives were
  not separately exercised.
- Passed: entered the empty/unavailable Additional details section, which routed
  directly to Review without the reported showSectionIntro ReferenceError. Moved
  all introduction derivation before early returns, and guarded cursor persistence
  against temporarily unavailable question batches. Screenshot:
  `optional-section-skip-fixed.png`. No authorization checkbox or Submit used.

Synthetic cyber fixture `zh761k2t9pcw99vs8t3wfqb63n8gntc5` retains the structured
WC payroll regression data and optional policy links; its temporary company facts
remain draft-only. Root/Convex type checks pass; focused lint has the pre-existing
application effect dependency warning and no errors. No new isolated tests.

### Non-blocking submission phone — 2026-10-20
Removed final phone-format/presence blockers from shared review completion and
`requestIntake.submit` for quote and savings. Both final profile-phone promotions
now tolerate normalization failure and omit invalid/blank/in-use values, preserving
an existing profile number while retaining raw submitted contact data. Manual
in-memory execution of the shared validator confirms `123`, `not a number`, and
blank phone values produce no phone problem for either intake goal. Source review
covers both final profile-write branches. Root/Convex type checks and focused lint
passed; local backend synced. No application submitted, new tests, migrations, or
production deployment. A full end-to-end submission was not performed.

### Signup phone render loop — 2026-10-20
Signup now stores the phone primitive's empty value as `undefined` and passes the
stable React state setter directly; it no longer feeds `""` back after the control
emits `undefined`. Handoff hydration uses the same convention; only the HTTP
payload converts empty to `""`. The application's contact phone control also
receives `undefined` when empty. Shared primitive/package remains unchanged.

Browser verification used an independent signed-out in-app browser session to
preserve the existing Chrome local QA login. Typed a Canadian 416 number, verified
Canada inference, selected all and deleted it, entered/deleted a partial 1, then
selected United Kingdom and typed a synthetic London number. All operations kept
the form responsive, and captured console warnings/errors stayed empty. No form
submission/account creation. Screenshot:
`.context/qa/intake-walkthrough/signup-phone-fixed.png`. Root type check and focused
lint pass (the application's prior effect-dependency warning remains). No new tests.

### Application contact phone synchronization — 2026-10-21
Reproduced digit truncation, a stalled Saving state and repeated React maximum
update depth errors in Helium incognito. The expanded stack pointed to
`react-phone-number-input`'s `usePhoneDigits` controlled-value synchronization.
A version-pinned patch now emits edits in the input handler rather than echoing
values from its synchronization effect (both ESM and CommonJS); country mismatch
normalization still notifies the owner. The intake writer ignores unchanged phone
values without marking the draft dirty.

Browser QA covered signup and application contact controls in an isolated local
session, including clearing, sequential typing, removing/restoring the final digit,
blur autosave, and a reload followed by review confirming the complete number.
Captured console errors were empty. Helium incognito also verified clearing and
retyping Anthony's complete supplied number, followed by Saved with no issue badge.
TypeScript and whitespace checks pass; focused ESLint has only the existing
application effect-dependency warning. No tests or migrations were written and no
application was submitted. A synthetic local Phone Input QA draft remains unsubmitted.

### Coverage grouping and named payroll steps — 2026-10-21
Coverage navigation now composes each selected line's limits, scope, catalog and
vehicle/driver pages before advancing to the next line, retaining existing step
IDs and question indices. Isolated browser QA verified GL limits/details through
the named additional-insured agreement/upload page, then property limits/scope
and property questions. Back from property limits returned to the last GL page.
Property valuation omitted Other, restoration accepted 12 months, and location
headers displayed coverage and WeWork at matching 17.6px sizes with the address
below. Selected numeric uncertainty aligned left. A synthetic agreement upload
completed extraction and supplied GL limits plus grounded waiver/primary answers;
entered additional-insured answers stayed intact. Country suggestions displayed
Canada on a blank workers' compensation jurisdiction, with no location prompt.
The additional-state conditional question explicitly repeated states/provinces.

Payroll browser QA used two synthetic groups, Company Drivers and Management
Team. The first page contained only group names and the shared 48px large Add
employee group pill. Each group received separate named headcount, period, optional
custom-date and amount/currency pages. Payroll uncertainty controls were absent;
blank fields exposed Skip. Entered 3 employees, Per month and USD 20,000 for
Company Drivers; skipped Management Team headcount and custom dates/amount.
Reload restored Management Team's active step, Back preserved Company Drivers'
amount, and Back from the next catalog question returned to the last payroll
page. Compact roster screenshot: `.context/qa/intake-walkthrough/payroll-groups.jpg`.
Payroll remains the existing payroll-v1 answer; only its optional UI cursor is new.
Skipped details stay blank; submission validates entered dates and group names.

Local Convex sync and TypeScript pass. Focused ESLint reports only the existing
application effect-dependency warning; whitespace checks pass. No tests, database
migrations, production deployment or application submission were performed.

### Shared input-group fill alignment — 2026-10-21
The version-pinned shared UI patch gives InputGroup the same bg-popover fill as
Input and SelectTrigger, retaining transparent inner controls and disabled styles.
Payroll browser QA confirmed both currency selector and total-pay group render
rgb(31, 33, 37), the same rgba(255, 255, 255, 0.24) border and 48px height.
Screenshot: `.context/qa/intake-walkthrough/payroll-matching-fields.jpg`.
The complete UI patch passes a reverse dry-run against installed sources; no tests
were added. Currency selection continues to use the unchanged Select primitive.

### Vehicle relevance, driver details, and percentage controls — 2026-10-21
Used only synthetic draft `zh71v0s8jb90eeq1fte39rtqjd8gp3zc`; no submission. Entered a 2018 Toyota Camry used only for Uber passenger rideshare. The request-owned Jev assessment completed with a current evidence key and excluded freight and maximum-cargo-value pages; general vehicle questions stayed available. Diagnostic: `requestIntake:inspectFollowupPreparation` exposes status/IDs/currentness, not applicant answers.
Driver roster no longer shows the explanatory paragraph or optional-sensitive-details toggle, and Add driver uses size large. Continue opens one driver-details page with country, province, DOB and license number. Confirmed country trigger height 48px, one name in the heading, no repeated name/generic error prose, and successful Continue after a synthetic past DOB and example license number. Screenshot: `.context/qa/intake-walkthrough/driver-details-verified.jpg`.
Mileage editing displayed `1,234,567` immediately. Entering `999` in the largest-client percentage field displayed/stored `100`; `99.5` remained valid and Continue saved successfully. Screenshot: `.context/qa/intake-walkthrough/percentage-cap-verified.jpg`. Credentials heading now asks what qualifications the applicant has. Hazardous-cargo detail definitions are split into materials, quantities, permits and safety procedures under the existing Yes gate. Local Convex sync, TypeScript, focused lint and whitespace checks passed (existing application effect-dependency warning remains). No tests or data migrations were written.

### Atomic questions, cyber evidence, review grouping and unknown input rows — 2026-10-21
Synthetic draft `zh71v0s8jb90eeq1fte39rtqjd8gp3zc` was not submitted. Cross-domain QA used a Bonita business URL with explicitly supplied Tools for Enlightenment privacy/terms URLs. Research completed with two grounded, Jev-verified answers and one technology; the two answers were saved with provenance and visible in review. Quote wrappers/joins previously rejected otherwise exact excerpts; the matcher now requires every quoted excerpt to occur verbatim after typography normalization, with full-answer Jev verification retained. Unsupported controls remain blank.
Coverage review uses distinct small topic cards shared with submitted tracking, and computed subsection typography is 14px/500/muted, matching Addresses. Snapshot: `.context/qa/intake-walkthrough/coverage-review-subsections.jpg`. Aircraft and watercraft source prompts now split into two/four conditional pages; the active applicant screenshot independently showed these split answers grouped under the correct headings. TypeScript, focused lint and local Convex sync passed; no tests or data migrations were created.
Browser QA confirmed adjacent unknown buttons on currency and the cyber response-plan date field, selection replacing the field with one full-width pressed button, and deselection restoring `250,000` exactly. Date calendar/action no longer share overlay space. Screenshots: `.context/qa/intake-walkthrough/date-unknown-inline.jpg` and `.context/qa/intake-walkthrough/unknown-row-expanded.jpg`. Fresh reload removed development hot-refresh warnings; no continuing runtime error appeared.
Premium preparation was observed on the synthetic review while `submitted:false`, without a visible estimate/loading card; the deliberately incomplete application returned no usable range and remained hidden. The applicant-provided submitted-page screenshot showed a completed USD range on their submitted application. Pending/failed estimates now render nothing, and the requested paragraph was removed. Matching provisional/accepted hashes reuse the result; new content creates a distinct attempt, with stale token/hash completion rejected.

## Unknown coverage suggestions — October 21, 2026

Implementation uses saved unknown-scope prose, owner checks and the shared Jev
confidence threshold. New persisted step 44 reuses the coverage picker and existing
coverage navigation. Root TypeScript validation passed; touched-file lint has only
the existing application effect-dependency warning. No tests were added.

The local backend at 127.0.0.1:3220 was synchronized after the frontend initially
hit the old action validator (which rejected `source`). Live function metadata now
accepts `unknown_scope`, and an owner-scoped invocation against the saved trucking
description returned `["commercial_auto"]` with no error. Convex typechecking passed.
No production deployment or data migration ran. Full browser verification remains
pending because the local port-3207 browser session redirects intake to signup.
Repeat with an owned draft: select “I’m not sure”, describe a trucking company
requesting truck/driver insurance, and continue. Confirm “We suggest” selects
Commercial auto; change selections and continue to limits, vehicles and driver
questions. Reload the suggestion page to confirm saved selections; Back must
restore the prose. Check multiple matches, removing all selections (Continue
disabled), selecting “I’m not sure” again, blank/no-match prose, stale prose during
matching and router failure. Savings and submitted records must stay unchanged.

Unknown-action visual alignment follow-up: commercial-auto limit input and adjacent action both measured 50px with identical top/bottom edges, 10px corner radius, `rgb(31, 33, 37)` fill and 1px `rgba(255,255,255,0.24)` borders. Typography now matches the input at 16px; selected state retains the fill, with a check and emphasized outline. Expansion/deselection verified. Screenshot: `.context/qa/intake-walkthrough/unknown-input-matched.jpg`. Vehicle introduction copy adds “your” before the vehicle name and uses actual `text-wrap: pretty`.

- October 21 intake unknown-action responsive QA: desktop single-line unit input and button both 48px high on the same row; desktop textarea and below-button both 624px wide with a 12px gap. At 390px mobile width the unknown button occupies the full 342px content width below the field. Currency overrides of legacy long-text questions retain desktop inline placement. Focused ESLint passed; no tests added or applications submitted. Screenshot: `.context/qa/intake-walkthrough/unknown-responsive-desktop.jpg`. Vehicle lookup callback routing no longer throws to the client (completed in 25.7s); its optional evidence decision returned `Invalid decision contract`, so specifications remained empty.

- October 21 unknown-action anchoring: replaced competing flex/width transitions with a desktop button positioned at right: 0, animating width only. Browser QA on the synthetic mileage field measured the same right edge (952px) and height (48px) at 144px collapsed and 624px expanded widths; deselection restored the blank input. Multiline/mobile controls retain stacked layout. Focused ESLint passed. Evidence: `.context/qa/intake-walkthrough/unknown-right-anchor-expanded.jpg`.

- October 21 route-map connectors: consecutive located stops now retain a GeoJSON line overlay while road directions load or fail; successful directions replace it. Blank/unlocated intermediate stops are not bridged. A bounded three-city cross-border Mapbox Static Images API request returned HTTP 200/image/png with line and marker overlays. ESLint and TypeScript passed; no tests added.

- October 21 monthly-estimate diagnosis: local Convex logs showed a completed model attempt followed by `No usable monthly premium range` after approximately 4.6 seconds; the accepted estimate is current and failed. Restored the submitted-page pending/running loading card and added a terminal unavailable message. No replay, retry, inferred price, submission or data migration performed. Focused ESLint and TypeScript passed. Applicant browser verification was unavailable in the separate QA browser account because owner authorization denied opening the request.

- October 21 explicitly requested premium retry: expected failed timestamp/content hash guarded the single manual retry; accepted application remained unchanged. Convex reports completed/current USD bounds 25,000–500,000 per month. Inspection found extraordinary hazardous-material answers in the saved application; no claim was made that the output is a validated carrier price. Added independent-bound handling (minimum-only Starting from; maximum-only About; neither hidden), retaining two-bound ordering and per-amount bounds. ESLint, TypeScript and local Convex typecheck/sync passed; no tests or migrations added.

- October 21 qualifications flow: in the synthetic draft, Yes opened the separate list page; add created a second row, entered two qualifications, and remove restored one. Changing parent to No skipped the child; changing back to Yes showed an empty list, confirming old answers were cleared. No application submitted. Focused ESLint, TypeScript and local Convex checks passed. Evidence: `.context/qa/intake-walkthrough/credentials-list.jpg`.

- October 21 PR packaging: root and Convex TypeScript checks passed; changed-file ESLint passed with the existing application effect-dependency warning. Reverse-application checks confirmed both dependency patches match installed source. No tests added. Review also identified the optional vehicle verifier’s extra trace `phase` key, which the strict Jev contract rejects; removed that key while retaining task kind and trace ID. The latest premium card uses compact outer padding with larger internal row gaps.

### Single-pass historical question hints — 2026-10-21
The question-only importer reproduced 2,571 rows / 2,370 normalized unique questions without model calls. The private review carries source-line coverage hints for 2,322 unique questions (48 unknown), separate from reviewed semantic concepts. The runtime pack contains 74 reviewed generic concepts; broad pattern matches are review suggestions, not automatic equivalence or requiredness. No source account fields or answers enter the pack.
Manual shortlist diagnostics covered cyber, commercial auto, property without/with a typed property, and combined lines. All hints matched a selected line; building hints required a typed location/property; combined selection remained under 50 hints and 12,000 characters. Root TypeScript and local Convex typecheck/build passed. Focused ESLint had no errors and retained the existing application effect-dependency warning. No tests or migrations were written.
Browser QA used only synthetic draft `zh71v0s8jb90eeq1fte39rtqjd8gp3zc`. Opening Additional details scheduled one `actions/intakeFollowups:generate` action, completed in 10.3 seconds without an error. It returned a ready empty batch and navigated to review; reopening reused the same batch start timestamp, with no new generation. Application remained unsubmitted. This verifies the empty/cached path; it does not establish question quality for every coverage/application. New `single-pass-v1` definitions are excluded from the legacy date model classifier. Evidence: `.context/qa/intake-walkthrough/question-reference-review.png`, `question-reference-runtime.jsonl` and `question-reference-sync.log`.

### Intake list editing, narrow layouts and optional lookups — 2026-10-21
Actor/fixture: ordinary signed-in synthetic applicant, draft `zh71v0s8jb90eeq1fte39rtqjd8gp3zc`, Next :3207 / local Convex :3220. Planned actions: (1) add/remove/paste qualifications and reload, (2) enter/select/clear unknown limits and multiline vehicle use, (3) select/remove a long country and add/remove routes on mobile, (4) follow a review completion link. No submission or production writes. Detailed run plan is in ignored `.context/qa/intake-polish/plan.md`.

| Case | Observed defect / change | Retest outcome |
| --- | --- | --- |
| Qualification rows | Add kept focus on its button; Remove lost focus to body; multiline paste concatenated entries. | Passed: Add focuses the new input, Remove focuses the next/previous surviving input, multiline paste creates distinct rows, and rows/values survived reload. Over-15 paste preserved original values and showed an accessible error. Tested at 390px and 1280px. |
| Country pills | A long name overflowed at 320px and hid its X. The hidden FieldLabel also overflowed despite `sr-only`, because primitive width styles won. Removing a pill lost focus. | Passed: wrapped name/X fit in 272px; document scroll width is exactly 320px. Dropdown Y remained 408.67px between zero and one long country. Removing the last pill focuses the closed dropdown. FieldLabel now explicitly retains one-pixel hidden width. |
| Blank vehicle lookup | Skipping year/make/model and opening a specification-backed question invoked the action and produced “Enter the vehicle year, make and model first.” | Passed: the frontend guards missing/incomplete identity; revisiting/reloading the blank seating page produced no new lookup errors. Results/selections are scoped to current identity/field; VIN is excluded from the cache identity. Manufacturer-success behavior was not reverified in this pass. |
| Empty route rows | Add stop/Add route immediately disappeared because all-blank routes normalize to an empty answer. | Passed: local empty editing rows remain visible; add/remove works before typing without marking an answer or disabling Skip. Toronto → Montreal was entered through city search; adding an unfinished stop disabled Continue, removing it re-enabled Continue, and the completed route recovered after reload. Connector preview was visible. |
| Unknown controls | No new defect. | Passed: currency and multiline values restored after selecting/deselecting unsure; mobile actions remained below/full width and desktop multiline actions remained below. |
| Review completion | No new defect. | Passed: professional-liability selection and blank/skipped qualifications were restored; review preserved skipped answers. The desired-effective-date completion link opened “When do you need coverage?” with the correct date field. Draft remained unsubmitted. |

Evidence: `.context/qa/intake-polish/qualifications-mobile.png`, `qualifications-desktop.png`, `country-pill-mobile.png`, `types-final.log`, `lint-final.log`. Root TypeScript and focused ESLint passed (the pre-existing missing `data` effect dependency warning remains). No tests, migrations, model-route changes or production deployment. Light theme and a successful manufacturer-specification retrieval were not run in this pass. Synthetic country/travel history remains in dormant auto answers after restoring the original professional-liability selection; temporary route cities and qualification strings were cleared. The macOS raw-free sampler understated available memory; `memory_pressure` reported 32–51% available during checks, and heavy checks were run sequentially.

## Intake System One audit — 2026-10-21

Actor/fixture: ordinary signed-in synthetic applicant, local draft `zh71v0s8jb90eeq1fte39rtqjd8gp3zc`, Next :3207 / Convex :3220. Run plan: `.context/qa/intake-system-one/plan.md`. No submission, production writes, migrations or test files.

| Case | Outcome / evidence |
| --- | --- |
| Description → industry/category | Passed. “We haul general freight for businesses using trucks.” filled Transportation & Logistics and Trucking & Freight. Both survived reload. Local telemetry recorded one complete `intake_description_industry` request (672ms), with no new request on reload. |
| Manual classification wins | Passed. Selecting Courier & Delivery and changing the description retained that category; subsequent website suggestions also preserved the manual industry/category. |
| Website source unavailable | Passed fallback. The original fixture domain `bonita-trucking.com` did not resolve and returned no cited content. Manual entry remained available and no failure banner appeared. |
| Website verification | The first reachable-site run failed with a generic decision-provider error. No unsupported answer was merged. The revised path extracts short exact excerpts with each atomic statement/founding-year proposal, checks literal grounding in code, and sends compact excerpt state to Jev. A fresh Cloudflare website context completed one verification request (441ms), populated the business description and founding year 2009, and preserved the manual classification. This demonstrates the revised path; the generic earlier provider error does not establish a definitive upstream cause. |
| Cyber | Source/contract audit only in this pass. Candidate IDs now use an enum of supplied questions; primitive validators remain. Candidate evidence is structured state, conflicting duplicate answers are omitted, and missing policy URLs are null rather than invalid undefined JSON values. Discovered policy/terms URLs now require their own grounded excerpts, so Jev verification no longer receives the full retrieved website text. No fresh end-to-end cyber enrichment run was performed. |
| Vehicle relevance/specifications | Source audit only in this pass. At most 100 independent relevance Nouls share one request (router cap128); variant-specific specification proposals omit the universal-variant question. Existing exact source/numeric/unit guards and manual fallback remain. No fresh manufacturer success run. |
| Uploads, catalog, final questions, premium | Source audit. Requirement classification changes eight rows to16, seven judgments per row (112<128), retaining known-payload splitting. Workforce question labels are structured evidence. Catalog selection remains local. Terminal gap/novelty/primitive selection remains exactly one generation; premium remains its separate bounded structured generation. No additional retries or agent loop introduced. |

Evidence: `.context/qa/intake-system-one/industry-category-prefill.png`, `website-prefill-review.png`, `model-events-final.json`, `types-final.log`, `convex-types-final.log`, `lint-final.log`. The earlier website failure's retrieved evidence is retained even when verification fails. The synthetic fixture now uses Cloudflare public-source facts with the deliberately retained manual Transportation & Logistics / Courier & Delivery classification; it remains an unsubmitted QA record. No real submitted application was changed. Confidence thresholds were not recalibrated against labeled examples; uncertain facts remain for the applicant to answer. Browser viewport styling was not changed in this backend-focused pass.

### Agent trace presentation — October 19, 2026

Cloud Chrome (headed, existing desktop session) exercised the actual shared
ChatAssistantTurn and ThinkingSummary components against controlled activity
fixtures served locally. The fixture includes a running search with no completed
audit entry, so its domain must come from execution-start metadata. Verified:

- One visible active indicator, alongside the active row; a single accessible
  status announcement. Empty activity, model wait and hidden-activity preferences
  retain their standalone loading indicator; streaming-off stays responsive.
- Site labels and circular favicons, overlapping icons and website counts for
  multiple targets, with all listed domains available through keyboard focus.
- Concise setup outcomes, repeated identical completed stages grouped with a
  count, and failed/interrupted/awaiting-approval states still explicit.
- Completion collapses activity, reopening preserves context, and settled rows
  have no spinning indicator. Desktop and 390px dark mode have no horizontal
  overflow; reduced motion is respected.

Artifacts: `.context/trace-ux/qa.mjs`, `browser-qa.txt`, `planning.png`,
`search.png`, `multi-desktop.png`, and `multi-mobile-dark.png` (workspace-local).
Existing 127 tests pass; no new unit tests or Vercel preview testing. The release
PR records the separate authenticated production acceptance after deployment.

Production acceptance on release `1105c245` (PR #487): authenticated cloud Chrome
at `/operator/brokers` completed a read-only Allianz/Chubb research turn with a
required plan and two successful searches. Websocket samples recorded the first
`2 websites` context while running before any audit calls existed, and the later
`allianz.com` context while running. Both circular favicon treatments rendered;
keyboard focus revealed both multi-site domains. Artifacts are
`.context/trace-ux/live-evidence.json`, `live-planning.png`, `live-research.png`
and `live-complete.png`. No business records were changed. Live review prompted
a final presentation reduction: omit generic completed stage rows when that
stage has a factual outcome, keep the plan row to its step count, and use
singular count labels. The local browser scenarios were repeated for this
reduction, including an extra generic completed model/tools pair alongside the
factual outcomes; these rows disappear without inflating the duplicate count.

Trace alignment follow-up: the icon column and content group now share a 24px
minimum first-line height instead of a fixed icon top offset. Headed Chrome
measured the website-row icon/text center difference falling from 2.20px to
0.20px at both 1100px and 390px widths; plain stage rows differ by under 0.01px.
No horizontal overflow. Screenshots: `.context/trace-ux/aligned-1100.png` and
`aligned-390.png`; repeatable measurement: `alignment.mjs`. Focused ESLint and
root typechecking passed; no new unit tests.

## Website tech browser skill outcomes — October 20, 2026

Independent native-local consumer QA is recorded in
[the focused report](website-tech-skill-outcomes-sol-2026-10-20.md). It covers
normal operator OTP entry, actual Profile Tech stack rendering, all known and
unknown skill labels, four statuses, legacy/empty/failed states, bounded consumer
responses, sanitized storage and actual registered operator tool projections,
role/tenant exclusion, and live Rescan updates. The report distinguishes local
executor evidence from untested HTTP/OAuth MCP transport and provisional router
configuration/provider execution. No product edits, new unit tests or deployments
were part of the QA packet. Candidate corrections and final cleanup are recorded
in that report rather than silently treating initial failures as passing.

Native router CAPTCHA acceptance remains incomplete. These independent Sol
reports preserve failed candidates and their repeatable artifacts:

- [Live ca0 baseline](browser-native-live-sol-2026-10-20.md): real Jev/Box and
  native cursor movement, followed by refusal; neither demo solved. The three
  authorized customer forms were inspected without fields or submissions.
- [Live 96d retest](browser-native-live-sol-96d1db5-2026-10-20.md): improved
  presence classification, but small hover crops were rejected by the provider;
  Turnstile's action gate also refused. Zero press/release events.
- [7ad provider diagnostic](browser-provider-diagnostic-sol-7ad8e5e-2026-10-20.md):
  one padded-image request reached the provider with exact embedded pixels, but
  hover-only confidence remained below the required threshold. No browser input
  or native-click acceptance is claimed.
- [a19 gate diagnostic](browser-gate-live-sol-a19f6fa-2026-10-20.md): a fresh
  screenshot reached the gate, but relevance was 0.58. The full historical
  observation was not retained; the report marks reconstructed fields.
- [4bbe gate diagnostic](browser-gate-live-sol-4bbe20e-2026-10-20.md): the full
  actual request was retained before inference, with the screenshot inside the
  observation and an explicit CAPTCHA action. Relevance was 0.65 against 0.7;
  neither the native primitive nor any input command ran.
- [a055 preserved-image diagnostic](browser-provider-diagnostic-sol-a055d14-2026-10-20.md):
  the original native Box plus four-pixel margin excludes 108 of 300 changed
  pixels. The unchanged comparison returns false before inference; that packet
  never reached the six-question provider comparison.
- [d28 gate reachability](browser-gate-live-sol-d28fb67-2026-10-20.md): one real
  gate decision passed with relevance 0.78 and reached the diagnostic stop spy.
  Goal and questions were unchanged. Zero native inputs; this does not establish
  a CAPTCHA solve or the cause of the changed score.
- [857 inbox readiness](browser-inbox-readiness-sol-2026-10-20.md): actual
  trusted-HTTPS refusal checks passed with zero messages exposed. Real delivery,
  positive read and acceptance remain blocked on the exact sender address and
  existing MCP conversation ID; no email was sent.
- [857 native demo run](browser-native-live-sol-857074d-2026-10-20.md): Turnstile's
  testing-key widget showed Success after native top-page motion and one
  press/release. V2 refused before pressing because two hover checks fell below
  threshold; its quota warning was already present and unchanged. Neither result
  establishes production challenge strength or host-form acceptance.
- [af229cc comparison corpus](browser-comparison-sol-af229cc-2026-10-20.md): the
  preserved v2 pair and an independent border-only hover both produced false
  negatives at the unchanged threshold. Six semantic changes were refused, an
  instruction change failed deterministic containment, and unchanged pixels
  passed without inference. Eight real requests, no retries or native input;
  exact image transforms and per-question wire references were verified. This
  remains a functional failure, not native CAPTCHA acceptance.
- [Frozen Jev 1.14 screen](browser-comparison-model114-sol-2026-10-20.md): eight
  original requests changed only the model. The independent border-only case
  passed, but the saved real-widget hover still failed; all six negative cases
  refused. The candidate was rejected, with no production model change.
- [Independent 0.8 cutoff screen](https://github.com/claritylabs-inc/cl-router/blob/ef3c3d836740271debb14ff52a5490ddc82e8850/test-harness/browser-agent/reports/heldout-calibration-af229cc.md):
  the second cosmetic case failed with selection probability 0.56. The declared
  fail-fast run stopped after two requests; nine eligible cases were not run and
  one case refused deterministically. The cutoff was rejected; runtime stays at
  0.9. This does not establish negative-case or native performance.
- [Single stronger-model probe](browser-hover-reasoner-probe-sol-2026-10-20.md):
  one frozen saved-widget pair returned all six `yes` from the configured
  broker's `openai/gpt-5.6-sol` route. Manager verified the request reconstruction,
  13 artifact hashes and 14 source blobs. This accepts only that exposed
  regression: no negative corpus, native integration or cascade adoption was
  tested. Provider-default effort and broker transport differ from the proposed
  direct helper; internal provider attempt count and `store:false` are unproven.

Controlled regressions on exact router `af229cc` are separately accepted:
[616 distinct skill requirements](https://github.com/claritylabs-inc/cl-router/blob/0c503dc0fa77c1069a23be08752f66d24016a54b/test-harness/browser-agent/reports/final-af229cc.md)
passed, while the
[772-workflow runtime union](https://github.com/claritylabs-inc/cl-router/blob/47ce2cee428f27e1dbee88ad8f4bf772e13c6270/reports/runtime/af229/final/README.md)
records 768 passes, three unverified cases and one limitation. These use actual
local Chrome with scripted decisions. Pinned-Chrome OOPIF availability, competing
client behavior, hosted isolation and external availability retain the report's
explicit limits. These results do not clear the real-provider hover failures.

[Final Spot consumer QA](website-tech-final-consumer-sol-2026-10-20.md) on
`cc8bb050` verifies the exact `af229cc` contract bytes (22 fixtures, 11 operations),
15 actual local UI groups, eight boundary groups, five access groups and six
request-construction groups. Keyboard entry, reload and Rescan subscriptions
pass. The existing 416px inner-shell overflow at a 390px viewport remains open;
skill text wraps within its card. The [empty-state addendum](website-tech-empty-consumer-sol-2026-10-20.md)
verifies an actual null tool/query result and the unscanned UI before any scan,
with zero profiles and router jobs before and after. Synthetic request seams and local executor checks do not
establish provider execution or HTTP/OAuth MCP acceptance.

These reports do not establish hosted sandbox isolation, production challenge
solving, controlled inbox delivery, or customer submission acceptance. Release
acceptance remains incomplete.

## Coverage terms consent — October 21, 2026

Node 24 root and Convex typechecks and touched-file ESLint passed (the existing
`application.tsx` effect dependency warning remains). `/intake/terms` returned
HTTP 200 on the existing local server at port 3207; browser accessibility output
confirmed the public terms heading, incorporated organization-terms link and
limited representation/purchase-approval text. Source review covered checkbox
defaults, disabled begin/section shortcuts, saved draft version, owner/revision
checks, server-derived acceptance actor/time and final submission gate.
Full authenticated consent/reload/submit and responsive card workflows were not
run; no agreement was accepted, application submitted or backend deployed.
Repeat by opening an unaccepted quote’s Coverage introduction, confirming Begin
and section shortcuts are disabled, opening the terms without toggling consent,
then checking in a synthetic local fixture, continuing and reloading. Uncheck on
return and verify the gate returns; submission without the current acceptance
must fail. Savings reviews must retain their existing flow.

October 21 PR follow-up: local non-saving component preview on current main’s
locked UI 0.12.0 dependency passed text click, empty right-padding click and direct
checkbox click (one toggle each). Terms-link click left consent unchanged and
Begin/section shortcuts disabled. The temporary preview route was removed.
The existing authorization-test fixture was updated with user approval to accept
the terms through the normal owner-scoped save path; all 133 existing tests passed.
No new tests were added. Root and Convex typechecks and repository lint were rerun
against current main’s locked dependencies before publishing the PR.

## Provider appetite and ACORD catalog — October 22, 2026

Local Chrome at `localhost:3207` passed provider Appetite review: geography and
ACORD lines render in separate row cards, saved lines show readable names and
exact codes, and searches for `CYBER` and `Management` return the corresponding
catalog options. No appetite selections were changed during browser checks.
All 82 local provider records were audited against the extracted PCS 2.11.0
`LOBCd` list: 65 have valid, sorted, unique recorded lines; 17 remain unknown.
The source has 107 codes; the provider selector excludes `UN` and `BLANK`.

Country, state/province and ACORD selectors use the shared `control.menu` role.
Browser computed styles confirmed identical **13.6px font / 20.4px line height**
for selected values, popup search inputs and options in all three dropdowns.
The shared package patch adds explicit typography selection and carries the role
through portals; app CSS prevents the older operator form overrides from
changing that role. Other callers retain the default input typography.
The patch was verified against clean package source using patch-package’s own
parser and application engine.
Root TypeScript, touched-file lint and whitespace checks passed. No tests added.

Evidence: `.context/qa/provider-acord/coverage-lines.png`,
`dropdown-typography.png`, `provider-audit.json` and `providers-after.json`.
The model extraction and source boundaries are documented in
`docs/architecture/acord-provider-appetite.md`.

## Provider relationship contacts — October 22, 2026

Local Chrome at `localhost:3207` passed Contacts tab create, name/notes autosave,
ACORD `EO` selection, reload persistence, removal and Undo. The synthetic contact
was removed again after verification. Reviewed the populated Polaris cards with
its distinct property and lawyers' professional liability contacts.
Root TypeScript, touched-file ESLint and whitespace checks passed. No tests or
database migrations were written. The additive contact table/functions were
pushed only to the existing local Convex instance at port 3220.

Researched all 82 existing external provider records using public provider
websites and official team/contact pages, with web-search follow-up for crawler
gaps and redirected agent identity. Added 159 contacts, including 66 entries
with named people/titles. All 159 retain sources and evidence. Four contacts have
explicitly evidenced ACORD specialties; other coverage preferences remain blank.
Memberships and portal access were not changed; production was not written.
The bounded operator detail output now includes `networkContacts`; directory
reads omit contact bodies.

Evidence: `.context/provider-contacts/reviewed.json`, `import-results.json`,
`verification.json`, cached public pages, `typecheck.log`, `lint.log`, and
`contacts.png`. [Research coverage](../research/provider-contacts-2026-10-22.md)
records the reviewed source for each provider. The local contact data is not a
committed fixture or production backfill.


October 22 contact follow-up: Contacts uses shared `FormSection` for an unboxed
title/action row. Contact cards expose only Name, Email, Phone, Best for and Notes;
role, title, contact page and provenance remain persisted but hidden. Browser
review of Vouch confirmed the five fields and unboxed header. Root/Convex
TypeScript, touched-file ESLint and whitespace checks passed. No tests or
database migrations added. Creation now deduplicates email plus name, allowing a
named person and general team to share a mailbox without collapsing entries.

Local data audit: 228 active contacts across 82 providers, all with emails and
a general email route, 120 named entries across 52 providers, 20 claims contacts.
Solutions Specialty's address is explicitly marked HIGH_PROBABILITY/unconfirmed;
shared office addresses are distinguished from direct work email in Notes.
Evidence: `.context/provider-contacts/final-verification.json`, public crawl and
directory lookup artifacts, `followup-typecheck.log`, `followup-convex-typecheck.log`,
`followup-lint.log`, and `simplified-contacts.png`. Production was not changed.
