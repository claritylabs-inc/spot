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
| Scheduled collection/reconciliation cases above | Not run | Awaiting integrated implementation. |
| Synthetic browser workflow | Not run | Awaiting integrated implementation. |
| Live Workspace, shared-dev and production | Not run | Outside this implementation's authorization. |
