# Spot domain evaluation — 2026-09-17

Pinned model: jev-1.13.0. All 40 HTTP calls succeeded. Fixtures are entirely synthetic, authored before execution: five calibration and five separately worded held-out cases per family. They are not customer evidence, public-document samples, or representative workload measurements. The ignored evaluation harness invokes the actual domain helper questions and acceptance functions. No credentials are recorded.

## Calibration

Offline replay of the same calibration answers through the actual acceptance functions at candidate floors (both Choice confidence and chosen probability). These are candidate threshold measurements, not quality qualifications.

| Family | Floor .90 accepted/correct | Floor .95 accepted/correct | Floor .99 accepted/correct |
|---|---|---|---|
| mailbox.classification | 3/3 of 5 | 3/3 of 5 | 2/2 of 5 |
| certificates.evidence_support | 1/1 of 5 | 1/1 of 5 | 0/0 of 5 |
| memory.evidence_and_section | 0/0 of 5 | 0/0 of 5 | 0/0 of 5 |
| agent.bounded_dispatch | 0/0 of 5 | 0/0 of 5 | 0/0 of 5 |

The small calibration split does not justify lowering consequential floors. Retained .99 in code; independently evaluated manager family gates remain required. A .95 candidate would increase calibration acceptance for mailbox and certificates but does not establish safe rollout. Memory and dispatch need better question design/evidence and broader evaluation.

## Held-out results at retained .99

| Family | Accepted | Label agreement among accepted | Fallback | Request latency p50/p95 ms | Estimated input cost USD |
|---|---|---|---|---|---|
| mailbox.classification | 1/5 | 1/1 | 4/5 | 183.4 / 231.6 | 0.00029077 |
| certificates.evidence_support | 1/5 | 1/1 | 4/5 | 147.7 / 217.7 | 0.00013877 |
| memory.evidence_and_section | 0/5 | 0/0 | 5/5 | 153.0 / 206.1 | 0.00016237 |
| agent.bounded_dispatch | 0/5 | 0/0 | 5/5 | 157.2 / 229.0 | 0.00019837 |

All-call aggregate: 37245 input tokens; 5538 output tokens; estimated input charge $0.00156429; latency p50 169.3 ms / p95 239.6 ms. Price $0.042 per million input tokens, free output, read live from https://docs.typesafe.ai/models.md. This is a published-price estimate, not an invoice. Request timings include HTTP/network/provider time and exclude the later reasoning fallback.

Accepted predictions across calibration + heldout: 4/40, all 4 matched labels; 36/40 escalated. One held-out certificate case accepted a conservative hold, not issuance. Escalation is not a correct answer and is not counted as measured decision accuracy. No positive certificate issuance replacement was established at .99. Memory/dispatch replaced no heldout calls.

## Limits and acceptance

No baseline reasoning/router call was run: CL_ROUTER_URL and CL_ROUTER_SECRET are absent from process and .env.local. Therefore baseline-relative accuracy, complete workflow cost, fallback cost, completion latency, TTFT, downstream answer quality and the agreed five-percentage-point budget are NOT MEASURED. The domain decisions do not qualify any family for active mode. Consequential evidence gates need held-out real/public evidence, conflicting endorsements, namesakes, omitted coverage, stale/quoted assertions, and independent manager acceptance. Routing transport and production deployment were not exercised.

The other families (forwarding/import/evidence intent, company/carrier/holder identities, industry/vertical, relevance/known-record matching, mailbox evidence selection, durable-fact detection, proposal/compliance, retrieval and security) remain NOT LIVE-EVALUATED. Do not borrow these four-family results to activate them.
