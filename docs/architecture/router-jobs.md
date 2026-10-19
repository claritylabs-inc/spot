# Durable router requests

Spot owns model inputs, results, and referenced binary assets in private Convex
storage. `convex/routerJobs.ts` owns the invocation journal and capability HTTP
endpoints. `convex/lib/routerJobClient.ts` owns submission, status polling, and
reconnection. `convex/actions/routerJobs.ts` provides the Node action entry
point for explicit cancellation.

The caller supplies a stable invocation key for one model step. The first call
freezes the request; resuming that key uses its original stored payload, including
its selected route. Rebuilding a prompt or refreshing an asset signature does not
replace an already dispatched request. Callers must allocate a new key for a
new step. Operator and Convex section-extraction owners retain these identities across their
own continuation boundaries. Other callers can poll within their existing action;
that does not make their outer application workflow resumable after process loss.

Before contacting the router, Spot snapshots referenced assets, writes the exact
serialized request, and atomically creates its journal entry. Competing uploads
that lose invocation registration are removed. SHA-256 binds the actual stored
request bytes. The router validates this fingerprint when fetching the request.

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

Operations are `generate`, `embed`, `retrieve`, and `transcribe`. The router
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

Capabilities use random 256-bit tokens and hashed lookup. Raw tokens are retained
only in private internal rows to recover a lost acknowledgement. Request and
asset access stops at terminal state. No capability or raw prompt belongs in logs,
model-visible tool output, public queries, or error strings.

Terminal request, result, and asset blobs are deleted after seven days; capability
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
valid. Metadata means the model requested the tool, not that it is running or
finished, and it never carries arguments, results or reasoning.
Cancelled/terminal jobs reject late progress. Router progress delivery is best
effort and never restarts inference. The router schema/API and router-owned worker must support progress callbacks before a Spot consumer uses streaming.

Profile settings store personal `users.streamResponses` (default on) and
`users.showThinking` (default on; only an explicit false hides activity). Both
operator and client web renderers share these preferences. Show thinking displays
the live status line and a collapsible summary of tool activity, not raw
reasoning or tool payloads.

`threadMessages.activity` and `operatorAgentMessages.activity` hold bounded live
status for a processing web message: a `model`/`tools` phase plus per-call
`requested`, `running`, `returned`, `completed`, `failed`, `awaiting_approval`
or `skipped` status (`convex/lib/messageActivity.ts`). `requested` comes from
router progress metadata; the runners record `running` immediately before a
tool executes (operator tools are serialized, so queued calls stay `requested`)
and the outcome when it returns. `returned` means the function returned without
an error marker, not business success; only an explicit `succeeded` result is
`completed`. `routerJobs.recordActivity` ignores messages that are no longer
processing and, for operator runs, stale runner attempts, stale checkpoints and
cancelled runs. Writes are presentation-only and never fail a turn. Settled
messages keep the existing `usedTools`/`toolCalls` audit history. Approvals and task artifacts remain independent
of these display preferences. Non-web channel delivery stays terminal-only.

These preferences control presentation only; turning streaming off does not stop
router progress callbacks. A transport rollback must deploy a Spot consumer that
omits `stream: true` and drain in-flight jobs before removing router support.

Local operator troubleshooting: a successful web request does not imply the scheduled agent completed. Inspect `operatorAgentRuns.lastError` and the stored router failure. `routerJobClient` preserves typed control-plane rejections, including callback-host rejection, instead of only the HTTP status. Local Spot may use the production router with a separately issued inference client token and an exact HTTPS callback host approved on both router Convex and its Railway worker. Provider credentials remain router-owned.
