# Provider email question extraction audit — October 23, 2026

The follow-up [reliability fix and verification](provider-email-extraction-reliability-2026-10-23.md) addresses the defects below. This document preserves the original observations.

## Scope and result

Diagnostic pass requested by the user. Tested 34 distinct synthetic provider replies plus one exact duplicate delivery against native-local Convex (:3220) and the local app (:3207), using real cl-router generation and grounding. Ordinary extraction and deduplication worked, but this pass found silent omissions, lost conditional follow-ups, inconsistent promotion of historical/static facts, and a hidden partial-review warning. These findings remain open; no product fixes were made in this pass.

The path exercised was the production inbound parser → shared `mirrorTeamEmail` storage helper → scheduled routing/extraction → grounding → persisted questions/provider requirements → signed-in operator UI. A temporary local-only fixture endpoint supplied synthetic inbound messages; it was removed after the audit. No external emails were sent. Actual Resend Receiving/webhook authentication, attachment-body extraction, hosted durable-job recovery, client-answer extraction and live email delivery were **not run**. This is a focused question-extraction audit, not an end-to-end production email certification.

There were 32 extraction runs; unknown-sender and closed-request cases correctly skipped inference. All 32 persisted as `complete`, despite the omissions below. Eight had held proposals. Extraction start-to-finish latency was 1.350–9.553 seconds, median 3.349 seconds. These local synthetic timings are not a production SLA. Model concurrency was bounded to three.

## Findings

### 1. High: question lists silently stop at 20

Both runs of an email with 25 explicit questions added only 20. Each reported `complete` and `unappliedCount: 0`, with no recorded overflow. The 12-question and exactly-20-question controls added every question. The extraction schema caps output at 20, and persistence slices proposals to 20. The missing five questions are absent from both Information Needed and the stored proposal list.

Owners: `convex/actions/procurementInformation.ts` (`questions.max(20)`) and `convex/procurementInformation.ts` (`finishExtraction`). Recommended: bounded continuation/chunking, explicit coverage accounting and an incomplete/review state whenever the source cannot be fully processed.

### 2. High: requests after the first 30,000 characters are invisible

A 33,690-character parsed current body with its only request at the end produced zero proposals and zero questions, marked complete without review. Moving the request to the front of the same long body produced one question. Extraction context silently slices the body at 30,000 characters. A 24,090-character control produced a proposal, but grounding held it; that control is not counted as a full pass.

Owner: `convex/procurementInformation.ts` (`extractionContext`). Recommended: preserve a truncation signal and process remaining content with bounded chunks or explicitly require review. Do not report an unexamined tail as complete.

### 3. High: conditional follow-ups are lost

An email asked whether the company uses subcontractors and, if yes, its expected CAD subcontractor spend over the next 12 months. Only the prerequisite yes/no question was retained. In the operator browser, answering **Yes** and syncing replies still left one question and one extraction: the dependent spend question never appeared. The original message is already processed, so ordinary sync does not recover it.

With a known-Yes prerequisite, the spend question was extracted, but no dependency was persisted. Its applicability cannot follow a later change of the parent answer through that missing relationship.

Owners: provider extraction prompt/schema and `finishExtraction`. The prompt explicitly leaves dependent questions “for later,” but no deferred child or trigger completes that work. Recommended: persist the dependency and child definition, then use applicability to show or exclude it as answers change.

### 4. High: partial successes suppress the review warning

The same three-question email was run three times. It requested supervisor count, the date of the latest safety training, and an incident reporting process. Each run proposed all three and grounded all three, but added only two; the training date had period `unspecified` and was held.

Visible Chrome confirmed that the resulting page showed two questions and **no review warning**. A wholly held ambiguous-turnover email did show “Some replies need review.” The panel excludes an extraction from review attention as soon as any requirement exists for that source message. Consequently, operators can miss held questions in otherwise successful replies.

Owner: `convex/procurementInformation.ts` (`panel.emailActivity.needsReview`). Recommended: track unresolved proposals individually; applying one question must not clear attention for another.

### 5. Medium: static and historical questions are inconsistently promoted

The training-date question above was held in all three runs because its period was `unspecified`, even though it was an explicit, grounded request for the most recent event. Two warehouse year-built questions produced 0/2, 0/2 and 2/2 automatically added across three identical emails. One run omitted the first warehouse even from proposals; other differences came from `unspecified` versus `current` periods.

