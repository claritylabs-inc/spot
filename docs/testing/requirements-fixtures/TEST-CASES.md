# Transformer Capital requirements test kit

This is a fictional QA kit for the Spot requirements feature. It models Transformer Capital investing in Cove Technologies Inc. at 1070 Bridgeview Way, San Francisco, CA 94124. None of the documents is a real contract, policy, binder, certificate, or legal document.

## Fixture files

| File | Format | Purpose |
| --- | --- | --- |
| `01-transformer-capital-balanced-requirements.pdf` | Two-page PDF | Balanced E&O and Cyber requirements, typed per-claim versus aggregate limits, deductible ceilings, claims-made wording, a retroactive date, page citations, explicit negations, and administrative noise. |
| `02-transformer-capital-strict-closing-conditions.pdf` | PDF | Clear gaps above the seeded policy, including an E&O endorsement form and a Cyber per-occurrence requirement. |
| `03-transformer-capital-requirements-amendment.docx` | DOCX | One valid E&O rule surrounded by negative coverage statements and non-coverage contract terms that should be skipped. |
| `04-transformer-capital-aggregate-clarification.txt` | TXT | An email-style clarification that sets only an aggregate requirement and explicitly leaves the per-claim amount undecided. |
| `EXPECTED-RESULTS.json` | JSON | Machine-readable expected extraction for all four documents. |

The generated binary files can be reproduced with:

```bash
node docs/testing/requirements-fixtures/generate-fixtures.mjs
```

## Seed alignment and an important evidence caveat

The local seed creates active policy `NWC-TEC-3110-26-01` for `Cove Technologies Inc.` from Northwoods Continental Insurance Company, effective March 15, 2026 through March 15, 2027. It displays:

- Technology Errors & Omissions Liability — `$5,000,000`
- Network Security & Privacy Liability (Cyber) — `$3,000,000`
- Media Content Liability — `$1,000,000`

The seed currently stores those as display strings only. It does not provide typed `limitAmount` values or separate `per_claim`, `per_occurrence`, and `aggregate` coverage-limit records. Therefore, the deterministic checker must not silently treat one display limit as proof of two distinct limit types. The balanced and clarification fixtures should be `Unverified` with explicit “limit is not structured” reasons until richer policy evidence exists. A deep check should remain `Unverified` unless it finds source-backed evidence for every requested term. If the seed is later enriched with typed limits matching the displayed coverage, update the compliance expectations in this runbook while keeping the extraction expectations unchanged.

The checker also treats absent structured deductible, coverage-form, retroactive-date, provision, and required-form evidence conservatively. Missing evidence is not satisfaction. A typed mismatch or a missing explicitly required form is `Not met`; evidence that cannot establish either satisfaction or a mismatch is `Unverified`. The Cyber requirement must match `Network Security & Privacy Liability (Cyber)`, not the E&O coverage. Deep review considers source-backed policy evidence and persists its rationale, but may not infer that an effective date is a retroactive date or that a generic limit proves a typed per-claim, per-occurrence, or aggregate limit.

The seeded policy uses a Toronto mailing address. The San Francisco address in these fixtures is transaction context; it must not silently overwrite the policy's source-backed insured address.

## Common setup

1. Start from a Conductor workspace whose local fixture has been provisioned and seeded. Run the normal Dev template or `npm run conductor:dev`.
2. Sign in as Cove's seeded client admin, `adyan@cove.dev`. Obtain the local OTP from the Dev terminal or `.context/logs/convex.log`.
3. Open `/compliance?tab=requirements`. Use `My requirements` when that scope selector is present.
4. Run each extraction case independently. Archive the prior source and its requirements before the next case, or use a freshly seeded local database. The server suppresses only exact typed duplicates; requirements with different limit kinds, amounts, forms, dates, provisions, or required forms remain distinct.
5. In the Import requirements drawer, use these common values unless a case says otherwise:

   - Source type: `Client requirements`
   - Certificate holder: `Transformer Capital`
   - Contact: `Mira Shah`
   - Email: `certificates@transformer-capital.example`
   - Deal name: `Transformer Capital investment in Cove`
   - Deal type: `Equity investment`
   - Internal notes: `Fictional requirements QA fixture`

6. Leave holder phone and address blank. The source documents provide the Cove transaction address, not a Transformer Capital mailing address.

