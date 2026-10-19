# Platform workflow QA

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

Acceptance workflow (pending production verification):

1. Submit a simple answer-only question: no business plan when all four Jev answers confidently say no.
2. Submit the original 13 broker domains as a read-only directory comparison. Observe complexity assessment, a distinct saved plan before the first business call, per-target searches or a disclosed bounded list, and an answer covering every target. A rejected batch is not a no-match result.
3. Reload while planning and after completion; the plan is retained and the durable planner invocation is reused. Stop a new run during planning; no business tool may execute after cancellation.
4. Ask for a read using an invalid identifier, then recover via an authoritative lookup. Verify structured error code, corrected call and final answer. Persistently invalid calls must exhaust after three corrective model iterations, not loop or claim absence. Do not manufacture production writes to test failures.
5. Recheck collapsed Plan/error disclosures, Show thinking preference and narrow viewport. Existing approval, authorization and unknown-outcome boundaries receive code review and existing automated coverage.

No new unit tests or Vercel previews are used. Results and artifact locations are recorded after integrated acceptance.
