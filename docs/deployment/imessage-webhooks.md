# iMessage over Spectrum webhooks

Production customer and operator iMessage run in Convex: Photon Spectrum POSTs
inbound messages to the role's HTTP route, and Convex sends replies through
`spectrum-ts` Node actions. Both webhook flags are enabled in production.
The Railway services are stopped with Git autodeploy disabled and retained for
rollback. Local terminal development still uses the worker harness.

References: Photon **Stable** docs (Spectrum) — [Webhooks](https://photon.codes/docs/webhooks/overview),
[Events](https://photon.codes/docs/webhooks/events),
[Delivery and retries](https://photon.codes/docs/webhooks/delivery),
[Managing webhooks](https://photon.codes/docs/webhooks/managing-webhooks),
[`app.webhook()`](https://photon.codes/docs/spectrum-ts/webhooks). Package
versions: `@spectrum-ts/core`, `@spectrum-ts/imessage`, and
`@spectrum-ts/terminal` pinned at `5.0.0`, the version the worker runs.

## How it works

| Step | Code |
| - | - |
| Photon POSTs `/imessage-webhook` (customer) or `/operator-imessage-webhook` (operator). The route reads the raw bytes, verifies `X-Spectrum-Signature` (HMAC-SHA256 over `v0:<timestamp>:<rawBody>`, five-minute window), dedupes on `message.id`, and schedules processing in the same mutation. It answers `200` immediately. | `convex/imessageWebhookHttp.ts`, `convex/lib/spectrumWebhookSignature.ts`, `convex/imessageTransportClaims.ts` |
| A Node action builds a request-scoped `Spectrum()` instance, hands the bytes to `app.webhook()` to get the live `[space, message]`, normalizes the turn with the worker's modules, keeps the typing indicator alive, calls the same internal inbound handler `/imessage-inbound` uses, then delivers the reply, contact card, app cards, and attachments. | `convex/actions/imessageWebhook.ts`, `convex/lib/imessageSpectrum.ts` |
| Outbound sends that used the worker's `POST /send` call `sendImessageViaSpectrum` instead: a chat by GUID (`imessage(app).space.get`), a direct chat by phone (`space.create`), or a new group (`chats.create`). A repeated `clientMessageId` within ten minutes is acknowledged as a duplicate. | `convex/lib/imessageSpectrum.ts`, `convex/lib/imessageOutbound.ts`, `convex/actions/createOutboundImessageGroup.ts`, `convex/actions/operatorChannelDelivery.ts` |

`imessageTransportClaims` stores the inbound dedupe keys (48 hours) and the
outbound `clientMessageId` claims (ten minutes, matching the worker's in-memory
cache). Expired rows are pruned in small batches on each claim. The existing
`imessageInboundEvents` and `imessageOutboundSends` idempotency is unchanged.

The worker's pure modules (`inboundNormalization`, `attachmentPolicy`,
`responseDelivery`, `outboundText`, `contactCard`, and the `convex.ts` contract
types) are imported from `imessage-worker/src` rather than copied. Railway
builds each worker from its own directory, so the modules cannot move into
`convex/` while the worker is the rollback path; they move with the deletion
below.

### Old to new mapping

| Worker path | Webhook path |
| - | - |
| `for await (… of app.messages)` + `isInboundTransportMessage` | `POST /imessage-webhook`, `/operator-imessage-webhook` → `actions/imessageWebhook.processMessage` |
| `sendToConvex` → `POST /imessage-inbound` | `ctx.runAction(internal.actions.handleInboundImessage.processInbound)` |
| `sendToConvex` → `POST /operator-imessage-inbound` (size/identity checks) | size check in the action, then `internal.actions.handleInboundOperatorImessage.processInbound` (which enforces DM-only and operator identity) |
| `reportImessageDeliveryEvent` → `/imessage-delivery-events`, `/operator-imessage-delivery-events` | `recordImessageAttachmentDeliveryFailures` (`convex/lib/imessageDeliveryEvents.ts`) |
| `getChatSnapshot`, `withTypingIndicator`, `sendResponseText`, `sendSpotContactCard`, `sendOutboundAppCards`, `sendOutboundAttachments`, group leave | same-named helpers in `convex/lib/imessageSpectrum.ts` |
| `activeSpacesByChatGuid` / `sendByChatGuid` | `imessage(app).space.get(chatGuid)` |
| `activeSpacesByPhone` / `imessage(app).space.create(user)` | `space.create(user)` |
| `/send` participants → `chats.create` + `groups.setDisplayName` | same calls, from Convex |
| in-memory `clientMessageId` cache | `imessageTransportClaims` (`kind: "send"`) |
| `lib/imessageOutbound.sendOutboundImessage`/`sendIdempotentOutboundImessage` → worker `/send` (web-chat mirror, agent mirror, notifications, pending-email confirmations, in-turn pending-email notice) | `sendImessageViaSpectrum(ctx, "customer", …)` when `IMESSAGE_WEBHOOK_ENABLED=true` |
| `createOutboundImessageGroup` → worker `/send` | `sendImessageViaSpectrum(ctx, "customer", { participants, … })` |
| `operatorChannelDelivery.deliver` → operator worker `/send` | `sendImessageViaSpectrum(ctx, "operator", …)` when `OPERATOR_IMESSAGE_WEBHOOK_ENABLED=true` |
| Worker `GET /health` | `/agent-health` reports the active transport; see deletion list |

## Convex environment

| Variable | Role | Notes |
| - | - | - |
| `IMESSAGE_WEBHOOK_ENABLED` | customer | `true` switches inbound and outbound to Spectrum. Requires `IMESSAGE_ENABLED=true`. |
| `OPERATOR_IMESSAGE_WEBHOOK_ENABLED` | operator | Same for the operator lane. Requires `OPERATOR_IMESSAGE_ENABLED=true`. |
| `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET` | customer | The worker's existing customer Photon credentials, now also set on Convex. |
| `OPERATOR_PHOTON_PROJECT_ID`, `OPERATOR_PHOTON_PROJECT_SECRET` | operator | The worker's existing operator credentials. Never reuse customer values. |
| `SPECTRUM_WEBHOOK_SECRET` | customer | The `signingSecret` Photon returns once when the customer webhook is registered. |
| `OPERATOR_SPECTRUM_WEBHOOK_SECRET` | operator | The operator webhook's `signingSecret`. Always passed explicitly, so the SDK never falls back to the customer secret. |
| `SPOT_IMESSAGE_CONTACT_PHONE` | customer | Phone on the vCard fallback when the native contact card fails (worker parity). |

Terminal lanes (`IMESSAGE_TERMINAL_ENABLED`, `OPERATOR_IMESSAGE_TERMINAL_ENABLED`)
ignore these flags: local and shared-dev development keep using the terminal
harness (`npm run conductor:spectrum`, `npm run conductor:operator-spectrum`)
and the worker URLs it registers.

## Cutover runbook (per role)

Do the customer and operator lanes separately. Run each step against the
intended deployment explicitly (`--prod` only for an approved production
change). The production HTTP actions origin is `https://actions.spot.insure`.

1. **Deploy** this code with both flags unset. The new routes answer `503` and
   nothing else changes.
2. **Set credentials** on Convex: the role's `*PHOTON_PROJECT_ID`/`SECRET`
   (copy from the Railway service).
3. **Register the webhook** for the role's Photon project, through the Spectrum
   dashboard **Webhook** tab or:
   ```sh
   curl -X POST "https://spectrum.photon.codes/projects/$PROJECT_ID/webhooks/" \
     -u "$PROJECT_ID:$PROJECT_SECRET" -H "Content-Type: application/json" \
     -d '{"webhookUrl":"https://actions.spot.insure/imessage-webhook"}'
   ```
   (operator: `/operator-imessage-webhook` with the operator project). Store the
   returned `signingSecret` in the team secret manager immediately; it is shown
   once. The URL must be HTTPS, public, and must not redirect. Do this step
   right before the flip: while the flag is off every delivery is retried for
   about 30 seconds and then dropped by Photon (the worker still handles it).
4. **Set the signing secret** on Convex: `SPECTRUM_WEBHOOK_SECRET` or
   `OPERATOR_SPECTRUM_WEBHOOK_SECRET`.
5. **Stop the Railway service** for the role (scale to zero or remove the
   active deployment; do not delete the service). Then, within about 20 seconds,
   **flip the flag**: `npx convex env set IMESSAGE_WEBHOOK_ENABLED true` (or
   `OPERATOR_IMESSAGE_WEBHOOK_ENABLED`). Messages that arrive between the two
   commands are answered `503` and redelivered by Photon after the flip. Running
   both transports at once would double-reply, because webhook `message.id`s
   need not match the worker's Apple GUIDs.
6. **Verify**, from a linked test phone on the role's line:
   - `/agent-health` returns `ok: true` (and `operatorImessage.webhookTransport: true` for the operator lane).
   - A text gets a reply, with a typing indicator while the agent runs.
   - A PDF with a caption reaches the agent with both the caption and the file.
     A `recovery degraded` log line means the raw-message lookup missed.
   - Web-chat mirroring, a notification, and an email-draft confirmation still
     arrive (customer); a delayed operator run is delivered by
     `operatorChannelDelivery` (operator).
   - Customer only: a new chat receives the contact card; an unlinked group gets
     the reply and is left; `create_imessage_group_chat` creates a titled group.
   - A voice memo. See *Voice memos* below before relying on it.
   - Convex logs show no `[imessage-webhook] Rejected delivery` or
     `Spectrum rejected the delivery` lines.

### Rollback

1. `npx convex env set IMESSAGE_WEBHOOK_ENABLED false` (or the operator flag).
   Deliveries now get `503` and Convex sends through the worker again.
2. Restart the Railway service.
3. Optionally delete the webhook (`DELETE /projects/$PROJECT_ID/webhooks/{id}`
   or the dashboard) to stop the retry traffic.

## Known gaps to check before flipping

- **Voice memos.** CAF memos are converted to m4a in Convex with ffmpeg compiled
  to WebAssembly (`@ffmpeg/core`, listed in `convex.json`
  `node.externalPackages`; `convex/lib/imessageVoice.ts`). There is no native
  binary, so nothing depends on executable permissions. Each conversion loads a
  fresh core (~130 ms, ~31 MB wasm); a 60 s Opus-in-CAF memo converts in ~1.2 s
  with ~150 MB peak memory locally. The package is GPL-2.0-or-later (server-side
  use only; confirm with legal). **Verify on the first deploy** that a real
  iPhone voice memo is transcribed on Convex. If conversion fails the memo is
  forwarded unchanged and the sender is told it could not be transcribed.
- **Reply threading.** Webhook `message.id` is opaque (`spc-msg-<uuid>`), not an
  Apple GUID. `convex/lib/imessageReplyThreading.ts` lists the last messages in
  the chat (with their real GUIDs) and asks Jev (`/v1/decide`, task
  `imessage_reply_threading`) two questions: whether the reply needs a native
  threaded reply, and which message it answers. A confident "no" sends a plain
  chat message; a confident "yes" threads to the chosen message; if Jev fails or
  is unsure, the reply threads to the inbound message when its GUID is known
  (previous behavior) and is otherwise sent plain. This adds one Jev call per
  reply (6 s budget). The Railway worker still threads every reply.
- **Outbound `clientMessageId`.** Chat-GUID sends now go through the live
  `Space` (markdown, like the worker's active-space path) instead of the worker's
  fallback `messages.sendText(…, { clientMessageId })`. Idempotency comes from
  `imessageTransportClaims`; group creation still passes `clientMessageId` to
  Photon.
- **Multiple lines in one project.** `space.get(chatGuid)` needs the line phone
  when a project has more than one dedicated line. The customer and operator
  projects each have one line today.
- **Cost.** Every webhook delivery and outbound send creates and stops a
  `Spectrum()` instance (two Spectrum Cloud calls), and the inbound Node action
  stays open while the agent runs (Node action time, 10-minute cap).

## Delete after cutover

Once both roles have run on webhooks for an agreed soak period:

- `imessage-worker/Dockerfile`, `.dockerignore`, `railway.json`,
  `railway.operator.json`, `src/index.ts` (the live Photon transport), and the
  Railway services `imessage-worker` and `operator-imessage-worker`.
- Move `imessage-worker/src/{inboundNormalization,attachmentPolicy,voiceAttachment,responseDelivery,outboundText,contactCard}.ts`
  and the `convex.ts` types into `convex/lib/imessageTransport/` and update the
  imports in `convex/lib/imessageSpectrum.ts` and `convex/actions/imessageWebhook.ts`.
  Keep the terminal harness as a local-only script importing from there, or
  replace it with a script that signs fixtures and POSTs them to the webhook
  routes.
- Routes `/imessage-inbound`, `/operator-imessage-inbound`,
  `/imessage-delivery-events`, `/operator-imessage-delivery-events`; the worker
  branches in `lib/imessageOutbound.ts`, `createOutboundImessageGroup.ts`, and
  `operatorChannelDelivery.ts`; the `IMESSAGE_WEBHOOK_ENABLED` /
  `OPERATOR_IMESSAGE_WEBHOOK_ENABLED` flags (make webhooks unconditional).
- Convex env `IMESSAGE_WORKER_URL`, `IMESSAGE_WORKER_SECRET`,
  `OPERATOR_IMESSAGE_WORKER_URL`, `OPERATOR_IMESSAGE_WORKER_SECRET`.
- Remaining worker wiring: the iMessage worker build in `validate-workers` and
  `ci.yml`, the `operatorImessage` Railway metadata in `config/deployments.json`, the
  `SPOT_PRODUCTION_OPERATOR_IMESSAGE_WORKER_HEALTH_URL` variable, the
  `operatorImessage.workerUrlConfigured`/`workerSecretConfigured` compatibility
  fields in `/agent-health`, and the `container:*:imessage-worker` scripts.
- The operator Railway section of [environments](./environments.md).
