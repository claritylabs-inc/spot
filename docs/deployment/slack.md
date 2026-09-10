# Slack workspace app and shared support channel

Slack is Spot's privileged client support and collaboration surface. Email and
iMessage remain AI-only. A Slack-enabled client installs Spot once in its
workspace, then may add the app to any number of channels. Separately, Clarity
Labs creates and invites the client to one private `#spot-<client-slug>` Slack
Connect support channel hosted by `claritylabsinc.slack.com`. Spot operators
answer there with their normal Slack identities. Convex stores the canonical
conversation, agent actions, delivery evidence, retries, and failures.

Spot owns one native Slack app:

- `slack-worker/manifests/production.json` configures production app
  `A0BMW4TG7JB` against the Convex HTTP origin
  `https://actions.spot.insure` (deployment `merry-platypus-82`).

Do not route Slack through Photon or Spectrum. Photon remains the production
iMessage provider only. Shared dev and local development use the signed
native-event fixture and mock worker; only production uses the native app.

## Native app provisioning

Install and authenticate the official Slack CLI, then create a short-lived
service/configuration token. The token can manage manifests, expires, and is not
a bot token or runtime credential.

```bash
slack login
slack auth token
SLACK_SERVICE_TOKEN='...' npm run slack:provision-apps
```

The provisioning script calls `apps.manifest.create` (or
`apps.manifest.update` when `config/deployments.json` already records an app ID)
through `slack api`. It never prints returned credentials and writes create
responses to gitignored permission-0600 files under `.context/slack-apps/`.
Transfer the credentials immediately to the production Convex deployment,
record the non-secret app ID in deployment config, then delete the local response
files and unset the temporary token.

If the native `/slack/events` route has not reached production yet, create the app
without Events API subscriptions using
`npm run slack:provision-apps -- --bootstrap production`. This is only a
bootstrap and also omits interactivity: after both routes and the signing secret
are deployed, rerun the normal production command so
`apps.manifest.update` applies and verifies the complete manifest before
enabling Slack.

The app manifest enables token rotation and subscribes the Events API to the
production `<CONVEX_SITE_URL>/slack/events` route. It requests these bot
scopes:

- `app_mentions:read`
- `chat:write`
- `channels:read`, `channels:join`, `channels:manage`, `channels:history`
- `groups:read`, `groups:history`, `groups:write`
- `im:history`
- `files:read`, `files:write`
- `reactions:write`
- `users:read`, `users:read.email`
- `conversations.connect:write`

The same manifest enables interactive components at
`<CONVEX_SITE_URL>/slack/interactivity`. Apply the complete manifest in
production; rich responses are not controlled by a separate feature flag or
cohort.

Customer OAuth requests the narrower set in
`convex/lib/slackOAuthPolicy.ts`; the Clarity-host installation also needs
`groups:write` and `conversations.connect:write` for private Connect channel
creation and invitations. Enable app distribution before sending customer
install links. Adding `channels:join` and `channels:manage` requires applying the updated manifest and
having existing installations, including the Clarity host installation,
authorize the expanded scope before the web app can add Spot to or remove Spot
from public channels for customers.

Applying a manifest does not widen tokens that were already issued. An
installation created before a scope was added keeps its original grant, and
Slack rejects the affected calls with `missing_scope` until an operator
reconnects that workspace from `/operator/channels`. Reactions are the quiet
case: without `reactions:write` the agent still answers normally but never marks
a message as seen, so `/agent-health` reports the gap directly through
`checks.slackHostScopesGranted` and `operatorSlack.missingHostScopes`, and
`npm run check:agent-health:prod` fails the release with the missing scope names.

## Request and credential boundaries

Slack sends Events API requests directly to `POST /slack/events`. Convex checks
the exact raw body with `X-Slack-Request-Timestamp`, `X-Slack-Signature`, and the
environment's `SLACK_SIGNING_SECRET`; requests outside the five-minute replay
window are rejected. Native provider event IDs are recorded for diagnostics,
while the durable event key deduplicates overlapping `app_mention` and
`message.*` subscriptions and host/customer Slack Connect mirrors for the same
Slack message. Mirrored primary-channel events also resolve to one canonical
thread even when Slack assigns different channel IDs to each workspace.

