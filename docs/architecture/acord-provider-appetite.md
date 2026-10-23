# ACORD provider appetite

Provider coverage appetite uses the ACORD PCS 2.11.0 `LineOfBusiness` code list
referenced by [`LOBCd`](https://modelviewers.pilotfishtechnology.com/modelviewers/ACORD-PCS/model/LOBCd.html).
The viewer publishes 107 codes. Spot offers 105 for provider appetite: `UN`
(Unknown) and `BLANK` (Not Applicable) are interchange markers, so missing
provider knowledge stays an empty list rather than a coverage selection.

## Reference extraction

`scripts/extract-acord-pcs-model.mjs` extracts the public model's HTML link graph
from `model/index/all.html`. It verifies the viewer reports `ACORD PCS|2.11.0`,
follows only HTML documentation links beneath that model, fetches four pages at a
time, caches compressed originals, and records source URLs and SHA-256 hashes.
It does not execute page scripts or follow model-switch, search, or external URLs.
A capped crawl or failed download produces an incomplete manifest and a nonzero
exit. Reuse the cache to resume; choose a fresh directory for a fresh source snapshot.

```sh
node scripts/extract-acord-pcs-model.mjs
```

The October 22, 2026 extraction has **4,704 pages**, including **495 standalone
code-list pages**. All discovered pages succeeded. Local outputs live under
`.context/acord-pcs-2.11.0/snapshot/`:

- `manifest.json`: model/version, extraction timestamp, counts and failures.
- `model.jsonl`: searchable page text, table rows, enumerations and model links.
- `line-of-business.json`: the extracted `LOBCd` values and descriptions.
- `html/*.html.gz`: complete original HTML for each page.

`docs/reference/acord-pcs-2.11.0-lines.json` retains the compact source catalog
in the repository. The large model snapshot is local and ignored by Git.

## Standardization boundaries

| Model concept | Meaning in Spot |
| --- | --- |
| `BroadLOBCd` | Broad grouping such as commercial or personal lines; not a provider coverage line. |
| `LOBCd` | Exact line classification, such as `CGL`, `AUTOB`, `PROP` or `CYBER`; this is the provider appetite field. |
| `LOBSubCd` | A separate product subdivision; not a substitute for `LOBCd`. |
| `CoverageCd` | A coverage type within a policy, risk or line; separate from the line classification. |
| `CoverageAvailable` | Model aggregate for more detailed coverage appetite and guidance. Spot's provider list does not yet claim this detail. |
| `Form` | Identifies a contract form through number, title, edition and related metadata; form identifiers are not line codes. |

The model describes XML business messages, elements, aggregates, relationships
and enumerations. It is not a downloadable library of printable ACORD forms or
a complete XML schema distribution. ACORD's [Forms Portal](https://formsportal.acord.org/Home)
is the separate source for form editions. Future form processing must retain
form number and edition alongside typed policy facts, rather than deriving a
provider's appetite from an application form alone.

Spot's standardization flow is: preserve source evidence; classify the actual
line using the pinned list; store its exact code; display its readable label;
and separately represent coverage details, forms and servicing geography.
A valid code does not establish that a provider sells that coverage.
Commercial/personal variants and distinct valid codes such as `CRIM`/`CRIME`
or `PL`/`EO` remain distinct. Preserve exact `Motorcycle` capitalization.

## Implementation and existing data

`convex/lib/linesOfBusiness.ts` retains the shared cl-sdk taxonomy and owns the
provider subset/schema. All 107 SDK codes match the published list. The module
corrects the SDK's `MGMLI` label spelling to **Management Liability**.
`convex/lib/brokerProfileValidation.ts` validates, deduplicates and sorts provider
codes. UI selectors, operator/MCP tool schemas and automated research use the
same provider catalog. Research still requires provider-specific evidence and
manual fields retain precedence.

Both provider editors use `components/broker-network/acord-lines-field.tsx`:
search by label or code, display every selected label and code, remove a saved
selection, and persist through existing autosave. ACORD lines have their own
card, separate from servicing geography.

All 82 local dev providers were checked against the extracted source list.
Their saved arrays already contained valid, sorted, unique codes, so no data
rewrite or migration was needed. **65** have recorded lines; **17** remain
unknown. No coverage was added from a company name, office address or generic
marketing claim. The audit is retained in
`.context/qa/provider-acord/provider-audit.json`.

## Request matching

The manual Auto add providers action and `convex/lib/procurementBrokerMatching.ts`
are removed. `convex/lib/providerOutreachMatch.ts` is the only request-to-provider
matcher. It reads the stored submitted application, whose blank company facts
are filled from the client profile (see `docs/architecture/insurance-intake.md`).

`convex/lib/providerOutreachMatch.ts` owns the deterministic mapping of
intake coverage IDs to ACORD classes through the shared `coverageLobMapping`.
Operating locations take precedence over the request's mailing address; the
latter is the fallback when no operating locations are recorded.

### Nationwide scope and actionable results

Provider geography also supports optional `nationwideCountries` and
`excludedStates`; old records need no migration. Nationwide scope requires a
selected country and explicit service evidence. Empty subdivisions never imply
nationwide service. Excluded regions must belong to a nationwide country and
win over individual inclusions; removing a country or nationwide scope clears
its dependent exceptions. Both editors use the same searchable primitives.
Explicit edits claim the existing manual ownership of regional research.

Directory state filters recognize nationwide service and honor exclusions. See the
[129-provider research review](../research/provider-geography-2026-10-22.md).

The nationwide/exception predicate is shared as `brokerAreaFit` by the
provider-outreach fit classifier. Missing US/CA regional appetite remains
unknown unless nationwide scope is explicit.
