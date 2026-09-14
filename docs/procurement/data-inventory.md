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
Source PDFs and other uploaded artifacts remain files in their own right;
the two-file rule governs editable procurement prose.

## Stored artifacts

`clientFiles` owns canonical blob identity, content hash, display/original
names, MIME type, size, provenance, client visibility, policy association, and
archive/delete lifecycle. Request file items and proposal documents link to
that identity rather than copying blobs. Proposal uploads normalize to private
client-file rows, with short-lived upload intents cleaning abandoned blobs.

| Active table | Responsibility |
| --- | --- |
| `procurementRequests` | Request identity, workflow, effective date, packet revision, policy links, inbox routing and audit stamps. |
| `procurementBrokerOutreaches` | Broker/contact identity, market status and sent state; observations belong in the request’s private.md. |
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
outreaches, file items and legacy packet sections. Later passes verify cleanup
and convert the owning request when needed.

The request conversion materializes `private.md` and `public.md` together,
preserving the audience of each source. Existing private packet files, outreach
logs, and file notes go into private content; existing shared packet/intake
content goes into public content. Preserve unique text, source references,
manual edits, and unresolved proposals without treating a proposal as accepted.
Only after verified preservation may the transaction remove old canonical
sidecar documents, legacy section rows, and inline narrative fields. No issued
link snapshot changes. The migration must not create a required section or
nested metadata model for future editing.

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
fields and making review `packetRevision` required. The two-file revision is
currently being implemented; final local validation and production migration
results belong in [the execution record](../architecture/backend-simplification.md).

`procurementSchemaCleanup:inventoryLegacyPage` inventories the retired
requirement drafts/links/specifications, request activities/documents,
clientInvitations and brokerActivity without deleting business evidence. These
stores require empty-table proof or reviewed source mapping before narrowing.
Canonical insuranceRequirements remain active in compliance. The unused `procurementPacketUpdateRuns` store requires a production count:
remove it if empty, or preserve material history losslessly before removing it.
Its retired writer is no longer active.
