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
   `CL_ROUTER_URL=https://disciplined-dove-883.convex.site`, matching inference
   `CL_ROUTER_SECRET`, `CL_ROUTER_TENANT_ID=glass`, and matching optional
   timeout. Set `CONVEX_SITE_URL=https://acoustic-caiman-755.convex.site` on
   both shared-dev Convex and its Railway extraction worker before deploying
   either consumer. Before changing either caller, audit the legacy
   `https://cl-router-dev.up.railway.app` routing state, pins, and freeze posture
   against the new router, export while the source is briefly paused, import
   into `disciplined-dove-883`, and verify the imported controls before changing
   both callers as one coordinated lane. Do not execute inference or mutate
   controls on the destination before that import. Keep the legacy service and
   database intact as rollback evidence. `intent-egret-409` is the preserved
   prior synthetic-data target, not the destination for this history import.
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

Use registered product functions rather than a permanent debug RPC. The only
read-only live model-control smoke is the authenticated capabilities action:

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

Inference smokes require synthetic product records because all registered
model entry points either persist a result or consume an existing record. Safe
registered paths and exact arguments are:

- tenant tool loop: `actions/processThreadChat:run`
  `{"threadId":"...","orgId":"...","userId":"...","userMessageId":"...","agentMessageId":"...","surface":"web"}`;
- operator tool loop: `operatorAgentRunner:run {"runId":"..."}`;
- embedding: `actions/backfillChunks:backfill {"orgId":"...","batchSize":1}`;
- structured retrieval: `actions/extractCompanyInfo:extractCompanyInfoForOrgInternal {"url":"https://example.com","orgId":"..."}`;
- stored-PDF structured extraction and staged-reference exercise:
  `actions/extractSupplementary:extractOne {"policyId":"...","force":true}`;
- normal external extraction handoff:
  `actions/policyExtraction:startPolicyExtractionFromUpload`
  `{"policyId":"...","fileId":"...","fileName":"router-smoke.pdf","orgId":"...","userId":"...","policyFileId":"...","policyVersionKind":"new_policy"}`.

For the staged-asset smoke, use an explicitly synthetic 4–12 MiB stored PDF
that cannot fit inline, let the normal shared-dev worker claim its own queued
job, and verify the asset ledger, exact allowlisted Spot-host `GET`, router
request, completion, and expiry/eager deletion. Never call a global worker
claim RPC for smoke testing because it may lease a business job. Archive the
synthetic policy and remove its related test artifacts afterward. Repeat the
same normal product path against an explicitly approved synthetic production
fixture before removing production consumer credentials; do not use a customer
policy. A local mock Slack loop (`npm run conductor:slack-fixture -- --text
"<@U-SPOT> use the policy tools to summarize my synthetic sample policy"`) and
local `actions/backfillChunks:backfill` exercise generation/tools and embeddings
without external business effects, but they do not prove cloud-router access to
native-local referenced assets.

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

`cl-router` is a separate service with its own database. Spot and the extraction
worker call it over authenticated TLS. It has no general Convex API or data
client; its only Convex-origin access is bounded `GET` requests for exact
allowlisted, signed Spot asset URLs and allowlisted permanent storage URLs.

Every deployed lane needs matching values:

| Runtime           | Required values                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Convex            | Exact lane `CONVEX_SITE_URL` (`https://acoustic-caiman-755.convex.site` in dev; `https://actions.spot.insure` in production), `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, optional `CL_ROUTER_TIMEOUT_MS`; `CL_ROUTER_ADMIN_SECRET` only when the authenticated `/operator/routing` control surface is enabled |
| Extraction worker | Exact lane `CONVEX_SITE_URL` matching Convex, `CL_ROUTER_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_TENANT_ID=glass` (the stable opaque compatibility key for existing router state), optional `CL_ROUTER_TIMEOUT_MS` |
| cl-router         | `SPOT_ENV`, `DATABASE_URL`, `CL_ROUTER_SECRET`, `CL_ROUTER_ADMIN_SECRET`, `CL_ROUTER_SESSION_HMAC_SECRET`, optional emergency `CL_ROUTER_FROZEN`, optional diagnostic `CL_ROUTER_SHADOW`, optional `CL_ROUTER_POLICY_REFRESH_MS`, `CL_ROUTER_SCORING_INTERVAL_MS`, and provider keys |

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
3. Deploy cl-router, migrate its Postgres database, and configure all required
   AI and retrieval provider credentials there before deploying Spot consumers.
4. Configure the same bearer secret in the caller and router for that lane.
   Before deploying callers or the extraction worker, set the exact lane
   `CONVEX_SITE_URL` on both Convex and the worker: the shared-dev value is
   `https://acoustic-caiman-755.convex.site` and production is
   `https://actions.spot.insure`.
5. Confirm `GET /health` and the Spot deployment health audit.
6. Validate generation, tool loops, structured output, embeddings,
   transcription, extraction assets, and retrieval in shared dev. Include a
   staged asset whose router request remains small only because it uses the
   lane's signed Spot reference, and confirm the router performs the bounded
   allowlisted `GET`. Repeat that staged-reference smoke in production before
   removing consumer credentials. Compare
   route, error, latency, token, cost, tool completion, and workflow-failure
   telemetry in `/operator/routing`.
7. Keep the router environment panic and diagnostic overrides off. Use the
   `/operator/routing` global freeze toggle when autonomous route changes should
   pause or resume, then verify the new posture in the same dashboard.
8. Page through the value-free legacy key audit with
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
9. Remove AI and retrieval provider keys from Convex and every Spot worker only
   after the router-backed consumer deploy is verified. Roll back by reverting
   the consumer release or pinning/freezing router policy—not by restoring
   consumer provider credentials. Reserve `CL_ROUTER_FROZEN=1` for incidents
   where the control surface is unavailable.
