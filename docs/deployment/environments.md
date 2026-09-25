# Deployment environments

`config/deployments.json` is the machine-readable environment map. `main` is
production, shared cloud dev is the deployed integration lane, and each
Conductor worktree uses native local Convex plus local workers.

## Private UI package installs

The root `.npmrc` routes `@claritylabs-inc` to GitHub Packages and reads
`NPM_TOKEN`. Root installs require a credential with read access to
`@claritylabs-inc/ui`.

- GitHub Actions: set the repository secret `NPM_TOKEN` to the package-reading
  credential. CI's `root` job and Release Spot's `validate-root` and `deploy`
  jobs map it directly into their environment. Package access through
  `GITHUB_TOKEN` is not required for these installs. The CLI validation and
  publication jobs install their separate manifests, which do not depend on UI;
  their existing publication credentials remain separate.
- Vercel: configure `NPM_TOKEN` on the Spot project for Production, Preview,
  and any Development environment that installs dependencies.
- Railway: tenant/operator iMessage and Slack Docker builds install
  only their worker manifests, which do not depend on UI. The mailbox scan
  Dockerfile performs no npm install. These builds need no UI package token.
  Keep each service rooted in its worker directory; a future root dependency
  install would require package authentication at build time.
- Local development: provide `NPM_TOKEN` in the install process environment.
  Never put the credential in tracked `.npmrc`, build arguments, or logs.

Repository configuration alone does not verify hosted secret values or prove
that a hosted build can read the package; the consuming build must pass.

## Company detail removal

The company detail forms and runtime fields are retired. After deploying this
version, run `npx convex run migrations:removeStructuredCompanyDetails '{}'`
on the release target and monitor the migrations component until both
`removeCompanyDetails` and `removeCompanyExtractionProfiles` are complete.
The user accepted deletion of these beta values: the cleanup does not copy them
to Markdown. It preserves existing wiki documents, source documents, policy
facts, and issued snapshots. Add `--prod` only for the production rollout.
The optional legacy schema fields support this deletion; narrow them after
completion has been verified on all deployed targets.

## Coordinated release readiness

`.github/workflows/deploy-convex.yml` owns readiness for every commit pushed to
`main`; it is not path-filtered. Root lint, tests, Next.js typechecking, Convex
typechecking, and the production build run as five parallel `validate-root`
matrix jobs alongside worker and package validation. Each root job checks shared
package versions. Deployment requires every validation job to pass. After
validation, the workflow:

1. deploys the commit's Convex functions to production;
2. waits for the exact commit's three established Railway contexts
   (`imessage-worker`, `slack-worker`, and
   `spot-mailbox-scan-worker`) plus `operator-imessage-worker` after its
   production health URL variable is configured, to report
   success, including explicit `No deployment needed` watch-path results;
3. runs the deployed Convex, iMessage, Slack, and cl-router
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

## Stacked PRs and Vercel builds

Use small, related PRs with a linear dependency chain and merge the reviewed
stack together. The top branch contains the combined change. Independent work
can continue as ordinary PRs targeting `main`.

### Branches and previews

`vercel.json` owns automatic Git deployment selection:

| Branch | Vercel behavior |
| --- | --- |
| `stack/<topic>/<layer>` | No automatic deployment; CI still runs. |
| `preview/<topic>` | Preview of the combined stack. |
| `main` | Production candidate with the existing readiness gate. |
| Other branches | Existing automatic preview behavior. |

Each branch must contain this configuration before it is pushed. These are
explicit branch rules, not automatic detection of the top PR. For existing
branches with other names, add each intermediate branch to
`git.deploymentEnabled` with `false`; do not rename workspace branches without
the author's authorization. If adding a layer above the preview branch,
disable the former preview branch and enable the new top branch before pushing.
Keep exactly one preview branch enabled for each stack. Remove obsolete exact
branch rules after the stack lands. Avoid broad `true` patterns overlapping
`stack/**`: Vercel enables a branch when any matching rule is `true`.

