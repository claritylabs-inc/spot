# Spot

Client-facing instructions for web chat, email, iMessage, Slack, connected
mailboxes, notifications, and document delivery are in the
[Spot client help](docs/help/README.md) section.

Spot is the insurance intelligence platform from Tools for Enlightenment. It combines document extraction, conversational AI, org memory, broker/client workspaces, connected vendor/client access, and API/MCP surfaces in one system.

For contributor-facing implementation detail, see [AGENTS.md](AGENTS.md).

## What Spot Does

- Ingests insurance-related documents from email and uploads
- Extracts structured bound-policy, renewal, and supporting business data
- Builds a continuously-updated company wiki (`orgWikiSections`) per organization
- Supports agent workflows for Q&A, policy-change requests, COI generation, and follow-up analysis
- Exposes capabilities through UI, REST API (`/api/v1/*`), and OAuth-authenticated MCP (`/mcp`)
- Lets client/customer orgs request read-only access to vendor org policies after vendor approval

## Stack

- Next.js 16 + React 19 + Tailwind 4
- Convex (DB, actions, scheduler, storage, vector search, HTTP)
- Vercel AI SDK (`ai`) for model execution + tool-enabled chat
- `@claritylabs/cl-sdk@4.5.0` for source-tree extraction, insurance-focused primitives, and the canonical ACORD policy taxonomy
- Resend for email ingest and messaging workflows

## Getting Started

Spot standardizes on Node 24.x for the app, Convex Node actions, CLIs, and all
workers. `.nvmrc`, `.node-version`, package `engines`, and `convex.json` encode
that contract. On a Mac, the Conductor setup installs Homebrew `node@24` when it
is missing and always runs the workspace under that toolchain.

For a non-Conductor checkout:

```bash
nvm use
npm install
CONVEX_AGENT_MODE=anonymous npx convex dev
npm run dev
```

Then open `http://localhost:8080`.

### Conductor workspaces

New Conductor worktrees use `.conductor/settings.toml` and get a native Convex
deployment and database that belong only to that worktree. Workspace setup:

1. Installs Node 24 and the root and worker dependencies.
2. Reads the copied cloud-dev selection from `.env.local`, imports that
   deployment's environment variables when Convex credentials are available,
   and replaces the worktree's Convex URLs with loopback URLs. A credential-free
   Conductor Cloud workspace continues with an anonymous local deployment
   instead of failing on `401 MissingAccessToken`.
3. Generates a worktree-local Convex Auth signing keypair, forces local safety
   settings (`SPOT_ENV=local`, captured email, terminal iMessage, dev clear
   enabled), maps the copied `NEXT_PUBLIC_MAPBOX_TOKEN` to Convex
   `MAPBOX_ACCESS_TOKEN` for agent address validation, creates worktree-local
   worker secrets, and points Convex at the worktree's worker ports.
4. Pushes the schema/functions and seeds the new database once with a curated,
   minimal shared-dev fixture: `terry@claritylabs.inc` as an operator,
   Montgomery Risk with `terry@montgomeryrisk.com` as its admin, Cove with
   `adyan@cove.dev` as its admin, unique phone identities for both customer
   accounts and one final Cove policy. Cove is standalone; Montgomery Risk is a
   supplier-network profile with seeded writing states and ACORD lines, no
   client ownership, and no policy-upload provenance. Setup fetches and saves
   the Montgomery Risk and Cove website favicons in the worktree's Convex file
   storage. The configured
   `IMESSAGE_TERMINAL_FROM_PHONE` is assigned to the Montgomery Risk admin so
   Spectrum starts in an org-scoped broker context. Setup then compiles the
   workers. Local macOS setup also starts Apple `container` and builds
   worktree-tagged Linux/amd64 worker images; cloud setup uses the compiled
   workers directly.

When credentials are available, the imported environment includes integration
and router configuration but filters every AI and retrieval provider credential;
it never imports cloud database rows or files. Setup also removes provider
credentials retained in native-local Convex by an older setup and strips them
from the copied root `.env.local`; rerun `npm run conductor:setup` once in an
existing workspace to apply that cleanup. Local auth
always uses the workspace's own signing keys. Local database state and secrets
persist under gitignored `.convex/local/default/` and `.context/`. Rerunning
setup preserves the existing local database and does not reseed it. The fixture
copies only a small allowlist of identity, organization, relationship, and
policy-summary fields; it never copies shared-dev auth sessions, email content,
documents, storage objects, or operational history.

Conductor's archive hook deletes `.convex/local/default/`, including local data
and auth state, before the worktree is removed. Closing a Conductor tab or the
app does not archive the workspace and intentionally preserves its database for
the next run.

