# Durable router requests

Spot owns model inputs, results, and referenced binary assets in private Convex
storage. `convex/routerJobs.ts` owns the invocation journal and capability HTTP
endpoints. `convex/lib/routerJobClient.ts` owns submission, status polling, and
reconnection. `convex/actions/routerJobs.ts` provides the Node action entry
point for explicit cancellation.

The caller supplies a stable invocation key for one model step. The first call
freezes the request; resuming that key uses its original stored payload, including
any explicit route pin. Rebuilding a prompt or refreshing an asset signature does not
replace an already dispatched request. Callers must allocate a new key for a
new step. Operator and Convex section-extraction owners retain these identities across their
own continuation boundaries. Other callers can poll within their existing action;
that does not make their outer application workflow resumable after process loss.

Before contacting the router, Spot snapshots referenced assets, writes the exact
serialized request, and atomically creates its journal entry. A request of at
most 512 KiB (`ROUTER_JOB_INLINE_REQUEST_BYTES`) is written to
`routerJobRequests` by the same `prepare` mutation that creates the job row, so
no storage upload precedes submission; a larger request is stored as a blob
first. Either way the bytes are durable before the first `POST /v1/jobs`.
Competing uploads that lose invocation registration are removed. SHA-256 binds
the actual stored request bytes. The router validates this fingerprint when
fetching the request.

The call that creates the job sends `input` from the bytes it already
serialized and fingerprinted. A later reconnect (a lost submission
acknowledgement, or a resumed step) reads them back from the inline request or
blob and resubmits the identical bytes, never a rebuilt payload; `requestUrl`
serves either form. A generation call looks up its row and its routed fallback
in one query, and `bind` returns the bound row, so the common path is lookup,
`prepare`, POST, `bind`.

## Protocol

`POST /v1/jobs` receives:

```json
{
  "idempotencyKey": "caller-owned-step-key",
  "operation": "generate",
  "tenantId": "glass",
  "fingerprint": "sha256-of-request-bytes",
  "requestUrl": "https://actions.spot.insure/router-jobs/request?token=...",
  "resultUrl": "https://actions.spot.insure/router-jobs/result?token=..."
}
```

Operations are `generate`, `manual`, `embed`, `retrieve`, `transcribe`, `browse`, and `exec` (skill scripts; see `operator-skills.md`). `exec` requests may be up to 12 MiB (`ROUTER_JOB_EXEC_REQUEST_BYTES`, base64 files), the others 4 MiB. When
`/v1/capabilities` lists `inline_job_input`, generate and manual submissions replace
`requestUrl` with `input`: the exact stored request text, so the fingerprint is unchanged
and the router skips its request fetch. Other operations, older routers and an unavailable
capabilities read keep `requestUrl`. A retry after a lost acknowledgement finds the same job
whichever source either attempt used; cancellation recovery always uses `requestUrl`, which a
cancelled row no longer serves. The router
returns a `jobId`. Repeating an identical submission after a lost acknowledgement
retrieves the same job. Spot stores its router ID before subsequent status reads.
`GET /v1/jobs/<jobId>` returns metadata; `POST /v1/jobs/<jobId>/cancel` requests
cancellation. All control requests use the router bearer secret. A short control
connection wait only yields/reconnects; it does not cancel inference or fail the
Spot task. Inference has no blanket elapsed-time deadline.

The router fetches raw request JSON from the request capability URL. For binary
references, Spot rewrites source URLs to `/router-jobs/asset?token=...&index=...`.
These assets belong to the invocation and stay available throughout active work,
even when the original asset signature expires or its caller cleans up staging.
The request remains limited to 4 MiB; assets are limited to 16 MiB decoded in
total, with no asset count limit.

The router posts this envelope to the result capability URL:

```json
{
  "jobId": "router-job-id",
  "idempotencyKey": "caller-owned-step-key",
  "fingerprint": "sha256-of-request-bytes",
  "status": "succeeded",
  "result": {}
}
```

