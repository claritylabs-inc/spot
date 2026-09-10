# Platform workflow QA

Follow `.agents/skills/cl-workflow-qa/SKILL.md`. This guide captures the user's
cloud-Chrome method and September 8, 2026 feedback. Scripts below specify desired
behavior before execution. Evidence lives in `.context/qa/platform/`.

Use the native-local app at `http://localhost:8080`, visible desktop Chrome,
local email-capture OTPs, and seeded operator (`terry@claritylabs.inc`), client
(`adyan@cove.dev`), and broker (`terry@montgomeryrisk.com`) identities. Keep each
role in an isolated context. Use synthetic fixtures for writes and restore
original values afterward. Do not send live email, change shared router state,
bind coverage, or alter production while testing.

For every edit: verify autosave, immediate close, reopen/reload, record switching,
failed-save recovery, keyboard operation, mobile width, and light/dark rendering
where relevant. Tables contain data and sidebar navigation; record actions and
uploads belong in sidebars. Use organization icons in selectors, toast progress,
and concise labels. Explicit creation and consequential actions remain explicit.

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
| WIKI | Operator/client / Company wiki | Open sections, edit allowed prose, close/reload, preserve text during live source updates; client admin rights and read-only impersonation hold. |
| REQUEST | Operator/client / Requests | Create synthetic request, edit narrative/status in sidebar, verify client allowlisted view, archive if supported; operator-private market/proposal data never appears for client or broker. |
| PACKET | Operator / Request packet | Edit multiple sections, immediate close/reopen, concurrent stale edit retains draft, change audience, generate/replace shared snapshot; public page excludes private sections and old link is revoked. |
| PROPOSAL | Operator / Proposals | Choose branded broker, edit request-specific contacts/log, upload multiple/revised PDFs, reject invalid files, inspect PDFs/Terms tabs, review gap and stale revision; no selection/binding during QA. |
| EMAIL | Operator / Request correspondence | Inspect forwarding address, imported synthetic email and attachment, file to correct broker/request; ambiguity requires explicit selection and replay cannot duplicate records. |
| CONNECT | Client / Vendors and Clients | Inspect empty/populated lists, create local synthetic connection request, view/revoke pending request, inspect shared policy access; exercise invalid public request token. |
| ORG | Client / Settings organization | Edit profile/company facts, verify autosave and required-field errors; branding and access stay standalone. |
| SETTINGS | Client / Agent and workflow settings | Exercise each visible tab, wiki/channels/behavior, certificate settings, notifications and beta flags; persist reversible local toggles and restore. |
| NOTIFICATIONS | Client / Notification tray | Inspect empty/populated tray, open a scoped record link, mark individual/all items read, reload and verify persisted state; synthetic local items only. |
| INTEGRATE | Client / Mailboxes and integrations | Open create/detail panels, validate missing/invalid input, inspect disconnect/recovery and OAuth denial; mark external authentication untested without a disposable account. |
| CHANNEL | Operator / Channels | Inspect Slack/iMessage/MCP setup and linked identity, edit reversible local identity and restore; exercise mock Slack where configured; do not send to live channels. |
| GWORKSPACE | Operator / Channels and agent | Sign in with captured local OTP, configure manual and Directory mailbox modes in the Google Workspace tab, verify validation, persistence, disabled/missing-credential failures, role boundaries, and the shared operator tool registry. Exercise a synthetic registered-tool model path and protected attachment behavior without Gmail writes; report live delegated-mailbox search/read/download as blocked unless an authorized service-account credential is present. |
| ROUTING | Operator / Routing | Inspect Routing/Models/Tools, refresh, filters and details; verify long data/mobile rendering. Shared router changes are read-only during local QA. |
| TELEMETRY | Operator / Telemetry | Switch extraction/model views, inspect empty/populated failures and drill-down, verify recoverable errors and navigation. |
| LEADS | Operator / Demo leads | Inspect empty state and synthetic public chat if locally available, open lead details and conversation, preserve prospect privacy. |
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
| GWORKSPACE | Partial pass / external prerequisite block | Rendered native-local operator setup, authorization, validation, manual/Directory persistence, disabled and incomplete-credential behavior, a real model-selected registered read tool, and compact settings rendering passed. Cross-channel registry, replay, revocation, and protected-original boundaries passed focused automated coverage. Live delegated mailbox listing/search/thread/attachment retrieval and source-grounded reasoning are blocked because no authorized service-account credential is available; ordinary administrator OAuth is not DWD. User-visible desktop Chrome was not run because this cloud workspace exposes no desktop/browser control. |
| PUBLIC | Passed exercised public paths | Invalid/revoked links and missing/unknown OAuth clients fail safely; routing-weather report responsive. Valid packet snapshot download, immutability and private-file exclusion passed. |
| CLIENT, COMPLIANCE | Passed exercised edits | Synthetic operator client/supplier creation, client search, website/name autosave and restoration passed. Manual requirement/source autosave, invalid-draft recovery, accurate evidence gap, disabled certificate generation and archive cleanup passed. Operator policy upload/retry is recorded in POLICY. |
| REQUEST | Partial | Client seeded packet exposes allowed narrative/sections/files without private proposal/market activity. Synthetic client request submitted and persisted in list; attachment sidebar/upload-failure recovery/download and direct navigation after creation passed. |
| AGENT | Passed exercised local flows | Client policy question returns correct seeded declarations/limits and survives reload; cancellation, archive/restore and mobile rendering passed. A synthetic PDF can be staged/removed/restaged, read accurately, reopened from history and previewed after reload. |
| PACKET, PROPOSAL, EMAIL | Passed exercised local flows | Section autosave, immutable/revoked snapshots, public download/privacy, proposal gap/staleness, two-PDF extraction/review and email replay/classification/revision/download passed. Concurrency/failed-switch safeguards covered by focused tests; advanced edges listed below. |
| LEADS | Passed synthetic populated lifecycle | Keyboard detail opening, stored lead facts/conversation, delete cancellation, confirmed deletion and mobile rendering passed. Internal fixture creation does not prove live public-demo ingress. |
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

