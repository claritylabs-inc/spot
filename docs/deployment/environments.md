# Deployment environments

`config/deployments.json` is the machine-readable environment map. `main` is
production, shared cloud dev is the deployed integration lane, and each
Conductor worktree uses native local Convex plus local workers.

## Coordinated release readiness

`.github/workflows/deploy-convex.yml` owns readiness for every commit pushed to
`main`; it is not path-filtered. After validation, the workflow:

1. deploys the commit's Convex functions to production;
2. waits for the exact commit's four established Railway contexts
   (`spot-extraction-worker`, `imessage-worker`, `slack-worker`, and
   `spot-mailbox-scan-worker`) plus `operator-imessage-worker` after its
   production health URL variable is configured, to report
   success, including explicit `No deployment needed` watch-path results;
3. runs the deployed Convex, extraction, iMessage, Slack, and cl-router
   compatibility audit; and
4. verifies the commit is still the branch head before emitting
   `release-ready-production`.

Vercel may build the production candidate in parallel, but the Spot Vercel
project must keep automatic production domain assignment enabled and configure
the GitHub `release-ready-production` check as a required Deployment Check. The
project check targets only `production`, uses the Git provider source with
external check name `release-ready-production`, requires no deployment URL,
blocks `deployment-alias`, and allows 1,800 seconds for the full release
workflow. Vercel then assigns every production alias, including
`app.spot.insure`, only after the release job succeeds. Changing the job name
requires updating the Vercel project check in the same rollout. A failed or
timed-out Convex deploy, Railway status, compatibility audit, or stale-head
check leaves the candidate unpromoted; use Vercel's explicit force-promotion
control only for an incident-approved bypass.

Railway Git autodeploy and every provisioned service-local watch path must remain
enabled. Unchanged workers satisfy the barrier with Railway's no-op status, and
the mailbox cron's Railway deployment status is its release signal because it
has no persistent HTTP process. Do not enable Railway **Wait for CI** for these
services: the release job itself waits for Railway and that setting would create
a cycle. Push-time health checks do not prove release readiness because they can
observe the previous healthy processes; the compatibility audit therefore runs
only after Convex and Railway are ready.
`agent-safeguards.yml` exposes the same production audit only as a manual
diagnostic; it has no recurring, push, or pull-request trigger.

Promotion-last removes the new-frontend/old-backend window, but distributed
runtimes are not atomic. Keep expand/contract compatibility for destructive
query-shape changes and version worker protocol changes so the old frontend and
workers remain compatible while the new backend rolls out.

## Shared-dev deployment

Shared dev (`acoustic-caiman-755`) is an active integration lane and is not
updated by the production-only `main` release workflow. Its Railway extraction
worker is also active: it claims jobs and serves conversions rather than running
health-only. Roll out an approved Spot commit to this lane separately from a
clean checkout:

1. Create a private env file containing the dev-scoped `CONVEX_DEPLOY_KEY` and
   `CONVEX_DEPLOYMENT=dev:acoustic-caiman-755`. Verify the selected deployment
   before making changes with
   `npx convex function-spec --deployment acoustic-caiman-755`.
