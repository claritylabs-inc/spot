# Procurement data and artifact inventory

## Markdown files

Procurement prose lives in `markdownDocuments` as ordinary named `.md` files
with YAML front matter. A packet can contain any number of named files; there
is no section schema or fixed public/private document pair. Each file declares
`visibility: private` or `visibility: shared`. Shared packet files have the same
client and broker view. Operator authorization still controls writes, and a
revision check prevents overwriting concurrent edits. Front matter cannot
change a file's owning organization or request.

| Document kind | Owner | Current use |
| --- | --- | --- |
| `packet` | Request + filename | Arbitrary submission and working Markdown files. |
| `request_intake` | Request | Original intake, projected as `narrative` in existing DTOs. |
| `outreach_log` | Market outreach | Market log, default private. |
| `procurement_file_notes` | Request file item | File handling notes, default private. |

Note/intake writers parse supplied front matter and preserve it alongside
existing metadata; they do not embed a second YAML document inside the body.
Machine/operator packet edits use the same exact-confirmed file-writing tool.
The unused packet section updater and bespoke proposal-acceptance API are
removed. Pending legacy proposal text remains in migration metadata for review.

Saving a change to a shared file, including making it private, advances the
request's packet revision. Existing packet links retain their immutable issued
content snapshots until explicitly revoked or replaced; editing a file does
not rewrite a historical snapshot. Released artifact access still rechecks
its current release state and file lifecycle.

## Stored artifacts

`clientFiles` owns canonical blob identity, content hash, display/original
names, MIME type, size, provenance, client visibility, policy association, and
archive/delete lifecycle. Request file items and proposal documents link to
that identity rather than copying blobs. Proposal uploads normalize to private
client-file rows, with short-lived upload intents cleaning abandoned blobs.

| Active table | Responsibility |
| --- | --- |
| `procurementRequests` | Request identity, workflow, effective date, packet revision, policy links, inbox routing and audit stamps. |
| `procurementBrokerOutreaches` | Broker/contact identity, market status and sent state; narrative comes from its Markdown file. |
| `procurementFileItems` | Request/outreach/file/message association, purpose, status and artifact release. Missing clientFileId means an outstanding request. |
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

## Migration and narrowing gates

Run `procurementMarkdownMigration:auditPage` and then, after reviewing the
approved deployment, `procurementMarkdownMigration:migratePage` with
`{"table":"<table>","cursor":null}`. Pass every returned cursor unchanged until
`isDone: true`; accumulate the complete audit. Migrate requests first, then
outreaches, file items and finally legacy packet sections.

The request phase creates intake files and converts legacy section rows to ordinary `packet` files
with explicit visibility. It retains legacy row IDs, source references,
manual-edit markers and pending changes in YAML. Section removal
requires its source mapping in a correctly scoped packet file. No issued link
snapshot is changed. Intake/log/note conflicts stop migration for reconciliation.

After every Markdown phase reports total `remaining: 0`, the following can
narrow: `procurementRequests.narrative`,
`procurementBrokerOutreaches.notes/applicationUrl/applicationQuestions/quoteSummary/quoteAmount/quoteCurrency/quoteUrl`,
`procurementFileItems.notes`, the `procurementPacketSections` table. Remove compatibility readers
and migration-only source types in the same narrowing release.

Separately, `procurementSchemaCleanup:auditPage` and `migratePage` handle
outreach `contactSnapshot`/`packetSnapshot` and request/review
`requirementRevision`/`specificationRevision`. The current cleanup deletes
unconfirmable pre-packet reviews before clearing legacy counters. Require a
complete audit with zero `changed` and `unboundReviews` before removing those
fields and making review `packetRevision` required.

`procurementSchemaCleanup:inventoryLegacyPage` inventories the retired
requirement drafts/links/specifications, request activities/documents,
clientInvitations and brokerActivity without deleting business evidence. These
stores require empty-table proof or reviewed source mapping before narrowing.
Canonical insuranceRequirements remain active in compliance. Existing
procurementPacketUpdateRuns are retained operational history pending an
explicit retention decision; their retired writer is no longer active.
