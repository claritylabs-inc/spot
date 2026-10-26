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
