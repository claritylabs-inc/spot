# Operator context compaction

The operator runner estimates UTF-8 input bytes / 3 (the shared history
estimator), plus per-message overhead, over its complete system prompt, offered
tool schemas and model messages. Continuations already include prior dialogue,
so history is counted once. A pinned model's live router `maxInputTokens` sets
the limit; automatically routed calls use a conservative 128,000-token fallback
because the route is selected after submission. Compaction starts at 60% of
that input limit (76,800 estimated tokens by default), leaving room for
estimation error, tool results and the 8,192-token output budget. Capabilities
failures use the same fallback. `OPERATOR_CONTEXT_COMPACTION_TOKENS` may lower
that threshold, with a minimum of 4,096; it cannot raise the 60% limit.

`operatorContextCompaction.ts` owns estimation, safe exchange boundaries and
exact reference metadata. The runner applies the existing per-result tool-output bound,
without repeatedly shrinking recent results against a combined byte budget. It
then summarizes an older prefix while retaining the newest four complete
assistant/tool exchanges (or `compact_context.keepRecentSteps`, 1–12). If recent
steps alone exhaust the budget it reduces retention, down to one complete
exchange. The latest user message stays verbatim, and the current objective is
also stored verbatim in working notes. A call and its results cannot straddle
the boundary, including parallel calls with separately returned results.

`operatorContextCompactionRunner.ts` uses the existing routed `summary` task.
Each request is bounded to 20,000 estimated input tokens and 2,048 output
tokens. Sequential source fragments have stable durable invocation keys for
the run iteration; a resumed job returns its stored result. Working notes
separate completed work, remaining work, decisions and errors. A deterministic
reference ledger retains IDs, names, cursors, input hashes, statuses and error
codes from older exchanges without asking generation to reproduce them.
Repeated compaction carries that ledger forward. Large ledgers or irreducibly
large recent input fail with `context_compaction_failed` rather than silently
losing references. Raw provider failures remain internal.

`operatorContext.installCompactedContinuation` installs a new blob only for the
current running attempt, iteration and source storage ID. It does not advance
the iteration. The checkpoint records compaction count, iteration, and estimated
tokens before/after; existing checkpoint replacements preserve these fields.
Only one install can succeed per iteration. Compaction is skipped once that
iteration's execution router job exists, so replay uses the submitted context.
The activity trace records a context-preparation stage with before/after counts.
Continuation metadata retains recovery state, leaked-call retry counts and
parent request IDs. Approval payloads, exact input hashes and execution audit
rows remain in their existing server-owned records; notes cannot approve or
replay a write. Approval pause/resume uses the same confirmation path.

`compact_context` is a core read tool with no confirmation. It requests
compaction at the next durable iteration, after its own tool result is stored.
It accepts an optional focus note as untrusted data. Small contexts with no
older complete steps need no compaction. Direct MCP calls have no model context
and return an explicit `not_applicable` result.

`operatorAgentHistory.ts` and `actions/compactOperatorThreadHistory.ts` reuse
`selectBoundedAgentHistory`, `formatMessagesForThreadSummary`,
`THREAD_SUMMARY_VERSION`, the `summary` model task and
`buildThreadContinuityPrompt` from the tenant history design. Tenant execution
is unchanged. Completed operator turns schedule a rolling summary of aged-out
messages in batches of at most 48 messages / 16,000 estimated source tokens;
the full summary request is capped at 20,000. The latest turn is protected when
choosing the cutoff. The cutoff is frozen while a generation is pending, and
summary commits compare generation and prior watermark. Unknown inference
outcomes reuse the same durable invocation; errors retain the prior summary
and watermark, with another attempt eligible after a later completed turn.
Business facts in continuity notes must be refreshed using current tools.

Schema additions are the `operatorThreadContextStates` table, indexed by
`by_threadId`, and optional `operatorAgentRuns.checkpoint.compaction` metadata.
No existing field changes meaning and no migration is required.
