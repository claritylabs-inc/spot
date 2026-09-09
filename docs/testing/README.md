# Testing guide

Spot uses automated tests to protect consequential, durable behavior. The goal is not the largest suite or the highest line count. A smaller suite is better when each failure points to a real regression and the suite remains fast enough to run routinely.

## The decision rule

Write a test when all of the following are true:

1. A regression would have a meaningful product, security, data, compliance, or operational consequence.
2. The assertion describes a stable behavior or boundary, not the current implementation.
3. The test can fail for the regression without duplicating the production logic.
4. No existing test already protects the same invariant at an equal or stronger boundary.

If a change is low-risk, primarily visual, or already enforced by TypeScript, ESLint, a build, or an existing integration test, do not add another test by default.

## When to write tests

Prioritize coverage for:

- **Authorization, privacy, and tenant isolation.** Test who may read or mutate data, impersonation boundaries, OAuth scopes, external actor resolution, and fail-closed behavior.
- **Irreversible or externally visible side effects.** Test destructive operations, email and channel delivery, certificate generation, compliance decisions, migrations, and any workflow that can lose, duplicate, or expose data.
- **State transitions and recovery.** Test idempotency, ordering, cancellation, retries, leases, resumability, stale completions, partial failure, and fallback rules. These tests should prove the important transition, not every intermediate call.
- **Complex domain invariants.** Test policy evidence and extraction promotion, source grounding, certificate request gates, routing eligibility, normalization, and other rules where several inputs interact and a plausible implementation can be subtly wrong.
- **Security-sensitive external boundaries.** Test webhook signatures and replay windows, authenticated worker endpoints, request encoding, protocol compatibility, and delivery deduplication. Test Spot's handling of the boundary, not the third-party library itself.
- **High-consequence regressions.** When fixing a bug that could reasonably recur, add the smallest test that would have caught it before the fix.
- **Stateful UI behavior with a data or access consequence.** Component tests are appropriate for cases such as autosave ordering, unsaved-data protection, auth transitions, impersonation teardown, or an exact-send confirmation. Assert the user-visible state and outcome through stable semantics.

## When not to write tests

Do not add tests whose main purpose is to lock down:

- CSS classes, colors, spacing, animation, DOM shape, panel placement, responsive layout, or other presentation details.
- Exact copy, prompt wording, labels, icons, email prose, or navigation lists unless the text itself is a required legal or protocol value.
- The presence or absence of source files, imports, function names, exports, string literals, or particular implementation calls.
- Generated code, framework wiring, dependency behavior, or facts already enforced by the compiler, linter, schema generation, or production build.
- Trivial getters, constant maps, simple formatting wrappers, and one-branch adapters with no meaningful failure mode.
- Every enum member, schema field, or implementation branch merely to raise a coverage number.
- Removed, deprecated, compatibility-only, or speculative behavior that the product no longer promises.

Never read production source files in a test and assert that they contain or omit specific strings. Those tests survive broken behavior, fail during harmless refactors, and turn architectural preferences into brittle text snapshots. Enforce mechanical rules with the appropriate compiler or linter; enforce architectural boundaries through public behavior, focused review, and documentation.

Avoid tests where the mock setup recreates most of the implementation, where the expected result is computed with the same algorithm as production, or where a harmless internal rewrite would require replacing the suite. If a test cannot explain a user, data, security, or operational consequence, it probably should not exist.

## Choose the narrowest useful boundary

| Risk | Preferred coverage |
| --- | --- |
| Pure domain rule with interacting cases | Test the owning helper with a compact input matrix. |
| Authorization or persisted state transition | Test the public Convex query, mutation, or action with realistic identities and records. |
| Worker protocol, webhook, retry, or delivery behavior | Test the HTTP or adapter boundary, including the important failure path. |
| Stateful UI that can lose data or cross an access boundary | Test accessible behavior and the resulting state or side effect. |
| Appearance, layout, ordinary rendering, or copy | Use browser and design review rather than an automated unit test. |

Use the lowest layer that can prove the contract. Add an integration test only when the risk exists in the interaction between layers. Do not repeat the same invariant in a helper test, a source-scanning test, a component test, and an end-to-end test.

## Write small, durable tests

- Search the existing suite first and extend the closest owner instead of creating a new file for every change.
- Name the consequence or invariant: `rejects a stale Slack signature` is more useful than `returns false`.
- Cover the successful path and only the failure paths with distinct risk. Consolidate equivalent cases with a table.
- Assert outputs, persisted state, authorization decisions, and externally visible calls. Avoid private call order unless ordering is the contract.
- Keep fixtures minimal and recognizable. A reader should understand why each field matters.
- Keep time, randomness, network access, and provider responses deterministic.
- For a regression, confirm that the test fails for the original defect or can clearly distinguish the defective behavior.

## Maintain the suite as product code

Every touched test must continue to earn its cost. Simplify or delete it when the protected contract disappears, stronger coverage supersedes it, it only checks presentation or implementation details, or its setup outweighs the risk it catches.

Before adding coverage, ask:

- What concrete regression will this catch?
- Why would that regression matter?
- Would the test still pass after a correct internal rewrite?
- Is the invariant already covered elsewhere?
- Can this case replace or merge with an existing case instead of expanding the suite?

If those questions do not have crisp answers, leave the test out.

## Hands-on workflow improvement

Use [the platform workflow guide](workflow-qa.md) and the repository
`cl-workflow-qa` skill for scripted testing in visible cloud Chrome. Write the
expected use case first, capture observed behavior, fix and rerun it, then
perform frontend-design and deslop reviews before committing each batch.
Maintain passed, failed, blocked, and not-run coverage separately.