A failure uses `status: "failed"` and an optional sanitized `error`. The entire
callback body is bounded to 18 MiB. A result can arrive before the submission
acknowledgement: the capability plus invocation key and fingerprint bind it to
the original request. Once a router ID is bound, another ID is rejected. Duplicate
callbacks cannot replace the first terminal result. A cancelled invocation rejects
late results. Terminal router statuses `failed`, `cancelled`, and
`outcome_unknown` are recorded even when no callback arrived; unknown outcomes
never trigger a fresh inference submission.

A succeeded result whose serialized JSON is at most 64 KiB
(`ROUTER_JOB_INLINE_RESULT_BYTES`) is stored on the job row (`resultJson`) by the
single `finish` mutation, so the callback is authorize then finish. Larger
results are stored as a blob first; `finish` adopts or deletes it in the same
transaction, and a finish that throws removes it. Readers use the inline value
when present. In-place waits poll the row every 100 ms for the first 3 s, then
every 250 ms, easing to 1 s after 10 s.

Capabilities use random 256-bit tokens and hashed lookup. Raw tokens are retained
only in private internal rows to recover a lost acknowledgement. Request and
asset access stops at terminal state. No capability or raw prompt belongs in logs,
model-visible tool output, public queries, or error strings.

Terminal request, result, and asset blobs and inline results are deleted after seven days; capability
tokens are revoked. The small invocation/fingerprint/status tombstone remains to
prevent replay after result retention ends. Active requests have no age expiry.

## Local callback reachability

The default callback origin is canonical `CONVEX_SITE_URL`. A fully local router
can reach loopback callbacks only when its local environment and explicit
callback-host allowlist permit them. A cloud router cannot reach a developer's
loopback address. For a non-production Spot checkout, set
`SPOT_ROUTER_CALLBACK_URL` to an HTTPS tunnel origin that forwards to its Convex
HTTP server, and add that hostname to the router's callback and asset host
allowlists. The override is an origin only: no credentials, path, query, or
fragment. Production retains its canonical Spot origin and rejects other values.
This override applies to request, result, and job-owned asset capability URLs;
it grants no access without the original per-job capability token.

## Web response streaming

Operator and client web replies stream through durable router jobs. `stream: true`
requests send ordered, cumulative text snapshots to the existing result capability
with `status: "progress"`; Spot validates invocation, token, fingerprint, router
ID, sequence, active message, and operator checkpoint before updating the reply.
Text and tool-request identity can stream; tool execution waits for the terminal model result.
A progress envelope may also carry optional cumulative
`toolCalls: [{ toolCallId, toolName }]` (at most 128 entries, each string
nonempty and at most 200 characters, no other keys, no duplicate ids). Spot
rejects malformed metadata with the whole callback; text-only callbacks remain
valid. Optional cumulative `stages` contains at most two entries with
`stageId` equal to `stage` (`selecting_model` or `selecting_tools`) and a
`running`, `completed`, or `failed` status. Spot validates the exact fields and
namespaces persisted stage IDs by job so retries and later steps remain distinct.
These report observed routing and Jev tool-selection work without decision inputs
or answers. Manual model routing reports configuration selection, not a Jev choice.
Tool metadata means the model requested the tool, not that it is running or
finished, and it never carries arguments, results or reasoning.
Cancelled/terminal jobs reject late progress. Router progress delivery is best
effort and never restarts inference. The router schema/API and router-owned worker must support progress callbacks before a Spot consumer uses streaming.

Profile settings store personal `users.streamResponses` (default on) and
`users.showThinking` (default on; only an explicit false hides activity). Both
operator and client web renderers share these preferences. Show thinking displays
the live status line, a text-only thought-process trace (decision stages and the
plan when one was made; a workflow check that found no plan is hidden), and a
separate tool card with one branded row per call, not raw reasoning or tool
payloads. `applyMessageActivity` stamps `startedAt` when an entry is first
observed running and `endedAt` when it settles, from its own clock; rows show
call durations, the card the end-to-end span, and the trace the summed stage
time ("Thought for 3s"). Older entries without timestamps show none.

Settled calls may also carry a structural `result` count ("3 threads", from
`convex/lib/toolResultSummary.ts`), and operator calls a registry `target`
(organization or request id, resolved to the client's brand by
`operatorAgent.getThread`), a bounded `change` summary for completed writes
(`changeSummaryInternal`, ids replaced by names) and a `preview` flag. Previews
live in `operatorAgentToolPreviews` (up to ten title/subtitle/date/website
items per call, kept with the thread) and load lazily through
`operatorAgent.getToolPreview` for any operator who can read the thread. Client
thread reads omit tool outputs from `toolCalls` and tool `agentSteps`.

