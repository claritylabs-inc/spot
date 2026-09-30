# Spot MCP Events

Status: planned architecture and UI contract. The behavior below remains
conditional on backend review, deployment configuration, and verification in an
approved ChatGPT plugin deployment. This document does not claim that Spot MCP
Events is deployed.

## Protocol boundary

Spot should add MCP Events alongside the existing MCP tool endpoint. The
2026-07-28 protocol path starts with `server/discover`, which advertises the
`events` capability, then exposes the authenticated event methods:

- `events/list` describes the events and optional subscription filters.
- `events/subscribe` creates or refreshes a webhook subscription.
- `events/unsubscribe` stops a matching subscription.

The legacy `initialize` handshake for protocol version 2025-11-25 remains
supported for existing clients. It is retained for compatibility; it does not
create an event subscription and should not bypass the newer discovery or
authorization checks.

This design follows the [OpenAI MCP Events guide](https://developers.openai.com/plugins/build/mcp-events)
and its linked [draft MCP Events design sketch](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/main/docs/design-sketch-proposal.md).
The ChatGPT integration described there uses webhook delivery and callback
verification. Spot should use `cursor: null` for these event types: delivery is
non-replayable, so events missed during an interruption cannot be recovered by
resuming a cursor.

## Planned Spot event catalog

The initial catalog is intentionally small and should be returned only when the
connected MCP principal can access the relevant records. Filter names are
optional subscription arguments, not a grant of access.

| Event | Optional filters |
| --- | --- |
| `compliance.status_changed` | `policy_id`, `vendor_org_id` |
| `vendor.policy_expiring` | `policy_id`, `vendor_org_id` |
| `policy.ready` | `policy_id` |
| `policy.review_required` | `policy_id` |
| `proposal.review_ready` | `request_id` |
| `procurement.request_updated` | `request_id` |

The event names, descriptions, payload schemas, and final filter availability
must be reviewed with the backend implementation before publication. Event
payloads are data, not instructions. A delivered event may prompt ChatGPT to
draft work, but delivery itself cannot write Spot data or bypass an approval
flow.

## Subscription lifecycle

1. `server/discover` and `events/list` are served from the same authenticated
   MCP endpoint as tools. Discovery and subscription arguments are checked
   against the connected principal and the specific policy, vendor, proposal,
   or request.
2. `events/subscribe` validates the event name, canonical filter arguments,
   callback origin, and requested delivery mode. The callback must pass the
   protocol’s HTTPS/public-destination checks and a fresh signed challenge
   before the subscription becomes active.
3. Spot stores a deterministic subscription identity derived from the
   authenticated principal, callback origin, event name, and canonical filters.
   Repeated requests with the same identity update the existing subscription
   rather than creating duplicates. Unsubscribe is idempotent.
4. Subscription state has a finite TTL: 24 hours by default and no more than
   seven days. A refresh may extend the same identity within that policy. The
   settings UI shows the granted expiration and never displays callback paths or
   signing secrets.
5. The source write and the durable outbox record should commit atomically.
   Delivery workers select active, authorized subscriptions, apply filters,
   sign the exact serialized event body, and retry transient failures with
   bounded backoff. Each event keeps one stable event ID across retries; there
   is no replay cursor for the initial Spot catalog.
6. Delivery access is rechecked when a subscription is used. Disconnecting the
   MCP account, revoking access to the target record, explicit unsubscribe, or
   TTL expiry stops future delivery. These transitions should be safe under
   retries and concurrent delivery attempts.

Signing secrets are sensitive integration credentials. They should be
encrypted with Spot’s existing integration-encryption mechanism and never
returned by `mcpEvents.listSubscriptions`; deployment must have the required
encryption key configured. The UI returns only the callback origin. The
backend should not be considered ready until callback verification, storage,
outbox, authorization, and retry behavior have been reviewed together.

Existing daily compliance monitors retain their current cadence. MCP Events is
an additional user-requested delivery path, not a replacement for those
monitors or a new scheduler.

## Settings surface

`McpEventSubscriptions` is shared by operator and tenant settings and takes no
organization selector. It reads the actor-scoped subscription list and lets an
authorized user stop an active subscription. It shows:

- the event label and callback origin;
- the granted expiration, formatted with dayjs;
- optional scope filters;
- active, expired, or revoked status; and
- a destructive **Stop** action for active subscriptions.

There is deliberately no create form. A user asks ChatGPT to watch a Spot
event, ChatGPT performs the MCP subscription request, and Spot activates it
only after callback verification. Draft-only follow-ups should be requested
explicitly, for example: “Draft a follow-up for me, but do not send it.”

## Approved-deployment smoke workflow

This is a verification checklist for the backend owner after an approved
deployment; it is not a claim that these steps have run:

1. Rescan the Spot plugin in ChatGPT after the MCP endpoint changes. Manually
   verify that `server/discover` advertises events and `events/list` shows only
   the intended event definitions.
2. In a new ChatGPT chat, ask it to watch compliance status for one authorized
   policy and request a draft-only follow-up. Confirm Spot receives
   `events/subscribe`, validates the callback challenge, and stores no secret in
   the list response.
3. Trigger a matching status change and confirm one signed callback is accepted
   and ChatGPT receives the event. Trigger a non-matching policy change and
   confirm it is not delivered.
4. Open Spot settings in both the tenant and operator surfaces. Confirm the
   same actor-scoped subscription appears with origin, scope, expiration, and
   status; stop it and confirm subsequent matching events are not delivered.
5. Verify expiration, account disconnection, target-access revocation,
   duplicate subscribe, retry/idempotency, invalid callback signatures, and
   the absence of any write or approval bypass. Confirm daily compliance
   monitors still run on their existing cadence.

Before this workflow is run, the deployment must have the integration
encryption key configured and the backend contract reviewed. No production
cleanup, deployment, or ChatGPT verification is part of this change.
