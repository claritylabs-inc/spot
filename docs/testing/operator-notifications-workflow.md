# Operator Slack notifications workflow

Use the workspace's local Convex backend, seeded operator and client accounts, and `SLACK_MODE=mock`. No live Slack, email, production writes or Vercel preview testing. Start only through `npm run conductor:dev`. Prefix other Convex CLI calls with `env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN`.

## Settings

Actor: seeded active operator, signed in normally with locally captured OTP. Open `/operator/settings?section=notifications` in visible Chrome.

1. Confirm all four categories render and missing routes are off.
2. Select the joined internal fixture channel for Inbox; reload and verify persistence while still off.
3. Enable Inbox, select a different internal channel, reload and verify both values persist.
4. Disable Inbox and verify it remains off after reload.
5. Exercise each other category independently; setting one must not alter another.
6. Check an empty or failing channel list, narrow viewport, keyboard selection and followed-open state. Following/impersonation disables writes.
7. Turn routes off after the run; retain clearly marked synthetic event history.

## Access and delivery boundaries

Use local synthetic source records through existing mutation owners or a temporary local-only fixture. Do not add permanent public test endpoints. Record exact results separately from inferred source review.

- Client and unauthenticated identities cannot read routes or save configuration.
- Impersonating operators cannot save, including through the action-to-mutation boundary.
- Saving with a stale expected revision rejects without changing configuration.
- Shared, unjoined, archived, wrong-host or missing channels cannot be enabled.
- One source event key produces one durable event despite duplicate calls.
- Missing/disabled route records a suppressed event; later enabling does not replay it.
- Enabled route schedules and mock-delivers fixed copy with a link; no email subject/body or approval payload is stored in the event.
- Changing a route before claim cancels the old delivery; it does not redirect it.
- Resolved/expired approval, deleted source, cancelled run and recovered policy failure do not send stale alerts.
- Concurrent claims cannot both send. Stale `sending` becomes `unknown`; repeated recovery never resends it.
- Known rejection retries are bounded. Unknown outcomes remain blocked from replay.

## Source workflows

- Genuine incoming team email queues Inbox once; duplicate receipts and operator-sent messages do not.
- A new manual approval queues Approvals; automatic approval does not.
- Terminal operator run and policy extraction failures queue Failures; cancellation does not.
- Submit/resubmit/savings intake all use the submitted seam. With no explicit intake route, legacy submission behavior remains. Once a route exists, the new service owns submission alerts even when disabled; legacy pending submitted replies are suppressed and later summaries still drain. Started/progress/summary messages keep their existing behavior.

## Evidence

Screenshots, local scripts and machine-readable observations belong in `.context/notifications/`. Record passed, failed, blocked and not-run cases in the final results below. Mock transport verification does not establish live Slack installation or provider delivery.

Results: pending integration.