The default **Dev** run template starts these foreground processes together in
local and cloud Conductor workspaces:

- Spot on `http://localhost:$CONDUCTOR_PORT`
- `convex dev` with the worktree's native local database, including local
  email/OTP capture logs, on `$CONDUCTOR_PORT + 3` (client) and `+ 4` (HTTP actions)
- the extraction worker on `$CONDUCTOR_PORT + 1`
- the mock Slack worker on `$CONDUCTOR_PORT + 5`
- a local email capture watcher that surfaces delivery context and OTPs

On macOS the extraction worker uses the worktree-tagged Apple container image;
in a cloud workspace it runs the already-built Linux worker directly. The Run
terminal automatically prints a compact notice for every captured local email,
including an explicit `OTP:` line when a six-digit code is present. Web, Convex,
extraction, and Slack output is written to
`.context/logs/{web,convex,extraction,slack}.log`; full captured email bodies
remain in `convex.log`. The separate **Email deliveries** Run template opens the
same capture stream in a dedicated terminal when desired.

Spectrum is optional and reserves `$CONDUCTOR_PORT + 2`. Start its interactive
TUI in a separate terminal with `npm run conductor:spectrum`, or use the
**Spectrum terminal** Run template. It starts as the Montgomery Risk admin. Use
`/whoami` to inspect the current sender, `/as broker` for Montgomery Risk,
`/as client` for Cove, and `/as public` for the unlinked public-demo path.
`/as +<E.164 phone>` can test an explicit local identity; the following message
uses the newly selected sender.
Conductor runs are concurrent: each local worktree reserves one six-port namespace
from its unique `CONDUCTOR_PORT` (`+0` web, `+1` extraction, `+2` Spectrum,
`+3/+4` Convex, `+5` Slack), and the app/workers wait for that exact local
instance before starting. Cloud workspaces use the same offsets from port 8080
because `CONDUCTOR_PORT` is not set there. Explicit Convex ports avoid a Convex
CLI collision edge case where automatic fallback can select the same port for
its client and HTTP services. The local extraction container uses a
worktree-tagged image and a narrow bridge from Apple's container network to that
loopback-only Convex port.

The checked-in `.worktreeinclude` copies `.env.local` and worker-local env files
from the repository root. The copied root `.env.local` must initially select a
cloud dev deployment. Local workspaces use the signed-in Convex CLI to import
its environment. Cloud workspaces without a Convex credential skip that import
and still support seeded browser, auth, email/OTP, and mock-channel QA; AI and
other router-backed flows remain unavailable. For full cloud-workspace parity,
add a deployment-scoped key for the selected dev deployment as
`CONDUCTOR_CONVEX_SOURCE_DEPLOY_KEY` in the Conductor Cloud Computer environment
before creating a fresh workspace. A matching standard `CONVEX_DEPLOY_KEY` is
also accepted. Keep
`imessage-worker/.env.local` configured with a local test user's E.164
`IMESSAGE_TERMINAL_FROM_PHONE`; setup assigns that number to the seeded broker
admin and generates distinct client/public terminal aliases. Generated runtime
files and unique local worker secrets stay under gitignored `.context/` and
`.convex/`.

Native local Convex has no public URL. Real Resend inbound webhooks and real
Photon/iMessage callbacks cannot reach it directly. The default local workflow
therefore uses Convex email capture and Spectrum's terminal transport. Use the
shared cloud dev when testing an integration that requires a stable public
callback URL. The mailbox cron image is built for parity but is
not started by default, because running it would scan connected mailboxes.
Automatic Convex AI-file refresh is also disabled so initial provisioning does
not rewrite committed agent skills and guidance; refresh those explicitly with
`npx convex ai-files install` when upgrading the repo's Convex guidance.

## Useful Commands

- `npm run build` - production build
- `npm run conductor:setup` - prepare a fresh Conductor worktree end to end
- `npm run conductor:setup:cloud` - Conductor Cloud entry point; generates the
  gitignored env files a cloud sandbox cannot copy, then runs `conductor:setup`
- `npm run conductor:dev` - start Spot, Convex, extraction, Slack, and email capture
- `npm run conductor:spectrum` - open the optional Spectrum iMessage TUI in a separate terminal
- `npm run conductor:emails` - show captured local email deliveries and OTPs in a dedicated terminal
- `npm run lint` - ESLint
- `npm test` - run tests
- `npx tsc --noEmit` - Next.js TypeScript check
- `npx convex typecheck` - Convex type check
- `npx convex deploy --yes` - deploy Convex functions to prod
- `npm run container:doctor` - verify local Apple `container` prerequisites and installation
- `npm run container:system:start` - start or initialize Apple's local container service
- `npm run container:build:workers` - build all Railway worker images locally with Apple's `container` CLI for `linux/amd64`
- `npm run container:run:extraction-worker` / `npm run container:run:imessage-worker` / `npm run container:run:mailbox-scan-worker` - run a locally built worker image with the worker's `.env`

