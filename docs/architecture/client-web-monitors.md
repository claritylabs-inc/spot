# Client web monitors

Spot watches each opted-in client for material public events (litigation,
regulatory or enforcement action, sanctions, breaches, recalls, safety
violations, layoffs, mergers and funding, leadership and location changes,
major contracts, bankruptcy). Spot holds no provider credentials: cl-router
creates and runs the monitor (Parallel behind it) and posts events back.
Contract: cl-router `/v1/monitors` (Contract M) and `/v1/capabilities`
`monitors.providers`.

## Create and cancel

`manage_client_web_monitor` (operator agent and operator MCP, exact approval,
action execution) calls `internal.actions.clientWebMonitors.create` or
`cancel`.

1. `create` rejects a frequency outside `1h`–`30d`, then reads
   `/v1/capabilities`. Without a configured `monitors` provider it fails with
   `web_monitoring_unavailable`; nothing else in Spot changes.
2. It generates a random 32-byte token, stores only its SHA-256 hash on a
   `pending` `clientWebMonitors` row (`beginCreateInternal`: live client, one
   monitor per client, a `pending` row older than ten minutes stops counting)
   and builds `callbackUrl = <callbackSiteUrl()>/router-monitors/events?token=<token>`.
   The raw token exists only in that URL, in the router's monitor row; it is
   never stored in Spot or logged.
3. `POST /v1/monitors` sends the public entity (company name, website origin),
   the default query (`CLIENT_WEB_MONITOR_QUERY`), four structured fields
   (`category`, `headline`, `materiality`, `summary`), frequency (default `1d`)
   and depth `fast`. Success stores `routerMonitorId` and marks the row
   `active`; any failure marks it `failed` with a fixed message (provider
   errors are never stored or shown). A create whose outcome is unknown can
   leave an orphan router monitor; its callbacks are rejected (404) because
   the row is not active.
4. `cancel` calls `POST /v1/monitors/{id}/cancel?tenantId=<tenant>` (no body),
   then marks the row `cancelled`; a 404 (the router no longer knows the
   monitor) also cancels the row; callbacks for a cancelled monitor return 404.

## Callback route

`POST /router-monitors/events?token=<64 hex>` (`eventsHttp`):

| Check | Result |
| --- | --- |
| Missing, malformed, unknown, cancelled or failed token (index `by_token_hash`) | 404 |
| Body over 256 KiB (`readBoundedRequestBody`) | 413 |
| Invalid JSON, wrong `contractVersion`, any unknown field | 400 |
| Payload `monitorId` is not this token's router monitor, or `orgId` differs | 409, nothing written |
| Monitor still `pending` (router ID not yet recorded) | 503, the router retries |
| Duplicate `deliveryId` for the monitor | 200, nothing written |
| Applied | 200 |

`kind: "execution_failed"` sets a fixed `error` on the monitor and stores no
events. `kind: "events"` inserts one `clientWebMonitorEvents` row per event
(`headline`, `summary` up to 4000 characters, `category` and `materiality`
validated against the known values, at most ten public citations with a
600-character excerpt) and updates `lastEventAt`. The token authorizes one
monitor only; the organization always comes from the monitor row, never the
payload.

## Surfaces

- `get_client_attention` → `webMonitorEvents`: unacknowledged medium/high
  events from the last 30 days (top five, headline, category, first citation
  URL, bounded scan).
- `get_organization` include `webMonitor`: monitor status plus recent events
  with cited detail.
- `acknowledge_client_web_monitor_events`: marks exact events reviewed.
- Operator alert: a delivery with a high-materiality event emits one
  `client_monitor` notification (`emitOperatorNotification`, keyed by monitor
  and delivery) routed like other alerts. Copy is fixed and links to the client;
  headlines are web content and are not placed in Slack messages.

Event text is untrusted public web content: tools label it as evidence, never
instructions. Retained events are not yet pruned.