2. Configure the shared-dev Convex and Railway worker with the migrated lane's
   `CL_ROUTER_URL=https://tangible-warbler-253.convex.site`, matching inference
   `CL_ROUTER_SECRET`, `CL_ROUTER_TENANT_ID=glass`, and matching optional
   timeout. Set `CONVEX_SITE_URL=https://acoustic-caiman-755.convex.site` on
   the Railway extraction worker and verify Convex's built-in
   `CONVEX_SITE_URL` resolves to that same canonical site before deploying
   either consumer. Do not try to overwrite the Convex system variable with
   `npx convex env set`. Before changing either caller, audit the legacy
   `https://cl-router-dev.up.railway.app` routing state, pins, and freeze posture
   against the new router, export while the source is briefly paused, import
   into `tangible-warbler-253`, and verify the imported controls before changing
   both callers as one coordinated lane. Do not execute inference or mutate
   controls on the destination before that import. Keep the legacy service and
   database intact as rollback evidence. `disciplined-dove-883` is the retained
   abandoned first import and `intent-egret-409` is the preserved prior
   synthetic-data target; neither is an active caller destination or the target
   for this history import. `tangible-warbler-253` is deployed from cl-router
   `402b7a2d38fa8453770a868bc4163363f33e99b5` by successful workflow
   `34531575428`; all 16 environment values were verified and all canonical
   tables and migration checkpoints were empty. It must remain guarded and
   frozen until the next fresh transfer. Both active Spot shared-dev callers
   remain on the legacy router until that coordinated cutover.
   Keep existing consumer provider keys until the new code has been deployed
   and exercised; the new runtime does not read them.
3. From the exact approved Spot commit, deploy the widening Convex schema and
   functions with `npx convex dev --once --env-file <shared-dev-env>`. The
   optional legacy `brokerModelSettings.providerKeys` field must remain in this
   release, and the new `routerAssets` table/HTTP handler must be present before
   the worker is updated.
4. Deploy the same commit explicitly to Railway environment `dev`, service
   `spot-extraction-worker`. Set
   `EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION` in Convex to the exact
   `@claritylabs/cl-sdk` spec reported by the worker, then require both health
   responses to agree before allowing new extraction jobs.
5. Run the representative caller and worker smokes below. Only after those pass,
   run the legacy-key cleanup and remove AI, retrieval, retired gateway, and
   Moonshot credentials from shared-dev Convex and the Railway dev worker.

Do not use a Conductor worktree's ordinary `npx convex dev --once` for this
step: it targets that worktree's native local deployment. Do not retire or
disable the shared-dev worker while this lane remains the Conductor source and
integration environment.

### Router migration smoke paths

The authenticated capabilities action is the read-only model-control check:

```bash
npx convex run --deployment acoustic-caiman-755 --inline-query \
  'const p = await ctx.db.query("operatorProfiles").withIndex("status", q => q.eq("status", "active")).first(); return p?.userId ?? null'
npx convex run --deployment acoustic-caiman-755 \
  --identity '{"subject":"<operator-user-id>|router-migration-smoke"}' \
  clRouterOperations:getCapabilities '{}'
```

It must return `availability: "available"`, `credentialMode: "router"`, and
the configured provider booleans without any key material. Use `--prod` only
for the explicitly approved production check.

Use the bounded internal acceptance action for live inference. It accepts only
canonical base64 M4A bytes between 1 KiB and 256 KiB; it accepts no organization,
user, URL, model, storage, marker, task, or deletion selector. The action creates
one random marker-owned organization with no users, memberships, contacts, or
channels, exercises generation, structured output, a deterministic local echo
tool and pinned continuation, embeddings, fixed `https://example.com/`
retrieval, meaningful transcription, and a parser-valid exact 4 MiB PDF. A
per-run token exists only inside the PDF content stream, and the action reports
only whether the routed model returned that token. It attempts to remove its
rows and storage before returning; a scheduled bounded cleanup remains if eager
cleanup fails.

Generate the supplied phrase locally or use the reviewed fixture with SHA-256
`e674f6b0da5b03c5454c28320d81feebbf82bde916b39a510e07f1c899a6b61d`:

```bash
say -v Samantha \
  'This is a synthetic router migration test. The sample number is forty two.' \
  -o "$TMPDIR/spot-router-smoke.aiff"
afconvert -f m4af -d aac \
  "$TMPDIR/spot-router-smoke.aiff" \
  "$TMPDIR/synthetic-audio.m4a"

AUDIO_B64="$(base64 < "$TMPDIR/synthetic-audio.m4a" | tr -d '\n')"
npx convex run --deployment acoustic-caiman-755 \
  actions/operationalRouterSmoke:run \
  "$(jq -nc --arg audioBase64 "$AUDIO_B64" '{audioBase64:$audioBase64}')"
```