The OAuth callback exchanges codes directly with `oauth.v2.access`, validates
the granted customer scopes, and AES-GCM encrypts bot and refresh tokens with
`SLACK_TOKEN_ENCRYPTION_KEY`. The workspace team ID is authenticated additional
data, so ciphertext cannot be moved between workspace records. Ciphertext never
appears in user-facing channel queries. The stateless worker retrieves a current
customer installation only from the bearer-authenticated
`POST /slack-worker/installation` token broker. Convex refreshes expiring tokens
through Slack, persists the replacement access and one-use refresh tokens, and
returns only the current installation to the worker. A short database refresh
lease serializes rotation across concurrent worker requests so Slack's one-use
refresh token is never redeemed twice.

The Clarity workspace is one environment-level host installation rather than a
customer connection. Operators install it through the Agent channels setup
surface with the broader host scopes. Its rotating credentials use the same
encrypted Convex installation store and private worker token broker as customer
installations. No Slack bot token belongs in Railway variables. Disconnect
calls `apps.uninstall`, then clears encrypted local credentials and disables the
connection. Native `app_uninstalled` and `tokens_revoked` events also revoke the
matching installation.

The encrypted Convex installation store is the current native-app credential
custody boundary. This replaces the older Photon-custody assumption; Photon is
an iMessage provider and is not in the Slack data path.

## Authoritative lifecycle and reconciliation

The native Events API request URL receives messages and lifecycle events in one
signed stream. Both app manifests subscribe to installation revocation and the
supported channel archive, delete, rename, ID-change, share, and unshare events.
`/slack/events` verifies the exact raw request, durably deduplicates lifecycle
events by Slack `event_id`, and acknowledges before scheduled processing.

`slackWorkspaceConnections` and `slackChannelBindings` retain canonical identity
and history while health changes. An uninstall or matching bot-user entry in
`tokens_revoked` clears encrypted credentials and marks the connection revoked;
unrelated identities are recorded and ignored. Channel events apply only to the
host or customer identity that produced them. Renames update display metadata,
`channel_id_changed` preserves the previous ID, and archive, delete, or unshare
makes the selected binding unavailable without deleting threads, preferences,
or delivery evidence. Rebinding is an explicit, audited operator action.

Every 15 minutes Convex asks the worker to run `auth.test` and bounded
`conversations.info` checks for due active installations and selected channel
IDs. The worker obtains a fresh installation through the token broker for every
operation and returns only normalized health fields—never tokens or raw Slack
payloads. Definitive authorization failures revoke immediately; transient
provider failures degrade health and retry with bounded exponential backoff.
Reconciliation covers event-delivery gaps, but it cannot infer an unknown
replacement channel ID.

Replies to Slack-delivered client and operator events require a healthy
workspace connection, then target the exact delivered channel without a second
channel-inventory, membership, privacy, sharing, or binding-health gate.
Inventory and binding health remain setup, canonical-support, web-mirror, and
proactive-destination metadata rather than invocation authorization. Provider
authorization and channel errors become structured lifecycle evidence, stop
retry leasing, and leave terminal delivery rows visible. Reinstall must target
the retained workspace and reverify scopes and bot identity. A support channel
is restored only by verification of the same ID or an audited rebind; canonical
threads and automation preferences are preserved.

## Direct Web API transport

`slack-worker/` calls Slack Web API directly. It owns:

- `chat.postMessage` and `chat.update` with Slack-mrkdwn and Block Kit;
- `reactions.add` and `reactions.remove` for the temporary model-selected
  processing acknowledgement on the triggering user message, with `eyes` as
  the immediate default;
- `assistant.threads.setStatus`, `chat.startStream`, `chat.appendStream`, and
  `chat.stopStream` only for compatibility with presentations started before
  the reaction-first delivery change;
- `chat.postEphemeral` for interaction confirmations;
- `views.open` for optional negative-feedback detail;
- `files.getUploadURLExternal` plus `files.completeUploadExternal` for outbound
  files (never retired `files.upload`);
- `files.info` and authenticated private downloads for inbound files;
- `users.info` to resolve a Slack Connect sender's native workspace before
  Convex authorizes that actor;
- `conversations.list` to return every visible public channel plus private or
  shared channels where Spot is already a member;
- `conversations.join` to add Spot to a selected public workspace channel;
- `conversations.create` and `conversations.inviteShared` using the separate
  Clarity-host installation.