`threadMessages.activity` and `operatorAgentMessages.activity` hold bounded live
status and a retained activity history: a `model`/`tools` phase, up to 32 decision
stages, and up to 128 per-call
`requested`, `running`, `returned`, `completed`, `failed`, `awaiting_approval`
or `skipped` status (`convex/lib/messageActivity.ts`). `requested` comes from
router progress metadata; the runners record `running` immediately before a
tool executes (operator tools are serialized, so queued calls stay `requested`)
and the outcome when it returns. `returned` means the function returned without
an error marker, not business success; only an explicit `succeeded` result is
`completed`. `routerJobs.recordActivity` ignores messages that are no longer
processing and, for operator runs, stale runner attempts, stale checkpoints and
cancelled runs. Writes are presentation-only and never fail a turn. Settled
messages keep their stage and tool statuses alongside the `usedTools`/`toolCalls`
audit history. The renderer stops unresolved indicators when a turn settles and
does not infer successful execution from an unfinished activity entry. Approvals and task artifacts remain independent
of these display preferences. Non-web channel delivery stays terminal-only.

After a web agent response, `models.ts` records the returned provider and model
as the selection outcome. A configured pin or automatic-routing preference is
not evidence of the executed model. Response request IDs keep replayed outcomes
from duplicating activity, and existing message/run guards reject stale writes.

These preferences control presentation only; turning streaming off does not stop
router progress callbacks. A transport rollback must deploy a Spot consumer that
omits `stream: true` and drain in-flight jobs before removing router support.

Local operator troubleshooting: a successful web request does not imply the scheduled agent completed. Inspect `operatorAgentRuns.lastError` and the stored router failure. `routerJobClient` preserves typed control-plane rejections, including callback-host rejection, instead of only the HTTP status. Local Spot may use the production router with a separately issued inference client token and an exact HTTPS callback host approved on both router Convex and its Railway worker. Provider credentials remain router-owned.

Operator failures retain an optional bounded structured `failure`: a safe code,
retry/execution flags, request reference and at most four provider-attempt
summaries. The chat shows a categorized explanation plus collapsed, copyable
Error details independently of Show thinking. Diagnostics never include raw
provider bodies, prompts, credentials or tool inputs/outputs. Legacy failed
messages expose only an allowlisted code and their message reference.

## Router-owned model selection

Spot delegates model selection to cl-router. Generation sends `text` or
`reasoning`; embeddings and transcription use their dedicated endpoints. Spot
sends no capability requirements: the router infers them from images, files,
tools, schemas and estimated input size.

