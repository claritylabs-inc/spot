# Backend simplification and client intake plan

> Historical audit and migration record. Current extraction, routing, search, and tool behavior is documented in [Convex section extraction](convex-section-extraction.md), [router jobs](router-jobs.md), [AGENTS.md](../../AGENTS.md), and [AGENT_TOOLS.md](../../AGENT_TOOLS.md). Retired procedures below are not current rollout instructions.

Status: the primary simplification shipped in [PR 350](https://github.com/claritylabs-inc/spot/pull/350). The follow-up implementation in [PR 352](https://github.com/claritylabs-inc/spot/pull/352) passed [production release 34911026220](https://github.com/claritylabs-inc/spot/actions/runs/34911026220), including its migration and exact-commit worker/health gates; `a58d9503` was verified serving `app.spot.insure`. Production and shared-dev have both passed the final storage-cleanup audit. [PR 353](https://github.com/claritylabs-inc/spot/pull/353) removes the converted fields and completed migration machinery. Historical-data recovery remains cancelled under the accepted legacy data loss.

## Final storage cleanup

The follow-up uses the same rule: retain routine structured data, remove unused state, and put mutable narrative in the existing Markdown owner. The compatibility implementation is merged in [PR 352](https://github.com/claritylabs-inc/spot/pull/352). The final schema removes its verified legacy fields and temporary migration code after the production cleanup gate succeeded.

| Owner | Current contract | Verification |
| --- | --- | --- |
| Pending email drafts | Stop storing serialized provider JSON beside typed delivery fields; make the browser card, preview, and send use the same effective draft. | Existing pending approvals retain the same effective content; recipient clears, attachments, and thread headers survive backfill; focused delivery/approval tests pass. |
| Slack inbound events | Store one attachment array, preserving distinct files when old transports supply both shapes. Remove unused event metadata after checking all writers. | Transport tests, bounded backfill, and zero residual legacy fields on production/shared-dev. |
| Proposal reviews and notifications | Replace loose findings/action/source validators with the actual current shapes; remove unused notification expiry. | Existing persisted shapes pass a bounded audit; malformed new writes are rejected; consumer casts are removed. |
| Retired settings and links | Remove unused organization automation settings and obsolete references to the deleted policy-change table. | No runtime consumers; bounded cleanup preserves active records and issued evidence; schema narrowing succeeds. |
| Company research | Live router-backed creation without a website completed with an official site, classification, and cited wiki facts. Identity changes retract old evidence; verified refreshes replace superseded facts and suggestions; transient failures preserve prior evidence. | Isolated local acceptance preserved manual prose; 24 adjacent tests passed, including regressions that failed on the previous release. |
| Browser workflows | Native operator/client OAuth consent, token rotation/revocation, compliance source Notes persistence, and company-wiki import passed in headed local Chrome. Failed packet saves now block sidebar replacement until save or explicit discard. | [Workflow ledger](../testing/workflow-qa.md) records the actors, assertions, and cleanup. The packet replacement regression failed without its guard and passed with it; the revision-conflict path also passed in the browser. |

PR 352 deploys canonical writers and audits and migrates only the named fields through the existing migrations component. The final narrowing removes the legacy email JSON, Slack attachment/actor aliases, unused settings and policy-change references, notification expiry and retired variants, and all completed cleanup APIs, runners and release hooks. Old signed Slack controls retain their authorization semantics at the input boundary. Ongoing operator identity, declaration-fact and carrier-identity migrations retain their owners. The main release workflow remains responsible for Convex, worker compatibility, and frontend promotion. Do not upload database exports, credentials, or private file backups to the public repository.

Shared-dev accepted the typed schemas and compatibility release. Its cleanup converted one pending draft and cleared two unused thread references; all nine table audits then reported zero changes and zero blockers. The draft conversion preserves its effective delivery payload and confirmation fingerprint. PR 352 passed 658 tests in 147 files, root/Convex type checks, lint and build. Production then audited 20 organizations, 23 Slack inbound events, one thread message and one global model-settings row; pending drafts, Slack actors, notifications, certificate holds and card links were empty. Every before/after page reported zero changes and blockers. The empty notification/hold/card tables also establish that removed variants have no retained rows. The final narrowing has passed 645 tests in 144 files, both type checks, lint and production build; its exact main-commit release workflow owns final deployment.

## Accepted scope update

The operator refined the rule during implementation: retain fields required by routine reads or executable logic; delete unused fields; move mutable narrative into standard Markdown with YAML front matter. This applies across the platform. The latest procurement decision is exactly two files per request: `private.md` and `public.md`. This supersedes both section-row storage and the intermediate design with arbitrary packet files and separate intake, outreach-log, and file-note documents.

`private.md` holds internal work, broker observations, follow-ups, and file-handling notes. `public.md` holds shared submission material and initial request narrative by default; explicitly private operator intake belongs in `private.md`. Their YAML visibility is `private` and `shared`, respectively. Authors choose ordinary headings and metadata freely; there is no required section schema or nested metadata model. Public means accessible through authorized request access or an issued packet link, not publication to the anonymous internet. Operators read both files; tenant/broker sharing excludes private content.

The canonical text lives in `markdownDocuments` for transactional persistence, with ordinary `.md` import/export and expected-revision checks. Indexed ownership, workflow state, approvals, source references, and values required for routine decisions remain structured. Company wikis and compliance/certificate notes use the same Markdown primitive under their own resource ownership. Existing issued packet/certificate snapshots and original source evidence remain immutable.

## Execution and release evidence

- [PR 346](https://github.com/claritylabs-inc/spot/pull/346) released the Markdown/client-intake implementation as `515265cd7c934410633705feb5177d51e640bd4e`. [Production release 34901426209](https://github.com/claritylabs-inc/spot/actions/runs/34901426209) passed Convex, worker, package, compatibility, and release-readiness checks.
- An isolated cloud workspace seeded a genuine pre-change fixture, then migrated with widening commit `d7460184ec467f227db629604c212243ae7e37b8`. Four wiki sections, eight packet sections, and the request narrative became one wiki and the two request files. Every legacy packet body retained its audience; the issued packet snapshot was byte-identical. Repeating the migration produced **zero differences across all database table documents**, including revisions and timestamps.
- [Production audit 34902173672](https://github.com/claritylabs-inc/spot/actions/runs/34902173672) and [migration 34902637845](https://github.com/claritylabs-inc/spot/actions/runs/34902637845) completed. The apply reported `readyForNarrowing: true`, no ownership blockers, no legacy Markdown kinds, and zero residual fields/rows for the narrowed domains. The database and file-storage export is retained in the task workspace.
- [PR 347](https://github.com/claritylabs-inc/spot/pull/347) corrected the ownership audit: obsolete broker pointers can be cleared without rewriting the actual client owner or historical upload provenance. Shared-dev `acoustic-caiman-755` completed the same migration with `readyForNarrowing: true`; its 38 retired broker status notifications were removed, and all eight final inventory table counts were zero. The used `uploadedBySide` and `uploadedByUserId` fields remain.
- Both target exports contained zero `insuranceRequirements` rows and no `policyVersions.caseId` values. The unused thread routing key was absent in production; the one shared-dev value was cleared with a zero-residual readback. Canonical requirement criteria remain structured while their obsolete aliases and row fallback machinery are removed.
- [PR 348](https://github.com/claritylabs-inc/spot/pull/348) keeps client editors synchronized with live agent updates. [PR 349](https://github.com/claritylabs-inc/spot/pull/349) also released the final thread-key cleanup function; [release 34904849513](https://github.com/claritylabs-inc/spot/actions/runs/34904849513) passed all gates, and `app.spot.insure` was verified on its exact `463d8248` commit.
- The backup comparison identified 22 historical company facts outside the current wiki. Their optional restoration was cancelled after the user explicitly accepted legacy data loss. No current wiki text was replaced. Recovery run `34905294458` was intentionally cancelled; it is not a narrowing gate. The final code removes that recovery function, script, and workflow along with the other one-time migrations.
- The repository is public. Raw migration artifacts were removed from GitHub after local copies were verified. Private database exports must not be uploaded as unencrypted artifacts to this repository. Local copies remain under the task workspace's gitignored `.context` directory.
- The integrated narrowing candidate passed 636 tests, both typechecks, lint, and a production build before the final frontend/requirement follow-ups. The final combined checks and actual browser coverage are recorded in the pull request and `docs/testing/workflow-qa.md`; earlier counts do not substitute for the final checks.

The narrowing release removes the verified retired schema and compatibility
writers, including all eight empty inventory-only tables. It also removes the
one-off migration workflow, runner, and temporary recovery APIs. Ongoing
operator-email identity, declaration-fact and carrier-identity migrations retain
their existing owners. Completed Slack compatibility migrations are removed in
the final storage cleanup. The normal main release
workflow enforces Convex deployment, exact-commit worker readiness, compatibility
checks, and the Vercel production-alias gate.

## Outcome

Client intake uses the existing client object correctly, researches public company identity even without a supplied website, and grows the company wiki from supported evidence. Backend simplification removes verified dead behavior and competing live representations while preserving authorization, source evidence, immutable issued artifacts, and resumable operations.

The audit covers 153 tables declared directly in schema.ts, the 12 local Workspace scan/reconciliation tables, and the six additional Convex Auth tables. Related domain findings and table dispositions follow below. Table count alone is not a quality target.

## Client information contract

- Organizations retain name, website, research state, and operational access/workflow fields. Company details—including legal names and relationships, industry, addresses, entity type, tax identifiers and operations—belong in company Markdown.
- COIs and policy tools use policy evidence and policy-specific overrides for insured identity, address and operations. Company details never supply policy fallbacks.
- Company-file extraction contributes source-owned prose. Preserve existing wiki text and source evidence; never infer subsidiaries from additional named insureds.
- `update_organization_profile` edits only name and website. Company details use the existing whole-document wiki tools and approval boundary.
- The user accepted deletion of old structured company values without a Markdown move. `migrations:removeStructuredCompanyDetails` clears the optional legacy fields. Narrow the compatibility schema only after the deletion has completed on deployed targets. This code change does not imply a production migration.

## Enforced intake research

1. Normalize explicit identity and resolve existing clients before creating duplicates.
2. Persist a research task as part of client creation, including operator, scan and ordinary onboarding entrypoints. Missing URL must not skip research. Document/email company-information completion can schedule research when the public identity or missing website warrants it.
3. Search public identity terms through the existing router-owned retrieval primitive; identify the official site, then retrieve it. Never send private documents, tax identifiers or private emails as search terms. Retrieved content is untrusted evidence.
4. Apply only supported public website and durable wiki facts. Preserve saved/manual values; conflicting or ambiguous identities remain unresolved. An unavailable website, research failure, or no reliable match is a persisted outcome, not an invented value.
5. Use fingerprint-bound completion to reject stale callbacks, bounded abandoned-job retries, and idempotent scheduling. Store source URLs and unresolved field outcomes. Do not create age-based expiry for human review.
6. Agents receive one shared destination/research policy and read current profile/wiki plus research status before claiming completion. Profile changes and wiki changes retain the existing exact approval boundary; the global Approve all setting retains its current semantics.

## Ordered release batches

### A. Canonical writers and widening deployment

- Add client identity normalization, complete tool profile support, classification validation and durable research workflow.
- Fix email preview to use the same canonical send envelope as actual delivery, including deliberate removal of CC/BCC. Preserve old rendered snapshots and legacy fallback while stored data remains mixed.
- Consolidate request prose into `private.md` and `public.md`; route request, outreach, file, scan, and agent prose writes through those two files. Stop separate intake/log/file-note writes and duplicate outreach contact/obsolete packet snapshots.
- Remove unused policy reconciliation state and compatibility source-chunk DB persistence; keep raw spans, nodes, vector document chunks and worker wire/manifest contracts.
- Simplify certificate workflow settings to the actual per-client renewal toggle; widen obsolete required settings before stopping writes.
- Stop obsolete conversation-vector storage/API references; preserve actual thread history and wiki.
- Add dedicated bounded audit/migrate/verify functions with fixed table/field scopes. Complete missing proposal-review revision cleanup; never treat the old runner alone as sufficient readiness.
- Update AGENTS.md, AGENT_TOOLS.md, shared primitive catalog and current behavior documentation.

### B. Data audit and migration

- Deploy A through the normal main release workflow. Record exact commit, Convex target, Railway readiness and Vercel result.
- Export/retain a database backup before destructive cleanup; report counts, conflicts and legacy-only payloads without printing confidential content.
- Run the approved widening commit’s fixed-scope migration pages and applicable compatibility gates. Require complete cursors, zero residual fields/rows and no unresolved blockers before narrowing; do not expect removed migration APIs to exist in the narrowed tree.
- Merge legacy packet/intake/log/file-note content into the correct request file without changing its audience or issued snapshots. Preserve unique historical prose, private evidence, source references, policy update history, old certificate links, and uncertain client identities. A missing active writer is not permission to lose evidence.
- Re-run pages to prove idempotency. Verify source removal/retry, manual edit preservation, exact approvals and legacy transport compatibility on bounded fixtures.

### C. Narrow verified obsolete schema

- Remove only fields/tables proven migrated on the target; remove obsolete imports, indexes, migration writers, DTO branches and compatibility tests in the same batch.
- The completed narrowing removed `policyUpdateRuns` and the seven inventory-only procurement tables after production and shared-dev counts were verified zero.
- Shared-dev/local fixture compatibility must be handled explicitly. Never switch this worktree to the shared integration database for routine tests.
- Release C, verify the same production gates, then run bounded read checks and migration verifiers against the deployed result.

### D. Additional simplification only where evidence supports completing it

- Canonicalize notification discriminants and OAuth scope persistence using current access semantics; no union of discrepant scopes or accidental write grants.
- Consolidate source-document holder lists preserving primary order; remove singleton Slack attachment storage only after worker input normalization and rollout verification.
- Finish deprecated compliance requirement shape migration with bounded reads before schema narrowing.
- Tighten review findings to shared accepted validators after shape audit.
- Existing legacy certificate artifacts, packet recipient snapshots, policyUpdateRuns history, and legacy request documents are migration decisions based on actual row evidence. Keep them when deterministic lossless mapping is not established. Large policy-row normalization requires measurement of hot-row size/read behavior; do not manufacture a new generic fact/job/blob system merely to reduce field count.

## Validation and completion

Use focused behavioral tests for policy-only certificate details; company-field deletion preserving wiki text; explicit clears and concurrent edits; mandatory research without a URL; identity ambiguity/provider failure/stale callbacks; wiki markdown preservation and source ownership; preview/send equality; duplicate snapshot removal; bounded migration cursor/resume/idempotency; certificate renewal setting behavior; and tenant/operator authorization. Extend existing suites rather than snapshotting source or prompts.

Run Node 24, generated API/codegen, Next and Convex type checks, lint, root tests, build and worker/package checks required by `.github/workflows/deploy-convex.yml`. Review the complete diff for dead abstractions, casts and reader-facing copy before merging. Production is complete only after Convex deployment, exact-commit Railway deploy/no-op contexts, live compatibility audit, `release-ready-production`, and frontend availability. No live customer email/Slack/iMessage sends are needed for validation.

## Explicit keep decisions

Keep tenant/operator conversation separation, exact approval and audit records, delivery attempts and replay receipts, authorization/OTP/token expiry, source spans/nodes, indexed retrieval chunks, immutable certificate/packet snapshots, extraction leases and per-policy commit ledgers. Keep structured facts used by compliance, certificates, filters and access. Human approvals and unread notifications never expire by age.

## Domain evidence

The following records are the preserved pre-implementation audit baseline.
Symbols, commands, schemas, and line numbers below refer to the audited checkout;
some no longer exist in the narrowed candidate and none are current operational
instructions. Use the current contracts and execution evidence above for
release decisions.


# Policy, evidence, compliance, and certificate schema audit

Read-only discovery performed against current checkout on 2026-09-14 before implementation. Parent owns combined findings and release. Line numbers below refer to pre-edit source.

## Highest-confidence simplifications

1. **Remove dormant reconciliation engine and its state.** `convex/actions/reconcilePolicy.ts:19` exports an action with no caller anywhere outside generated declarations. It reads `policyFiles.extractedData` (:47), then applies free-form model JSON using `policies.updateReconciliation` (:120). `convex/policies.ts:2943` accepts `fields: v.any()` and blindly patches them (:2959), bypassing current final-extraction promotion ownership. `appendReconciliationLog` (:2928) is only used by this uncalled action. `policyFiles.updateExtraction` and `appendExtractionLog` likewise have no external callers. Current upload paths still write reconciliationStatus=pending (`operatorPolicyImports.ts:267`, `actions/extractFromUpload.ts:149,279`) and errors (`actions/policyExtraction.ts:1777,3734`) despite no path to reconciliation completion. Remove dead engine, dead exports, write-only per-file extractedData/log mutation, redundant reconciliation state from writers/read DTO, and clear stored reconciliationStatus/reconciliationLog/extractedData in bounded migration. Do not delete policyFiles or actual extraction run/pipeline state. New finding, not an existing staged migration.

2. **Stop storing unused compatibility source chunks.** `schema.ts:4128` defines sourceChunks in addition to raw sourceSpans, sourceNodes, and actual vector-indexed documentChunks. `actions/policyExtraction.ts:2171` persists compatibility chunks, but `lib/agentPrompts.ts:292` initializes sourceChunkDocs to [] and never populates it; :357-401 is unreachable presentation logic. Actual reads are existence as a source-tree rebuild hint (`agentPrompts.ts:85-113` / `sourceSpans.ts:220`) and diagnostic counts (`operator.ts:754,808`); unused list query :206. Replace rebuild hint with raw-span existence, remove compatibility persistence/read/prompt branch, then bounded purge/narrow sourceChunks. Preserve SDK/worker sourceChunks wire fields and sourceChunkIds manifest hashes for existing protocol/ledger consistency unless separately changing that contract. Preserve documentChunks (real indexed semantic search), sourceNodes (canonical exact wording retrieval), and sourceSpans (immutable quoted evidence). New finding, despite misleading compatibility comment suggesting a live reader.

3. **Collapse certificate workflow settings to the one real client setting.** `schema.ts:3754` has optional broker/client scopes, populateHoldersFromEndorsements, renewalReissueMode, renewalReviewLeadDays, policyChangeRequestsForHeldCertificatesEnabled, channels, copyInstructions. UI only exposes renewalReissueEnabled (`components/settings/certificate-workflow-section.tsx:18,91`); actual workflow only reads this boolean (`certificateWorkflowJobs.ts:157-166`). `certificateWorkflowSettings.ts:45` writes fixed obsolete settings every update; :72 resolves only clients, no broker inheritance. Keep clientOrgId, renewalReissueEnabled, updater/timestamps; remove unused knobs and broker indexes. Widen required obsolete fields first, clean rows, verify; orphan broker-only rows must be counted and removed (they have no current runtime effect), never reassigned to arbitrary clients. No current consumer uses lead days/channels/copy instructions outside returning the settings DTO. New finding consistent with current standalone client boundary.

4. **Use one source-document holder list.** `schema.ts:1719-20` stores both certificateHolderId and certificateHolderIds; importer picks first entry into singular then writes both (`compliance.ts:1564-70`), editor rewrites both (:807-815), reader merges/deduplicates (:86-103). `holder` index only targets singular, and no actual consumer uses that index. Canonical ordered holder IDs can replace both representations with first element being preferred holder. Preserve current primary ordering and all distinct additional holders during migration. Bounded follow-up, not required to combine with first batch.

## Other findings needing careful follow-up

- `policyUpdateRuns` (`schema.ts:4143`) has no repository runtime writer/reader, only schema-compatibility test and AGENTS claim at :434 that it is live update audit storage. Current `policyVersions` already records appended/re-extracted versions and diffs. First audit whether historical rows contain unique evidence, migrate non-empty useful history to canonical version/audit history if mapping is deterministic, then remove dormant table and correct AGENTS. Do not purge potentially unique historic snapshots based solely on missing current callers.
- Legacy `certificates` table (`schema.ts:3810`) remains read by old app-card links (`appCardLinks.ts:107-118`) and old activity/list queries (`certificates.ts:286-336`), whereas current issuance uses `certificateLifecycle.recordIssuedVersionInternal` (`actions/generateCoi.ts:352`). Old `certificates.recordGenerated` (:1459) still writes legacy table but has no caller. Remove obsolete writer; migrate legacy certificate records to holder/parent/version model, preserve download IDs and old link compatibility until links are remapped. This is an existing widening bridge (`schema.ts:3735-37`), not permission to delete historical certificate artifacts.
- `insuranceRequirements` has 20+ explicitly deprecated fields (`schema.ts:1924-73`) plus optional kind/scope. Existing backfill `compliance.backfillComplianceRequirementShapeInternal` (:2142) replaces rows with normalized shape, but first `.collect()`s the whole table (:2149); limit caps changes only, not reads. Convert migration to bounded cursor pages before finishing normalization, then require kind/scope and remove legacy fields after all targets verify. Existing planned migration, with a new operational issue in its unbounded implementation. Keep numeric limits, deductible, form/rating criteria structured because compliance and certificate decision logic executes them; do not move those into wiki prose.
- `policies` includes enormous inline SDK document/declarations/operationalProfile + projected flattened fields (`schema.ts:2053-2649`); risk is duplicated authority and heavy rows, not that every field should be removed. Stable extracted financial/date/coverage fields and overrides have meaningful certificate/compliance/search consumers. Keep source evidence and corrections separate. A future versioned extraction-result payload or storage-backed immutable snapshot could reduce hot-row size, but needs measurement and a typed Spot projection contract, not indiscriminate schema shuffling.
- `policies.analysis` is explicitly schema-only legacy (:2581-82), ready for bounded unset then narrowing. `carrier` and `security` are still actively read/fallbacked; do not remove carrier solely because schema calls it compatibility. New company wiki facts must never override policy legal insured names or contractual terms.
- Source-node embeddings have no vector index, but do not remove embeddings without checking current lexical/cosine retrieval and SDK contracts. Retaining raw spans and hierarchy is deliberate, not accidental duplication.

## Table coverage (owned domains)

| Tables | Keep/change and rationale |
|---|---|
| policies | Keep canonical current policy projection; remove obsolete reconciliation/analysis; later measure splitting large immutable extraction details. Preserve manual overrides separately. |
| policyFiles | Keep authoritative source-file list and ownership; remove uncalled legacy extractedData/write paths only after migration. Inline policies.files is explicit UI projection, not a second editable source. |
| policyUploadFingerprints, policyUploadFingerprintInventories | Keep hash lookup/dedup and bounded inventory backfill progress; projection/index prevents scans, not arbitrary duplicate data. |
| policyExtractionRuns | Keep high-churn logs/checkpoint/promotion ledger off policy row. |
| policyExtractionQueue, policyExtractionPreviewQueue | Keep separate narrow claim/lease lanes; merging would couple independent preview/final claims and increase scans. |
| policyExtractionArtifacts | Keep storage-backed transient large payloads/resumability; cl_sdk_checkpoint is named legacy cleanup kind and should only narrow after cleanup. |
| routerAssets | Keep signed, lease/org-bound, expiring model input staging; security boundary. |
| operationalRouterSmokeRuns, workerRouterTransportSmokeRuns | Keep bounded marker-owned release diagnostics; never generalize identities/models/assets or merge with production claim queues. |
| policyExtractionTraceSessions, policyExtractionTraceEvents | Keep separate summary/event diagnostic retention; useful bounded trace attribution. |
| carrierBrands | Keep reusable insurer brand identity enrichment separate from policy legal-security identity. |
| carrierIdentityBackfillResults | Keep until migration retries/results verified; later explicit migration-history retention decision. |
| acordTaxonomyDryRunPages, acordTaxonomyWriteRuns, acordTaxonomyWritePages, acordTaxonomyWritePolicyResults | Keep migration cursor/results/idempotency across partial action retries. Do not fold per-policy commit result into page-only summary. |
| sourceSpans | Keep canonical source evidence text/provenance. |
| sourceNodes | Keep canonical hierarchy/section retrieval. |
| documentChunks | Keep vector-indexed structured fact retrieval; different job from raw source spans/nodes. |
| sourceChunks | Remove unused compatibility persistence/read layer after bounded purge. |
| policyVersions | Keep immutable version snapshots/diffs/links; issuance needs exact historic terms, current policy references cannot substitute. Legacy caseId can unset/narrow after audit. |
| policyUpdateRuns | Dormant runtime; audit historical unique payloads then migrate/retire, correct stale docs. |
| policyDeclarationFacts | Keep source-backed extracted org fact provenance, active/inactive history, stable record hashes; policy source evidence is not wiki free text. |
| policyAuditLog | Keep operational history independent of current entity. |
| requirementSourceDocuments | Keep originals/provenance/import status, consolidate dual holder association. |
| requirementExtractionRuns | Keep bounded diagnostics and count/source/model attribution; router transport direct value is historical compatibility. |
| extractionReviews | Keep operator quality feedback + router submission state; not policy manual corrections. |
| insuranceRequirements | Keep executable coverage criteria; finish existing legacy shape migration, remove deprecated duplicate criterion representation. |
| complianceChecks | Keep requirement/subject evaluation and manual evidence/history; checkedAt/alertedAt/expiry are real evaluation/reminder boundaries. |
| certificateHolders | Keep tenant-local recipient identity/contact/address normalization for deterministic dedup, not org identity or legal policy insured. |
| certificateHolderPolicyLinks | Keep source-backed relationship evidence/version/status. Holder is not automatically an additional insured. |
| policyCertificates | Keep holder/policy parent with current/latest issued pointers and dedupe identity. |
| certificateVersions | Keep issued artifact, immutable holder/policy/requirement snapshots and request fingerprint. Deduplicate input validators, not historical issuance facts. |
| certificateWorkflowSettings | Collapse to client + renewal toggle + audit timestamps. |
| certificateWorkflowJobs | Keep review queue, frozen recipients, per-version idempotency, sent/cancelled state. Optional brokerOrgId is retired ownership candidate for cleanup. |
| certificates | Existing legacy bridge; migrate artifacts and old links before removal; remove dormant legacy writer now if full caller check confirms. |
| certificateRequestHolds | Keep unresolved requests, evidence why issue is blocked, email draft, exact request snapshots; remove retired policy-change links/status only after preserving meaning. Do not give human hold an expiry. |
| policyDeliverySettings, policyDeliveryRules, policyDeliveryJobs, policyDeliveryAttempts | Explicitly retired by procurement ownership boundary; existing gated purge/narrowing work, not a new architecture proposal. |

No deployment data was read during audit, so database row counts, current migration completion, and size savings are not claimed.


# Procurement, supplier, artifact, and email schema audit

Read-only repository audit. No target database row counts or migration execution verified. Scope: `convex/schema.ts` plus actual writers/readers. Existing canonical inventory: `docs/procurement/data-inventory.md`.

## Main conclusions

1. Finish the existing packet/file ownership transition before inventing another abstraction. Packet markdown, canonical client files, private proposals, broker profiles, and imported correspondence are already good domain boundaries.
2. Remove duplicate outreach contacts and obsolete packet snapshots. `contactSnapshot` has no product read consumers; creation duplicates top-level contact fields (`convex/procurementRequests.ts:960`, `:973`), edits overwrite the supposed snapshot (`:1102`), and the nullish fallback can preserve an old value when clearing a contact. Keep one mutable outreach contact representation; actual issuance identity is held in packet links. `packetSnapshot` still writes retired requirement/specification rows on outreach create/status change (`:231`, `:979`, `:1112`) despite no active consumer. Packet links own real immutable snapshots (`schema.ts:3209`). Stop writes, unset old fields in a bounded migration, then narrow. Distinguish this new concrete duplicate cleanup from the already documented eventual retirement of packetSnapshot.
3. Existing packet-review narrowing gate is incomplete. `migrations:runProposalReviewPacketBackfill` (`convex/migrations.ts:478`) only deletes reviews without packetRevision. It does not clear legacy revision fields from retained reviews or requests. Legacy callable intake still creates drafts/specifications (`convex/actions/procurementIntake.ts:22`, `:67`; `convex/procurementRequirements.ts:82`, `:200`) and writes counters (`:166`, `:309`, `:456`). Compliance still increments requirementRevision through `convex/lib/procurementRequirements.ts:5`. Thus passing that runner alone does not make the documented schema narrowing safe.
4. Two additional orphaned broker-ownership stores: `clientInvitations` (`schema.ts:2023`) and `brokerActivity` (`:4018`). Whole-repo searches find schema, dev-clear and tests only; no active product read/write owner. Neither appears in the existing purge runner. Audit existing rows, preserve material invitation/audit evidence where needed, then dedicated purge and drop; never revive broker-owned client access.
5. Keep structured information that authorizes, filters, or binds evidence. Supplier networkStatus/writingStates/LOB codes drive directory filters (`convex/brokerProfiles.ts:160`), so they belong in fields. Company/supplier descriptions and placement narrative belong in wiki/packet prose. Proposal source evidence and findings must remain structured and private.
6. Tighten typed output, rather than stuffing operational objects into markdown: proposal reviews have a precise normalized finding shape (`convex/lib/proposalReview.ts:39`) yet store and accept `v.array(v.any())` (`schema.ts:3350`, `convex/procurementProposals.ts:1376`). Use one shared Convex validator for accepted finding/evidence fields after audit/backfill of old review shapes. Proposal extractedOffer itself is intentionally extractor-version tolerant (`convex/lib/proposalMarkdown.ts:80`); do not blindly narrow it to one current provider format.

## Historical migration gates and gaps

This list records what existed at audit time. The referenced one-off functions
are removed from the narrowed candidate and must not be invoked from it.

- `procurementMigration:auditLegacyNarrowing` (`convex/procurementMigration.ts:4`) checks broker-owned clients, broker-uploaded policies and unlinked outreaches. It uses whole-table collect; replace with bounded cursor audit before operating against large production data. It does not report orphaned legacy request documents/activities, contact duplicates, revision residue, invitations or brokerActivity.
- `migrations:runProcurementDomainBackfill` (`migrations.ts:460`) links brokers but also creates empty draft proposals for legacy quote summaries (`:320`). That conflicts with current atomic filing guarantee (no empty shells) and can revive obsolete extractedOffer fields. Audit legacy rows and use a targeted successor migration; do not rerun blindly for a cleanup.
- `migrations:runProcurementLegacyPurge` (`:483`) removes brokerClientAssignments, all four policyDelivery tables, and broker branding. It does NOT clear organizations.brokerOrgId or old policy upload fields. Existing audit must pass first.
- `migrations:runCompanyWikiLegacyPurge` (`:495`) backfills missing fact sections, unsets connectedEmailAutomationItems.memoryIds and companyInformationExtractions.procurementFacts, then deletes orgMemory/procurementMemory. This is an existing gate, not a novel finding.
- `migrations:runProposalReviewPacketBackfill` only removes unconfirmable pre-packet reviews; extend cleanup + stop writers before revision-field narrowing.
- `migrations:runLegacyCoiAttachmentAuthorizationCleanup` (`:444`) + `pendingEmails:verifyLegacyCoiAttachmentAuthorizationCleanup` gates removal of allowMultipleCoiAttachments. Preserve exact coiBatchAuthorization fingerprint binding.
- At audit time, no dedicated migration preserved legacy `procurementRequestDocuments`, material `procurementRequestActivities`, or drafts/specifications in the request’s Markdown files. Inventory and explicitly map them; never automatically confirm extracted obligations or widen visibility.

## Table coverage: keep/change rationale

| Table (schema.ts line) | Recommendation |
| --- | --- |
| brokerProfiles (646) | Keep separate supplier profile and network filter fields; access remains orgMemberships. Office address is operational contact data; unify address validator reuse, not table ownership. |
| brokerClientAssignments (1278) | Existing retired ownership store; purge via approved migration and narrow, including seed/dev-clear references. |
| clientInvitations (2023) | New orphan candidate; no current product consumers. Audit material invitation evidence then retire. |
| brokerActivity (4018) | New orphan candidate; no current product consumers. Preserve material audit in canonical audit store before retirement. |
| policyDeliverySettings (1569), policyDeliveryRules (1586), policyDeliveryJobs (1608), policyDeliveryAttempts (1643) | Existing retired automated delivery stores. Run gated purge and narrow; do not merge with live certificate workflows. |
| clientFiles (2896) | Keep canonical blob, hash, display/original name, lifecycle and audience. Names have distinct purposes. Existing sha256 optionality can narrow after content audit/backfill. |
| clientFileUploadIntents (2938) | Keep security/abandoned upload ownership ledger; expiry protects temporary blobs. |
| procurementRequests (2948) | Keep project/workflow/date/policy relations/inbox/audit; narrative is sole request prose. Retire requirement/specification counters after full migration, ensure packetRevision/clientVisible normalized before making required. normalizedTitle is purposeful idempotency index. |
| procurementBrokerOutreaches (2984) | Keep broker link, contact, status, private markdown log, sentAt. Remove contactSnapshot duplicate and packetSnapshot. Fold application/legacy quote fields into existing log before narrowing (already documented compatibility transition). BrokerOrgId can become required only after audit/backfill. |
| procurementSmsEvents (3042) | Keep provider receipt/delivery ledger separate from customer channels. Provider event/message IDs serve different dedupe identities. |
| procurementRequirementDrafts (3074) | Retire legacy callable intake path only after preserving drafts/evidence without confirming them. |
| procurementRequestRequirements (3096) | Retire compatibility links after packet migration/review binding. Do not delete canonical insuranceRequirements shared with compliance. |
| procurementSpecifications (3107) | Move request-only fact prose to `private.md` or `public.md` according to its existing audience; currently still callable writer, so stop/redirect writer first. |
| procurementRequestActivities (3124) | Existing orphan store; migrate material messages/status evidence to canonical audit/correspondence, preserve client visibility, then drop. |
| procurementRequestDocuments (3142) | Existing orphan store; canonical clientFiles + associations. Preserve blobs/visibility before removal. |
| procurementPacketSections (3161) | Historical section store superseded by the two-file contract. Preserve content, audience, proposed edits, and source references during conversion; the conditional candidate removes this table. |
| procurementPacketLinks (3196) | Keep token hash, revocation, recipient and immutable snapshots. Existing optional legacy outreach/snapshot fields need explicit rotation; never snapshot old links to today's content and call it historical truth. |
| procurementPacketViews (3252) | Keep bounded audit evidence; viewCount/lastViewedAt are useful aggregate cache. Avoid extra generic activity abstraction. |
| procurementPacketUpdateRuns (3260) | Historical migration ledger. The conditional candidate removes it after verified conversion; it is not one of the eight inventory-only tables retained for production counts. |
| procurementProposals (3275) | Keep private decision entity and atomic filing contract. Do not move selected status, premium offer evidence or extraction fingerprint into wiki. |
| procurementProposalDocuments (3307) | Keep association/extraction evidence manifest. Existing planned cleanup: backfill clientFileId, then remove duplicate fileId/contentType/size only after reader compare and preserving extraction identity/hash. |
| procurementProposalReviews (3325) | Keep model vs staff conclusion and exact extraction+packet binding. Tighten findings validator; complete counter cleanup before narrowing. |
| procurementProposalExtractionJobs (3359) | Keep leases/attempts/cancellation and completion payload ownership; not interchangeable with generic jobs without explicit adapters. |
| procurementProposalExtractionArtifacts (3387) | Keep derived diagnostics subject to proposal/evidence retention. Introduce versioned artifact shapes only for stable kinds. |
| proposalSourceSpans (3397) | Keep source-native text, hash, document and extraction fingerprint; these prove extracted offers. |
| proposalSourceNodes (3427) | Keep source hierarchy and bounded evidence lookup; do not merge with spans or flatten into markdown. |
| procurementEmailThreads (3462) | Keep current requestId and addressedRequestId: reassignment intentionally preserves ingress provenance (`procurementRequests.ts:1681`). Category source and reason preserve operator override. |
| procurementEmailMessages (3492) | Keep threading IDs/envelope/current content/forwarded evidence and canonical attachment associations. Forwarded v.any can reuse shared structured parser validator after legacy shape audit. |
| procurementFileItems (3518) | Keep request association separate from canonical file. No clientFileId means outstanding request. clientVisible and brokerRelease protect distinct audiences; don't collapse to one arbitrary visibility boolean. |
| companyInformationExtractions (3558) | Keep source/applied fingerprints, extraction versions, retries, normalized candidate profile/facts; derived observation ledger enables safe repeat enrichment. Remove only legacy procurementFacts via existing gate; parent owns richer company/wiki audit. |
| orgMemory (1183), procurementMemory (1226) | Existing retired stores; purge only through wiki migration. Request chatter does not become durable company knowledge automatically. |
| pendingEmails (5357) | Keep exact authorization, delivery status, scheduled send state. Future normalization candidate: one validated canonical outgoing payload rather than serialized JSON plus duplicated headers/body/recipients. Today fallback extraction (`pendingEmails.ts:106`) means migration must compare full rendered send envelope/attachments before narrowing. chatMessageId and threadMessageId are different agent-status vs email-history messages (`actions/sendPendingEmail.ts:360`, `:372`), not duplicates. |
| emailDeliveryAttempts (5411) | Keep append-only attempt ledger separate from pending draft; one draft can retry and not all sends originate a draft. Legacy policy_delivery discriminator can retire only after historical retention decision. |

## Suggested independent first implementation batch

Stop outreach contactSnapshot/packetSnapshot writes, replace DTO spread leakage with explicit omission or reviewed fields, add resumable audit/unset migration, and document exact validation gate. Then remove old schema fields in a later deployed narrowing stage. Focused tests: clearing contact fields does not retain a shadow contact; marking an outreach sent does not materialize retired requirements; actual packet immutable snapshots and authorization remain unchanged. Do not fold all the above into one broad production schema removal.



# Agent, channel, email, notification, and auth schema audit

Read-only repository audit, 2026-09-14. No production rows were inspected and no migration readiness is asserted. Findings distinguish runtime duplication from deliberate authorization, recovery, historical snapshots, and indexed projections. Scope excludes organization/user membership and model routing.

## Findings and implementation order

### 1. Make pending-email preview and actual delivery read the same canonical draft (highest priority, independently implementable)

Evidence: `convex/schema.ts:5357` stores both `emailPayload` (serialized provider JSON) and recipient/CC/BCC/subject/body, sender/reply/threading fields, rendered text/HTML, and attachment metadata. `convex/lib/emailDraftArtifacts.ts:74` and `:123` dual-write JSON and typed fields. `convex/pendingEmails.ts:106` and `:164` extract typed fields from legacy JSON. `convex/actions/renderEmailPreview.ts:63` prefers JSON HTML/text, subject and recipient; `convex/lib/emailDelivery.ts:138` constructs actual send using typed `recipientEmail`, `subject`, `renderedText` and `renderedHtml`, with legacy fallbacks. These are materially different precedence rules when copies disagree.

First batch: introduce one typed resolved-draft projection used by preview and delivery, preserving existing legacy fallback and unknown headers for compatibility. Preview must display exactly the current canonical recipients/subject/body that will be sent; no provider call is needed to resolve it. Extend closest meaningful test with an intentionally divergent legacy payload and typed fields, missing legacy data, and explicit empty CC/BCC removal. Verify attachments and exact approval fingerprint still describe actual payload. Do not merge `chatMessageId` and `threadMessageId`: `emailDraftArtifacts.ts:97` updates the draft-email record while `:116` attaches the draft to an agent response; they have different roles.

Second staged batch: move all writers onto one typed draft envelope, make legacy payload optional, backfill with explicit conflict reports (typed fields win only when they were already authoritative for delivery), preserve opaque legacy headers in typed `headers` when needed, verify there are no legacy-only rows, then remove JSON and parsing fallback. Do not regenerate HTML for previously approved drafts: preserve the reviewed rendered snapshot or invalidate/reissue exact approval when meaning changes. Keep separate send-attempt records.

### 2. Retire the unused conversation-vector subsystem after a bounded purge gate

Evidence: `convex/schema.ts:4204` defines a second conversation store with a 1536-dimensional vector index. `convex/conversationTurns.ts:28` exposes an insert mutation whose handler is an explicit no-op. Whole-repository literal search found no active callers of the get/list/insert API or vector search; remaining consumers are `convex/operatorAgent.ts:2829` clear-all-agent-memory, `convex/memoryMaintenance.ts:8`, `convex/devClear.ts:46`, and README inventory.

Plan: mark table/API as retired, audit historical counts, purge in bounded resumable pages using a migration dedicated to this retired table, verify empty and no pending scheduled dependencies, then remove schema/table/API/vector index/dev-clear entry. Update `clear_all_agent_memory` result, confirmation preview, audit description, AGENT_TOOLS.md and README in the same release. Keep current wiki memory and actual thread history; do not repurpose the purge into deleting either. Do not drop the table assuming no runtime writes means no stored data. Recommended low-risk widening step is documentation and a targeted purge/verify command before narrowing.

### 3. Finish explicit legacy cleanup in a separate measured migration lane

Known compatibility fields, not permission to drop immediately:

| Field | Evidence / required treatment |
| --- | --- |
| `threads.deliveryContactKey` | `schema.ts:4324` explicitly says current routing neither reads nor writes; schemaCompatibility.test.ts:62 preserves it. Bounded unset then verify before removal. |
| `threadMessages.policyChangeCaseId`, `pendingEmails.policyChangeCaseId`, `appCardAccessLinks.policyChangeCaseId` and kind `policy_change` | `schema.ts:4511`, `:5386`, `:5277` identify retired domain. Coordinate parent policy-change purge; do not break readable historical links while rows remain. |
| `pendingEmails.allowMultipleCoiAttachments` | Migration exists (`migrations.ts:199`), readiness verifier exists (`pendingEmails.ts:375`); send code still recognizes legacy value (`actions/sendPendingEmail.ts:271`). Follow existing run/verify gate, preserve fingerprint-bound `coiBatchAuthorization`, then remove old flag and runtime branch. |
| `connectedEmailAutomationItems.memoryIds` | `schema.ts:1131` explicitly owned by `runCompanyWikiLegacyPurge`; complete that migration before narrowing. |
| `slackInboundEvents.mentionsGlass` | `schema.ts:4716` widening compatibility; run existing mention migration and require complete verifier. |
| `slackActors.glass_operator`, `glassUserId` | `schema.ts:1531`/`:1538`; run existing actor migration and verifier, retain pre-rebrand signed-control semantics. |
| Confirmation/review-link `expiresAt`; notification `expiresAt` | `schema.ts:4558`, `:5094`, `:5311`, `:3963`. Human approval, unread notifications, and review controls use current-state validity. `notifications.ts:244` stale sweep is intentionally no-op; `operatorAgent.ts:3646` old expiration task is harmless. Remove fields only after legacy outcome handling audit; leave scheduled old handlers compatible until drained. |
| `slackMessagePresentations.actionTokenExpiresAt` | **Not a simple unset.** `slackPresentation.ts:11` interprets legacy expiry <= updatedAt as explicit revocation. Backfill `actionTokenRevokedAt` for those rows first, then clear expiry. Preserve still-valid old signed controls. |

### 4. Canonicalize OAuth scopes without broadening access

Evidence: `schema.ts:5463` and `:5480` store both optional string `scope` and optional enum-array `scopes`; `oauth.ts:174`, `:249`, `:279` use the shared legacy-aware parser. New token writes (`oauth.ts:190`, `:295`) and code creation (`:404`) persist both forms.

Plan: make the normalized enum array the sole stored source of truth after staged migration; convert to OAuth protocol string only at response boundaries. Backfill using **exactly existing parser semantics**, including the conservative legacy default. Audit discrepancies where both forms exist; never union discrepant forms or infer write access. Make principal discriminants explicit only after auditing historical organization tokens. Preserve PKCE, exact resource/redirect URI binding, expiration, refresh rotation and token revocation. Focused tests should prove missing/legacy scope stays read-only, explicit write survives rotation, principal cannot change, and replay fails. Existing `oauth.test.ts` already tests several of these and should be extended, not duplicated.

### 5. Reduce notification type drift at the validator boundary; defer storage redesign

Evidence: `schema.ts:3912` defines a literal type list separately from active/retired arrays in `lib/notificationTypes.ts:5`/`:21`. They already differ: schema includes historical `merge_suggestion`, `policy_declaration_discrepancy`, `policy_change_needs_info`, `policy_change_completed`, while the shared stored union excludes those. `notifications.ts:143` accepts arbitrary string then casts at `:157`; `actionType`, `actionPayload`, `sourceRef` are string/any rather than a checked notification variant.

Plan: one source for active and historical notification discriminants with explicit creation validator restricted to active producer contracts and stored validator admitting historical values. Audit all producers first. Remove cast-based acceptance, and progressively give active notification source/action payloads narrow validators based on actual consumers. Keep legacy rows readable rather than reclassifying or deleting history. Existing email/iMessage/Slack status fields have repeated shape but are bounded to three channels: share their validator and update helper without automatically adding a new delivery table. Only normalize delivery rows if per-recipient attempts/retry requirements justify extra joins/tables. No age-based auto-dismiss.

### 6. Collapse Slack singular-attachment compatibility only after transport migration

Evidence: `schema.ts:4684` stores both `attachment` and `attachments`; `slack.ts:598` accepts both, `:805` and `:816` patch each shape, and `:1108` falls back from array to singleton. This duplicates intake, download, and cleanup paths.

Plan: normalize singular transport input to array at one ingress boundary, keep schema compatibility while workers roll, backfill old singleton rows (preserving provider/file identity and all files), verify no worker writes singular form, then remove duplicate field and branches. Search worker protocol writers before implementation. Never impose a file-count cap; retain byte budgets and provider replay identity.

## Tables to keep and why

| Domain / tables | Disposition and consumer evidence |
| --- | --- |
| `threads`, `threadMessages` | Keep tenant conversation domain, visibility, transport indexes and authoritative message content. Nested shared validators could reduce schema boilerplate; wholesale channel-subtable normalization would add joins without evidence. `threadContextStates` has separate task-epoch/summary lifecycle; keep. |
| `operatorAgentThreads`, `operatorAgentMessages`, `operatorAgentRuns` | Keep distinct from tenant tables: private/shared operator ownership, all-channel runner status, exact continuation/checkpoints. `operatorAgent.ts:1212` and `:5658` join per-run audit. Do not create one generic conversation table with optional operator/org identifiers. |
| `operatorAgentAttachments`, `operatorAgentUploadIntents` | Keep attachment ownership and consumed upload proof separate from embedded presentation metadata; expiry protects temporary upload cleanup. |
| `threadActionConfirmations`, `operatorAgentConfirmations`, `agentActionAuditEvents` | Keep exact fingerprint/actor/task/run ledgers and audit history. Share validators/state helpers only if behavior truly matches. Operator auto-approval and tenant manual approval remain distinct. |
| `operatorAgentThreads.archiveState` plus `archivedAt` | Keep indexed projection; `operatorAgent.ts:1476`/`:1483` query exact archive state while timestamp records event time. This is useful denormalization, not duplicate free-form business facts. |
| `slackInstallations`, `slackWorkspaceConnections`, `slackChannelBindings`, `slackChannelMemberships`, `slackActors`, `slackSetupStates`, `slackOAuthStates` | Keep physical installation credential/refresh lifecycle separate from organization connection, channel routing/membership, actor identity and setup/OAuth state. Do not move secrets to org profile. Candidate follow-up is reconcile installation metadata copied onto connection, but no removal is justified without native/legacy installation consumer audit. |
| `slackLifecycleEvents` | Keep ordered/idempotent provider/reconciliation evidence; active inserts `slackLifecycle.ts:649`, `:917`, `:1164`. Shared lifecycle-health field validators may reduce repetition without merging resource state. |
| `slackInboundEvents`, `slackMessageRevisions`, `slackOutboundSends`, `operatorSlackOutboundSends`, `slackMessagePresentations`, `slackInteractionEvents`, `slackHandoffs` | Keep inbound deduplication, edit history, delivery retries, stream revision and signed controls, operator-only DM authorization, and handoff relationships. `slackOutbound.ts:234`/`:276` own tenant sends; `:368` uses operator-scoped idempotency. Do not merge tenant/operator outbound authorization to save a table. |
| `imessageInboundEvents`, `imessageOutboundSends`, `imessageChats`, `imessageParticipants` | Keep transport dedupe distinct from chat participant/organization resolution; active inserts `imessageInboundEvents.ts:39`, `imessageOutboundSends.ts:43`. Participant mapping is authorization context, not wiki prose. |
| `imessagePrivacyStates`, `imessageAgentRunLeases`, `imessageHistoryDeletionJobs`, `imessageHistoryDeletionTargets`, `imessageHistoryDeletionFiles` | Keep generation isolation and bounded resumable deletion inventory. `imessagePrivacy.ts:37`, `:266`, `:333`, `:443` independently own state and lease/target/file rows. Do not collapse into a giant deletion job blob. |
| `operatorEmailReceipts`, `operatorEmailDeliveries` | Keep signed-message/provider replay ledger and immutable phase delivery snapshots; `operatorEmail.ts:96`, `:160`, `:188` own these separate identities. Human confirmation wait is not a transport lease. |
| `pendingEmails`, `emailDeliveryAttempts`, `emailDraftReviewLinks`, `appCardAccessLinks` | Keep draft/attempt/access-token boundaries; simplify draft envelope as above. Token, exact fingerprint, actor and source-thread binding are not generic markdown facts. |
| `agentResponseFeedback` | Keep cross-channel actor identity and router feedback-delivery state; schema.ts:4879. Avoid putting feedback into general message `metadata`. |
| `connectedEmailAccounts`, `connectedEmailScanStates`, `connectedEmailAutomationItems` | Keep credential ownership/user-vs-org scope separate from IMAP UID checkpoint and per-message automation dedupe/result. `connectedEmail.ts:120` and `:141` enforce scope; `actions/connectedEmailScan.ts:907` maps user accounts to private threads. Remove only explicit legacy `memoryIds` in this batch. |
| Workspace scan config/runs/mailboxes/sources/source parts | Keep authorization/credential revision, independently leased work and bounded source content. `operatorGoogleWorkspaceScan.ts:78`, `:231`, `:669`, `:779`, `:951` actively write these. `active`, `hasError` are indexed projections, not automatically removable status duplicates. |
| Workspace reconciliation finding sources/inventories/contexts/imports/findings/changes/identities | Keep original evidence, resumable inventories, imported-file provenance, independently reviewable findings, before/after corrections and identity dedupe. Active writes `operatorGoogleWorkspaceReconciliation.ts:165`, `:323`, `:500`, `:584`, `:617`, `:757`. Before/after JSON is historical audit snapshot, not a second live business object. Future narrowing should use typed operation discriminants, only after cataloging consumers. |
| `operatorAuthNonces`, `operatorImpersonationSessions`, `employeeProvisioningRequests`, `operatorAuditEvents` | Keep security replay/impersonation/provisioning idempotency/audit boundaries. Safe shared audit metadata typing is preferable to schema flattening. |
| OAuth clients/codes/tokens/rate counters; auth library tables; user email change requests | Keep protocol lifecycles; canonical scopes is the evidenced simplification. Security expiry remains. |
| `publicDemoConversations`, `publicDemoChatLogs`, `publicDemoSalesTranscripts`, `publicDemoRateCounters` | Keep public/untrusted lead context isolated from tenant/operator authorization. Curated sales transcript is a derived handoff snapshot; measure usage before considering consolidation. |
| `notifications`, `notificationPreferences`, `agentChannelSettings`, `presence` | Keep per-user preference distinct from org enablement, and ephemeral page presence separate from business profile. Canonicalize notification validators; do not move operational state into wiki. |

## Acceptance and release contract

Every deletion uses audit -> widen/canonical writer -> bounded resumable migration -> read-only verifier -> narrow -> focused runtime checks. Record actual target and migration counters; never assume source-level lack of writes proves rows absent. Run Node 24 and focused existing tests for touched boundaries, then required root/Convex type checks. Security-sensitive cases include exact draft approval after edits, stale confirmation invalidation, old Slack revocation preservation, OAuth conservative legacy scope conversion, replay/idempotency, tenant/operator isolation, and interrupt/resume during purge. No live messages or broad memory-clearing tools are needed for acceptance.

Recommended first implementation batch is canonical email preview/delivery resolution, followed by notification validator consolidation. The migration-only retired conversation store and established legacy gates can run as a separate deployment lane once actual target audit is available. Avoid a simultaneous all-channel table rewrite.

### Ownership migration follow-up

The first widening release is PR #346 (`515265cd`); production release run `34901426209` passed. Production audit `34902173672` found zero ownership blockers and zero rows in all eight inventory-only retired tables.

Shared development has a client that retains its retired broker association and a policy already owned by that client with historical broker-upload metadata. Those pointers are removable without changing ownership. The widening migration records their prior values in the operator audit ledger and clears only the unused references after backup. It retains the historical uploader side and user because the policy UI displays that provenance. Broker-owned or unresolved policies still require evidence-based reconciliation; the migration never assigns a replacement owner.

The shared-development `brokerActivity` inventory contains 38 retired status notifications: 37 extraction completions and one upload. They carry source policy references rather than unique policy facts. The backed-up retired-store purge removes these unused duplicates, and the final inventory counts are recorded after migration. Production has zero rows in this table.
