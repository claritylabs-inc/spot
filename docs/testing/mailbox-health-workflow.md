# Dedicated mailbox delivery and health

Actor: authenticated operator without impersonation. Local target: localhost:8080,
local Convex 127.0.0.1:8083, EMAIL_DELIVERY_MODE=capture. Run: October 27, 2026.
No real messages or mailbox credentials used in this QA run.

## Acceptance workflow

1. Navigate through Email health; show the five reserved addresses, actual connection
   state, disabled limits for unconnected mailboxes, and a local capture banner.
2. Search, clear, sort and switch Mailboxes / Sending activity / Placement checks.
   Empty searches explain that there are no matches. Enter activates a focused tab.
3. Connect using a synthetic password; capture must refuse external access and
   save no connection. Closing/reopening clears the password.
4. Record a clearly labelled local QA placement observation, then reload and
   verify persistence. Do not present synthetic local results as live placement.
5. Inspect light/dark and 200% browser zoom; verify the connection drawer remains
   usable at the narrow effective viewport. Restore system theme and 100% zoom.
6. Live rollout (separate external gate): verify real SMTP/IMAP access, pause/resume,
   quota scheduling, a real seed send, a reply with attachments and unknown-send
   reconciliation. Existing sender approvals must be reviewed after identity changes.

## Evidence ledger

| Workflow | Status | Evidence |
| --- | --- | --- |
| Navigation / five mailbox rows / disabled state | Passed | Helium rendered actual unconnected state and local capture banner |
| Search / empty state / sorting / tabs | Passed | zac@ filter, no-match text, descending address sort, three views and Enter activation |
| Capture connection refusal / password lifecycle | Passed | Explicit capture refusal; no saved connection; reopened input empty |
| Placement save and reload | Passed locally | Synthetic Missing observation with `LOCAL QA FIXTURE — no email was sent` note persisted; capture overview says Local preview |
| Light / dark / narrow connection drawer | Passed | health-light.png, health-zoomed.png, health-narrow-connection.png; restored original System theme and zoom |
| Convex typecheck and local function build | Passed | Conductor ready at 11:47:26 after latest transport edits |
| Changed frontend and transitive backend types | Passed | .context/qa/mailbox-health-20261027/tsconfig.json; final tsc exit 0 |
| Focused ESLint / diff whitespace | Passed | Changed email UI/transport/settings modules; git diff --check |
| Existing email tool regression tests | Passed | 32 existing tests, convex/lib/emailTools.test.ts; no tests added |
| Real connection / SMTP send / quota / reply / attachments | Not run | Requires live credentials and isolated live seed verification; no live readiness claim |
| Unknown / partial recipient acceptance | Reviewed, not live-tested | Unknown sends never replay. Sent-folder reconciliation only for a single-recipient envelope; multi-recipient unknowns stay locked |

## Instantly reservation

All five insurewithspot.com mailboxes were removed from sending assignments in
Spot US Businesses Treg, Hardware investor_fu, Hardware founder_fu and Hardware
Oct 7 RSVPs Team. Per-mailbox campaign views were audited empty. Final account
list shows all five Active with standard warmups and 100% Instantly health scores.
These scores are not evidence of real provider inbox placement. Adyan was briefly
paused during UI inspection and restored to Active.

Evidence: .context/qa/mailbox-health-20261027/ (gitignored), including
instantly-reserved-warmups.png and per-campaign removal screenshots.

## Fixture / operational notes

One synthetic local placement observation remains, explicitly labelled as QA.
No live credentials, real messages, production deploys or database migrations.
Local services remain running through npm run conductor:dev. Temporary typecheck
configuration and screenshots remain gitignored.

Memory pressure interrupted earlier checks. Our duplicate/heavy processes and
local services were stopped without touching the unrelated Ollama workload. After
the user freed memory, services were restarted normally and interrupted local
checks were rerun. Earlier incomplete/OOM checks are not counted as passes.