## TC-01 — Balanced PDF extraction and page evidence

Goal: verify clean multi-page import, distinct limit kinds, source metadata, negative clauses, and page citations.

1. Import `01-transformer-capital-balanced-requirements.pdf` with source name `TC-COVE-REQ-001 — Balanced investor schedule`.
2. Confirm the success toast says two requirements were created.
3. Open the source under the `Sources` tab.
4. Open each extracted requirement and compare it with the first document entry in `EXPECTED-RESULTS.json`.

Expected:

- Exactly two active coverage requirements exist under this source: one `EO` and one `CYBER`.
- The E&O rule contains `$2,000,000 per claim`, `$5,000,000 aggregate`, a maximum `$100,000` deductible or retention, claims-made form, and retroactive date on or before March 15, 2026. Its source citation is page 1.
- The Cyber rule contains `$1,000,000 per claim`, `$3,000,000 aggregate`, a maximum `$100,000` deductible or retention, and claims-made form. Its source citation is page 2.
- No requirements are created for CGL, D&O, Workers Compensation, Auto, AM Best rating, certificate delivery, or cancellation notice.
- No additional-insured, waiver-of-subrogation, or primary-and-non-contributory provision is added; the document expressly says those are not required.
- The source drawer shows Transformer Capital, Mira Shah, the email, deal name, deal type, and internal note entered during import.
- The requirements table can filter these rows by `EO`/`CYBER`, `Aggregate`, and their current status.
- With the unmodified seed, the deterministic and careful-review result is `Unverified` because typed per-claim, aggregate, deductible, and coverage-form evidence is unavailable. The E&O result additionally calls out the unavailable retroactive-date evidence.
- The Cyber row's matched-coverage display, if shown, is `Network Security & Privacy Liability (Cyber)`. Showing the E&O coverage on a Cyber requirement is a defect even if the overall status remains `Unverified`.

Failure conditions:

- A single combined E&O limit replaces the two typed limits.
- A page-2 Cyber quote is attributed to page 1.
- Any negated coverage or administrative clause becomes a requirement.
- The San Francisco transaction address overwrites the seeded policy address.

## TC-02 — Strict limits and required-form gaps

Goal: verify clear underinsurance and form gaps against the single seeded policy.

1. Import `02-transformer-capital-strict-closing-conditions.pdf` with source name `TC-COVE-REQ-002 — Strict closing conditions`.
2. Confirm two requirements were created.
3. Inspect both requirement drawers, then run `Check compliance` for each.

Expected extraction:

- E&O: `$7,500,000 per claim`, `$10,000,000 aggregate`, maximum `$25,000` retention, claims-made form, and required form `TC EO 01 (08/26)`.
- Cyber: `$5,000,000 per occurrence` and `$5,000,000 aggregate`, with maximum `$25,000` deductible or retention.
- The certificate-delivery sentence is skipped.

Expected compliance:

- Neither requirement may be marked met from the seeded `$5,000,000` E&O and `$3,000,000` Cyber display strings.
- E&O is `Not met` because the explicitly required `TC EO 01 (08/26)` form is absent. Its typed limits, deductible, and coverage form are also unverifiable from the sparse seed.
- Cyber is `Unverified`: the generic `$3,000,000` display cannot be retyped as either a per-occurrence or aggregate limit, so it is insufficient to prove satisfaction or a typed mismatch.
- A deep review must not treat an unconfirmed claims-made form, retroactive date, or deductible ceiling as satisfied merely because a policy with the right line exists.

Failure conditions:

- Aggregate and per-occurrence values are conflated.
- The fictional form number disappears during extraction.
- Either requirement is reported as met.

## TC-03 — DOCX negation and noise filtering

Goal: verify DOCX parsing and coverage-only extraction.

1. Import `03-transformer-capital-requirements-amendment.docx` with source name `TC-COVE-REQ-003 — Insurance amendment`.
2. Confirm exactly one requirement was created.
3. Compare the result with the third document entry in `EXPECTED-RESULTS.json`.

Expected:

- One E&O requirement is created with `$1,000,000 per claim`, `$1,000,000 aggregate`, and claims-made form.
- No CGL, D&O, Workers Compensation, Auto, provision, insurer-rating, certificate-delivery, cancellation-notice, claims-reporting, subcontractor, or indemnification requirement is created.
- The source is recorded as a DOCX parsed through the supported Word path.
- Deterministic compliance remains `Unverified` because the seed does not type its `$5,000,000` display limit or coverage form. A deep check may only mark it met if it can support both required limit types and the claims-made form from actual policy evidence; otherwise it remains `Unverified`.

