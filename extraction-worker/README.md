# Spot Extraction Worker

Standalone worker for long-running `cl-sdk` policy and private procurement-proposal extraction jobs. Convex stays the durable job ledger; this service claims extract-phase work, sends heartbeats, saves SDK checkpoints, and returns policy results for ordinary post-processing or proposal results to the operator-private proposal ledger.

The worker also owns LiteParse preprocessing for `@claritylabs/cl-sdk`. It converts PDFs to parser text plus hierarchical page/row/cell source spans with bounding boxes, captures bounded page screenshots for multimodal model calls, passes the original PDF bytes and those spans into `cl-sdk`, and exposes a small authenticated HTTP endpoint for Convex actions that need synchronous parsed PDF text. Policy extraction also runs Poppler's `pdftotext` as a bounded supplement and adds only pages containing visible text that LiteParse omitted, which covers filled form overlays without replacing precise LiteParse bounding-box evidence. If LiteParse fails or times out, callers fall back to PDF.js plus the same supplemental visible-text check. A shared admission controller reserves PDF-bearing work before job claim, preview claim, or HTTP body decoding; it defaults to 12 live PDFs total and 8 full extraction PDFs, preserving capacity for preview and HTTP requests. The native parser remains serialized and its defensive wait queue is independently capped at 12 documents.

Proposal jobs use a separate Convex claim/lease/completion path but reuse that same admission controller and serialized parser. Each bundled proposal PDF is extracted independently under its stable proposal-document ID so page-one evidence from different files cannot merge. Completion stores document-qualified source spans/nodes only in proposal source tables; it does not create policies, policy chunks, compliance matches, certificates, or delivery work.

## Local

```bash
npm install
cp .env.template .env
npm run build
npm run start
```

Required env:

- `CONVEX_URL` - Convex deployment URL, for example `https://acoustic-caiman-755.convex.cloud`
- `CONVEX_SITE_URL` - exact HTTP actions origin for authenticated temporary router assets; shared dev is `https://acoustic-caiman-755.convex.site` and production is `https://actions.spot.insure`
- `EXTRACTION_WORKER_SECRET` - shared secret that also exists on the Convex deployment
- `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, and `CL_ROUTER_TENANT_ID=glass` - the authenticated inference endpoint and stable tenant identity; provider credentials exist only in cl-router
- `PORT` - set by Railway; when present, the worker serves `POST /liteparse/convert`

Set `EXTRACTION_WORKER_MODE=external` on the Convex deployment to queue new and retried extraction jobs for this worker.

## cl-router execution

Every full extraction, provisional extraction, coverage cleanup, and proposal supplement model call goes through cl-router. The worker sends a key-free route snapshot, organization context, exact JSON schema, execution budget, explicit configured pin when present, and trace metadata. The returned provider/model, request ID, routing decision, cached-token usage, and dollar cost are copied into the existing extraction trace details. Router failures fail closed; the worker has no direct provider client or break-glass path.

Router configuration is mandatory:

```bash
CL_ROUTER_URL=https://router.toolsforenlightenment.org
CL_ROUTER_SECRET=shared-router-secret
CL_ROUTER_TENANT_ID=glass # Stable internal key retained across the Spot rebrand
CL_ROUTER_TIMEOUT_MS=180000
```

Router requests are limited to eight assets, 12 MiB per asset, 16 MiB decoded in aggregate, and a strict 4 MiB serialized JSON envelope. The original policy/proposal PDF uses its existing signed Convex claim URL when it fits the asset limits. Generated LiteParse screenshots stay inline only while the JSON envelope fits; larger screenshots are uploaded through a worker-authenticated, lease- and organization-bound Convex handoff and represented by a short-lived signed `AssetReference`. The worker deletes staged assets in `finally`, while Convex retains a bounded expiry cleanup for interrupted calls. Production references use `https://actions.spot.insure/router-assets`; shared dev uses `https://acoustic-caiman-755.convex.site/router-assets`.

Convex rejects stale external workers before they can claim jobs when expected-version env vars are set. Workers send `workerProtocolVersion`, `workerVersion`, and `clSdkVersion` on every claim and expose the same values at `GET /health`. Dev Convex should set `EXTRACTION_WORKER_EXPECTED_PROTOCOL_VERSION` to the current worker protocol and `EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION` to the package spec in `extraction-worker/package.json`.

`EXTRACTION_WORKER_PROTOCOL_VERSION` defaults to `source-tree-v1`. Setting it to `source-tree-v2` requires an exact section-capable cl-sdk and enables resumable core, coverage, and optional cleanup sections. The worker persists the parsed source bundle before model work and stores each hashed section result by run, source fingerprint, and extractor version; a retry can skip PDF parsing and completed core work. Keep Convex dual-compatible during rollout, and require v2 with `EXTRACTION_WORKER_EXPECTED_PROTOCOL_VERSION=source-tree-v2` only after the representative protocol comparison corpus has zero critical-fact and coverage-recall regressions.

Set `EXTRACTION_WORKER_URL` and the same `EXTRACTION_WORKER_SECRET` on Convex to let requirement imports, mailbox attachment reads, on-demand source lookup, and agent PDF attachment context call the worker's LiteParse endpoint. The endpoint accepts `{ "pdfBase64": "..." }` with `Authorization: Bearer <secret>` and returns `{ text, sourceSpans, sourceChunks, pageScreenshots, metadata }`.

`EXTRACTION_JOB_CONCURRENCY` remains the outer policy job-loop ceiling, and `PROPOSAL_EXTRACTION_CONCURRENCY` (default 2) bounds proposal jobs. `EXTRACTION_PDF_WORK_MAX_ACTIVE` (default 12) bounds all live PDF-bearing full, proposal, preview, and HTTP work, while `EXTRACTION_PDF_WORK_MAX_FULL_ACTIVE` (default 8) limits policy and proposal extraction inside that total so latency-sensitive work retains capacity. Admission happens before a job is claimed or an HTTP request body is decoded, so waiters retain only metadata rather than complete PDFs. `LITEPARSE_MAX_QUEUED_DOCUMENTS` (default 12) is a second defensive bound on the serialized parser queue; total PDF admission is clamped to that queue limit plus the one running native parse.

## Railway

Create a Railway service rooted at `extraction-worker/`. The included `railway.json` builds the Dockerfile with Node, Poppler, and the native `@llamaindex/liteparse` package:

```bash
node dist/index.js
```

Run at least one worker replica. Multiple replicas are safe because jobs are claimed with Convex-backed leases and periodic heartbeats.

Focused validation:

```bash
npm test
npm run build
```