The deploy key stays in the environment rather than the action arguments. A
pass has top-level `ok: true`, every phase boolean true, nonzero request IDs and
counts, `toolLoop.toolCallCount: 1`, `toolLoop.stepCount: 2`,
`toolLoop.routePinned: true`, and `cleanup.fixtureDeleted: true`. The result
contains no transcript, PDF token, source text, organization ID, storage ID,
provider, model, or secret. If eager fixture cleanup reports false, rerun only
the marker-ledger cleanup ID returned by that invocation:

```bash
npx convex run --deployment acoustic-caiman-755 \
  operationalRouterSmoke:cleanupFixture \
  '{"smokeRunId":"<result.cleanup.cleanupRequestId>"}'
```

The extraction worker has a separate transport-only smoke. It does not create
or claim a queue item and never invokes extraction completion, enrichment, or
notifications. First create its single random, no-user/no-customer active-lease
fixture with deploy-key authentication:

```bash
WORKER_SMOKE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
npx convex run --deployment acoustic-caiman-755 \
  workerRouterTransportSmoke:createFixture \
  "$(jq -nc --arg requestId "$WORKER_SMOKE_ID" '{requestId:$requestId}')"
```

Then use authenticated Railway SSH against the exact reviewed worker instance
and run its compiled transport script. Keep the worker and router secrets in
the service environment; explicitly remove every prohibited consumer routing
flag and provider/retrieval credential from the child process:

```bash
railway ssh \
  -p 21798fb8-c164-4eed-800c-c964978a9639 \
  -s e8a4f55a-ae25-4d5e-ba0d-e18ea11271ac \
  -e "$RAILWAY_ENVIRONMENT_ID" \
  --deployment-instance "$RAILWAY_DEPLOYMENT_INSTANCE_ID" \
  -- env \
  -u AI_GATEWAY_API_KEY -u ANTHROPIC_API_KEY -u COHERE_API_KEY \
  -u DEEPSEEK_API_KEY -u EXA_API_KEY -u FIREWORKS_API_KEY \
  -u GOOGLE_API_KEY -u GOOGLE_GENERATIVE_AI_API_KEY -u MISTRAL_API_KEY \
  -u MOONSHOTAI_API_KEY -u MOONSHOT_API_KEY -u OPENAI_API_KEY \
  -u PARALLEL_API_KEY -u VERCEL_AI_GATEWAY_API_KEY -u XAI_API_KEY \
  -u CL_ROUTER_TASKS \
  node /app/dist/routerTransportSmoke.js "$WORKER_SMOKE_ID"
```

The one stdout record must start with
`[spot:worker-router-transport-smoke]` and contain sanitized JSON with
`ok: true`, both cleanup acknowledgements true, and a nonempty router request
ID. On interruption or a false cleanup acknowledgement, invoke the bounded
marker-owned cleanup and repeat it after the asset-ledger retry if necessary:

```bash
npx convex run --deployment acoustic-caiman-755 \
  actions/workerRouterTransportSmoke:cleanup \
  "$(jq -nc --arg requestId "$WORKER_SMOKE_ID" '{requestId:$requestId}')"
```

Repeat both smokes with `--prod` only during the explicitly approved production
acceptance window. Neither smoke proves the full extraction pipeline; that
pipeline remains unverified until a separately approved synthetic product flow
can run without customer or external-message effects. Never call a global
worker claim RPC for smoke testing. Native-local Spot references are unreachable
from the cloud router, so these staged-reference smokes target shared dev and
production rather than ordinary Conductor-local Convex.

The iMessage number follows the same expand-first rule. Browser surfaces prefer
`NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER` and its `_DISPLAY` companion, and the worker
prefers `SPOT_IMESSAGE_CONTACT_PHONE` before the public Spot value. Both paths
temporarily fall back to the corresponding legacy `GLASS_*` variables until the
Spot values have been verified on every production target.