Contract reviewed against cl-router main at
[`641027850b37b36fb00863a0f98eda5bdec46437`](https://github.com/claritylabs-inc/cl-router/blob/641027850b37b36fb00863a0f98eda5bdec46437/AGENTS.md#routing),
including `packages/convex/worker/generation.ts` `inferredRequirements`.
An authenticated, read-only `GET /v1/capabilities` confirmed the current model
list on October 23, 2026.

### Routing inventory

| Call site / owner | Before | After |
| --- | --- | --- |
| `modelSettings.resolveOperatorAgentRoute`, operator runner and `models.getAgentLanguageModelForOperatorTask` | Required an explicit global `operator_agent` route; missing pin threw before generation | Optional pin; absent pin uses routed generation |
| `clRouterLanguageModel` client/public/operator loops | Saved each response's model as a pin for later steps | Each step routes independently; only an explicit initial pin uses manual generation |
| `models`, `sdkCallbacks`, section extraction | Explicit global task pins used manual generation without checking the live registry | Default remains routed; optional pins are checked against live capabilities and stale pins fall back |
| `clRouterClient` inline JSON and SSE | Manual route rejection ended the request | Missing/unconfigured model routes automatically; unknown-route rejection can fall back only with `executionStarted: false` and before stream output |
| `routerJobClient`, operator resume/cancellation | Durable `route` selected the manual operation; failed jobs stayed terminal | Explicit pins still use manual; safe fallback gets one stable `:routed` identity; reconnect and cancellation cover both jobs |
| Global/broker settings | Explicit global pins applied; broker routes already ignored; cleanup preserved operator pin | Global pins remain optional; cleanup removes all global/broker pins including operator pin |
| Native web retrieval | Inherited chat/operator generation pins; static native model defaults remained in catalog | Derives a configured native model from live capabilities; existing Parallel/Exa fallback remains |
| `modelCatalog`, `modelSettings`, `routerCapabilities` | Static display-name model list and provider/task validation helpers; operator pin required vision | Removed static model IDs and local task capability validation; raw model IDs remain available for display and telemetry |
| `contracts/cl-router/policy.ts`, `routerCapabilities`, `clRouterOperations`, Convex validators | Vendored provider list and literal unions; a provider Spot did not know invalidated the whole `/v1/capabilities` response and failed telemetry writes | Provider and model ids are strings from live `/v1/capabilities`, checked for shape only and cached for 60 s; optional provider `label`, `brandColor`, `monogram` and `logo` pass through; native retrieval providers are the configured non-API `webRetrieval.providers` |
| `clRouterPrimitive` and all generation serializers | Selected `multimodal` / `tool_use` and added vision/tools/structured-output requirements | Generation uses only `text` / `reasoning`, no explicit requirements or capability bookkeeping |
| Operator tool selection | Forced `toolSelection: caller` after choosing authorized families | Router selects among the same authorized tools; family and execution authorization remain in Spot |
| Extraction fixture and router contract examples | Encoded retired GPT-5.x, GLM and DeepSeek model IDs and capability-forcing requests | Extraction test uses an opaque fixture ID; contract examples reflect current models and inferred capabilities |

### Budgets retained

Generation and retrieval have no default elapsed deadline in Spot's shared
client. Output-token limits remain task-specific: they bound response size and
are clamped by the router, without selecting a model. The text-only local intake
transport still limits output to 3,000 tokens.

Explicit Jev decision budgets remain separate from generation routing:

- Intake industry, coverage, follow-up inputs and vehicle-specification checks:
  5 seconds, with a 6-second cancellation deadline and manual/uncertain fallback.
- Client turn selection, operator family selection/planning, iMessage threading
  and chat presentations: bounded interactive decisions, generally 10–15 seconds.
- Research, evidence verification, proposal review, wiki extraction, outreach
  and other batch decisions: existing 60–120 second budgets.
- Website browsing: 6 minutes for the bounded browser workflow.
- Durable job control requests: 5 seconds to submit/read/cancel; this does not
  impose a deadline on inference or permit replay after an unknown response.

No prompts, business tools, approval paths or authorization rules changed.

### Cleanup after deployment

The owner can remove all stored pins after the new code is deployed. This also
removes intentionally configured pins and the stored web retrieval preference;
retrieval then uses its existing Parallel default. The cleanup is bounded to
50 broker settings rows per call and is safe to repeat. It does not run
inference and is not scheduled automatically.

Choose the intended Spot deployment explicitly:

```bash
env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN npx convex run --deployment '<SPOT_DEPLOYMENT>' --codegen disable modelSettings:clearOperatorModelOverridesInternal '{}'
```

If `isDone` is false, repeat with that response's `continueCursor`:

```bash
env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN npx convex run --deployment '<SPOT_DEPLOYMENT>' --codegen disable modelSettings:clearOperatorModelOverridesInternal '{"cursor":"<CONTINUE_CURSOR>"}'
```

Continue until `isDone` is true. `stripRetiredRoutesInternal` is unnecessary for
this cleanup because all stored route fields are cleared. No cleanup command
was run against any deployment during implementation.

### Routing verification

The existing `convex/routerJobs.test.ts` covers optional operator pins, live
capabilities, explicit pins, stale-pin fallback, pre-execution rejection,
partial-stream replay prevention, independent generation steps, durable
fallback reconnection after pin removal, and unknown-outcome holds.

Run the full repository checks with Node 24:

```bash
npm test
npx tsc --noEmit
env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN npx convex typecheck
npm run lint
npm run check:cl-router-contract
```
