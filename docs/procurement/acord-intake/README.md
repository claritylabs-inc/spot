# Procurement follow-up question catalog

The [full-text catalog](full-question-catalog.md) contains **475 original questions in 36 sections**, organized around Spot's seven named intake coverage lines and seven business-specific supplements. [question-catalog.json](question-catalog.json) is the canonical structured version for database design.

The questions use original intake wording. **One-to-one coverage of the ACORD registry has not been verified.** Review the catalog before using it to replace an ACORD application or drive production intake.

## Deliverables

| File | Contents |
| --- | --- |
| [full-question-catalog.md](full-question-catalog.md) | All 475 prompts, answer types, choices, and conditional follow-ups, grouped for review |
| [question-catalog.json](question-catalog.json) | Stable IDs, full text, sections, entity scope, coverage mappings, answer types, conditions, existing-answer candidates, and context requirements |
| [catalog.schema.json](catalog.schema.json) | JSON Schema for question definitions and 26 reusable answer-value shapes |
| [answer.schema.json](answer.schema.json) | JSON Schema for subject-scoped, revision-bound answers with explicit answered/unknown/not-applicable states |
| [question-inventory.md](question-inventory.md) | Readable inventory of all 1,868 distinct question codes, grouped into 80 source-code families |
| [question-index.json](question-index.json) | Machine-readable question identities, family membership, source references, duplicate counts, wording hashes, and explicit review states |
| [line-manifest.json](line-manifest.json) | Candidate family mappings for all seven named Spot intake lines, shared questions, conditional supplements, and reachable model nodes |
| [model-graph.json](model-graph.json) | 3,027 model nodes with forward element relationships, data types, code-list references, attribute names, and observed repetition indicators |
| [question-contract.md](question-contract.md) | Database structure, existing-answer mappings, and Jev selection boundaries |

Exact ACORD-code mappings remain empty pending verification. `question-index.json` indexes the source codes; `question-catalog.json` contains the original full-text prompts.

## Full-text catalog coverage

| Section family | Questions |
| --- | ---: |
| Shared company, operations, locations, insurance, policies, and losses | 77 |
| General liability | 35 |
| Commercial property | 62 |
| Workers' compensation | 42 |
| Commercial auto | 53 |
| Professional liability | 30 |
| Cyber | 70 |
| Umbrella and excess | 20 |
| Business-specific supplements | 86 |

Supplement sections cover contractors, product manufacturers/importers/distributors, hospitality and liquor, technology services, healthcare, transportation, and real-estate businesses. They are eligible across relevant lines rather than duplicated into each line. These are the authored section counts, not counts of equivalent ACORD questions.

Each question has a concrete prompt and answer type. Choice questions include stable options. Conditional follow-ups reference stable parent-question IDs. Repeated subjects include locations, buildings, vehicles, drivers, employee classes, people, policies, and losses. Money and reporting-period answers preserve currency and dates; measurements preserve units.

The draft includes 115 conditional prompts, 43 mappings to candidate existing intake answers, and nine prompts requiring an explicit history window. Validation passed for both JSON Schemas, the catalog against its schema, unique IDs, choice references, subject-compatible dependencies, absence of dependency cycles, current intake coverage IDs, and agreement between the JSON prompts and the readable catalog.

## Source and completeness