Internal operator iMessage uses a separate Photon project and isolated route on the
`operator-imessage-worker` Railway service
(`21ab337b-1f74-4cac-8654-fba5187c35a3`). Its production base URL is
`https://operator-imessage-worker-production.up.railway.app`. It reuses the
`imessage-worker` image with `IMESSAGE_CHANNEL_ROLE=operator`, but requires distinct
`OPERATOR_PHOTON_PROJECT_ID`, `OPERATOR_PHOTON_PROJECT_SECRET`, and
`OPERATOR_IMESSAGE_WORKER_SECRET` values. Its Convex callbacks are
`/operator-imessage-inbound` and `/operator-imessage-delivery-events`; do not
point the internal number at the customer routes or copy customer Photon
credentials into the operator service.

The authenticated Photon dashboard owns a Pro `Spot Operator` project separate
from the customer project. Pro supplies an unlimited shared iMessage route for
up to 100 explicitly registered users; it does not allocate a dedicated public
line. The current registered roster is intentionally limited to Terry Wang and
Adyan Tanver. Record the project ID, one-time project secret, assigned shared
line, and registered sender numbers in the team secret manager; never commit
them or place them in a shared `.env` file. Each registered sender number must
also belong to the matching active production operator user. The inbound route
normalizes that number and accepts it only when both Photon registration and the
Spot operator identity match; unknown and customer numbers fail closed.

Copy the assigned shared line into the GitHub Actions variable
`SPOT_PRODUCTION_OPERATOR_IMESSAGE_CONTACT_PHONE` as an E.164 number. The
`main` release workflow writes it to Convex as
`OPERATOR_IMESSAGE_CONTACT_PHONE`; authenticated operators see the formatted
number and their own linked sender number under `/operator/channels`. The
number is never exposed through a public browser environment variable.

Configure that Railway service with root directory `/imessage-worker` and
`imessage-worker/railway.operator.json`. Set `SPOT_ENV=production`,
`SPECTRUM_PROVIDER=imessage`, `OPERATOR_IMESSAGE_ENABLED=true`, and
`CONVEX_SITE_URL` alongside the operator-only credentials. Convex receives the
same operator worker secret plus `OPERATOR_IMESSAGE_ENABLED=true` and the
service's `OPERATOR_IMESSAGE_WORKER_URL`. Production must keep
`OPERATOR_IMESSAGE_TERMINAL_ENABLED` unset or false. Publish the service health
URL through the GitHub Actions variable
`SPOT_PRODUCTION_OPERATOR_IMESSAGE_WORKER_HEALTH_URL`.
Before merging the rollout, configure both production GitHub Actions variables
and set the Railway service's `OPERATOR_IMESSAGE_ENABLED=true`. Every `main`
release then requires the exact-commit `Spot - operator-imessage-worker`
status, sets Convex `OPERATOR_SLACK_ENABLED=true` and
`OPERATOR_IMESSAGE_ENABLED=true`, clears the terminal-mode flag, and requires
the operator worker health contract, contact number, and fail-closed Convex
wiring before production promotion.

Slack environment/app setup and the client-owned policy-delivery migration are
documented in [Slack privileged service channel](./slack.md). Production owns
the native Slack app and live worker; shared dev and local development use the
mock path. Photon is not part of the Slack deployment path.

## cl-router

`cl-router` runs as separate Convex deployments. Spot and the extraction worker
call it over authenticated TLS. It has no general Spot Convex API or data
client; its only Spot-origin access is bounded `GET` requests for exact
allowlisted, signed asset URLs and allowlisted permanent storage URLs.

Every deployed lane needs matching values:

