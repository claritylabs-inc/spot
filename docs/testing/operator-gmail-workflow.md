# Operator Gmail workflow

Manual localhost QA for the OAuth-connected operator Gmail. Use the local Conductor stack (`npm run conductor:dev`) and verify `.env.local` selects `127.0.0.1` before opening Chrome. Prefix every other Convex CLI call with `env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN CONVEX_AGENT_MODE=anonymous`. Never use Vercel previews or production data.

## Prerequisites

- Local Convex env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_MAILBOX_ALLOWED_DOMAINS` (the test Workspace domain), `EMAIL_CONNECTIONS_ENCRYPTION_KEY`. The Google OAuth client is an Internal Web client whose redirect URI is the local `<CONVEX_SITE_URL>/operator-gmail/oauth/callback`.
- Capture mode disables connections unless `OPERATOR_MAILBOX_CONNECTIONS_ENABLED=true`.
- Receiving mail through Resend needs a public webhook URL, which native local Convex does not have. Cases 2, 3 and the Resend half of 4 need an isolated dev deployment inbox (`team.dev.spot.insure`) with an explicit recipient allowlist, or records injected through the existing inbound mutation. Record which was used.
- Two synthetic active operators (Terry QA, Amy QA) in separate Chrome profiles; Terry owns a Workspace Gmail account in the allowed domain, plus one account outside it. Record fixtures under gitignored `.context/qa/operator-gmail/`.

## Workflows

1. **Connect.** Profile → Gmail shows "Connect Google". Connect with the allowed-domain account; Google returns to `/operator/profile`, a "Gmail connected" toast shows, the query string is removed, and the card shows the address with an Active badge. Reload and verify it persists. Repeat with the outside-domain account: an error toast ("not on an allowed domain"), no connection, and the query string removed. Untick a Gmail permission on the consent screen: "Allow every requested Gmail permission". Connect the same address as Amy: "connected to another operator". With the card connected, Reconnect re-runs consent and keeps one connection.
2. **CC capture.** From Gmail (outside Spot), send to an external test address with Terry's `<localpart>@team.spot.insure` on Cc, then another on Bcc. Each appears once in the team inbox for both operators, as Terry's outbound mail, with the Gmail badge in the list and "via Gmail" in the reader. A copy without the team address never appears.
3. **External reply-all.** Reply-all from the external address (team address still included). The reply lands in the same thread as inbound mail with the Gmail marker and the thread's unread/needs-reply state. A plain reply that drops the team address never reaches Spot (known limitation).
4. **Send a reply from Gmail and from Spot.** On the Gmail thread, the reply default is Gmail; on a thread with no Gmail marker it is the Spot address; a new email defaults to Spot. In the preview, Gmail shows Terry's team address as a visible Cc; change body or recipients and verify the approval fingerprint changes. Send from Gmail: the message is in Terry's Gmail Sent folder and in the same Gmail thread, once in the Spot inbox (the captured CC copy does not duplicate it). Send a reply From Spot on the same thread through Resend and verify the other path is unaffected. An agent/MCP saved draft and a provider-outreach sequence still send from the Spot address.
5. **Revocation.** Revoke Spot's access at https://myaccount.google.com/permissions (or remove the app token). Attempt a Gmail send: it is blocked with a visible error, never delivered through Resend, and the Profile card shows Needs reconnect with the last send error. The Spot-address send option still works. Reconnect and verify the badge returns to Active and a send succeeds.
6. **Disconnect.** Disconnect asks for confirmation; Cancel changes nothing. Confirm: toast, the card returns to "Connect Google", and Gmail is no longer offered when sending. Existing Gmail-marked threads and messages remain. Connecting again (or Amy connecting the address) now works.

Also check: keyboard navigation, narrow viewport, light and dark themes, and an impersonating operator (Connect/Disconnect are rejected with a message).

## Evidence

Record each outcome in `docs/testing/workflow-qa.md` with screenshots and readback paths under `.context/qa/operator-gmail/`. Never include tokens, cookies or the encryption key. Use Passed only for the actual workflow; distinguish failure, blocked prerequisite and not run. Disconnect the test Gmail and remove temporary allowlists afterwards.
