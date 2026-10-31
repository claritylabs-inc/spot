# Provider discovery

Provider discovery is network-level market finding: operators ask Spot to
find insurance markets (carriers, MGAs, wholesalers, program administrators)
that write chosen coverage lines in chosen states, review the cited
candidates, and add the chosen ones to the provider network. It is separate
from request provider outreach: a discovery belongs to no procurement request
and sends no client or request data. Spot holds no provider credentials:
cl-router runs the discovery (Parallel FindAll behind it) and posts the
matches back once. Contract: cl-router `/v1/discoveries` (Contract D) and
`/v1/capabilities` `discovery.providers`.

## Start

`discover_providers` (operator agent and operator MCP, exact approval, action
execution) and the operator UI action `actions/providerDiscovery.start` both
call `startProviderDiscovery` in `convex/actions/providerDiscovery.ts` with
explicit criteria.

1. `matchLimit` must be 5–50 (default 25); `generator` is `base`, `core`
   (default) or `pro`. The action reads `/v1/capabilities`; without a
   configured `discovery` provider it fails with
   `provider_discovery_unavailable` and nothing changes.
2. `beginInternal` (`prepareProviderDiscovery`) validates the criteria and
   rejects a start while any discovery is `running` or `pending` and younger
   than ten minutes (newest ten rows by `by_createdAt`), so a repeated call
   never pays twice. It stores only the SHA-256 hash of a random 32-byte token
   on a `pending` `providerDiscoveries` row and schedules a watchdog that
   fails the row if it is still `pending` after ten minutes. The raw token
   exists only in
   `callbackUrl = <callbackSiteUrl()>/router-discoveries/events?token=<token>`.
3. `POST /v1/discoveries` succeeds → the row becomes `running` with
   `routerDiscoveryId`, and a second watchdog
   (`expireRunningInternal`, six hours) fails it and cancels the router run if
   no result has arrived. Any failure marks the row `failed` with a fixed
   message; a router run that was created but can no longer be recorded is
   cancelled.

The tool and action return a `running` status object; results arrive later.

### What is sent

Only public, non-identifying criteria (`providerDiscoveryCriteria`,
`providerDiscoveryInput` in `convex/lib/providerDiscovery.ts`):

- `lines`: 1–10 coverage catalog labels (`MARKET_SEARCH_COVERAGE_LABELS`:
  `COVERAGE_OPTIONS` without `unknown`/`other`, matched case-insensitively and
  stored canonically).
- `states`: 1–20 USPS state codes (`USPS_STATE_CODES`, including DC).
- `industry`: only when the operator passes one (at most 80 characters).
- `exclude`: up to 1,000 external network providers with a website, as
  `{name, url: https://<domain>}`.

No `orgId` is sent, and no client name, website, revenue or request prose.
The objective reads "Find insurance markets that write {lines} for
{industry} businesses in {states} and accept submissions from retail
brokers."; `entityType` is "insurance carriers, MGAs, program administrators
and wholesale brokers". Match conditions are `writes_lines`, `serves_states`,
`market_type` (excludes comparison, lead-generation and retail agency sites)
and, with an industry, `industry_appetite`. Enrichment fields are
`provider_type` (carrier, mga, wholesaler, program_administrator, agency,
other), `lines_offered`, `states_served` and `appointment_url`.

## Callback route

`POST /router-discoveries/events?token=<64 hex>` (`eventsHttp` in
`convex/providerDiscovery.ts`):

| Check | Result |
| --- | --- |
| Missing, malformed or unknown token, or a `failed`/`cancelled` discovery (including a `pending` row the watchdog failed) | 404 |
| Body over 1 MiB (`readBoundedRequestBody`) | 413 |
| Invalid JSON, wrong `contractVersion`, any unknown field | 400 |
| Discovery `pending` (router ID not yet recorded) | 503, the router retries |
| Payload `discoveryId` is not this token's router discovery, or it carries an `orgId` the discovery did not send | 409, nothing written |
| Already `completed` with the same `deliveryId` | 200, nothing written |
| Already `completed` with another `deliveryId` | 409, nothing written |
| Applied | 200 |