Owner: scope generation and automatic-promotion checks. Recommended: represent static facts and last-event dates explicitly rather than requiring every fact to resemble a reporting-period fact. Retain conservative review for actual ambiguity. Also investigate the grounding hold on the clear 24,090-character control.

## Case ledger

“Passed” means the observed behavior matched the stated narrow expectation; it does not establish universal model reliability.

| Case / runs | Outcome | Observation |
| --- | --- | --- |
| Ordinary headcount / 1 | Passed | One numeric question, correct coverage and scope. |
| Same fact paraphrased by second provider / 1 | Passed | Reused one question with two provider requirements; confirmed in browser. |
| Exact message redelivery / 1 additional delivery | Passed | Duplicate recognized; extraction and question counts stayed at one. |
| Prior-year vs next-12-month revenue / 1 | Passed | Two distinct questions and periods. |
| USD vs CAD revenue / 1 | Passed | Separate facts; no currency conversion or merging. |
| Feet vs existing metres question / 1 | Passed | Separate question; did not reuse different units. |
| GL and Cyber / 1 | Passed | Two questions mapped to their respective coverages. |
| Three-question list / 3 | Partial | Three grounded proposals, two added, date held every time. |
| Two warehouse subjects / 3 | Failed / inconsistent | Added 0, 0, then 2; first run omitted one proposal. |
| Unknown conditional prerequisite / 1 | Failed | Parent added; child lost even after Yes and UI sync. |
| Known-Yes conditional prerequisite / 1 | Partial | Child added without a dependency. |
| HTML-only email / 1 | Passed | Parser recovered body; two questions added. |
| Acknowledgment and statements-only / 2 | Passed | No questions invented. |
| Old quoted and forwarded history / 2 | Passed | History removed; no old requests added. |
| Vague turnover / 1 | Passed conservative hold | Proposal held; browser review warning visible. |
| Unsupported coverage / 1 | Passed conservative hold | No incorrect coverage automatically assigned. |
| Loss-run document request / 1 | Passed with limitation | Long-text question added; supporting upload available, no dedicated required-file question type. |
| Fact already in submitted application / 1 | Passed conservative handling | Exact existing-answer hint supplied; no automatic answer write. |
| Hostile instructions mixed with real request / 1 | Passed | Only legitimate underwriting question added. |
| Sensitive-only request / 1 | Passed | No credential/medical question added. |
| 12-question list / 1 | Passed | 12/12 added. |
| Exactly 20-question list / 1 | Passed | 20/20 added. |
| 25-question list / 2 | Failed | 20/25 both times; no overflow recorded. |
| Long body, request at tail / 1 | Failed | 0 questions; unexamined tail silently dropped. |
| Same long body, request at front / 1 | Passed control | One question added. |
| Below-limit long-body control / 1 | Partial | Request proposed, grounding held it. |
| Unknown sender / 1 | Passed | No extraction started. |
| Closed request / 1 | Passed | No extraction started. |

## Reproduction and evidence

Isolated organization: **Provider email extraction QA · October 23** (`w972gefz8jznx66mamkpnzp8n18gt3x3`). Synthetic request records remain locally for inspection. No real client data or transport was used. The temporary fixture endpoint was guarded to local mode and the marked QA organization; no schema migration was needed.

Evidence is in gitignored `.context/qa/email-extraction-audit/`: `plan.md`, `cases.json`, `repeats.json`, `manifest.json`, `results.json`, `repeat-results.json`, per-case JSON, `duplicate.json`, `conditional-after-yes-resync.json`, harness scripts, logs and the archived temporary fixture source. These JSON results include source/parsed bodies, proposals, grounding results, scopes, promoted questions and provider links.

Browser screenshots: `dedup-two-providers.png`, `conditional-after-yes.png`, `partial-no-review-notice.png`, and `fully-held-review-notice.png`. The partial case is request `zh76m6sbczjs8m352e06zgxz858gvck4`; the conditional case is `zh7czmmdhx7s1ch1acyb95bmx18gtjxj`.

Recommended fix order: expose partial/truncated extraction first, preserve conditional children next, then improve static/date scope handling and rerun the same cases. The audit uses the cl-workflow-qa skill; this diagnostic request intentionally reports defects without fixing product behavior.
