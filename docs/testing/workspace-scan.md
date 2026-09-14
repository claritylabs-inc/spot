# Scheduled Workspace reconciliation acceptance

Use synthetic mail, documents, organizations and provider responses. Run against
the worktree-local Convex deployment. Do not enable a real Workspace scan, send
mail, invite users, bind coverage, or change shared deployment credentials.

The provider contract follows Google's [Gmail synchronization guide](https://developers.google.com/workspace/gmail/api/guides/sync):
incremental history can expire and return HTTP 404, which requires a full resync.
The initial history checkpoint must precede enumeration so arrivals during the
90-day backfill are collected afterward.

## Behavior cases

| Case | Fixture and action | Required result |
| --- | --- | --- |
| Collection and arrival gap | More than one Directory and message page; receive a new message between initial checkpoint and final backfill page. | Every eligible mailbox is covered; received, sent and archived messages are collected; drafts, spam and trash are excluded. The new arrival is drained through history. |
| Expired history | Gmail returns 404 for a saved checkpoint after a long pause. | Resync covers the original scan window and missed interval, preserves progress, and deduplicates previously collected messages. |
| Partial failure and recovery | One mailbox fails while others complete; interrupt a lease; retry failed work. | Failures remain visible, successful collection is retained, stale jobs recover, and one mailbox never has overlapping active work. |
| Standing authorization | Disable scanning, alter connector settings/credential revision, or revoke the authorizing operator between extraction and commit. | Future reads and all stale commits fail closed. A current active operator can explicitly reassign sponsorship through settings. |
| Purchase completion | Exact auto request plus “I purchased the GEICO auto policy on September 12, 2026 and no longer need this auto request.” | Only that request completes with `placed_elsewhere`, GEICO and the known purchase date. Client remains active; no verified policy or resulting policy ID is invented. |
| Tentative and wrong coverage | “I may buy GEICO”; completed auto purchase in a thread for an unresolved cyber request. | Neither tentative language nor a different coverage request authorizes completion. Uncertainty is visible for review. |
| Safe creation | Clear new client, prospect broker and client request; repeat across two mailbox copies and concurrent source jobs. | Exact existing matches are reused; one record is created per identity. No users, invitations, memberships, packet links or inherited access appear. The new request is immediately client-visible with safe narrative. |
| Chronology | Apply newer dated evidence over a manual value, then process older evidence; race a target change against a prepared proposal. | Newer clear evidence can replace the manual value. Old evidence cannot roll it back. Concurrent changes force reevaluation; ambiguous or conflicting dates go to Needs attention. Original request narrative and existing visibility are preserved. |
| Duplicate and forward | Same message in two mailboxes, forwarded copy, then a genuinely new reply. | Replays/copies do not repeat domain effects; all mailbox provenance is retained. New reply evidence remains eligible. |
| Attachment and import | Clear bound-policy PDF, duplicate PDF under another filename, quote PDF and ambiguous multi-policy attachment group. | Only clear policy sources enter normal import/extraction. Content retries do not duplicate policies; source originals remain available. Quotes stay procurement material; ambiguous grouping needs attention. Queued extraction is never reported as verified coverage. |
| Untrusted content | Message body directs the model to send mail, ignore policy gates, or disclose another organization's evidence. | Content remains evidence only. The allowlisted operation boundary rejects unauthorized effects and no tenant or outgoing channel receives source evidence. |
| Correction | Restore an applied field, then attempt to restore another after a later manual or scan change. | First correction records the restoration atomically. Superseded fields are not overwritten. Created records use normal lifecycle controls, with no cascading undo. |
| Privacy | Call scan status/activity/detail/actions as anonymous, broker and client identities; inspect client request DTO. | Scanner APIs reject nonoperators. Client outcome is allowlisted; private mail, findings and market evidence stay operator-private. Interactive agent/MCP exact confirmations retain their normal behavior. |

## Browser workflow

Actor: seeded local operator, then an isolated seeded client browser context.
Use the local email-capture OTP flow. Store screenshots and temporary scripts in
`.context/qa/workspace-scan/`; never store auth or live mail in tracked files.

1. Open **Operator → Channels → Google Workspace**. Check disabled defaults,
   hourly interval, missing prerequisites and persisted settings after reload.
