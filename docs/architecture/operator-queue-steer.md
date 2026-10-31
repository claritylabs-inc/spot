# Operator queue and steer

Status: design (packet 1). Builds on subtasks and turn ownership (`AGENT_TOOLS.md` → "Operator subtasks and concurrent operators").

## Goal

There is one primitive, the **pending input**: a durable message that has been sent to a conversation that is already busy. It is either:

- **queue**: it starts the next turn when the conversation is free, in order.
- **steer**: the run that is working takes it at its next step boundary, without cancelling. Only the run's own operator can steer.

The same primitive and the same rules serve web chat (dock, starter-intent chats, subtask conversations), shared Slack threads, MCP `run_operator_task`, and `run_operator_tasks` follow-ups. When a conversation is idle, nothing changes: a message starts a run straight away, as it does today.

## Data model

New table `operatorAgentInputs`:

| Field | Notes |
| --- | --- |
| `threadId`, `operatorUserId` (author), `channel` | |
| `mode` | `"queue" \| "steer"`. A steer becomes a queue item when its run ends on its own (see below). |
| `status` | `"pending" \| "applied"` (steer taken by its run) `\| "started"` (became a turn) `\| "cancelled" \| "failed"` |
| `content`, `attachments?`, `pageContext?`, `planRequested?`, `requestedSkills?`, `slackThreadContext?`, `toolArtifacts?`, `mcpClientId?`, `dedupeKey?` | Exactly the `enqueueOperatorMessage` arguments that get replayed when the input starts. |
| `parentRunId?`, `parentThreadId?` | Set when a parent run sent the input through `run_operator_tasks`. |
| `targetRunId` | The run that was active at send time. A steer applies only to this run. For a queue item it is informational ("waiting for …"). |
| `delivery?` | `operatorChannelDelivery` (Slack). Used to schedule the reply for the run this input starts. |
| `appliedIteration?`, `messageId?`, `runId?`, `error?`, `createdAt`, `updatedAt`, `resolvedAt?` | `messageId` is the transcript row that was written when the input was applied or started. |

Indexes: `thread_status_created` (`threadId`, `status`, `createdAt`) for FIFO drain and the composer list, `target_status` (`targetRunId`, `status`) for steer claims, and `thread_dedupe` (`threadId`, `dedupeKey`) for retried Slack events and MCP idempotency keys.

How it relates to the existing tables:

- `operatorAgentRuns` is unchanged. A queue item becomes a normal run through `enqueueOperatorMessage` (with its user message, agent message, `parentRunId`, and so on).
- A steer becomes an `operatorAgentMessages` row with `role: "user"`, `replyToMessageId` = the run's `userMessageId`, and artifact `operator_steer {runId, inputId, iteration}`. Its text is therefore stored, searchable, readable by `read_operator_conversation`, and included in history compaction.

Limits:

- At most 20 pending inputs per thread, and 10 per author.
- Content is limited by `MAX_OPERATOR_MESSAGE_CHARS`.
- A steer is text only. Files go in a queue item, and the composer switches to Queue when files are attached.

Attachments are validated when the item is queued. That consumes the upload intent, so `cleanupUploadIntentInternal` no longer deletes the file. The input holds the files until it starts, which writes the `operatorAgentAttachments` rows. Cancelling or failing the input deletes any of its files that nothing else references.

## Turn-ownership rules

| Actor, while a run holds the conversation | Queue | Steer | Replace (supersede) | Stop |
| --- | --- | --- | --- | --- |
| The run's operator | yes | yes | yes ("Send now", or `replace`) | yes |
| Another operator | yes | no: downgraded to queue, and the result says `queued` | rejected | rejected (unchanged) |

Pending inputs:

