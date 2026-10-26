# Operator context compaction QA

Run Node 24 and start the local backend only with `npm run conductor:dev`.
Prefix every other Convex CLI command with
`env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN`. Never deploy from a worker.

The October 26 local run used synthetic fixture operator/thread data. Artifacts
are in `.context/w12-*.json`, `.context/w12-*.log` and
`.context/w12-history.jsonl` (workspace-local, not committed).

1. Read `operatorProfiles` through `convex data` to obtain the seeded active
   operator. Create a dedicated MCP conversation with
   `operatorAgent:createOrGetChannelThreadInternal`.
2. Append 30 synthetic user/assistant turns to `operatorAgentMessages` with
   `convex import --table operatorAgentMessages <fixture.jsonl> --append`.
   Each turn states read-only goals, prior decisions and unfinished work; its
   timestamps precede the current turn. Do not use customer conversations.
3. Lower the compaction threshold locally with
   `convex env set OPERATOR_CONTEXT_COMPACTION_TOKENS 24000`. Enqueue a read-only
   task through `operatorAgent:enqueueMessageInternal` requesting
   `get_operator_overview`, `compact_context` with `keepRecentSteps: 1`, then
   a concise answer. Inspect `operatorAgent:getRunResultForOperatorInternal`.
   Expected when routing is available: context notes installed before execution,
   checkpoint compaction count and token estimates, then a second proactive
   compaction if an older complete exchange remains. Repeat a pending iteration
   and confirm the durable summary result and compaction count are reused.
4. For a local summary scheduling check independent of generation, prepare a
   read invocation with `operatorAgent:prepareDirectToolInvocationInternal`,
   then complete its run with `operatorAgent:completeRunInternal` and empty tool
   audit arrays. Query `operatorAgentHistory:getState`. On inference failure,
   `status` is `error`, with no advanced summary watermark. On success, inspect
   the summary/watermark and ask a later turn about the aged-out objective.
5. Invoke `operatorMcpReadCalls:invoke` with `toolName: compact_context`, optional
   keep/focus values, and a stable idempotency key, then repeat the same call.
   Direct MCP calls have no model context: expect `not_applicable` and an
   idempotent replay with identical run/message IDs and input hash.
6. Restore the default with
   `convex env remove OPERATOR_CONTEXT_COMPACTION_TOKENS`.

Observed locally: the read tool and exact replay passed. A manually completed
local QA turn scheduled the rolling summary, whose rejected model call left the
watermark unset. The live long-history task and rolling summarizer both received
`The job callback is not permitted. (router_rejected)` from cl-router. No live
summary generation, compaction installation, approval pause/resume after
compaction, recovery/leaked-call resume after compaction, or later-turn summary
injection is claimed. These remain required integration checks in an environment
with a router-approved callback URL.

A separate synthetic 180-step continuation used the real estimator, existing
output bounding, exchange splitter and exact-reference ledger. Its history
estimate fell from 66,630 to 22,585 tokens with fixed illustrative notes, retaining
four recent pairs and 352 older call/result reference entries. No tool call was
left without its result. Recent retained messages exactly match the original bounded input.
System/tool-schema overhead was omitted from this isolated estimator report;
the runner includes that overhead when deciding whether to compact.

Validation commands on Node v24.22.1:

```sh
npx tsc --noEmit -p .
npx eslint $(git diff --name-only 55dd0402 -- '*.ts' ':!convex/_generated/**')
npm test
git diff --cached --check
```

TypeScript, scoped ESLint and whitespace checks passed. The existing test suite
passed: 20 files, 145 tests. No test files were added or modified. Local functions
also compiled and loaded through the Conductor development script.

## Manager-review correction: fail-safe compaction

The follow-up run used the real local Convex runner, persisted synthetic
continuation blobs, and an HTTP router stub on `127.0.0.1:8799`. The stub fetched
requests and delivered results through the existing local router-job capability
endpoints. Execution-model responses were stubbed; no provider inference is
claimed. `CL_ROUTER_URL` was temporarily changed for these fixtures and restored
afterward. No test files were added.

| Scenario | Local outcome |
| --- | --- |
| Automatic compaction, threshold 16,000; `SPOT_ENV=local` and `OPERATOR_CONTEXT_COMPACTION_FORCE_FAILURE=true` | Completed with deterministic notes: 49,062 → 18,327 estimated tokens, count 1. The execution request contained working notes and the exact `cursor-17` reference. |
| Re-enter the automatic run while its execution router job is pending | Reused the installed continuation and job; final compaction count stayed 1. |
| Exact-reference ledger deliberately larger than the 128,000 hard input limit; original history still fits | Logged skipped compaction, retained all original messages, and completed at 43,736 → 43,736 tokens; mode deterministic, skipped true, count 1. The execution request contained no replacement notes. |
| Manual `compact_context`, below the automatic threshold; stub rejects its routed summary with HTTP 400 `router_rejected` | Completed: 10,369 → 9,573 tokens; deterministic mode, count 1, compaction iteration 1. The web activity stage explicitly recorded deterministic mode and both estimates. |
| Manual compaction's summary job yields, then completes with empty output | Yielded without installing notes while pending; resumed the same summary job and completed with deterministic notes, count 1. An explicit pending resume also yielded. |

The pending/empty workflow used a 30-second callback delay to inspect the queued
run before the summary completed. Its checkpoint still had iteration 1 and no
compaction entry; a direct `operatorAgentRunner:run` resume returned `queued`.
After the empty result arrived, the existing model-output validation raised an
error and deterministic fallback let the task finish. Earlier empty-output
execution also completed with one deterministic compaction.

Artifacts: `.context/w12-review-{auto,original,manual,pending}*.json`,
`.context/w12-review-stub.jsonl`, `.context/w12-review-pending-yield.json`,
and the local-only fixture/stub scripts in `.context/`. The scripts are QA
artifacts, not registered application functions or committed test files.

Follow-up validation:

```sh
npx tsc --noEmit -p .
npx eslint convex/lib/operatorContextCompaction.ts convex/lib/operatorContextCompactionRunner.ts convex/operatorAgentRunner.ts convex/operatorContext.ts convex/schema.ts
npm test
git diff --check
```

All passed; the existing suite remains 20 files / 145 tests. Live provider
summary generation and approval pause/resume after compaction remain unverified
as recorded above.