Failure conditions:

- Any sentence beginning with “No … is required” creates a positive requirement.
- Administrative terms become coverage requirements.
- More than one requirement is created.

## TC-04 — Aggregate-only email clarification

Goal: verify that the importer does not invent a per-claim amount when the source explicitly leaves it undecided.

1. Import `04-transformer-capital-aggregate-clarification.txt` with source name `Transformer Capital aggregate clarification — 2026-08-20` and source type `Other source`.
2. Confirm exactly one requirement was created.

Expected:

- One E&O rule is created with only a `$5,000,000 aggregate` limit.
- No `per_claim` limit is present.
- No Cyber or other line is added, and certificate delivery is skipped.
- With the current seed, the deterministic result is `Unverified` with an unverifiable aggregate reason. The generic `$5,000,000` display limit must not automatically be retyped as an aggregate.

Failure conditions:

- The importer creates a per-claim limit from “still under negotiation.”
- “We are not changing the Cyber requirement” creates a Cyber rule.

## TC-05 — Duplicate suppression

Goal: verify that an already-active source requirement is not duplicated.

1. Complete TC-01 and leave both requirements active.
2. Import the same balanced PDF again with a different source name but the same scope.

Expected:

- The import reports no new coverage requirements, or creates zero duplicate E&O/Cyber rules.
- If the source record is retained for audit, its requirement count is zero.

Failure condition: a second semantically equivalent E&O or Cyber requirement appears.

Duplicate suppression is based on the normalized typed requirement fields after extraction. Record the model route and extracted rows if a case fails, but do not accept title-only or line-of-business-only deduplication.

## TC-06 — Source editing, filters, and archive behavior

Goal: verify the lifecycle around an imported source.

1. Complete TC-01.
2. In `Sources`, open the balanced source and change the internal note to `Reviewed by QA`.
3. Return to requirements and filter by source, then by `Aggregate`, then by `EO`.
4. Clear all filters.
5. Archive the source before generating a certificate.

Expected:

- The source edit persists after closing and reopening the drawer.
- Source, limit-type, and line filters show only matching rows; clearing them restores both.
- Archiving the source removes it and both associated requirements from active lists without affecting policy `NWC-TEC-3110-26-01`.
- No unrelated source or requirement is changed.

## TC-07 — Certificate planning from a source

Goal: verify that all requirements from one investor source enter the certificate-planning flow together.

1. Complete TC-01 and open its source.
2. Choose `Generate certificates`.
3. Inspect the proposed requirement plan before confirming any generation.

Expected:

- Transformer Capital is the selected certificate holder.
- Both E&O and Cyber requirements are represented once, with separate per-claim and aggregate values preserved in their snapshots.
- The plan references Cove's seeded policy only where evidence supports the requested line.
- Unmet or unverifiable items remain visibly flagged; the flow must not silently claim that a certificate proves unavailable typed limits.
- The preflight shows both the machine-readable gap labels and the saved deep-review rationale when a deeper check has been run.
- `Generate certificates` is disabled when every selected requirement is `Unverified`, `Not met`, or `Expired`.
- The generated certificate, if the UI permits proceeding, uses source-backed policy identity and does not change the policy's insured address to the transaction address.

## TC-08 — Access control

Goal: verify that requirements remain read-only for users without write authority.

1. Open the same Cove compliance surface in operator impersonation (admin access, audited) or with a non-admin client role.
2. Attempt to import, edit, archive, run a persistent deep check, or generate a certificate.

Expected:

- The page states why compliance is read-only.
- Mutating actions are absent or disabled, and direct mutation attempts are rejected server-side.
- Existing source text, holder data, and policy details remain readable only to an authorized viewer.

## Reporting template

Use this block for each run:

```text
Case:
Workspace / commit:
Tester / date:
Model route (for import or deep check):
Created requirement count:
Observed requirements and typed limits:
Observed compliance statuses and notes:
Source/page citations correct: yes/no
Unexpected extracted or omitted rules:
Certificate-plan result (if applicable):
Verdict: pass/fail/blocked
Evidence links or screenshots:
```