| Runtime           | Required values                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Convex            | Verify the built-in `CONVEX_SITE_URL` resolves to the exact lane origin (`https://acoustic-caiman-755.convex.site` in dev; `https://actions.spot.insure` in production); do not set this system variable with `npx convex env set`. Configure `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, optional `CL_ROUTER_TIMEOUT_MS`; configure `CL_ROUTER_ADMIN_SECRET` only when the authenticated `/operator/routing` control surface is enabled. |
| Extraction worker | Exact lane `CONVEX_SITE_URL` matching Convex, `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_TENANT_ID=glass` (the stable opaque compatibility key for existing router state), optional `CL_ROUTER_TIMEOUT_MS`                                                                                                                                                                                                |
| cl-router         | `SPOT_ENV`, `CL_ROUTER_SECRET`, `CL_ROUTER_ADMIN_SECRET`, `CL_ROUTER_SESSION_HMAC_SECRET`, exact comma-separated `CL_ROUTER_ASSET_HOSTS`, optional emergency `CL_ROUTER_FROZEN`, optional diagnostic `CL_ROUTER_SHADOW`, and provider/retrieval credentials. Do not set `DATABASE_URL`, `PORT`, Railway variables, or the retired Fastify refresh/scoring interval variables on the Convex router deployments. |

Production callers use the canonical origin
`https://router.toolsforenlightenment.org`. The underlying Convex site URL may
be used as an external diagnostic when the custom domain is inaccessible from a
particular network, but it is not a product-config fallback.

The inference, admin, and session-HMAC secrets must be distinct within each
lane and different between shared dev and production. The admin secret may
be copied only to Convex for the operator-authenticated, server-side
`clRouterOperations.getDashboard` and `setGlobalFreeze` actions. They call the
read-only policy and rollup endpoints and the versioned `/admin/freeze`
control. Never expose the secret to browsers or configure it on extraction,
iMessage, or mailbox workers. AI provider, Parallel, and Exa credentials live
only in the router environment. Spot settings snapshots, Convex, workers, and
browser payloads never contain provider credentials.

`CL_ROUTER_URL` and `CL_ROUTER_SECRET` are required for every Spot AI and
credentialed retrieval call. There is no task gate, consumer-side direct path,
or break-glass provider fallback. A missing or unavailable router produces the
typed unavailable state or failure for that operation.

Tool-bearing agent loops use `getAgentLanguageModelForOrg`,
`getAgentLanguageModelForPublicTask`, `generateAgentTextForOrg`, or
`generateAgentTextForPublicTask`. These helpers preserve AI SDK tools and
`stopWhen`, require stable run and surface metadata, select through cl-router
once, and pin the chosen route for the remaining steps. Routed generation
carries one total execution budget. The router may select its configured
fallback inside the same request before visible output or tool execution.
`query_reason` always retains
a cross-provider router candidate even when a stale static settings snapshot
contains a same-provider fallback. A blank or truncated
turn that already completed tools instead receives one tool-free continuation
over the existing results, so imports and other actions are not replayed.
Generic text/object helpers still fail closed when passed tool-loop-only options.
Every task family, including `operator_agent`, public/default calls, extraction,
embeddings, and voice transcription, uses the same router-only boundary.

Router asset requests accept at most eight assets, 12 MiB for any one decoded
asset, and 16 MiB decoded in aggregate. Spot callers additionally enforce the
Convex runtime's stricter 4 MiB serialized UTF-8 JSON request ceiling, including
base64 expansion. General attachment intake remains separately bounded at ten
files, 25 MiB each, and 50 MiB aggregate because parseable documents become
bounded text and are not router assets. `clRouterLanguageModel` is the final
guard for every AI-SDK image/file part: it counts mixed inline and referenced
binary inputs together and replaces inline bytes with an ActionCtx-backed,
signed Spot reference when the exact serialized request would exceed 4 MiB.
The direct cl-sdk callback request builder applies the same staging and cleanup
rule independently. Existing stored email, thread, web, and operator assets use
their authorized Spot storage URL plus known size. PDFs and audio that require
temporary storage use short-lived signed Spot references.
Generated extraction screenshots that cannot safely remain inline are staged
through the worker-authenticated, current-lease-bound Spot asset ledger and are
deleted after the model call or by bounded expiry cleanup. The router never
persists prompt documents, images, or audio.