`kind: "failed"` or `"cancelled"` sets that status (a fixed error for
failures) and stores nothing. `kind: "completed"` inserts one
`providerDiscoveryCandidates` row per public-website candidate, deduplicated
by domain and capped at the discovery's `matchLimit`: name (300), URL, domain
(the broker-profile `providerDomain` normalization), description (2,000),
each condition with its value (1,000) and up to three public citations with
a 600-character excerpt, plus the enrichment answers (`providerType`
validated, `linesOffered`/`statesServed` 500 characters, public
`appointmentUrl`). A candidate whose domain matches exactly one external
network provider is stored `added` with that `brokerOrgId`. The row becomes
`completed` with `candidateCount`, and one `provider_discovery` operator
alert (`emitOperatorNotification`, keyed by discovery) links to
`/operator/brokers?tab=markets&discovery=<id>` with fixed copy. The token
authorizes one discovery.

`requestId` on both tables is optional and set only on discoveries started
from a request before discovery became network-level; a legacy discovery's
callback may still carry its client's `orgId`.

## Review

- `list_provider_discoveries` / `providerDiscovery.list`: recent discoveries,
  newest first, with status, criteria, `matchLimit`, `candidateCount` and
  dates (tool: 1–25, default 10; UI query: up to 50, default 20).
- `list_provider_candidates` / `providerDiscovery.candidates`: one
  discovery's status and candidates in the router's order (tool: optional
  `discoveryId`, default the latest discovery; optional `status`; compact rows
  without citations, 1–25 with `offset`/`nextOffset`, because a full-evidence
  row is about 7 KB and would overrun the 24 KB model-facing result bound
  after four candidates; up to three `candidateIds` read cited evidence with
  excerpts trimmed to 240 characters; UI query: every candidate, full stored
  excerpts).
- `review_provider_candidates` / `providerDiscovery.review`: 1–50 distinct
  pending candidates, atomic. Adds run one `ensure_broker_network_profiles`
  batch (`internal.operatorBrokerBatches.execute`) with `{name, domain}`:
  match by normalized domain, then exact name, else create with public
  enrichment queued. It never creates request tracking rows or sends email.
  Any rejected item (already reviewed, ambiguous or Spot-owned identity)
  saves nothing.

The public queries, mutation and action authorize like the other operator
network UI functions (active operator; writes and starts refuse
impersonation). Candidate text is untrusted public web content: tools label
it as evidence, never instructions, and UI renders it as plain text.
Candidates are not yet pruned.

## Operator UI

The operator Insurance providers page (`app/operator/brokers/page.tsx`) has
two top-bar tabs, persisted in `?tab=`: Network (the provider list) and Find
markets (`components/broker-network/find-markets.tsx`). Find markets has a
search form (coverage lines and states as multi-selects, an optional
industry, markets to find up to 50), a confirm dialog that lists exactly what
the paid search sends (the action stays disabled while a discovery is pending
or running), a recent-search history with status, candidate count and date,
and the selected search's candidates (`?discovery=` selects one from a
notification link; otherwise the latest). Candidates render as plain text
with up to two cited sources per matched condition and the appointment link;
operators add or dismiss them one at a time or in bulk (up to 50, one atomic
`review` call). Rows already in the network show "In network", linking to the
provider profile. The request workspace has no discovery surface.

Everything on the tab is live for every operator on the page: the history and
candidates are reactive queries, and the form fields, confirm dialog, selected
search and selected candidates are followed state (`brokers:markets:*`), so a
follower sees the leader's. While the tab is open it layers an
`operator_broker_markets` page context (entityId the open search) over the
page's, so the AI panel's first step already holds that search's compact
candidates and the newest searches (`convex/lib/pageContext/operator.ts`).

The Clients list adds a bulk "Research public profiles" action (1–50
clients) backed by `clientProfileBatchResearch.start`, which authorizes like
other operator client writes and queues through
`queueClientProfileBatchResearch`. Its confirmation is followed state
(`clients:list:profile-research`) over the already followed selection, and
every client row shows a spinner while its company research is queued or
running (`listClients` `researching`), so teammates watch the batch progress
without a toast.
