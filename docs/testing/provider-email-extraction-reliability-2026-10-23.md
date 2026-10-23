# Provider email extraction reliability — October 23, 2026

## Result

The five defects identified in the earlier audit are addressed. Verification used 44 distinct synthetic messages plus one exact duplicate delivery: a 37-case broad rerun, six focused long-email reruns during iteration, and an 85-question boundary case. The final long-email reruns supersede the earlier held/warning results from that iteration. The final acceptance set is the original 37 cases with their three long-email cases replaced by the final controls, plus the 85-question boundary case.

All final acceptance cases met their expected outcome, including conservative holds for genuinely ambiguous/unsupported requests and an explicit failure/review state for oversized context. This is not a claim of universal model accuracy.

## Changes

- Provider extraction now continues in distinct batches of at most 12 new questions, with at most 3,000 output tokens per inference. It carries earlier proposals and stable parent keys into each continuation. The overall bound is 80 questions / eight batches, with explicit incomplete-review reasons on a cap, lack of progress, verification failure or an interrupted continuation. Unknown inference outcomes are never replayed.
- The 30,000-character source truncation is removed. The existing 96,000-byte serialized context budget remains enforced; oversized messages fail visibly instead of silently ignoring the tail. Long-body completeness decisions examine every overlapping source window; individual question grounding uses exact, source-checked quotes with nearby context. Unconfirmed coverage remains flagged for review.
- Conditional prerequisites and children are both retained, including children of already answered parents. Keys are ordered before writing and resolved to request-owned Yes/No question IDs. Invalid, missing or unconfirmed parent references are held rather than converted to unconditional questions. Dependencies survive publication into the dynamic form.
- Static facts and most-recent-event dates have explicit scope guidance. `static` and `most_recent` preserve those meanings without inventing a reporting window; genuinely ambiguous metrics still require review.
- A successful requirement from one source message no longer clears review attention for another held proposal in the same email. Incomplete extraction reasons also keep the review warning visible.

## Observed verification

| Case | Before | After |
| --- | --- | --- |
| 25 explicit questions, twice | 20/25 silently | 25/25 added in both runs, no held proposals |
| 12 / exactly 20 questions | All added | Still all added |
| 85 explicit questions | Not previously exercised | 80 retained, explicit incomplete reasons and visible review warning |
| Request at character 33,690 | No proposal | One grounded question added; final full-body coverage checks passed |
| Same long body, request first | One question | One question, final coverage checks passed |
| Below-limit 24,090-character control | Proposal unnecessarily held | One grounded question, final coverage checks passed |
| Oversized context, about 120,000 characters | Silent-prefix behavior possible | Failed without inference; visible review warning |
| Three-question training email, three runs | 2/3 added, date held | 3/3 added in all runs |
| Two warehouses/year built, three runs | 0/2, 0/2, 2/2 | 2/2 in all runs, distinct warehouse subjects |
| Unknown subcontractor prerequisite | Child discarded | Both questions retained; child has an explicit Yes condition |
| Known-Yes prerequisite | Child unconditional | Child retains its dependency on the known question |
| Nested conditional email | Not previously exercised | Three questions with two dependency levels |
| One clear question + ambiguous turnover | Partial warning suppressed | Clear question added, turnover held, warning remains visible |
| Paraphrased question from second provider | Reused question | Still one question with two requesting providers |
| Exact duplicate delivery | No duplicate inference | Still one extraction and one question |
| Currencies, periods, units, coverage grouping, HTML-only | Passed | Remained correct |
| Acknowledgments, facts-only, quoted/forwarded history | No invented questions | Remained correct |
| Unknown sender / closed request | No extraction | Remained correctly skipped |
| Hostile and sensitive requests | Excluded | Legitimate mixed request retained; sensitive-only email adds none |
| Unknown coverage / vague turnover | Conservative holds | Remained held, rather than inventing scope |

Visible signed-in Chrome also verified that Yes enables the conditional child, No hides it and excludes it from a batch, and an unsure prerequisite includes both parent and child in Add form. No form was created or sent in this verification. Partial, oversized and capped cases all visibly show review warnings.

## Evidence and limits

Raw source/parsed bodies, proposal scopes, conditions, confirmation results, stored facts, provider associations and timings are under gitignored `.context/qa/email-extraction-reliability/`. The main files are `results.json`, `coverage-results.json`, `limit-results.json`, `duplicate.json`, the case JSON, manifests and harness scripts. Intermediate `long-results.json` documents the grounding improvement iteration; use `coverage-results.json` for the final long-email result.

Screenshots: `conditional-yes.png`, `conditional-batch.png`, `partial-review-visible.png`, `oversized-review-visible.png`, `question-cap-review-visible.png`. The temporary local fixture endpoint was archived there and removed from Convex, followed by local sync/codegen.

These runs used the production parser, email-storage helper, scheduled routing, extraction and persistence owners with real cl-router inference, on native-local Convex. Local inline generation was selected before submission, with the existing text-only 3,000-token bound retained. The hosted durable-job path, actual Receiving webhook authentication and live email transport were not exercised; no external email was sent. Previously processed messages were not automatically replayed or migrated. There is no schema/data migration; new stored proposal dependency fields and extraction review reasons are optional for compatibility.

## Verification after merging main

Merged main at `20802f6a` into the feature branch. Full repository ESLint, root TypeScript, Convex TypeScript, and all 133 existing tests (20 files) passed. Convex's ES2022 target exposed an unsupported `toSorted` call; copying the array before `sort` preserves nonmutating prerequisite order and passes both type checks.

Five fresh synthetic deliveries exercised the merged inbox/storage path: basic extraction (1/1), a 25-question email (25/25), conditional parent and child (2/2), partial ambiguous scope (one retained, one held), and a long-body tail request (1/1). Duplicate redelivery retained one extraction. Evidence is in gitignored `.context/qa/email-extraction-merged/`. The temporary fixture endpoint was removed after verification. No external email was sent.
