# Operator notifications

## Scope and contract

Operators receive actionable alerts in Slack, configured by category in operator settings. The initial categories are incoming team email, pending manual approvals, submitted applications, and terminal operator-agent or policy extraction failures. Each category has one optional host-workspace channel; different categories can use different channels. Missing configuration is disabled. Enabling a route does not replay historical events.

Operator and client flows remain separate: event catalogs, routing, authorization, settings, and message behavior have different owners. Shared Slack transport, credential handling, channel metadata validation, and delivery error utilities belong below those flows. Tenant `notifications`, preferences, and client Slack routing retain their contracts.

`convex/lib/operatorNotificationTypes.ts` owns the operator catalog and typed target references. `operatorNotificationRoutes` stores revisioned configuration. `operatorNotificationEvents` is the durable event and delivery record, deduplicated by stable source transition key. Payloads contain identifiers, not email subjects, bodies, approval arguments, or provider errors. Server-side target resolution produces fixed copy and authorized application links.

The service rechecks route revision, configured host workspace, channel eligibility and source validity before sending. Only joined, unarchived, nonshared host channels are eligible. Public configuration endpoints require an active operator and reject impersonated writes. Client users cannot read operator delivery records or settings. Pending approvals remain subject to their existing exact approval flow; Slack alerts do not approve actions.

Delivery claims prevent concurrent sends. Definitively rejected requests may retry with bounded backoff; ambiguous external send outcomes remain `unknown` and never automatically replay. Route changes cancel old queued delivery rather than moving it to a new audience. Notification failures do not recursively create notifications.

Intake retains its existing start/progress/summary thread. Before any intake route is saved, the existing environment-configured submission notification remains compatible. Once an explicit intake route exists, submission alerts belong to the new service, including when that route is disabled. Legacy pending submission replies must be suppressed at claim; existing in-flight sends cannot be recalled.

## Public API contract

- `operatorNotifications.getRoutes({})`: `{ available: boolean, unavailableReason?: string, routes: Array<{ category, enabled, channelId?: string, channelName?: string, revision: number, latestDelivery?: { status, errorCode?: string, createdAt: number } }> }`. All four categories are returned; missing rows have revision zero.
- `actions/operatorNotifications.listSlackChannels({})`: joined eligible channel metadata `{ id, name }[]` from the configured host workspace.
- `actions/operatorNotifications.setRoute({ category, enabled, channelId?, expectedRevision })`: validates channel server-side and saves with optimistic revision checking; returns `null`.
- `emitOperatorNotification(ctx, { eventKey, category, target })` from `convex/lib/operatorNotify.ts`: inserts/deduplicates and schedules inside the source mutation, returning the event ID.

## Validation plan

Use local synthetic actors and Slack mock delivery, never Vercel previews or live sends. Exercise route selection, per-category enable/disable, reload persistence, stale revision rejection, tenant denial, impersonation denial, event dedupe, disabled suppression, route-change cancellation, stale approvals, terminal failures, and ambiguous-send recovery. Browser checks cover the actual settings flow and followed-state controls. Review source integration separately from transport verification and record limits in the workflow QA ledger.

Out of scope: Slack commands or approval buttons, per-operator preferences/DM subscriptions, recurring escalation schedules, production rollout, and notification-history backfill.

Initial producers cover incoming team/outreach replies, new manual approvals, submitted/resubmitted applications (including savings intake), failed operator runs, and failed policy extraction. Proposal failure and outreach-delivery-failure producers, reminders and escalation policies are follow-up scope.

Recovery runs every minute in bounded batches. Route-change cleanup reads only pending events through the category/status index.
