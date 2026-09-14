# Procurement data and artifact inventory

## Markdown files

Every procurement request has exactly two ordinary Markdown files in
`markdownDocuments`, both owned by the request:

| File | Readership | Content |
| --- | --- | --- |
| `private.md` | Operators only; YAML `visibility: private`. | Internal work, broker observations, follow-ups, and file-handling notes. |
| `public.md` | The request’s authorized shared audience; YAML `visibility: shared`. | Shared submission material and initial request narrative by default. |

Explicitly private operator intake goes into `private.md`. There are no
separate intake, outreach-log, or file-note documents, arbitrary extra packet
files, required headings, or nested metadata protocol. Authors use ordinary
Markdown and YAML. Request, outreach, and file-item updates carry workflow
fields; later prose edits replace one of the two files with `expectedRevision`.
The exact-confirmed operator tool is `update_procurement_packet`.

The public filename does not publish content to the anonymous internet.
Reading requires authorized request access or a valid issued packet link.
Operators may read both files; client and broker sharing exposes public content
only. Filenames and visibility must agree. Front matter cannot change the
owning organization/request or grant editing authority.

Updating `public.md` advances the request’s packet revision. Existing packet
links retain immutable issued text/artifact snapshots until revoked or
replaced; editing a file does not rewrite historical issuance. Released
artifacts still require their current release state and file lifecycle checks.
Source PDFs and other uploaded artifacts remain files in their own right; the
two-file rule governs editable procurement prose.

## Stored artifacts

`clientFiles` owns canonical blob identity, content hash, display/original
names, MIME type, size, provenance, client visibility, policy association, and
archive/delete lifecycle. Request file items and proposal documents link to
that identity rather than copying blobs. Proposal uploads normalize to private
client-file rows, with short-lived upload intents cleaning abandoned blobs.

| Active table | Responsibility |
| --- | --- |
| `procurementRequests` | Request identity, workflow, effective date, packet revision, policy links, inbox routing and audit stamps. |
| `procurementBrokerOutreaches` | Broker/contact identity, market status and sent state; observations belong in the request’s `private.md`. |
| `procurementFileItems` | Request/outreach/file/message association, purpose, status and artifact release. Missing `clientFileId` means an outstanding request. |
| `procurementPacketLinks` | Token hash, recipient, revocation/expiry and immutable issued text/artifact snapshots. |
| `procurementPacketViews` | Token-validated access audit without raw magic-link tokens. |
| `procurementProposals` | Operator-private offer, selection/archive state and extraction identity. |
| `procurementProposalDocuments` | Source/evidence manifest linking canonical client files; legacy duplicate storage metadata remains until separately audited. |
| `procurementProposalReviews` | Private model/staff decision evidence bound to extraction fingerprint and packet revision. |
| `procurementProposalExtractionJobs`, `procurementProposalExtractionArtifacts` | Lease/retry/completion ownership and retained extraction diagnostics. |
| `proposalSourceSpans`, `proposalSourceNodes` | Private source-native proposal evidence and hierarchy. |
| `procurementEmailThreads`, `procurementEmailMessages` | Imported correspondence and canonical attachment associations. Current request and originally addressed request remain separate provenance. |
| `procurementSmsEvents` | Operator market-contact provider event/delivery deduplication, separate from customer channels. |
| `brokerProfiles` | Supplier network status, office, writing states and LOB filters; never client/proposal access. |
| `operatorAuditEvents` | Append-only actor/action/request audit. |

## Conditional narrowing status

The narrowing candidate removes the migrated procurement narrative fields,
section storage, separate intake/log/file-note document ownership, obsolete
snapshot/revision fields, and the one-off migration APIs that operated on them.
This is a code-state description, not evidence that production migration or
deployment has completed. The approved production export, full audit pages,
migration results, zero-residual verification, exact deployed commit, and
rollback artifact are pending in
[the execution record](../architecture/backend-simplification.md).

The narrowed tree intentionally has no broad schema-migration runner. Its
remaining exported migrations are ongoing operator-email identity,
declaration-fact, carrier-identity, and Slack compatibility work documented in
[AGENTS.md](../../AGENTS.md).

Eight inventory-only tables remain until production counts and content review
are available:

- `policyUpdateRuns`
- `clientInvitations`
- `brokerActivity`
- `procurementRequirementDrafts`
- `procurementRequestRequirements`
- `procurementSpecifications`
- `procurementRequestActivities`
- `procurementRequestDocuments`

Do not purge or narrow these tables from repository-only evidence. If a table
is empty on the approved target, record the all-page count before removal. If
it contains material history, preserve that evidence losslessly under an
authorized current owner before proposing a later narrowing change.
`insuranceRequirements` remains the canonical active compliance store and is
not part of this inventory-only set.