Router asset host allowlists are exact. Shared dev permits permanent storage on
`acoustic-caiman-755.convex.cloud` and expiry-enforced HTTP-action references on
`acoustic-caiman-755.convex.site`; production permits permanent storage on
`merry-platypus-82.convex.cloud` and expiry-enforced references on the canonical
`actions.spot.insure` host. Do not add wildcard or underlying-site fallbacks.

The exact-pinned `@claritylabs/cl-router-policy` contract owns model and task
capability metadata. Spot validates function-tool schemas and fails closed on
unsupported adapter inputs; do not duplicate a model capability allowlist in
Spot. Review the active candidates for tool and structured-output compatibility
before enabling autonomous selection for those task families.

Normal deployed operation leaves `CL_ROUTER_FROZEN=0` and
`CL_ROUTER_SHADOW=0` (or omits both variables). Authenticated operators use the
global freeze toggle on `/operator/routing`, which writes an immutable router
control version with the Spot operator ID in its reason. `CL_ROUTER_FROZEN=1`
is an environment-level panic switch for incidents where the operator surface
or admin API is unavailable; it deliberately cannot be overridden by the UI.
`CL_ROUTER_SHADOW=1` is a separate diagnostic override and is not controlled by
the freeze toggle.

`CL_ROUTER_MIGRATION_MODE=1` is a temporary state-import guard only. Set it on
an otherwise idle destination immediately before export/import,
verify the imported counts and history while the guard remains active, and
clear it before caller cutover. It is not part of normal router runtime
configuration and must not remain enabled after migration verification.

Spot never changes transport after a router failure. Authentication/validation
failures, typed candidate exhaustion, transport failures, malformed responses,
and every failure after a successful step all fail closed at the consumer
boundary. Chat preserves the first successful router route pin across later
steps and never replays completed business tools after visible output.

`/operator/routing` combines router health, policy and hourly rollups with
30-day Spot routing events. It shows actual versus shadow routes, router-owned
request IDs, sanitized failed provider attempts, cost and failure aggregates,
and agent workflow outcomes, and owns the
authenticated global freeze toggle. An active operator can control the healthy
router configured by `CL_ROUTER_URL` from any Spot environment; the admin
secret remains server-side. Workflow feedback is submitted only when tool
results contain concrete workflow outcomes; an HTTP 200 by itself is never
scored as success.

The production router health URL is configured through
`SPOT_PRODUCTION_CL_ROUTER_HEALTH_URL`. The normal deployment audit includes
the router:

```bash
AGENT_HEALTH_ATTEMPTS=1 npm run check:agent-health -- --env=production
```

The router must report the matching environment, a live database, and an
active or bootstrap-ready policy store. Before increasing production traffic,
exercise the operator global freeze toggle in both directions, inspect
`/admin/policy` and `/admin/rollups`, then run `/admin/score` against shared dev
or during an explicitly controlled production rollout.

Local health checks skip cl-router unless `SPOT_CL_ROUTER_HEALTH_URL` is set,
because the default Conductor template does not start the separate repository.
Conductor setup imports the source development router URL, inference secret,
admin secret, tenant, and timeout into native-local Convex and passes only the
execution subset to the extraction worker. New setup filters provider keys from
the copied root env and cloud import. Because Convex environment imports are
additive, filtering alone does not delete values already stored by an older
workspace; every setup run now explicitly removes those legacy AI, retrieval,
gateway, and Moonshot variables from native-local Convex. Rerun
`npm run conductor:setup` once in each retained workspace to apply the cleanup.
That cloud router cannot fetch native-local Convex storage or signed HTTP-action
URLs on loopback. Parseable documents may still become bounded text and small
rich inputs may remain inline within the exact 4 MiB serialized request ceiling,
but any local input that requires a reference must fail before inference rather
than omit evidence or forward an unreachable URL. End-to-end local referenced
asset testing requires a local cl-router paired with the native-local Spot
deployment, or an explicitly provisioned exact HTTPS development host added to
that router lane's asset allowlist. Never allow localhost, private-address, or
wildcard asset origins on a cloud router.