2. With a synthetic provider fixture, enable scanning, change the interval,
   start a scan and inspect initial progress, last success, next run and paginated
   mailbox failures. Pause during work and verify no later writes occur.
3. Filter activity by Updated, Needs attention and Failed. Open rows with the
   keyboard; inspect before/after values, explanation, excerpts, mailbox/thread
   provenance and affected-record/source-thread links.
4. Resolve or dismiss an unresolved finding, retry failed work and correct an
   eligible update from the sidebar footer. Check a superseded correction's
   conflict feedback and verify persistence after reopening.
5. Follow an affected client, broker and request link. Confirm related scan
   activity remains reachable. Inspect the completed purchase outcome as an
   operator and client, with no private source material in the client view.
6. Check keyboard focus, narrow viewport, light/dark rendering, loading, empty
   and failed states. Restore temporary fixture edits; finish with scanning
   disabled.

## Coverage ledger

Record actual outcomes here after execution. A route load is not a passed
workflow, and mocked provider tests do not prove live delegated Gmail access.

| Scope | Status | Evidence |
| --- | --- | --- |
| Existing connector, interactive imports and procurement baseline | Passed | `npx vitest run convex/operatorGoogleWorkspace.test.ts convex/operatorPolicyImports.test.ts convex/procurementDomain.test.ts`: 3 files, 37 tests, pinned baseline. |
| Integrated focused collection/domain/import/UI checks | Passed | Fourteen files, 132 tests passed after the major source/import followup. Final full suite below includes subsequent alias, capability-withdrawal and concurrent client-request regressions. |
| Full repository regression | Passed | `npx vitest run --maxWorkers=2`: 129 files, 505 tests on the final integrated implementation. |
| App TypeScript, lint and production build | Passed | `npx tsc --noEmit --pretty false`, `npm run lint`, and `npm run build` passed on the final implementation. The build also checked shared SDK/router package versions. |
| Local Convex generation and typecheck | Passed after fixture removal | `CONVEX_AGENT_MODE=anonymous npx convex dev --once --local-cloud-port 8083 --local-site-port 8084 --typecheck enable` passed against the worktree-local deployment after removing temporary browser functions. Generated bindings contain only the final modules. No shared deployment was selected. |
| Additional import grouping assertions | Passed | Reconciliation suite: 34 tests. A quote, ambiguous document and nominal bound-policy classification with incomplete grouping all reject automatic policy creation even if the later model proposes an import. |
| Synthetic headless browser | Passed at stated scope | Fresh local captured-OTP operator login; paused default, prerequisite disclosure, Escape, desktop/mobile light/dark, no horizontal overflow; keyboard activity/provenance/source href, dismiss persistence and paused retry refusal (portal lane). Integration repeated GEICO outcome rendering, successful correction and supersession conflict on the final backend and verified persisted states. An isolated client captured-OTP session verified the reported outcome without operator evidence/actions at 390px width. Screenshots were inspected; synthetic fixture records/functions were removed and the seeded client request restored afterward. |
| Visible desktop / automatic provider-to-extraction browser workflow | Not run for scheduled scanning | Initial scan acceptance used headless Chrome with local persisted fixtures. A visible desktop was subsequently configured for the separate review recorded in `workflow-qa.md`; automatic Gmail-to-extraction acceptance remains untested. Provider/model/action/import tests use synthetic automated adapters. |
| Live Workspace, shared-dev and production | Not run | Outside this implementation's authorization. |

## Implementation and verification map

