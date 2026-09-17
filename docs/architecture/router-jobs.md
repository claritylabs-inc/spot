# Durable router requests

Spot owns model inputs, results, and referenced binary assets in private Convex
storage. `convex/routerJobs.ts` owns the invocation journal and capability HTTP
endpoints. `convex/lib/routerJobClient.ts` owns submission, status polling, and
reconnection. `convex/actions/routerJobs.ts` provides Node action entry points
for extraction workers and explicit cancellation.

The caller supplies a stable invocation key for one model step. The first call
freezes the request; resuming that key uses its original stored payload, including
its selected route. Rebuilding a prompt or refreshing an asset signature does not
replace an already dispatched request. Callers must allocate a new key for a
new step. Operator and extraction owners retain these identities across their
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
The request remains limited to 4 MiB; assets retain 12 MiB each, 16 MiB aggregate,
and eight-asset limits.

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

## Extraction bridge

`POST /router-jobs/worker` requires the extraction worker bearer secret and
`{jobKind, jobId, leaseId, orgId, invocationKey, payload}`. The existing
`routerAssets.validateWorkerLease` owner checks the live policy, preview, or
proposal lease before submission and before returning a completed result. The
payload organization must match that lease. The effective key contains job kind
and job ID; it deliberately excludes the lease token so recovering an abandoned
worker reuses the same inference. Pending work returns HTTP 202. Success returns
`{result}`. The request body retains the 4 MiB transport ceiling.

Use focused journal/client tests for lost acknowledgement, early callback,
conflicting identity, cancellation races, unknown outcomes, asset snapshots,
and cleanup without expiry of active work.

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
Only text is streamed; tool execution waits for the terminal model result.
Cancelled/terminal jobs reject late progress. Router progress delivery is best
effort and never restarts inference. Deploy the router schema/API and worker
support before enabling the Spot consumer change.

Profile settings store personal `users.streamResponses` (default on) and
`users.showThinking` (default off). Both operator and client web renderers share
these preferences. Show thinking displays a collapsible summary of tool activity,
not raw reasoning or tool payloads. Approvals and task artifacts remain independent
of these display preferences. Non-web channel delivery stays terminal-only.

These preferences control presentation only; turning streaming off does not stop
router progress callbacks. A transport rollback must deploy a Spot consumer that
omits `stream: true` and drain in-flight jobs before removing router support.