- **Cancel**: only the author can cancel their own pending input. Nobody can cancel someone else's, including the run owner.
- **Reorder**: there is no reordering. Order is FIFO by `createdAt` for everyone. This keeps operators out of each other's way. The author can only cancel and re-send.
- **Send now**: available to the author only when the active run is their own, or when the thread is idle. It supersedes the author's run and starts this input at once, ahead of the FIFO. Other operators' items stay queued behind it. Send now never cancels another operator's run.
- **Send in new chat**: available to the author at any time. It cancels the input and starts it in a fresh conversation (one mutation). This is the way out when you are waiting behind someone else's long run or a pending approval, because approvals have no expiry.

`assertNoOtherOperatorRun(..., "message")` stops being called on the paths that can queue. The `"cancel"` check stays.

## Queue lifecycle

1. **Submit.** `submitOperatorInput(ctx, args & {whenBusy})` is the single entry point in `convex/lib/operatorAgentInputs.ts`. Web `sendMessage`, Slack `enqueueMessageInternal`, MCP `enqueueMcpTaskInternal`, and subtask follow-ups all call it.
   - If no run is active and nothing is pending, it calls `enqueueOperatorMessage` as today.
   - If nothing is active but inputs are pending (a missed drain), it drains first and then appends. A stuck queue therefore repairs itself on the next message.
   - Otherwise it resolves `whenBusy` by the rules above. `replace` keeps today's supersede path. `queue` and `steer` insert a pending input.
   - If `whenBusy` is omitted, an internal caller gets `replace`. That is the current behaviour, for example `rerunTurn`, which requires an idle thread anyway.
   - It returns `{delivery: "started" | "queued" | "steered", runId?, inputId?}`.
2. **Drain.** `afterOperatorRunFinished` schedules `internal.operatorAgentInputs.drainInternal({threadId})` with `runAfter(0)`. It does not drain inline, for three reasons: the reject path inserts its "Cancelled: …" message after the hook; the supersede path calls the hook in the middle of `enqueueOperatorMessage`; and it keeps terminal mutations small.
   - `drainInternal` returns without doing anything if a run is active.
   - Otherwise it converts the finished run's unconsumed steers to `mode: "queue"`, then takes the head pending input.
   - It checks the start preconditions before writing anything: the author is still an active operator who is not impersonating, the files exist, and the skills can still be loaded. If a check fails, the input is marked `failed` with a reason the author can read, and the drain moves to the next input.
   - It calls `enqueueOperatorMessage` with the stored arguments (`dedupeKey` keeps message-level dedupe), marks the input `started` with `runId` and `messageId`, and schedules `operatorChannelDelivery.deliver` when `delivery` is set.
   - It starts exactly one input, because the new run now holds the turn.
3. **Every terminal transition calls the hook.** `completeRunInternal`, `failRunInternal`, confirm-reject, and the immediate approval outcome already do. Packet 2 adds the missing paths:
   - `finishConfirmedActionToolInternal`: the failed path and the completed direct path.
   - `cancelActiveRunsForThread`: every cancelled run, not only subtasks.
   - `operatorMcpReadCalls.finish`: direct MCP reads hold the turn while they run.

   The drain is idempotent and serialized by OCC, so extra calls are harmless.
