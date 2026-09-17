# Synthetic Jev domain evaluation archive

These artifacts document a **synthetic, unqualified evaluation with no measured reasoning/router baseline**. They do not authorize family activation, deployment, or package publication. Source review accepted the domain implementation at `7b17ed237ed94e258acb16446f2216f3763a9722`; integrated acceptance still requires the actual shared packages and manager wrapper tests after router deployment.

- [evaluation-report.md](evaluation-report.md) records the calibration sweep, separate held-out results, latency, estimated input cost, and limitations.
- [live-results.json](live-results.json) preserves all 40 synthetic requests and returned answers, resolved model version, usage, and local request timings. It contains no customer records, credentials, or request/response transport headers.
- [evaluate.mjs](evaluate.mjs) contains the fixture definitions and evaluation hook, transcribed from the ephemeral TypeScript harness by removing type annotations and adjusting imports for this directory. Labels and splits are unchanged. Its live mode reads a key only from the environment; the review command below uses saved responses and removes that key from the child environment.
- [replay.mjs](replay.mjs) replays saved answers against the domain acceptance functions at candidate floors .90, .95, and .99. It substitutes an evaluation adapter inside the generated bundle, without writing a runtime stub or modifying source files.

From the repository root with Node 24 and installed repository dependencies:

```sh
node docs/testing/jev-domain-2026-09-17/replay.mjs
```

This command makes no inference calls. It writes disposable bundles and replay outputs only under `.context/jev-domain-artifact-replay/`. Use the reviewed source commit above to reproduce its acceptance logic; later domain changes can change replay outcomes. The immutable original requests remain in `live-results.json`.

The live run invoked the domain `accept` callbacks through an evaluation hook, bypassing the shared transport, policy, and SDK response validator. It therefore measured domain acceptance on returned answers, not integrated routing or activation behavior. Consumed-branch callbacks added afterward do not change those domain acceptance results. The dispatch observer was corrected for offline replay to recognize the callback's `{name, input}` result as well as the prepared model step; no live dispatch case was accepted, so that correction changes none of the recorded live outcomes.

Each family's indices 0–4 are calibration fixtures; 5–9 are separately worded held-out fixtures authored before execution. Both sets are synthetic and share the author's assumptions. Accepted label agreement is not representative workflow accuracy. `correct` in the raw file means agreement with the fixture's expected outcome, including an expected fallback; the report counts accuracy only among accepted decisions. Zero accepted cases have undefined accepted-decision accuracy, not zero accuracy.

`minimumConfidence` and `minimumSelectedProbability` summarize all speculative Choice answers, including unused ones. They are diagnostic fields, not the gate applied by domain `accept`. Replay outputs retain recorded latency and usage; replay itself does not measure new inference latency or cost. The model price used for estimates was read from the TypeSafe model documentation on the run date; it is not an invoice.

No family is qualified for active mode. Baseline-relative accuracy, the reversible five-percentage-point limit, fallback costs, total workflow cost/latency, and downstream answer quality remain unmeasured.

Original `live-results.json` SHA-256: `de214164716e203f3d566dd4d77d6f908bc25f8713977699fefaaa4ce7df01da`. The published file is byte-for-byte identical to the ignored evaluation output.