CI runs on PRs regardless of their immediate base branch, and on merge groups.
New updates cancel superseded CI for the same PR or ref. Every PR still needs
the required CI checks and reviews. A Vercel preview must not be a required
merge check for intermediate PRs whose deployments are disabled.

### Create and merge a stack

The official `github/gh-stack` extension is required (`gh extension install
github/gh-stack` if it is missing). For a new stack, create branches bottom to
top, making and committing each layer before adding the next:

```bash
gh stack init --base main stack/example/backend
# Commit the backend change.
gh stack add stack/example/api
# Commit the API change.
gh stack add preview/example
# Commit the UI change and validate the combined result.
gh stack submit
```

For existing branches that already form a linear dependency chain, adopt them
with `gh stack init --base main <bottom-branch> <middle-branch> <top-branch>` and
then `gh stack submit`. Do not use this to combine unrelated branches without
first resolving their dependencies and validating the combined result.

After updates to lower layers or `main`, run `gh stack sync` and wait for the
new checks and preview. Once review is complete and the release is authorized:

```bash
gh stack view
gh stack merge --squash
```

Select the entire intended stack in the merge picker. A direct stack merge
lands the PRs together in one atomic operation. This batches the update to
`main` and avoids a separate production release for each layer. With a merge
queue, a sufficiently large stack may be split across consecutive merge groups.
Monitor the resulting `release-ready-production` check and Vercel production
deployment as for any release. Stacking does not bypass reviews, required
checks, or release readiness.

### Build concurrency

The Spot Vercel project uses **Settings → Build and Deployment → On-Demand
Concurrent Builds → Run up to one build per branch**. Its API setting is
`resourceConfig.buildQueue.configuration: WAIT_FOR_NAMESPACE_QUEUE`, with
`resourceConfig.elasticConcurrencyEnabled: true`. This is a project setting,
not a `vercel.json` property. To restore it with an authenticated Vercel CLI:

```bash
vercel api /v9/projects/prj_ZegCP8JSt7ePV0qpG7I43l5XydCZ \
  --scope claritylabs-inc --method PATCH --input - <<'JSON'
{
  "resourceConfig": {
    "elasticConcurrencyEnabled": true,
    "buildQueue": { "configuration": "WAIT_FOR_NAMESPACE_QUEUE" }
  }
}
JSON
```

Read the project back and verify those two fields after changing the setting.
The active build finishes; superseded queued commits are skipped and the newest
commit builds next. Different branches can still build concurrently. GitHub
workflow cancellation does not cancel Vercel builds. Keep automatic production
domain assignment and the `release-ready-production` Deployment Check enabled.

