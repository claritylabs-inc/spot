# Typed decisions

Spot sends bounded semantic questions through cl-router. The router owns the
version-pinned Jev adapter and credentials; Spot retains workflow execution,
authorization, source evidence, and reasoning fallback.

## Configuration

Set `SPOT_DECISION_POLICY` as JSON in each consuming Convex or worker environment.
Missing or invalid configuration preserves the established reasoning path.
The default is:

```json
{"mode":"legacy"}
```

A shadow rollout records judgments while executing the existing reasoning
path:

```json
{"mode":"shadow","policyVersion":"shadow-v1","timeoutMs":1000}
```

Active mode requires a family-specific threshold and an evaluation ID. An
identifier alone is not acceptance evidence: review the associated report
before configuring it. Keep consequential families on their existing path
until their stricter evaluations pass. Return the global mode and any family
overrides to `legacy` for immediate rollback.

Router model selection has separate `legacy`, `jev_shadow`, and `jev_active`
controls. Routing uncertainty chooses the qualified established default;
domain-decision uncertainty invokes the existing reasoning workflow. Explicit
model pins and freezes remain binding. Typed decision requests bypass dynamic
model selection entirely.

## Evidence and execution

Choice options contain exact candidate identifiers and their definitions.
Independent questions are batched; dependent questions use a later call.
Instructions and criteria remain structured JSON. Noul returns `noul`, Choice
returns its option distribution, and Score returns its level distribution.
No one of these is a general assurance that a workflow is correct.

The shared SDK cascade checks the response and family threshold. Each caller
also validates evidence coverage, candidate membership, identity, and source
references before accepting a result. Missing candidates, stale sources,
conflicting endorsements, namesakes, quoted instructions, and omitted pages
must escalate. PDF-only interpretation remains on the reasoning path when
text and trusted metadata are insufficient.

Tool dispatch stays within real AI SDK steps. The original executor enforces
roles, scopes, approval, idempotency, and audit. Selection never grants access
and never replays completed effects. Free-form arguments and final prose
remain generative.

## Measurement and rollout

Compare router selection against the deterministic router baseline. Measure
whole-workflow cost including routing and fallback, routing latency, time to
first token, completion p50/p95, task success, acceptance, abstention, default
use, recovery, and downstream quality. Calibrate on one dataset and evaluate
on held-out documents and threads. Reversible routing and ranking may lose at
most five percentage points; evidence and authorization gates remain strict.

Synthetic boundary tests establish code behavior. Small synthetic live
benchmarks establish only behavior on those fixtures; neither establishes
production accuracy or savings. Reports must identify fixture provenance,
calibration and held-out splits, threshold, sample count, model version,
policy version, cost, latency, and limitations.

Deploy and verify cl-router before installing released shared packages in
Spot. Publish packages through their existing release workflows and update
root and extraction-worker versions together. Validate the integrated state
with focused tests, typechecks, lint, package alignment, and worker checks.
Keep policy, rating, and audit history intact.

Structured decision logs contain family, mode, outcome, duration, policy and
evaluation versions, request lineage, usage, and cost. They omit source text,
questions, and answers. Unknown costs remain unknown. Extraction model traces
also record successful decision usage through the existing trace owner.

## Family inventory

Each ID is an independent rollout gate; approval for one does not activate its
neighbors. Policy thresholds and local evidence floors both apply. Batched
speculative questions are fully validated, but confidence gates cover only the
answers consumed by the selected branch.

| Surface | Family IDs |
| --- | --- |
| Mailbox | `mailbox.classification`, `mailbox.evidence_selection`, `mailbox.known_record_matching`, `mailbox.reconciliation_relevance` |
| Conversation | `agent.bounded_dispatch`, `intent.forward_direction`, `intent.policy_evidence`, `intent.requirement_import` |
| Identity | `identity.carrier_website`, `identity.certificate_holder`, `identity.company_website`, `identity.company_industry`, `identity.company_vertical` |
| Company memory | `memory.durable_fact_detection`, `memory.evidence_and_section` |
| Evidence review | `certificates.evidence_support`, `compliance.requirement_evidence`, `proposal.requirement_review` |
| Retrieval and security | `retrieval.passage_ranking`, `security.prompt_injection` |
| Policy intake | `policy_document_intake` |
| Shared extraction SDK | `extraction.cleanup`, `extraction.recovery_regions`, `extraction.verify` |

SDK query and application coordinators also expose their own gates, documented
in the SDK's `DECISIONS.md`. Spot does not currently call those coordinators;
their results are not Spot workflow savings.

The [domain evaluation archive](../testing/jev-domain-2026-09-17/README.md)
contains 40 synthetic calls across four families. At the retained .99 evidence
floor, four calls were accepted, including two of 20 held-out calls. Certificate
acceptance established a conservative hold, not issuance. Memory and dispatch
accepted none. No family is qualified active by this report, and no paired
reasoning baseline, total workflow savings, or downstream quality improvement
was measured. All families ship with the default legacy policy.

Router selection accounting is preserved in `routing.selection` on generation
responses, stream completion, worker traces, and stored model-call traces.
`costNanoUsd` is selector cost; `generationAttemptsCostNanoUsd` covers recorded
provider attempts; `totalCostNanoUsd` combines them when every component is
known. `expectedFallbackCostNanoUsd` is a historical estimate, not an invoice
or a replacement for actual attempt costs. Existing top-level generation cost
keeps its original meaning.
