# Provider discovery

Operators can ask Spot to find insurance markets (carriers, MGAs, wholesalers,
program administrators) that could write a procurement request, review the
cited candidates, and add the chosen ones to the provider network. Spot holds
no provider credentials: cl-router runs the discovery (Parallel FindAll behind
it) and posts the matches back once. Contract: cl-router `/v1/discoveries`
(Contract D) and `/v1/capabilities` `discovery.providers`.

## Start

`discover_providers` (operator agent and operator MCP, exact approval, action
execution) and the operator UI action `actions/providerDiscovery.start` both
call `startProviderDiscovery` in `convex/actions/providerDiscovery.ts`.

1. `matchLimit` must be 5–50 (default 25); `generator` is `base`, `core`
   (default) or `pro`. The action reads `/v1/capabilities`; without a
   configured `discovery` provider it fails with
   `provider_discovery_unavailable` and nothing changes.
2. `beginInternal` (`prepareProviderDiscovery`) rejects a request that already
   has a `running` discovery or a `pending` one younger than ten minutes, so a
   repeated call never pays twice. It builds the criteria, stores only the
   SHA-256 hash of a random 32-byte token on a `pending` `providerDiscoveries`
   row and schedules a watchdog that fails the row if it is still `pending`
   after ten minutes. The raw token exists only in
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

- `lines`: catalog coverage labels of the request's coverages
  (`requestLobNeeds`; `other`/`unknown` coverages contribute nothing), or the
  operator's `lines`.
- `states`: US state or Canadian province codes from the application or
  business-profile addresses (`requestGeography`, state only), or the
  operator's `states` (validated codes).
- `industry`: only when the operator passes one.
- `exclude`: up to 1,000 external network providers with a website, as
  `{name, url: https://<domain>}`.
- `orgId`: the client organization's opaque Convex ID, for router scoping.

The client's name, website, revenue and any request prose are never sent.
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
| Payload `discoveryId` is not this token's router discovery, or `orgId` differs from the request's client | 409, nothing written |
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
alert (`emitOperatorNotification`, keyed by discovery) links to the request
with fixed copy. The token authorizes one discovery; the request always comes
from the discovery row, never the payload.

## Review

- `list_provider_candidates` / `providerDiscovery.listForRequest`: the latest
  discovery status and the request's candidates (tool: 1–25, excerpts trimmed
  to 240 characters; UI query: up to 100, full stored excerpts).
- `review_provider_candidates` / `providerDiscovery.review`: 1–50 distinct
  pending candidates, atomic. `add` runs the
  `ensure_broker_network_profiles` batch (`internal.operatorBrokerBatches.execute`)
  per request with `{name, domain}`: match by normalized domain, then exact
  name, else create with public enrichment queued; `attachToRequest` also
  creates the request's provider tracking row and never sends email. Any
  rejected item (already reviewed, ambiguous or Spot-owned identity) saves
  nothing.

The public query, mutation and action authorize like the other operator
procurement UI functions (active operator; writes refuse impersonation).
Candidate text is untrusted public web content: tools label it as evidence,
never instructions, and UI renders it as plain text. Candidates are not yet
pruned.