4. **Waiting for approval.** `waiting_confirmation` still holds the turn, so queue items wait. The banner says whose approval is pending, and Send in new chat is the escape hatch.
5. **Stop and supersede.**
   - When the owner stops a run (web Stop, `cancel_operator_run`, the parent's `cancel_operator_tasks`, or the parent-stop cascade), or replaces it, the owner's pending steers for that run are cancelled. Steers belong to their run. The stopping web client puts the text back in an empty composer.
   - Queue items from everyone, the owner included, then drain FIFO.
   - When a run ends on its own (completed, failed, or approval rejected), its unconsumed steers become queue items in place, because the operator still wants them acted on. In the rejection case, "use the GL application instead" becomes the next turn.

## Steering in the runner

**Claim.** In `runStep` (`convex/operatorAgentRunner.ts`), after the continuation or history loads and `executionJobStarted` is known, and before compaction, family selection, and planning, the runner calls `claimRunSteersInternal({runId, expectedRunnerAttempt, iteration, claimNew: !executionJobStarted})`. In one mutation, while the run is `running` and the attempt matches, it does the following:

- If `claimNew` is set, it marks the run's pending steers `applied` with `appliedIteration = iteration` and inserts their `operator_steer` message rows.
- It returns every steer applied at this iteration, in `createdAt` order.

**Inject.** Each returned steer is appended as one user model message:

`GUIDANCE FROM <name> WHILE YOU WORK (it changes the current task; it does not start a new one; keep completed work unless it says otherwise):\n<content>`

The instruction travels in the message, not in the system prompt, so the cached prompt prefix is not broken. On a step that claimed new steers, family selection and planning see `objective + steers`, and the result is unioned with `checkpoint.families`. This means "also check Maple's website" can load `web`, and `stableToolOrder` keeps cached positions.

**Idempotency.**

- **Resumed step.** The router job for this iteration already exists. The runner claims nothing new and re-injects exactly the steers applied at this iteration, so the request it rebuilds matches the one it submitted. This also covers the step that resumes after approval: that step reuses its invocation key, so a steer sent while waiting is claimed one step later, after the approved write's result.
- **Router retry (`:rN`) and abandoned-run recovery.** These keep the same iteration and get a fresh job. The runner claims new steers and injects the old and new ones together.
- **Checkpoint.** The steer messages are part of `messages`, so the continuation that `continueRunInternal` writes carries them. Later iterations never inject them again, because they only inject `appliedIteration === current`.
- **Iteration 0 rebuilt from history.** The history excludes `operator_steer` rows of the current run, which are injected explicitly instead.

**History for later turns.** `selectBoundedAgentHistory` attaches a steer row to the turn of the message in its `replyToMessageId` instead of starting a new turn. It orders the turn as user, steers, reply, because the final answer came after the guidance.

**A steer that is never claimed.** The model may write its final answer while a steer is pending. The run then completes and the steer becomes the next queued turn, as in Claude Code. The steer is not dropped, and the run does not reopen.

**Exact confirmations.** A steer never changes, approves, or withdraws a pending confirmation. The confirmation stays bound to its exact input and fingerprint. A write proposed after a steer needs fresh approval as usual, and the rule of one live confirmation per conversation still holds. Only the owner can steer, so steering cannot mix approvals between operators.

**Activity.** `getThread` groups steer rows onto the reply of their run (`steers[]` on the agent message) and leaves them out of the top-level list. The reply shows "↪ Terry: also check Maple's website" inline in its activity, at the time it was claimed.

## Channels

- **Web.** Covers the dock, starter-intent chats, and subtask conversations. `sendMessage` gets `whenBusy?: "queue" | "steer" | "replace"`. The UI is described below.
- **Slack shared threads.**
  - Another operator's mention while a run is active is queued instead of rejected. Spot replies once in the thread: "Queued behind Maya's request. I'll reply here when it's done."
  - The run owner's own follow-up mention steers the run, with a short reply: "Added to the current request".
  - While the run waits for approval, approve and reject replies keep their existing handling. Any other text from the owner steers and applies after the decision.
  - The inbound event completes right after the acknowledgement. The stored `delivery` (`clientMessageId: operator-agent:<inputId>:<eventKey>`) replies when the run that the input starts finishes.
  - The `ConvexError` rejection branch stays for the remaining user-facing errors.
- **MCP.**
  - `run_operator_task` gets `if_busy: "queue" | "steer" | "replace"`. It applies only when an explicit `thread_id` or `conversation_key` targets a busy conversation, and the default is `queue`.
  - Without a thread, behaviour is unchanged: a busy default conversation opens a fresh one.
  - The result adds `delivery` and `input_id`.
  - `get_operator_run` accepts `input_id` in place of `run_id`. It returns the input's state, and once the input starts, the run view. `wait_seconds` also waits while the input is pending.
  - For another operator's run, `steer` is downgraded to queue and `replace` is rejected.
- **Subtasks (`run_operator_tasks` follow-up).**
  - A follow-up with `operatorThreadId` steers a subtask that is queued or running, and is held for a subtask that is waiting for approval: it applies after the decision, or starts the next turn if the operator rejects.
  - It starts a new run for a finished subtask.
  - It never supersedes. To replace a subtask's work, call `cancel_operator_tasks` first.
  - There is no new input field.
- **Email: deferred.** Operator email threads belong to one owner (`operatorEmail.ts` checks `ownerUserId`), so there is no multiplayer conflict. Receipts and delivery are keyed by `runId`, and each email expects its own reply, so a steer would merge two replies into one. Superseding with a new email is the documented redirect, and the confirmation-reply path already avoids it. Packet 2 keeps email unchanged. It is a later one-field change once receipts can point to an input.
- **iMessage.** Unchanged: operators do not use it in a multiplayer way.

## Tool contract changes for the manager

These are proposed for the manager to apply. The entries and executors are manager-owned.

1. **`run_operator_tasks` description.** Replace "or send a follow-up … with its operatorThreadId" with: "or send a follow-up to one of this conversation's subtasks with its operatorThreadId: a queued or running subtask takes it as guidance at its next step without restarting, one waiting for approval takes it after the operator decides, and a finished one starts a new run with it. Stop a subtask with cancel_operator_tasks first to replace its work."
   - Change the `operatorThreadId` field text to: "…to send this objective to as a follow-up (guidance for a running subtask, a new turn for a finished one). Omit to start a new subtask".
   - Add to each output item: `delivery: "started" | "steered"` and `inputId?`. The `status` of a steered item is the target run's status.
2. **`runOperatorTasks` executor.** Replace the follow-up `enqueueOperatorMessage` with `submitOperatorInput({whenBusy: "steer", parentRunId, parentThreadId, toolArtifacts: [operator_subtask_objective]})`. Steered follow-ups do not count toward `MAX_ACTIVE_OPERATOR_TASKS`.
3. **`cancelOperatorTasks`.** It inherits steer cancellation through `cancelActiveRunsForThread`. It should also cancel this parent's pending queue inputs in the subtask conversation.
4. **`operatorTasksInternal` / `get_operator_tasks`.**
   - A subtask conversation with a pending input from this parent reports `status: "queued"` and `settled: false`, so a parent that is waiting does not report stale work.
   - Add `pendingFollowUps: number`.
5. **`OPERATOR_SUBTASK_GUIDANCE`** (the runner prompt) does not change. Steers carry their own framing.

The MCP lifecycle tools (`run_operator_task`, `get_operator_run`) live outside the registry, so I change them myself in `convex/lib/operatorMcpToolCatalog.ts` and `convex/http.ts` and document them in `AGENT_TOOLS.md`.

## Composer UI states

The composer reuses and extracts the tenant primitive: `QueuedThreadMessage` moves to `components/chat/queued-message.tsx` as `QueuedMessageRow` (avatar, label, text with references, Send now, ×). The tenant thread and the operator chat both use it.

| State | Composer |
| --- | --- |
| Idle | Unchanged. |
| Own run queued or running | Input stays enabled. Enter = **Steer**, ⌥Enter or the send menu = **Queue**, and Stop stays next to the send button. With files attached, Enter = Queue. |
| Own run waiting for approval | The approval card stays in the transcript. Enter = Steer, with the hint "applies after you decide". Stop stays. |
| Another operator's run | `OperatorHeldComposer` becomes a banner above an enabled input: avatar, "Maya's request is running" (or "is waiting for Maya's approval"), "· your message will wait", and New chat. Enter = Queue. |
| Pending inputs | Rows above the composer, visible to every viewer, oldest first: avatar, "Queued:" or "Steering:" and the text. The author sees × and Send in new chat, plus Send now when the active run is theirs. Failed rows show "Couldn't start: <reason>" with Dismiss. More than 3 rows collapse to "+N more". |

`SpotPromptInput` needs a `busySubmit` prop: it keeps Send enabled while `status` is `submitted` and labels it Steer or Queue. `getThread` adds `pendingInputs[]` (person, mode, preview, attachment count, status, error, `canCancel`, `canSendNow`) and `activeRunOwnedByViewer`. The dock tabs could show a queued badge, which is a manager-owned proposal.

## Client-facing (tenant) thread

`processThreadChat` runs the AI SDK multi-step loop inside one action (`stopWhen: stepCountIs(25)`). It has no durable step checkpoints, and its threads, members and auth are separate (`threads`/`threadMessages`, tenant isolation).

- **Shared now:** the UI primitive (`QueuedMessageRow`) and the contract (queue semantics, author-only cancel, Send now = supersede).
- **Surface-specific:** storage. The tenant thread should not use `operatorAgentInputs`, because it is operator-scoped and crosses the tenant boundary.
- **Later packet:** a tenant `threadPendingInputs` table with the same lifecycle, queue only, drained from the client agent's completion path. Steering would use the AI SDK `prepareStep` hook to read pending steers per step. That is feasible, but out of scope here.
- **Packet 2:** the tenant queue stays client-side and is only refactored onto the shared row.

## Failure modes

| Failure | Handling |
| --- | --- |
| A terminal path misses the hook | Fixed by the full list above. Submit drains a stuck queue first, and Send now works when the thread is idle. |
| The author is deactivated, a skill is disabled, or a file is missing at drain time | The input is marked `failed` with a reason and the drain continues. Its files are deleted if nothing else references them. |
| Two drains race, or Send now races the drain | Mutations are serialized. Each one rechecks the active runs and the input's status. |
| A steer lands after the run's last step | It becomes the next queued turn, which shows in the queue row. |
| A resumed step's request does not match what was submitted | Avoided: a resumed step injects only the steers already applied at its iteration. |
| A queue item waits forever behind an approval | The banner says so, and the author can use Send in new chat. |
| Another operator's Slack or MCP retry | Dedupe on `operatorAgentInputs.thread_dedupe`, then on the message `dedupeKey` after the input starts. |
| The thread is archived while items are queued | Unarchived when the item starts, as `enqueueOperatorMessage` does today. |

## Files changed in packet 2

**Backend:**
- `convex/schema.ts`
- `convex/operatorAgentInputs.ts` (new): `cancelInput`, `sendInputNow`, `sendInputInNewChat`, `drainInternal`, `claimRunSteersInternal`
- `convex/lib/operatorAgentInputs.ts` (new): `submitOperatorInput`, drain and claim helpers, steer message text, steer cancellation on stop
- `convex/operatorAgent.ts`: `sendMessage`, `enqueueMessageInternal`, `enqueueMcpTaskInternal`, `getThread`, `getRunViewForOperatorInternal`, `cancelActiveRunsForThread`, `cancelOwnRunsForThread`, `finishConfirmedActionToolInternal`
- `convex/lib/operatorTasks.ts`: the drain schedule in `afterOperatorRunFinished`
- `convex/operatorMcpReadCalls.ts`
- `convex/operatorAgentRunner.ts`
- `convex/lib/agentMessageHistory.ts`
- `convex/actions/handleInboundSlack.ts`
- `convex/lib/operatorMcpToolCatalog.ts`
- `convex/http.ts`

**Frontend:**
- `lib/operator-agent-api.ts`
- `components/chat/queued-message.tsx` (new)
- `components/agent-thread/thread-content.tsx`
- `components/spot-prompt-input.tsx`
- `components/chat/chat-composer.tsx`
- `components/operator-agent/operator-agent-chat.tsx`
- `components/operator-agent/operator-conversation.tsx` (steer rows in replies)
- `components/operator-agent/operator-subtasks.tsx`: only `OperatorHeldComposer`, which becomes the banner

**Docs:**
- `AGENT_TOOLS.md`
- `AGENTS.md`
- `docs/testing/workflow-qa.md`
- this doc

**Not touched (manager-owned):** the `operator_tasks` registry entries and executors, `operatorTargetVersions.ts`, `components/agent-dock/*`, and `OperatorSubtaskList`.
