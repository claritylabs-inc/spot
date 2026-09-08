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
| INTEGRATE | Client / Mailboxes and integrations | Open create/detail panels, validate missing/invalid input, inspect disconnect/recovery and OAuth denial; mark external authentication untested without a disposable account. |
| CHANNEL | Operator / Channels | Inspect Slack/iMessage/MCP setup and linked identity, edit reversible local identity and restore; exercise mock Slack where configured; do not send to live channels. |
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
| THREAD | Passed exercised local workflows | Sidebar keyboard opening, archive/restore, full conversation navigation and grounded operator policy task passed after local model setup and rich-tool argument fix. Cancellation still to run. |
| PROFILE | Partial pass | Operator/client name persistence, invalid-phone recovery, appearance and mobile rendering passed. Privacy/email panels inspected; irreversible account deletion excluded. |
| POLICY, CERT, FILE | Partial pass | Client read-only policy details/source preview, client allowed-file isolation/download, synthetic certificate generation/version 2/download/archive/restore passed. Fixed PDF Download opening tabs and client read-only visibility switch changing visually. Operator upload/edit and requirement-backed certificate cases underway. |
| WIKI, ORG, SETTINGS | Passed exercised edits; follow-up underway | Wiki immediate-close/offline/retry and required-name validation passed; behavior/certificate/beta toggles restored. Notification autosave and restoring inherited defaults passed. |
| INTEGRATE, CONNECT | Partial / external prerequisite blocks | Invalid vendor input and local pending invitation creation passed; cancel/sidebar and invalid mailbox inputs fixed and browser verified. Live IMAP/OAuth/Slack reinstall requires disposable credentials. |
| CHANNEL, ROUTING, TELEMETRY | Partial pass | Local Slack identity save/reload/restore, MCP setup copy, read-only router refresh/filter, Models desktop/mobile, telemetry search/detail passed. Operator model configured only in native-local Convex. Mock channel turn, terminal turn and MCP client authorization remain. |
| PUBLIC | Passed negative/public-report paths | Invalid share/connection tokens, missing/unknown OAuth client fail safely; routing-weather report responsive. Valid packet snapshot remains in PACKET lane. |
| CLIENT, COMPLIANCE | Passed exercised edits | Synthetic operator client/supplier creation, client search, website/name autosave and restoration passed. Manual requirement/source autosave, invalid-draft recovery, accurate evidence gap, disabled certificate generation and archive cleanup passed. Operator policy upload remains in POLICY. |
| REQUEST | Partial | Client seeded packet exposes allowed narrative/sections/files without private proposal/market activity. Synthetic client request submitted and persisted in list; attachment workflow remains. |
| AGENT, PACKET, PROPOSAL, EMAIL | Not run this pass | Prior procurement evidence is a baseline; current regression and client agent turn remain. |
| LEADS | Empty state only | No local synthetic lead yet; populated lifecycle remains. |

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
This still needs local configuration and rerun; it is not a successful agent
workflow. Client settings navigation discovery covered every exposed settings
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

Visible operator Chrome is on CDP port 9222. Visible client Chrome is on 9223
with persistent profile `.context/qa/platform/client-chrome`; use it for the
remaining client workflows without repeated sign-in. The first independent
contexts were closed after each run. Their saved storage snapshots may be stale;
prefer the live persistent sessions. A missing fresh OTP capture is an execution
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