## Promotion checklist

1. Run root CI, worker builds, Convex typecheck, and the cl-router OpenAPI and
   full checks.
2. In the target environment, explicitly save an image-capable route for
   `operator_agent` and confirm the router capabilities endpoint reports its
   provider configured. Spot sends this selection to cl-router as a request pin.
3. Deploy the separate Convex cl-router lane and configure all required AI and
   retrieval provider credentials there before deploying Spot consumers. State
   import uses the temporary guarded migration procedure above; cl-router's
   Convex deployments must not receive Postgres or Railway runtime variables.
4. Configure the same bearer secret in the caller and router for that lane.
   Before deploying callers or the extraction worker, set the exact lane
   `CONVEX_SITE_URL` normally on the Railway worker and verify Convex's built-in
   system value resolves to the same canonical origin; do not run
   `npx convex env set CONVEX_SITE_URL`. The shared-dev value is
   `https://acoustic-caiman-755.convex.site` and production is
   `https://actions.spot.insure`.
5. Before merging a commit whose Railway image uses the new asset actions,
   explicitly deploy that exact commit's widening Convex schema/functions and
   synchronize `EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION`. The pre-migration
   worker accepts the omitted optional `providerKeys` claim field and remains
   compatible with this widening release while its process credentials remain;
   this overlap is safe only after the value-free audit confirms there is no
   broker/configured route that depended on a snapshot key. Then merge and let
   the normal `main` workflow redeploy the same Convex commit and gate Railway
   plus Vercel. This prevents Railway autodeploy from starting the new worker
   against old Convex functions.
6. Confirm `GET /health` and the Spot deployment health audit.
7. Validate generation, tool loops, structured output, embeddings,
   transcription, extraction assets, and retrieval in shared dev. Include a
   staged asset whose router request remains small only because it uses the
   lane's signed Spot reference, and confirm the router performs the bounded
   allowlisted `GET`. Repeat that staged-reference smoke in production before
   removing consumer credentials. Compare
   route, error, latency, token, cost, tool completion, and workflow-failure
   telemetry in `/operator/routing`.
8. Keep the router environment panic and diagnostic overrides off. Use the
   `/operator/routing` global freeze toggle when autonomous route changes should
   pause or resume, then verify the new posture in the same dashboard.
9. Page through the value-free legacy key audit with
   `npx convex run modelSettingsMigration:auditLegacyProviderKeys '{"paginationOpts":{"cursor":null,"numItems":100}}'`, passing each returned opaque cursor until
   `isDone`. Review `configuredKeyProviders`, `configuredRouteProviders`, and
   each `routeRows` organization against router capabilities. The audit returns
   provider names, row IDs, and counts only—never credential values, lengths,
   prefixes, or hints. Review the dry run from
   `npx convex run migrations:unsetLegacyBrokerModelProviderKeys '{"dryRun":true}'`,
   then run `npx convex run migrations:runLegacyBrokerModelProviderKeyCleanup`.
   Repeat the full paginated audit until every page reports
   `legacyFieldRows: 0`; only a later narrowing release may remove the optional
   schema field.
10. Remove AI and retrieval provider keys from Convex and every Spot worker only
    after the router-backed consumer deploy is verified. Roll back by reverting
    the consumer release or pinning/freezing router policy—not by restoring
    consumer provider credentials. Reserve `CL_ROUTER_FROZEN=1` for incidents
    where the control surface is unavailable.
