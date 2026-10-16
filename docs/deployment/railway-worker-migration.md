# Manual steps: retiring the Railway workers

Code for all three migrations is merged on this branch. Nothing external has
been changed: no deploys, no Railway/Convex/Photon/GitHub edits. Do these in
order. Run Convex commands against the intended deployment explicitly
(production origin `https://actions.spot.insure`, deployment `merry-platypus-82`).

## 0. Deploy Convex first

Merge and let `deploy-convex.yml` deploy (or `npx convex deploy`). Every worker
below must keep running until this deploy is live and verified.

Before merging, update GitHub branch protection if `Spot - slack-worker` or
`Spot - spot-mailbox-scan-worker` are **required status checks**; those Railway
contexts will no longer be reported, which would block the merge. The deploy
workflow no longer waits for them.

## 1. Mailbox scan (done in code: Convex cron `0 15 * * *`)

1. After deploy, open the Convex dashboard, Crons, and confirm the connected-email
   scan cron exists. Optionally run it once from the dashboard
   (`actions/connectedEmailScan:scanAllMailboxes`) and check the logs.
2. Railway: delete service `spot-mailbox-scan-worker`.
3. Convex env (prod, and any other deployment that set it): remove
   `EMAIL_SCAN_CRON_SECRET`.

## 2. Slack (done in code: Convex calls the Slack Web API directly)

Convex needs no new variables. It already uses `SLACK_CLARITY_TEAM_ID` and the
encrypted installation store.

1. After deploy, check `https://actions.spot.insure/agent-health`: Slack mode
   `slack` (not `mock`), signing/encryption configured, Clarity host
   installation active with required scopes.
2. Smoke test in the shared support channel: send a message and confirm Spot
   replies (reaction, then reply), a file upload and a file download work, and
   a Block Kit interaction (button) responds.
3. Check the Convex logs for Slack `missing_scope`, `ratelimited`, or
   `invalid_auth` errors for ~24 hours.
4. Railway: delete service `slack-worker`.
5. Convex env: remove `SLACK_WORKER_URL`, `SLACK_WORKER_SECRET`.
6. GitHub repo variables: delete `SPOT_PRODUCTION_SLACK_WORKER_HEALTH_URL`.
7. The app manifest moved to `config/slack/manifests/production.json`; the
   provisioning command `npm run slack:provision-apps` is unchanged. Slack's
   Events and interactivity URLs already point at Convex, so no Slack app
   changes are needed.

Rollback: restore the Railway service from its last deployment and the two
Convex env vars. The old code is in git history before commit "Move Slack Web
API transport from slack-worker into Convex".

## 3. iMessage (code merged, flag-gated, OFF by default)

The Railway `imessage-worker` and `operator-imessage-worker` services stay live
and nothing changes until you flip a flag. Follow the full runbook in
[imessage-webhooks.md](./imessage-webhooks.md). Summary, per role
(customer first, then operator):

1. Confirm Photon **Stable** webhooks are enabled for the Photon project.
2. Set on Convex: `PHOTON_PROJECT_ID`/`PHOTON_PROJECT_SECRET` (operator:
   `OPERATOR_PHOTON_PROJECT_ID`/`OPERATOR_PHOTON_PROJECT_SECRET`), copied from
   the Railway service. Never reuse customer values for operator.
3. Right before the flip, register the webhook
   (`https://actions.spot.insure/imessage-webhook`, operator:
   `/operator-imessage-webhook`) via the Spectrum dashboard Webhook tab or the
   curl in the runbook. Save the returned `signingSecret` immediately (shown once).
4. Set `SPECTRUM_WEBHOOK_SECRET` (operator: `OPERATOR_SPECTRUM_WEBHOOK_SECRET`)
   on Convex. Optionally `SPOT_IMESSAGE_CONTACT_PHONE`.
5. Stop (scale to zero, do not delete) the Railway service for that role, then
   within ~20s run `npx convex env set IMESSAGE_WEBHOOK_ENABLED true`
   (operator: `OPERATOR_IMESSAGE_WEBHOOK_ENABLED`). Both transports running
   together will double-reply.
6. Run the verification checklist in the runbook (text reply with typing
   indicator, PDF with caption, web-chat mirror, contact card, group creation,
   no `Rejected delivery` log lines).
7. Rollback: set the flag to `false`, restart the Railway service.

**Verify on first deploy:** voice memos now transcode with a bundled ffmpeg
(`@ffmpeg-installer/ffmpeg`, listed in `convex.json` external packages). Send a
real iPhone voice memo and confirm it is transcribed; if the Convex bundle did
not install the binary, memos fall back to a "could not transcribe" reply.

**Reply threading** is decided by Jev per reply (thread to a specific earlier
message, or send a plain message). Check a few conversations: a reply to an
older question should thread to it; a normal back-and-forth should not. Each
reply adds one Jev call; each webhook delivery also creates a `Spectrum()`
instance (extra Spectrum Cloud calls and Node action time while the agent runs).

After a soak period, do the deletions in the runbook's "Delete after cutover"
section (worker directory, Railway services, old routes, env vars, release
wiring). Not done yet on purpose.

## Checklist

- [ ] Branch protection no longer requires the slack/mailbox Railway contexts
- [ ] Convex deployed; `/agent-health` ok
- [ ] Mailbox cron confirmed; Railway `spot-mailbox-scan-worker` deleted; `EMAIL_SCAN_CRON_SECRET` removed
- [ ] Slack smoke test passed; Railway `slack-worker` deleted; `SLACK_WORKER_*` and `SPOT_PRODUCTION_SLACK_WORKER_HEALTH_URL` removed
- [ ] iMessage customer lane flipped and verified
- [ ] iMessage operator lane flipped and verified
- [ ] iMessage post-soak deletions
