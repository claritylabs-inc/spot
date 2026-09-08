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
| BROKER | Partial pass | Website autosave on immediate close/reopen; invalid-state rejection retains draft and recovers; status edits retain the sidebar when filtered out; keyboard row opening and 390px layout passed. Creation, logo upload, and same-field concurrency remain to run. |
| BPROFILE | Partial pass | Broker OTP login, website autosave/reload and restoration passed; operator status restriction and partial-update preservation covered by Convex regression. Logo, live-draft and role UI cases remain. |
| THREAD | In progress | Baseline desktop Chrome showed Archive action inside thread rows; fix pending. |
| CLIENT, CHANNEL, ROUTING, TELEMETRY, PROFILE, LEADS | Discovery only | Operator routes rendered in desktop Chrome. Routing talks to shared dev; do not mutate it. |
| All remaining IDs | Not run | Execute the scripts above and expand them when further reachable workflows are discovered. |

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