## Local Worker Containers

Production Railway worker services are Dockerfile-backed. Local worker image tests should use the same Dockerfiles through Apple's `container` CLI on Apple silicon Macs so local builds exercise the production container path.

Deployment environment policy is documented in [docs/deployment/environments.md](docs/deployment/environments.md). `main` is production, shared cloud dev is the deployed integration lane, and local worktrees use local containers instead of shared Railway workers.

Prerequisites:

- Apple silicon Mac
- macOS 26 or newer
- Apple `container` installed from the signed package at <https://github.com/apple/container/releases/latest>

Install or verify the CLI:

```bash
curl -fL -o /tmp/container-installer-signed.pkg \
  https://github.com/apple/container/releases/download/1.0.0/container-1.0.0-installer-signed.pkg
spctl --assess --type install -vv /tmp/container-installer-signed.pkg
pkgutil --check-signature /tmp/container-installer-signed.pkg
sudo installer -pkg /tmp/container-installer-signed.pkg -target /
npm run container:doctor
npm run container:system:start
```

The first `container system start` may prompt to install Apple's recommended Kata Linux kernel. In a non-interactive shell, run `yes | container system start`.

Build all worker images:

```bash
npm run container:build:workers
```

Run one worker image locally:

```bash
cp extraction-worker/.env.template extraction-worker/.env
npm run container:run:extraction-worker
```

Repeat with `imessage-worker/.env` or `mailbox-scan-worker/.env` for those services. The build scripts target `linux/amd64` and the run scripts use `--arch amd64`; this is intentional because production Railway runs Linux containers and the extraction worker currently validates the Linux x64 LiteParse native package.

## Environment

Common variables used across major workflows:

- `CONVEX_DEPLOYMENT`
- `CONVEX_SITE_URL` — exact Spot HTTP-action origin used for signed router
  assets; set it on both Convex and the extraction worker
  (`https://acoustic-caiman-755.convex.site` in shared dev,
  `https://actions.spot.insure` in production)
- `CL_ROUTER_URL` — canonical cl-router origin for every AI and web-retrieval call
- `CL_ROUTER_SECRET` — inference bearer shared only with cl-router
- `CL_ROUTER_TIMEOUT_MS` — optional total router request timeout
- `AUTH_RESEND_KEY` — Resend API key (shared by all outbound email; not required for local capture with `SPOT_ENV=local` and `EMAIL_DELIVERY_MODE=capture`)
- `RESEND_WEBHOOK_SECRET`
- `SPOT_ENV` — runtime lane: `production`, `dev`, or `local`
- `EMAIL_DELIVERY_MODE` — outbound email policy: `live`, `restricted`, or `capture`. Use `capture` with `SPOT_ENV=local` to print full local email text/HTML and six-digit code candidates in the Convex terminal while skipping Resend. Non-local `capture` logs metadata only.
- `EMAIL_ALLOWED_RECIPIENT_DOMAINS` / `EMAIL_ALLOWED_RECIPIENTS` — allowlist for restricted delivery
- `EMAIL_REDIRECT_TO` — internal redirect address for restricted delivery; local capture does not use a redirect address
- `EMAIL_SUBJECT_PREFIX` — optional prefix for restricted delivery subjects
- `AGENT_DOMAIN` — verified Resend sending domain for agent mail. Defaults to `spot.insure`. Legacy inbound addresses at `spot.claritylabs.inc` and `dev.claritylabs.inc` remain recognized.
- `NOTIFICATION_EMAIL_DOMAIN` — verified Resend sending domain for system notifications. Defaults to `notifications.spot.insure`.
- `AUTH_EMAIL_DOMAIN` — verified Resend sending domain for OTP, auth, and invite mail. Defaults to `auth.spot.insure`.
- `CLIENT_PORTAL_URL` / `APP_SITE_URL` — client portal URL. Defaults to `https://app.spot.insure`.
- `spot.claritylabs.inc` is the legacy browser host and redirects to `app.spot.insure`.
- `AUTH_LINK_SITE_URL` — optional override for auth, login, signup, and invite links. Defaults to `https://app.spot.insure`; `auth.spot.insure` is only the default email sender domain.
- `AUTH_EMAIL_FROM` — optional mailbox-address override for OTP sign-in emails. The sender name is `Spot` unless a branded sender name is supplied by the email flow; the default address is `noreply@auth.spot.insure`.
- `SITE_URL` — legacy fallback for client-facing links when the newer portal URL variables are not set.