The packet pass verified two-section persistence, immutable old snapshots,
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
settings and credential values were removed, and the local integration finished
disabled.

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

| Outcome | Cases |
| --- | --- |
| Passed | Rendered OTP/setup and configuration workflows; manual and Directory validation/persistence; draft recovery; unauthenticated, tenant, disabled-config, incomplete-credential, and disabled-operator boundaries; real model/registry/audit fail-closed invocation; synthetic cross-channel and protected-original automated assertions. |
| Failed, then fixed and passed | Manual-mode zero-checked verification lacked an actionable reason; the sanitized aggregate diagnostic and incomplete-credential presentation passed focused before/after rendered retests. No unresolved defect remains from the exercised cases. |
| Blocked | Live organization mailbox discovery, Gmail search, thread reads, attachment retrieval, and current-conversation reasoning require `gmail.readonly` domain-wide delegation through the backend service account. No such credential is present. Existing ordinary administrator OAuth can read the Directory but lacks Gmail scope and cannot prove DWD. |
| Not run | User-visible cloud desktop Chrome because no desktop/browser-control surface is available; live Slack, iMessage, or MCP traffic; Gmail sends, labels, scheduling, ingestion, production writes, key creation, or Workspace authorization changes. Headless system Chrome supplied rendered supplemental evidence only. |

Private screenshots, browser scripts, redacted prerequisite notes, and model/audit
checks remain under `.context/qa/google-workspace/`. The tracked scenario contains
no live mailbox addresses, message/thread identifiers, filenames, transcripts,
insurance facts, or credentials. Integration-owner validation on the preceding
checkpoint passed 103 files and 299 tests, native-local Convex deployment, app
TypeScript/build, and changed-source ESLint; the retained provider, verification,
header-parser, replay, attachment, and authorization updates subsequently passed
103 files and 300 tests plus native-local Convex deployment. Those full checks
were not redundantly rerun in this workspace.
