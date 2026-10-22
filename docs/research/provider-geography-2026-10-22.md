# Provider geography review — October 22, 2026

The prior auto-add result mixed a directory-wide missing-data count with a request-specific matching outcome. The underlying data also had 70 providers without recorded geographic appetite and 17 without ACORD lines, leaving no recorded Ontario markets.

## Data work

Reviewed all 129 provider identities using the recorded official websites, two targeted search passes, the existing same-day public crawl, and follow-up primary product/state pages. Search queries and raw public responses are under `.context/provider-geography/`. The free TinyFish search endpoint through treg reported $0 cost. No customer request details were sent to the search service. Failed, empty, generic third-party or licensing-only results were not converted into service-area claims.

The [reviewed record](provider-geography-2026-10-22.json) covers every provider, including unchanged/unverified outcomes and primary source URLs. Updated 33 local-dev profiles through the existing authenticated operator writer, preserving old ACORD selections and network status. Geography was expanded only for evidenced markets; explicit exclusions take precedence. All 129 private company wiki documents have a dated service-area review, sources and limitations.

- 24 providers received geographic updates; 12 now record explicit US nationwide service.
- 12 now record Ontario service; KBD also records Quebec. Canadian national service was not inferred from a Toronto office, a broker license or unnamed provincial distribution.
- Added 78 evidenced ACORD selections. Profiles missing lines fell from 17 to 6.
- Profiles with no country or regional appetite fell from 70 to 52. Remaining unknowns remain visible for verification rather than being guessed.
- The existing Ontario professional-liability/cyber request now has nine recorded matches: KBD, Mitch, Scrivens, Halpenny, Morison, Cowan, The Insurance Lab, Unibrokers and HUB International. This was a read-only report over its saved request facts, using the production matching helper; its outreach was not automatically changed.

Nationwide examples include [Coterie's product statement](https://coterieinsurance.com/), [TechInsurance's national service](https://www.techinsurance.com/), [Athos's service statement](https://www.athosinsurance.com/) and [Francis L. Dean's FAQ](https://fdean.com/FAQs). [Hiscox's E&O page](https://www.hiscox.com/small-business-insurance/errors-and-omissions-insurance/e-and-o-coverage) and state directory explicitly support its Alaska exception. Generic biBerk availability was not applied across all its classes because its own coverage maps show product-specific variation. Foxquilt's eight unnamed Canadian provinces did not become an Ontario or all-Canada claim. Nationwide licensing alone did not expand At-Bay, Counterpart, Newfront or other profiles.

## Product behavior

The existing button still adds all confirmed matches as Observed. A compact shared-primitives drawer shows requested coverage and locations, added and existing counts, request-specific verification candidates with provider links, and grouped exclusions. Unknowns no longer receive a success toast or appear as definite refusals. Other/unknown request classes still require manual matching.

Provider Appetite adds an explicit nationwide selection and, only when selected, state/province exceptions. Country removal clears dependent nationwide scope and exceptions. Regional directory filters and procurement matching use the same nationwide/exception semantics. Operator and MCP profile tools accept the fields with their existing authorization, exact-approval and impersonation boundaries. No send/schedule capability was added.

## Verification

The dev Texas CGL request gained 11 confirmed markets, increasing from three to 14 unique providers. A repeat run added zero and showed 14 already on the request, 41 requiring verification, 24 coverage mismatches, 49 regional mismatches and one restricted provider. Readback confirmed all 14 rows remain Observed, without sent timestamps or issued packets. Hiscox's profile rendered United States nationwide with Alaska explicitly excluded and a distinct accessible exclusion label. The drawer's initial narrow table was replaced with wrapping inline rows and quiet Review actions after visual inspection.

Root and Convex TypeScript, touched-file ESLint, whitespace checks and local Convex deployment passed. No test files or database migrations were written. Production was not deployed or changed. Evidence: `.context/provider-geography/{matching-results,nationwide-exception}.png`, `request-availability.json`, and `final-readback.json`.

Integration retained the concurrently added missing-request-geography prompt,
shared coverage-class mappings and outreach features. Manual and outreach fit
classification now share `brokerAreaFit` for nationwide scope and exclusions;
a country alone does not silently become nationwide service.