Not every flow requires every variable; requirements depend on which features you are running.

## Core Flows

### 1) Ingest + Extract

1. Scan inboxes or accept uploads.
2. Store raw files in Convex storage.
3. Extract structured insurance/business data via `cl-sdk`.
4. Persist policy data and chunk + embed content for retrieval.
5. Write key facts into the company wiki.

### 2) Retrieval + Agent Chat

Agent responses are grounded in:

- `documentChunks` (bound-policy/supporting docs)
- `orgWikiSections` (the company wiki, read whole)
- `conversationTurns` (cross-thread memory)

### 3) Connected vendor/client accounts

Client/customer orgs can request a one-way vendor relationship from Connected orgs in the main app menu by entering a vendor contact email. If the email belongs to an existing Spot user, Spot resolves that user's org and emails an approval link; otherwise Spot sends an invite link so the vendor can sign in, create/select their org, and approve access. Active relationships grant the client org read-only access to the vendor's public org profile and bound policy records; they do not grant uploads, deletes, email/thread access, broker-portal capabilities, or onward access to third-party orgs.

Connected vendor data is exposed in the same channels as first-party insurance data:

- Web app: Connected orgs in the main app menu for request/approval/revocation, and policy screens can read approved vendor org policies via the shared Convex access helper.
- REST API: `GET /api/v1/vendors`, `GET /api/v1/vendors/:id`, and `GET /api/v1/vendors/:id/policies`.
- MCP/CLI: `list_connected_vendors`, `get_connected_vendor`, and `list_connected_vendor_policies`.
- Agent: MCP chat receives connected-vendor roster context and directs callers to vendor tools for exact policy lists.

### 4) APIs

- REST API exposes client/vendor resources under `/api/v1/*`
- MCP enables remote and local AI tool access
- Operators connect coding agents to the internal operator MCP server with `npm run operator:mcp` or the operator portal's Channels → MCP tab; see [docs/deployment/operator-mcp.md](docs/deployment/operator-mcp.md)

## Model Routing

Every AI and credentialed web-retrieval call runs through the separate
task-aware `cl-router` service. Spot resolves the global/code settings snapshot
without provider credentials and sends it with each request; the router owns
provider credentials, direct-provider execution, failover, cost telemetry,
calibration, capabilities, and autonomous policy.

- `CL_ROUTER_URL` and `CL_ROUTER_SECRET` are mandatory for AI execution.
  There is no task gate or consumer-side direct-provider fallback.
- Operator global choices are explicit overrides; leaving a task on Automated
  routing gives the active policy control. The global fallback remains a
  separate safety route. Broker organizations do not override model routing.
- The internal `operator_agent` route still requires an explicit image-capable
  selection, but Spot sends that selection to cl-router as a request pin.
- `convex/lib/clRouterClient.ts` owns generation, streaming, embeddings,
  transcription, capabilities, and retrieval contracts.
  `convex/lib/clRouterLanguageModel.ts` preserves the Spot-owned business-tool
  loop with one routed stream per model step and a stable route pin.
- Tool-bearing successes and incomplete responses feed generic quality signals
  back to the routed request so autonomous `query_reason` policies can learn
  which candidates reliably complete tool workflows.
- Defaults are operator-configurable in `/operator/routing`; see `AGENTS.md`
  and `docs/deployment/environments.md` for rollout and controls.

Only cl-router calls AI and retrieval providers. Spot contains no provider keys,
provider SDK execution, Vercel AI Gateway fallback, or break-glass provider path.

## Convex Rule Of Thumb

Internal Convex functions do not have user auth context. Do not call public auth-dependent functions from internal actions.

## Key Files

- `convex/lib/clRouterClient.ts` - task-aware router API client
- `convex/lib/clRouterLanguageModel.ts` - AI SDK chat streaming adapter
- `convex/lib/models.ts` - settings resolution and router-only task helpers
- `convex/lib/sdkCallbacks.ts` - `cl-sdk` task bridge
- `convex/lib/agentPrompts.ts` - retrieval context builders
- `convex/actions/extractPolicy.ts` - policy extraction entrypoint
- `convex/connectedOrgs.ts` - connected vendor/client relationship mutations and queries
- `convex/http.ts` - HTTP, REST, and MCP routes