The source index uses [PilotFish's Policy viewer](https://modelviewers.pilotfishtechnology.com/modelviewers/ACORD-PCS/model/Policy.html). Its [QuestionCd table](https://modelviewers.pilotfishtechnology.com/modelviewers/ACORD-PCS/model/QuestionCd.html) embeds the `ResponseIndicator` question registry. [QuestionAnswer](https://modelviewers.pilotfishtechnology.com/modelviewers/ACORD-PCS/model/QuestionAnswer.html) describes how question codes and their responses fit into the model.

The table contains 1,869 rows and 1,868 distinct codes. `CUMBR27` occurs twice with identical wording; the index retains one identity with `sourceOccurrences: 2`. No question codes were discarded. Gaps in numeric sequences are preserved, and leading zeroes are significant.

The structural crawl followed every forward element link reachable from Policy and the seven commercial line roots, including the commercial package container. All 3,027 discovered element pages were fetched successfully. Parent links and attribute definition pages were not traversed. This broad discovery includes personal lines, specialty products, policy administration, and deprecated structures; it is not the set of questions to show applicants.

The model graph retains structural identifiers, not source descriptions. `repeatingIconObserved: false` means only that the viewer did not display a repetition icon. It does **not** establish maximum cardinality one. Minimum cardinality, schema choices, reference-target constraints, and XML serialization rules need the actual schema. Entity/group nodes are not necessarily literal XML elements; these graph paths are not validated XPath expressions.

The viewer does not establish an ACORD standard release, printed-form edition, page/question number, jurisdiction-specific requirement, or carrier acceptance rule. Those are recorded as unknown rather than invented. Code-list links are retained from the element pages; the entire code-list library was not separately fetched or validated.

## Current intake lines

These are editorial candidate mappings based on code families and the supplied viewer. Family membership is a retrieval aid, not proof that every question in a family applies.

| Spot coverage ID | Model root | Primary family | Distinct primary codes | Conditional supplements to review |
| --- | --- | --- | ---: | --- |
| `general_liability` | `GeneralLiabilityLineBusiness` | `CGL` | 44 | Contractors, liquor, hotels, restaurants, railroad, international operations |
| `property` | `CommlPropertyLineBusiness` | `PROP` | 34 | `CPR` property/program topics, glass, wind, earthquake, flood, vacant buildings, hotels, restaurants |
| `workers_compensation` | `WorkCompLineBusiness` | `WORK` | 99 | `WORKA` supplemental topics |
| `commercial_auto` | `CommlAutoLineBusiness` | `AUTOB` | 17 | Drivers, garage operations, motor truck, truckers |
| `professional_liability` | `ErrorsAndOmissionsLineBusiness` | `EO` | 55 | Profession-specific and medical-professional topics |
| `cyber` | `CyberLiabilityLineBusiness` | `CYBR` | 163 | Review question-level business applicability |
| `umbrella` | `CommlUmbrellaLineBusiness` | `CUMBR` | 36 | Underlying contractor, liquor, driver, and garage exposures |

The primary pools total 448 distinct codes. The 65 `GENRL` codes form a separate shared candidate pool, but include personal and policy-specific topics; do not ask all of them universally. Conditional supplements overlap across lines and must be deduplicated by question code **and** the subject being insured.

`CPR` contributes 94 additional property-related candidates, including program-specific questions; it is not silently folded into the core property pool. `PROF` and `MP` are not generic questions for every professional business. `WORKA` includes supplemental and carrier-facing topics. Review each question's audience and jurisdiction before enabling it.

All remaining families stay visible in the inventory. Unclassified labels are intentionally blank in JSON. `other` must resolve to a reviewed line/program mapping; `unknown` must resolve the requested coverage first. Neither option selects the entire remaining registry.

## Two distinct sources of intake fields

1. **Coded underwriting questions:** `QuestionAnswer.QuestionCd` identifies a registry question. These need preserved meaning, an answer schema, conditional details, scope, applicability, and wording review.
2. **Structured exposure facts:** fields under line aggregates and shared insured/location/loss aggregates represent schedules, amounts, dates, classifications, and other facts. They are not all registered questions. Preserve their containing entities and reference relationships when authoring an intake prompt.

For example, the [cyber root](https://modelviewers.pilotfishtechnology.com/modelviewers/ACORD-PCS/model/CyberLiabilityLineBusiness.html) has a relatively small immediate field set but includes `QuestionAnswer`. Traversing only its immediate scalar fields would miss the cyber question family.

The graph also contains premiums, credits, underwriting decisions, system identifiers, and policy issuance fields. Their presence does not make them applicant questions. Some code families also contain broker checks, elections, or policy interpretation questions. Do not use name-based filtering as final authorization to show or omit a question.

## Remaining work before runtime integration

- Review the original prompts for underwriting completeness, business applicability, jurisdiction, and follow-up detail. This draft does not assert coverage of every source question.
- Validate source-code mappings individually if ACORD compatibility is required; do not populate mappings from prefix similarity alone.
- Resolve requiredness from the actual carrier/program and applicable jurisdiction. No draft question is automatically mandatory.
- Confirm equivalent existing answers before reuse; prose may need structured extraction and applicant confirmation.
- Verify form/edition mappings separately if generating ACORD forms is part of the later workflow.
- Resolve source schema cardinality and code lists before building ACORD serializers. The catalog's original choices are not ACORD code lists.
- Implement request-owned answer persistence, subject IDs, revisions, Jev selection, and the additional-question UI.

No application, Convex schema, agent tools, or live intake behavior changed. The catalog and answer schemas are design artifacts. No unit tests, deployment, or Vercel previews were used.