References: [GitHub stack merging](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests),
[Vercel branch rules](https://vercel.com/docs/project-configuration/git-configuration),
and [Vercel build concurrency](https://vercel.com/docs/builds/managing-builds).

## Shared-dev deployment

Shared dev (`acoustic-caiman-755`) is an active integration lane and is not
updated by the production-only `main` release workflow. Extraction runs
entirely through Convex in this lane, the same as every other environment —
there is no Railway extraction-worker component. Roll out an approved Spot
commit to this lane separately from a clean checkout:

1. Create a private env file containing the dev-scoped `CONVEX_DEPLOY_KEY` and
   `CONVEX_DEPLOYMENT=dev:acoustic-caiman-755`. Verify the selected deployment
   before making changes with
   `npx convex function-spec --deployment acoustic-caiman-755`.
2. Configure the shared-dev Convex deployment with the migrated lane's
   `CL_ROUTER_URL=https://tangible-warbler-253.convex.site`, matching inference
   `CL_ROUTER_SECRET`, and `CL_ROUTER_TENANT_ID=glass`. Verify Convex's built-in
   `CONVEX_SITE_URL` resolves to `https://acoustic-caiman-755.convex.site`
   before deploying. Do not try to overwrite the Convex system variable with
   `npx convex env set`. Before cutting over, audit the legacy
   `https://cl-router-dev.up.railway.app` routing state, pins, and freeze posture
   against the new router, export while the source is briefly paused, import
   into `tangible-warbler-253`, and verify the imported controls before the
   cutover. Do not execute inference or mutate controls on the destination
   before that import. Keep the legacy service and database intact as rollback
   evidence. `disciplined-dove-883` is the retained abandoned first import and
   `intent-egret-409` is the preserved prior synthetic-data target; neither is
   an active caller destination or the target for this history import.
   `tangible-warbler-253` is deployed from cl-router
   `402b7a2d38fa8453770a868bc4163363f33e99b5` by successful workflow
   `34531575428`; all 16 environment values were verified and all canonical
   tables and migration checkpoints were empty. It must remain guarded and
   frozen until the next fresh transfer. The active Spot shared-dev caller
   remains on the legacy router until that cutover. Keep existing consumer
   provider keys until the new code has been deployed and exercised; the new
   runtime does not read them.
3. From the exact approved Spot commit, deploy the widening Convex schema and
   functions with `npx convex dev --once --env-file <shared-dev-env>`. This step
   must use the approved widening commit; the conditional narrowed schema no
   longer stores provider keys. The new `routerAssets` table/HTTP handler must
   be present before this deploy completes.
4. Run the representative caller smoke below. Only after it passes, run the
   legacy-key cleanup and remove AI, retrieval, retired gateway, and Moonshot
   credentials from shared-dev Convex.

Do not use a Conductor worktree's ordinary `npx convex dev --once` for this
step: it targets that worktree's native local deployment. Do not retire or
disable this shared-dev Convex integration lane while it remains the Conductor
source and integration environment.

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

Repeat this smoke with `--prod` only during the explicitly approved production
acceptance window. It does not prove the full extraction pipeline; that
pipeline remains unverified until a separately approved synthetic product flow
can run without customer or external-message effects. Native-local Spot
references are unreachable from the cloud router, so this staged-reference
smoke targets shared dev and production rather than ordinary Conductor-local
Convex.

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

`cl-router` runs as separate Convex deployments. Spot calls it over
authenticated TLS. It has no general Spot Convex API or data
client; its only Spot-origin access is bounded `GET` requests for exact
allowlisted, signed asset URLs and allowlisted permanent storage URLs.

Jev decisions (`clRouterDecide`) proceed at 70% confidence by default. Set
`JEV_PROCEED_THRESHOLD` (0.5–0.99) on a Convex deployment to change it; the value
is read on every decision, so no redeploy is needed.

Every deployed lane needs matching values:

| Runtime           | Required values                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Convex            | Verify the built-in `CONVEX_SITE_URL` resolves to the exact lane origin (`https://acoustic-caiman-755.convex.site` in dev; `https://actions.spot.insure` in production); do not set this system variable with `npx convex env set`. Configure `CL_ROUTER_URL` and `CL_ROUTER_SECRET`. Also set `CL_ROUTER_ASSET_SIGNING_SECRET` (at least 32 characters), the dedicated HMAC key for signed router asset URLs; it falls back to `CL_ROUTER_SECRET` only while unset, so rotate it independently of `CL_ROUTER_SECRET` and never rotate the two together. |
| cl-router         | `SPOT_ENV`, `CL_ROUTER_SECRET`, `CL_ROUTER_ADMIN_SECRET`, `CL_ROUTER_SESSION_HMAC_SECRET`, exact comma-separated `CL_ROUTER_ASSET_HOSTS`, optional emergency `CL_ROUTER_FROZEN`, optional diagnostic `CL_ROUTER_SHADOW`, and provider/retrieval credentials. Do not set `DATABASE_URL`, `PORT`, Railway variables, or the retired Fastify refresh/scoring interval variables on the Convex router deployments. |

Production callers use the canonical origin
`https://router.toolsforenlightenment.org`. The underlying Convex site URL may
be used as an external diagnostic when the custom domain is inaccessible from a
particular network, but it is not a product-config fallback.

The inference and session-HMAC secrets must be distinct within each
lane and different between shared dev and production. Spot callers use only
`CL_ROUTER_URL` and `CL_ROUTER_SECRET`. There is no operator freeze/pin admin
surface and no `CL_ROUTER_ADMIN_SECRET` on Convex. Never expose provider
credentials to browsers or configure them on iMessage or mailbox
workers. AI provider, Parallel, and Exa credentials live only in the router
environment. Spot settings snapshots, Convex, workers, and browser payloads
never contain provider credentials.

`CL_ROUTER_URL` and `CL_ROUTER_SECRET` are required for every Spot AI and
credentialed retrieval call. There is no task gate, consumer-side direct path,
or break-glass provider fallback. A missing or unavailable router produces the
typed unavailable state or failure for that operation.

Signed router asset URLs (`convex/lib/routerAssetSignature.ts`,
`convex/http.ts`'s `/router-assets` route) are HMAC-signed with
`CL_ROUTER_ASSET_SIGNING_SECRET`, not `CL_ROUTER_SECRET`. Rotating the router
credential must never invalidate in-flight signed asset URLs, so the two
secrets are configured and rotated independently once
`CL_ROUTER_ASSET_SIGNING_SECRET` is set; it only falls back to
`CL_ROUTER_SECRET` while unset, to keep first deploys a no-op.

Typed classification decisions use `clRouterDecide` and authenticated
`POST /v1/decide`, with the router-owned Jev pin and native Choice/Noul answers.
Spot keeps no TypeSafe key. The app consumes router-policy
1.0.0; the checked-in API snapshot includes decision request/response fixtures.
Deploy the router decision endpoint before this Spot version. Classification
and security generation-route settings no longer control these decisions.
Decision calls remain inline JSON even when a caller has a durable generation
transport. Generation responses report `routing` metadata (decision, source,
primitive, difficulty, and tiers); trace storage keeps legacy selection fields
readable for older events.

Before each operator model step, Spot filters tool definitions by current role,
impersonation, and known integration configuration. Jev selects starter tool families; `expand_tools` can add more during a run. Spot sends the selected family definitions without `toolChoice` and revalidates exact access and approvals at execution. There is no separate chat policy-evidence
classifier, completed-lookup gate, or recovery generation.

Tool-bearing agent loops use `getAgentLanguageModelForOrg`,
`getAgentLanguageModelForPublicTask`, `generateAgentTextForOrg`, or
`generateAgentTextForPublicTask`. These helpers preserve AI SDK tools and
`stopWhen`, require stable run and surface metadata, select through cl-router
once, and pin the chosen route for the remaining steps. Routed generation has no default elapsed-time deadline. Explicit caller budgets
apply to the complete generation request. The router may select its configured
fallback inside the same request before visible output or tool execution.
Spot sends no default model and has no fallback route. A blank or truncated
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
Section extraction slices each PDF section directly in Convex with `pdf-lib`
and sends it inline; a slice is staged as a signed router asset only when the
inline request would exceed the serialized size ceiling, and that staged asset
is deleted after the model call or by bounded expiry cleanup. The router never
persists prompt documents, images, or audio.

Router asset host allowlists are exact. Shared dev permits permanent storage on
`acoustic-caiman-755.convex.cloud` and expiry-enforced HTTP-action references on
`acoustic-caiman-755.convex.site`; production permits permanent storage on
`merry-platypus-82.convex.cloud` and expiry-enforced references on the canonical
`actions.spot.insure` host. Do not add wildcard or underlying-site fallbacks.

The vendored `/v1/decide` and primitive vocabulary in `contracts/cl-router/policy.ts` is used by Convex. Spot uses authenticated `GET /v1/capabilities` `models` to constrain operator pins; cl-router selects models for unpinned calls and clamps
`maxTokens` to the selected model. Spot validates function-tool schemas and
fails closed on unsupported adapter inputs.

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

`/operator/logs` shows 30-day Spot `modelRoutingEvents` call history with
router-owned request IDs, the router's selection summary, sanitized failed
provider attempts, cost, and usage. The retired rating and router feedback paths are not used.

The production router health URL is configured through
`SPOT_PRODUCTION_CL_ROUTER_HEALTH_URL`. The normal deployment audit includes
the router:

```bash
AGENT_HEALTH_ATTEMPTS=1 npm run check:agent-health -- --env=production
```

The router must report the matching environment and a live database.
Spot no longer calls `/admin/policy`, `/admin/rollups`, `/admin/score`, or
`/admin/freeze`. Call history lives in Spot. Operator model and web retrieval route settings have no UI; the retired overrides are cleared by the post-deploy checklist.

Local health checks skip cl-router unless `SPOT_CL_ROUTER_HEALTH_URL` is set,
because the default Conductor template does not start the separate repository.
Conductor setup imports the source development router URL, inference secret,
admin secret and tenant into native-local Convex. New setup filters provider keys from
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

1. Run root CI, worker builds, Convex typecheck, and the cl-router checks. Deploy router jobs and its router-owned worker before the Spot consumer.
2. Configure `CL_ROUTER_URL` and `CL_ROUTER_SECRET` for the approved lane. Confirm the canonical Convex callback origin is reachable by the router; local Convex needs an HTTPS tunnel or local router worker, even for text jobs.
3. Verify authenticated capabilities and the bounded `actions/operationalRouterSmoke:run` fixture in shared dev. Check the Convex section extraction flow with synthetic documents and confirm `convex-sections-v1` promotion and scanned-page evidence.
4. Run the [post-deploy operator checklist](../../AGENTS.md#post-deploy-operator-checklist-for-this-extraction-release) after target deployment. `actions/reextractLegacyPolicies:run` defaults to a dry run; page the cleanup mutations until they return `isDone`.
5. Confirm release readiness and exact-commit health before Vercel production alias assignment.

The operator-agent model route and web retrieval route have no settings UI. Set the operator agent route with `npx convex run modelSettings:setOperatorAgentRouteInternal '{"provider":"openai","model":"..."}'`. `modelSettings:clearOperatorModelOverridesInternal` clears every other stored override but keeps the operator agent route, which `resolveOperatorAgentRoute` still requires. Web retrieval falls back to its default when no override is stored.

### Durable inference rollout

Deploy the cl-router job ledger and its separate Node worker before this Spot
consumer. Follow the router repository's durable inference documentation for its
worker secret, provider credentials, callback/asset allowlists, and worker health.
Spot keeps only its inference bearer; never copy the router worker secret or
provider credentials here. Then release Spot Convex through its existing lane
workflow — section extraction's durable router jobs run entirely from Convex,
with no separate Spot-side worker consumer. Verify a job callback, reconnect
after a lost submission/status response, explicit cancellation, and a
lost-worker unknown outcome before production traffic. Existing synchronous
router endpoints remain compatible during the rollout. Roll back the consumer
before removing the router's worker.

Blanket `CL_ROUTER_TIMEOUT_MS` and `MODEL_CALL_TIMEOUT_MS` no longer apply. Short
control waits only reconnect to the existing job. For local Spot with a remote
router, set `SPOT_ROUTER_CALLBACK_URL` on local Convex to a reachable HTTPS tunnel
origin and allowlist that exact host on the router; text-only calls also need it.
Alternatively run a local router worker on the same machine, with local-only
loopback callback/asset allowlists. See [the Spot protocol](../architecture/router-jobs.md).
