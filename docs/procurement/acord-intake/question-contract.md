# Question and answer storage contract

The canonical definitions are in [question-catalog.json](question-catalog.json). Their shape is defined by [catalog.schema.json](catalog.schema.json); proposed stored answers use [answer.schema.json](answer.schema.json). These are design artifacts. No Convex tables or writers have been added.

## Suggested storage boundaries

| Record | Identity | Contents |
| --- | --- | --- |
| Catalog revision | `catalogId + revision` | Immutable published definition set and review state |
| Question definition | Catalog revision + `question.id` | Original prompt, group, answer type, options, dependencies, source mappings, reuse candidates |
| Group definition | Catalog revision + `group.id` | Coverage eligibility, subject kind, relevance guidance, display title |
| Application subject | Request ID + stable subject ID | Company, coverage request, location, building, vehicle, driver, employee class, person, prior policy, or loss; links to parent subjects |
| Question selection | Request revision + catalog revision + question ID + subject ID | Applicability decision and the specific intake facts used to reach it |
| Answer | Request ID + question ID + subject ID + bound catalog revision | Typed value or explicit answer status, application revision, provenance, context, and revision history |

The same question can be selected for several subjects without sharing their answers. For example, `property.building.year_built` has a different answer instance for each building. A question inherited by both general liability and umbrella can reuse one company-scoped answer when its meaning and period are identical.

A coverage-scoped answer must also have `coverageRequestId`; this identifies the actual requested coverage instance rather than just the line enum. Arrays in current intake do not supply stable subject IDs: assign those when implementing persistence. Do not use array positions as long-lived identities.

Group coverage IDs and relevance instructions are selection metadata. They do not establish permission, carrier requiredness, or jurisdictional applicability.

## Definition example

```json
{
  "id": "property.building.sprinkler_extent",
  "groupId": "property.building",
  "subjectKind": "building",
  "prompt": "What percentage of the building is protected by sprinklers?",
  "answerType": "percentage",
  "requiredness": "not_determined",
  "status": "draft",
  "conditions": [
    {
      "questionId": "property.building.sprinklered",
      "operator": "eq",
      "value": true,
      "subjectBinding": "same_subject"
    }
  ],
  "existingAnswerCandidates": [],
  "contextRequirements": [],
  "sensitivity": "ordinary_business",
  "sourceMapping": {
    "kind": "original",
    "acordQuestionCodes": [],
    "mappingStatus": "not_verified"
  }
}
```

The source mapping is deliberately unpopulated. Similar subject matter is not proof that a prompt is equivalent to an ACORD question. Preserve original identifiers if mappings are verified later, and record the source version and any differences in scope.

## Values and answer status

The reusable value shapes include boolean, text, long text, lists, choices, integer counts, decimal numbers, percentages, dates, years, money, period money, period counts, unit-bearing measurements, addresses, email/phone, and file/entity references. A percentage is on a 0–100 scale. Monetary amounts use decimal strings and separate currency codes. Reporting periods use explicit `from` and `through` dates.

| Status | Value allowed? | Meaning |
| --- | --- | --- |
| `unanswered` | No | No answer has been supplied |
| `answered` | Required | A typed answer is present; `false`, `0`, and an explicitly empty collection remain valid values where the question permits them |
| `unknown` | No | The respondent does not know |
| `not_applicable` | No | A reason is required; this is not a false answer |

The server must look up the question's answer type from the bound catalog revision. Never trust an incoming `answerType`, `subjectKind`, actor identity, or coverage ID as authority. The schema validates the declared shape; it cannot validate cross-record authorization or whether the declared type matches the selected definition.

Reference values are IDs, not arbitrary public URLs. Validate entity type, request ownership, authorized file access, and relationship to the subject at the writer. Store accepted answers within the existing owner-scoped intake lifecycle. Draft answers do not publish company facts or change the submitted snapshot.

Tax identifiers, policy numbers, driver license details, and dates of birth are marked restricted. Apply the owning product's access controls when implementing storage and presentation. These flags do not grant permissions or change current analytics behavior.

## Conditional behavior

Each `conditions` array is an AND of equality predicates against answers for the same subject. Only `answered` parent values can satisfy or refute a predicate. A missing, unknown, or unresolvable parent leaves eligibility unresolved. The selector must include or resolve prerequisite questions before a conditional child can be presented.

A confidently false condition hides the follow-up for the current selection. It does not erase prior answers. If the parent changes, invalidate the dependent selection and retain the old answer with its revision for audit. Dependencies must reference existing questions on the same subject type and have no cycles.

Questions without explicit conditions are still candidates, not universal requirements. Jev can evaluate business relevance using their prompt and group context. Conditions on a company question cannot be used as a `same_subject` predicate on a building or vehicle; that relationship must go through the selection layer with explicit parent-subject context.

Questions with `contextRequirements: ["historyPeriod"]` need a resolved reporting window. Render the exact dates alongside the prompt and store them in the answer context. Do not silently choose five years or treat a carrier-specific history period as universal. Changing the period invalidates answer equivalence.

Several narrative prompts collect an explanation with related details. These are intentionally narrative in this draft. If a downstream form or workflow needs those details as separately queryable facts, split them into additional typed definitions before that integration instead of treating free text as structured evidence.

## Existing-answer reuse

`existingAnswerCandidates` contains logical paths into current intake, not executable JSONPath or approved ACORD mappings. Resolve each path using the actual subject and selected coverage. For example, `details.coverages[general_liability]` means the matching coverage instance, not a numeric array index.

Reuse only when entity, scope, time period, precision, and meaning agree. Counts saved as strings need validation. Money saved without currency cannot satisfy a currency-bearing answer without resolving currency. A free-text ownership answer may not map safely to an enum. Evidence extraction should retain its source and confirmation state.

The current owners are `lib/insurance-intake.ts`, `lib/insurance-intake-details.ts`, `convex/lib/intakeApplication.ts`, and `convex/requestIntake.ts`. Existing company facts remain in typed intake/business profiles; this catalog does not move them to Markdown or create a second canonical company profile.

## Jev selection

1. Code identifies selected coverage instances, subjects, accepted shared intake facts, and explicit application requirements.
2. Retrieve groups matching those lines and evaluate business-specific supplement relevance. Do not route `unknown` or `other` into every group.
3. Evaluate small, independent relevance questions against structured intake context. Keep the prompt and subject context available to Jev; a code or section name alone is insufficient.
4. Apply `convex/lib/jevThreshold.ts`. Low confidence leaves the decision unresolved. Relevance cannot override a known mandatory requirement.
5. Code resolves dependencies, reuses equivalent answers, deduplicates subject-scoped prompts, and orders the remaining questions.

A selection record should identify the catalog revision, question, subject, decision, confidence, and input fact references. Changes to relevant business activities, locations, coverage, or answers invalidate affected selections. Model calls must use the existing router transport if this is implemented later.

The current catalog has `status: draft` and all question requiredness is `not_determined`. No live selector or completion gate should treat it as an approved carrier application.

## Validation boundaries

JSON Schema checks the artifact and value shapes. The later application writer must also enforce:

- Definition/answer type agreement, valid option IDs, and field-specific constraints.
- Stable subject and coverage relationships, tenant/request authorization, and server-bound provenance.
- Reporting-period ordering, valid calendar dates, and supported currency/country codes.
- Resolved history context where required and deterministic dependency evaluation.
- Optimistic revisions, preservation of accepted snapshots, and the existing submission rules.

The catalog is complete as an authored 475-question draft. It has not been audited for one-to-one content equivalence with all 1,868 indexed ACORD codes or for every carrier's quote requirements.