Private and Slack Connect channels cannot be joined from Spot. A Slack member
must add the app from Slack, after which the next channel inventory sync reports
the membership. The worker exposes channel, Block Kit, message-update,
assistant-status, streaming, and interaction-response capabilities in health
output so deploy checks can distinguish them from basic outbound messaging.
`reconciliationEnabled` confirms that token-safe verification is live.

Never infer that a sender belongs to the installation workspace when native
event data omits `user_team`. Actor resolution must succeed before
authorization. Slack Connect events can arrive through either installation.
Convex maps Clarity-side events through the binding's host team/channel pair and
sends with the host installation; customer-side and other-channel traffic uses
the customer's encrypted installation.

## Environment contract

Convex requires:

| Variable                                  | Purpose                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `SLACK_ENABLED`                           | Global Slack service switch; `true` in production                |
| `SLACK_MODE`                              | `slack` for native live testing; `mock` for the isolated fixture |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`  | Credentials for that lane's native app                           |
| `SLACK_SIGNING_SECRET`                    | Verify native Slack requests                                     |
| `SLACK_TOKEN_ENCRYPTION_KEY`              | Encrypt customer bot and refresh tokens                          |
| `SLACK_OAUTH_REDIRECT_URI`                | Optional callback override                                       |
| `SLACK_CLARITY_TEAM_ID`                   | Clarity host workspace ID                                        |
| `SLACK_WORKER_URL`, `SLACK_WORKER_SECRET` | Worker URL and shared bearer secret                              |
| `OPERATOR_SLACK_ENABLED`                  | Enable internal operator DMs and activated host-channel threads  |
| `NEXT_PUBLIC_APP_URL` or `APP_URL`        | Post-OAuth settings redirect                                     |

The Railway worker requires `SPOT_ENV`, `SLACK_WORKER_MODE`,
`SLACK_WORKER_SECRET`, and `PORT`. Native live mode additionally requires
`CONVEX_SITE_URL` and `SLACK_CLARITY_TEAM_ID`. The worker retrieves both host
and customer installations through the token broker. The worker and Convex must
use the same mode and worker secret.

Use `SPOT_PRODUCTION_SLACK_WORKER_HEALTH_URL` for release checks. Native worker
health must report `tokenBrokerConfigured`, `outboundEnabled`,
`actorResolutionEnabled`, `clarityTeamConfigured`, `channelInventoryEnabled`,
`publicChannelJoinEnabled`, `blockKitEnabled`, `messageUpdatesEnabled`,
`reactionsEnabled`, `agentStatusEnabled`, `streamingEnabled`,
`interactivityResponsesEnabled`, and `feedbackModalsEnabled`.
The Convex agent health endpoint separately verifies that the Clarity host
workspace has an active encrypted installation; worker configuration alone
cannot prove that OAuth installation exists.

Internal operator chat reuses this same Clarity host installation and worker.
Production release health requires `OPERATOR_SLACK_ENABLED=true` and a
configured `SLACK_CLARITY_TEAM_ID`; the shared worker and active host
installation remain covered by the existing Slack health contract. The `main`
release workflow sets `OPERATOR_SLACK_ENABLED=true` on production Convex before
running that health gate, so a release cannot promote with operator Slack
silently disabled.
After customer workspace and persisted Slack Connect binding resolution have
failed, Convex may route a Clarity App Home DM, a host-channel mention, or an
authorized reply in an active host-channel thread to the operator agent only
when `OPERATOR_SLACK_ENABLED=true`, `users.info` resolves the sender to the
Clarity team, and that exact Slack identity belongs to an active Spot operator.
A mention on any reply activates its Slack thread even when the unmentioned
root was previously ignored; later replies in that thread do not require
another mention. Unmentioned top-level messages remain ignored. Convex does not
query channel inventory or apply channel ID, type, privacy, sharing, or
membership filters; Slack event delivery is the authority for where the
installed app is present. Exact `approve` or `reject` replies resolve the one
pending confirmation in that operator-owned conversation. Spot's own bot
messages, unknown users, other bots, and external workspaces fail closed.

For a local operator-channel fixture after the default Conductor dev run is
ready:

```bash
npm run conductor:slack-fixture -- --team T-CLARITY-FIXTURE --channel G-OPERATOR-FIXTURE --user U-SPOT-OPERATOR --text "<@U-SPOT> summarize operator status"
```

Use a `D...` channel ID, or pass `--channel-type im`, to exercise the App Home
DM route.

## Onboarding and operating model

1. An operator uses `/operator/channels` to OAuth-install the matching native app in
   the Clarity workspace, persisting its rotating credentials in Convex.
2. A Spot operator records their Clarity `{teamId,userId}` identity.
3. The operator creates `#spot-<client-slug>` and sends the Slack Connect
   invitation. Plan/policy failures fall back to audited manual binding.
