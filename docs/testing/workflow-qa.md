# Platform workflow QA

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
| WIKI | Operator/client / Company wiki | Open the Markdown document, import/edit/download allowed prose, close/reload, preserve text during live source updates; client admin rights and read-only impersonation hold. |
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
| GWSCAN | Operator / Channels and affected records | Follow [scheduled Workspace reconciliation acceptance](workspace-scan.md) for synthetic scheduled collection, activity review, conditional correction, safe record creation and client-visible outcome checks. Keep live scanning disabled. |
| ROUTING | Operator / Routing | Inspect Routing/Models/Tools, refresh, filters and details; verify long data/mobile rendering. Shared router changes are read-only during local QA. |
| TELEMETRY | Operator / Telemetry | Switch extraction/model views, inspect empty/populated failures and drill-down, verify recoverable errors and navigation. |
| LEADS | Operator / Demo leads | Inspect empty state and synthetic public chat if locally available, open lead details and conversation, preserve prospect privacy. |
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
| LEADS | Passed synthetic populated lifecycle | Keyboard detail opening, stored lead facts/conversation, delete cancellation, confirmed deletion and mobile rendering passed. Internal fixture creation does not prove live public-demo ingress. |
| WEBMCP | Passed scripted headless run (September 24, 2026), with model steps blocked | 171/174 checks passed. The other 3 were blocked because the local router rejected every job with 422: deeper requirement check, requirement import, and agent drafting. Artifact: `.context/qa/webmcp/results.json` plus screenshots. The run executed 95 imperative and all 7 declarative tools against native-local Convex, with email in capture mode. Policy upload: the client drawer, `upload_policy` combined/separate/duplicate/non-PDF, a member-role upload, own-upload archive/restore/cancel, extraction started, and Archive shown only on client uploads. Direct Convex calls: operator upload still works; connected clients, broker orgs, staff-upload archive, and extraction on another user's policy are rejected. Extraction completion needs the extraction worker, which was not running. Not executed: Slack, IMAP mailbox, and destructive profile deletion. It used a stub `modelContext`. |
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
blob downloads, and the audited action boundary. Native-local operator Models
now selects the existing OpenAI GPT 5.6 Terra route; a fresh browser task returns
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
reinstallation, Photon traffic or public-demo provider ingress; these need
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


## Scheduled Workspace integration acceptance

The [scheduled reconciliation ledger](workspace-scan.md) records collection,
authorization, domain/import and UI evidence for the integrated feature. Final
headless checks used captured local OTPs in isolated operator/client profiles:
disabled defaults, keyboard activity and provenance, reported external purchase,
conditional correction and later-change conflict, and client-safe mobile outcome.
Fixtures were cleaned or restored. Visible desktop and live provider-to-extraction
browser execution were not run; synthetic action tests cover that backend flow.

## Cloud live-review setup — September 14, 2026

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
| Native PDF conversion | Initial HTTP conversions failed because Amazon Linux glibc was too old for LiteParse. An isolated workspace-local glibc 2.41 loader repaired the worker launch; authenticated synthetic PDF conversion returned 200, expected text, two source spans, and one page image. Evidence: `parser-result.json`, `parser-smoke.mjs`. | Failed setup prerequisite, repaired and passed |
| Operator agent | Required local operator route was initially unset. Selected OpenAI `gpt-5.6-terra` through the rendered Models tab, verified persistence, then submitted a read-only policy lookup through the portal. The response matched the seeded Cove policy and carrier. Shared router policy was unchanged. | Passed |

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