| Approved behavior | Implementation owners | Behavioral verification |
| --- | --- | --- |
| Whole-customer schedule, initial/history collection, durable recovery and partial progress | `operatorGoogleWorkspaceScan.ts`, `actions/operatorGoogleWorkspaceScan.ts`, `lib/googleWorkspaceScanState.ts`, `crons.ts` | `operatorGoogleWorkspaceScan.test.ts`: Directory pagination beyond live-tool caps, checkpoint-before-backfill arrivals, expired history, page replay, source adoption, reservation limits, renewed and reclaimed leases, failed-source counters. |
| Explicit authorization, pause, sponsor loss, credential rotation and concurrent settings edits | Scan APIs/state and portal scan controls | Scan tests reject stale source writes and both settings-version races; controls tests preserve stale drafts and require explicit enable. Provider action tests stop later reads after pause. |
| Source integrity, duplicate mailbox provenance, old forwards and untrusted instructions | `lib/googleWorkspaceReconciliation.ts`, reconciliation action and atomic mutation | Reconciliation tests reject incomplete/missing/reordered/changed parts, crafted participants, old quoted assertions and instruction excerpts; two mailbox copies apply once while preserving both sources. Excluded parents cannot supply identity or trigger attachment hydration. |
| Safe creation, exact identity, concurrent duplicates and client privacy | Shared operator/request constructors, `lib/workspaceScanDomain.ts`, allowlisted client DTO | Reconciliation tests create standalone clients, prospect brokers and visible requests without users/invitations/sharing; large inventories, legal-name variants, changed historical aliases and client/operator request creation races are covered. Candidate test pages beyond 100 and rejects tenants. |
| GEICO exact request and newer-over-manual updates | Reconciliation validator/domain, procurement outcome schema/API and shared outcome view | Completed vs tentative/negated/wrong-coverage tests, including public reviewed target selection; old vs newer/manual and concurrent target mutation; no client deactivation, other-request closure or invented policy. Outcome schema tests and client DTO assertions preserve the audience boundary. |
| Company facts, broker capabilities and private market activity | `orgWiki.ts`, `brokerProfiles.ts`, `procurementRequests.ts` shared helpers | Unrelated wiki facts survive; additions retain capabilities; explicit withdrawals cannot remove a state retained in a contrasting clause. Decline and quote reuse one exact market row; different brokers retain separate events and broker-linked activity. |
| Bound PDF ownership, content dedup and normal extraction | Reconciliation action/staging, `operatorPolicyImports.ts`, `lib/policyImportDedup.ts`, policy extraction pipeline | Actual synthetic original bytes through router classifier and shared import; quote and conflicting insured rejection; attachment-only exact insured identity; reviewed owner mapping; 221-policy inventory and concurrent hash change; committed import followed by action failure/retry creates one policy. |
| Portal-only extraction results with ordinary interactive behavior preserved | Extraction invocation marker, shared notification mutation and retry state | `workspaceScanNotifications.test.ts`: scheduled invocation sends nothing; duplicate reference to interactive policy still notifies; worker claim/checkpoint preserves origin; resume/restart retains it and manual full rerun clears it. Existing interactive exact-confirmation import tests pass. |
| Activity, candidates, resolution, retry, conditional correction and record navigation | `operatorGoogleWorkspaceScanActivity.ts`, `components/operator/workspace-scan`, affected record views | Candidate pagination/owner tests, dismissed evidence retry regression, union of changed fields and supersession checks, broker/request/policy links; UI tests cover explicit selection and draft/version handling. Local headless browser verifies keyboard source drawer, dismiss and real correction/conflict persistence. |

Independent review used the two assigned sibling lanes after their implementation
work. Reviewers reproduced defects against earlier commits, then retested the
fixed mutations/actions. Final signoffs cover conflicting PDF ownership, reviewed
PDF matching, separate broker events, failure precedence, excluded parent context,
pause between provider calls, committed-original cleanup and capability withdrawal
contrasts. These are scoped test-backed reviews; they do not establish live Google
or model quality, or a full provider-to-extraction browser run.

The final operator browser rerun initially received a development-server 404 for
a route present in the successful production build. Restarting Next with only
its stale `.next/dev` cache moved aside restored the route; the identical browser
workflow then passed. No application code, auth state or database reset was
needed. This was an environment recovery, not a passed assertion before retry.

## PR review follow-up — September 14, 2026

Review added mailbox authorization revalidation after Directory verification,
rejection of overlapping operation keys before applying a generated batch, and
the missing reported-purchase input on the registered request-creation tool.
Regressions cover pause during each mailbox phase, an unapplied overlapping
batch that becomes Needs attention, and exact-confirmed creation with idempotent
replay. After merging the current `main`, the full suite passed 136 files and
558 tests; the final tool-input fix then passed all 29 procurement domain tests.
TypeScript, repository-wide ESLint, the production build, and diff checks also
passed on the combined branch.
The broker UI fixes and their visible desktop acceptance are recorded in
`workflow-qa.md`. Live scheduled Gmail-to-extraction acceptance remains untested.