4. The operator sends the selected client contact the same lane's app-install
   invitation. The client accepts OAuth in their workspace; accepting the
   Connect invitation is not app install.
5. In Spot, an operator or client admin may add the app to any visible public
   workspace channel or remove it from one. For private and Slack Connect
   channels, a Slack member manages the app in Slack and Spot discovers the
   joined channel on sync.
6. A channel sync verifies the selected customer-side support mirror by its
   persisted ID. Missing, unshared, ambiguous, or renamed channels never cause
   name-based reassociation; an operator must make an audited rebind when Slack
   cannot authoritatively update the ID.
7. Designate the automatic alerts channel and confirm its health.
   Spot still responds in any channel where Slack delivers the installed app's
   events; neither this selection nor the synchronized inventory limits chat.
   The selection affects only supported automatic alerts. Safe customer alerts
   default on; vendor alerts default off.

Support-channel messages are canonical from connection onward. A mention starts
or resumes AI, unmentioned customer replies continue an active thread, an
operator reply pauses AI, and `@Spot resolve` closes the thread. Outside the
support channel, only mentions and active-thread replies are retained. A human
request posts only a content-free link notice into the support channel. Private
non-support channels fail closed in the web mirror: the thread is visible only
to the first mapped Spot member who starts it, or remains Slack-only when no
current client member can be mapped. A new inbound Slack message automatically
restores an archived mirror so current activity cannot remain hidden.
Slack message deletions scrub the mirrored message content, stored attachments,
edit revisions, and retained inbound event payloads without running the agent.

The App Home Messages tab provides one continuous direct conversation between
Spot and each customer workspace member. DMs do not require an `@Spot`
mention and are keyed by the Slack DM channel rather than each message timestamp.
Top-level messages receive top-level replies; when a user replies inside a Slack
thread, the answer and its files stay in that thread. `users.info` returns the
profile email under the required `users:read.email` scope. When that email matches
a current Spot user with membership in the connected client org, Convex records
the web mirror as `visibility: "user_private"` with that user as `createdBy`; otherwise the DM
continues in Slack but remains absent from the shared web tenant. Multiparty DMs
remain unsupported.

The web app keeps the eight most recent Slack conversations pinned above
ordinary web/email threads and provides an All threads page for every older
active conversation. Slack-origin threads are read-only in Spot, link back to
Slack, and show a private affordance for `user_private` mirrors. Outbound agent
messages expose retrying or terminal Slack delivery state instead of presenting
an undelivered answer as successful.

## Rich responses and interactions

Every Slack agent run creates one durable `slackMessagePresentations` row before
delivery. Spot immediately adds the default `eyes` reaction to the triggering
user message, then requires the Slack model to choose one context-appropriate
built-in reaction through `choose_slack_reaction` before its other tools. The
selected reaction is removed on both success and failure and is not included in
the visible completed-work trace. Finalization posts one completed emoji-free
Block Kit answer and adds policy cards, linked policy details, native
certificate-file delivery, an optional human-service action in shared threads,
and per-response feedback. Progress narration, model reasoning, and raw tool
input or output are never projected into Slack.

Internal operator Slack uses a deterministic acknowledgement lifecycle instead
of model-selected reactions. After a host-workspace sender is authorized as an
active operator, Spot adds `eyes` to each triggering message while the operator
agent works. Once the response is delivered and the inbound event is completed,
Spot adds `white_check_mark` and removes `eyes`. Failed runs remove `eyes`
without adding a completion reaction. Reaction API failures remain advisory and
do not block response delivery.

The final renderer uses current Slack `card`, `context_actions`, and
`feedback_buttons` primitives. If Slack rejects a newer block type for a
particular surface, that same message is retried immediately with classic
`section` and `actions` blocks. This automatic protocol degradation is part of
the renderer and is not a rollout gate. If both renderers fail, Spot preserves
the existing durable plaintext-and-attachment fallback.

Interactive payloads use the same five-minute signature and raw-body validation
as Events API requests. Buttons carry a random bearer token whose SHA-256 digest
and 30-day expiry are stored with the presentation; plaintext tokens are never
persisted. Convex binds every action back to the exact team, channel, provider
message, connection, tenant, and resolved Slack actor. It idempotently records
`slackInteractionEvents`, stores one `agentResponseFeedback` row per actor and
response, opens an optional detail modal after negative feedback, and routes
human requests through the existing audited handoff mutation. URL buttons
remain ordinary access-controlled Spot deep links.

## Retired policy-delivery automation

Automated policy delivery no longer has Slack settings, rules, queues, attempts,
or extraction hooks. Ordinary Slack replies, notifications, certificates, file
downloads, and proposal correspondence remain. The procurement legacy audit and
purge are deployment-gated through `procurementMigration:auditLegacyNarrowing`
and `migrations:runProcurementLegacyPurge`; do not restore a Slack policy-delivery
toggle or sender while those retired tables await their narrowing release.

## Validation and rollback

In production, apply the complete manifest and verify OAuth, native signature
rejection/acceptance, uninstall and reinstall, Connect actor identity, App Home
DMs, mentions, thread replies, edits, processing-reaction cleanup, Markdown
rendering, policy cards,
feedback, human handoff, multiple inbound files, outbound certificate/PDF
upload and proactive alerts. The processing reaction requires
`reactions:write`; apply the manifest and reauthorize both the Clarity host and
existing customer installations. Until an installation is reauthorized,
reaction failures remain advisory and completed answers still deliver.

For lifecycle changes, first exercise signed fixtures and worker integration
tests, then use a designated disposable customer workspace and a real private
Slack Connect channel during an explicitly controlled production smoke test.
Record the Slack event ID,
the corresponding `slackLifecycleEvents` row, connection/binding health, and a
blocked outbound ledger row for each destructive case. Exercise these cases in
order: rename the channel; archive/unarchive where the workspace exposes that
operation; unshare and re-share or explicitly rebind; revoke the test workspace's bot
authorization and confirm the revoked bot user ID matches; reinstall into the
same workspace; then uninstall the app and reinstall again. Verify both host and
customer channel IDs, confirm stale/duplicate events do not change the newest
state, and confirm no reply, file, alert, or handoff reaches
Slack while health is degraded. Finish by waiting for a scheduled reconciliation
cycle and confirming both `auth.test` and channel checks return healthy.

Do not broaden lifecycle support from signed fixtures alone. The controlled
production evidence must include real Events API delivery for every event Slack
can produce and explicit reconciliation evidence for lifecycle states whose
event delivery is unavailable or asymmetric.

Before progression run Slack-focused tests, worker build/tests, root and Convex
typechecks, lint, build, worker checks, deployment health, and
`git diff --check`.

For rollback, disable Slack for the client. For a lane-wide stop set
`SLACK_ENABLED=false` and leave durable records intact. Disconnect only for a
requested removal or revoked installation; it uninstalls the native app and
prevents outbound retries.

For local testing after `npm run conductor:setup` and while
`npm run conductor:dev` is running:

```bash
npm run conductor:slack-fixture -- --text "<@U-SPOT> summarize my policy"
```

The command signs a native Slack Events API fixture with the worktree-only
secret and records the response through the same durable Slack tables.
During the rebrand transition, local fixture ingestion accepts the canonical
`U-SPOT` mention when a preserved worktree still stores the synthetic
`U-GLASS` bot identity. This compatibility is restricted to the known local
fixture team and channel and never applies to deployed Slack traffic.

## Operator approval lifetime

Operator Confirm/Cancel controls have no time limit. The exact proposed action
stays pending until approved, cancelled, or superseded by a new task. Approval
revalidates the operator, tool input, and current record references before
execution. One pending confirmation still blocks competing writes in the same
operator thread.

Confirmations that expired under the former ten-minute policy remain terminal.
Clicking an expired or inactive control replaces the buttons with its state and
an instruction to ask Spot to continue with a fresh confirmation. Legacy stored
`expiresAt` values no longer expire pending approvals, and expiration jobs
scheduled before this change do nothing.
