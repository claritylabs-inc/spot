# Recipient-scoped inbox preparation — October 20, 2026

Exact router: **`857074d99baa09792b66a45d65a3ca73aef53719`**, detached scratch
checkout of `origin/manager/browser-runtime-candidate`. **BLOCKED for actual mail
delivery and positive candidate read/accept. Local HTTPS refusal checks PASS.**
No self-test was sent, no receiving API was called, and no received body was read.
No browser/model/customer/backend action occurred; customer allowances remain
unconsumed. This is a harness-only manual MCP bridge, not production Spot
`researchInbox`, webhook delivery acceptance, or end-to-end inbox readiness.

Two prerequisites remain unresolved:

- Resend MCP `send_email` explicitly requires a **user-supplied exact From
  address** and forbids choosing one. The authorized research domain does not
  identify a sender localpart. The one missing-information question remains
  pending; no sender was selected from assistant examples or configuration.
- The **existing server-issued Resend conversation_id** was not recoverable from
  the retained function store, available own Codex session, or applicable own
  Conductor transcript window. No replacement ID was invented, and no MCP call
  was made to reset it. Tool availability alone does not establish a currently
  usable authenticated send/receive route.

The prior accepted report records domain receiving enabled, local-key receiving
403, and successful connected-MCP metadata access. Those historical observations
were not rerun or promoted to fresh catch-all delivery evidence. The manager
confirmed there was no prior exact user-supplied From and instructed that real
receiving remain pending. No new key, inbox feature, DNS, webhook, production
Spot access, backend mutation or environment configuration was created.

| Scenario | Evidence / status |
| --- | --- |
| One controlled alias | Prepared exactly one private address: random first name from the existing allowed list plus a cryptographic128-bit suffix on `research.spot.insure`. Address, synthetic code/link and random256-bit capability remain private. No From chosen. |
| Send / actual catch-all receive | **BLOCKED / NOT RUN**. Sends0, metadata polls0, received-body fetches0; no send ID or original-mail provenance exists. No retry or substitute synthetic receipt. |
| Trusted local HTTPS | **PASS**. Local CA/server certificate with localhost SAN; `NODE_EXTRA_CA_CERTS`; hostname/certificate validation enabled. Bound only127.0.0.1 on an ephemeral port. |
| Wrong capability | Actual HTTP404 and actual candidate `createInboxClient(...).read()` returns `ok:false`. |
| Expired capability | Actual HTTP404 and candidate read returns `ok:false`. Private deadline moved into past for the HTTP check, then restored; this does not claim thirty minutes elapsed. |
| Unbound recipient query | Actual HTTP404; no mail data. This checks query binding, **not isolation against actual unrelated received records**. No unrelated body was requested or fabricated. |
| Valid capability, missing real feed | Actual HTTP503 and candidate read returns `ok:false`; **no successful empty/synthetic fallback**. |
| Positive read / accept | **BLOCKED / NOT RUN**. Successful reads0, exposed messages0, accept calls0. Actual `createInboxClient` read failure path was exercised; `accept` was not invoked with invented mail. |
| Bounds / receipt projection | Source-only: exact recipient and window checks, maximum20 messages,256KiB JSON response,1MiB private feed,30-minute capability ceiling. Overflow/real-message projection not behavior-tested without actual receipt. |
| Cleanup | HTTPS server stopped after each workflow; original private expiry restored. No prepared server remains listening. Private setup retained for a later explicit packet. |

## Adapter and source binding

[adapter.mjs](artifacts/website-tech-skill-outcomes-2026-10-20/inbox-readiness-sol/adapter.mjs)
is owned QA code. It serves `/research-inbox?token=…` with `Cache-Control:no-store`.
It checks capability equality, expiry and recipient binding before attempting to
read a private `received-mcp.json` feed. Missing feed returns503. The success path
requires an envelope marked `connected-resend-mcp`, the exact recipient/window,
an original tool-response digest and at most20 actual received messages. Every
message must have that sole exact recipient and a valid received timestamp in
the current window. An envelope marker/digest is provenance bookkeeping, not
cryptographic proof that an MCP call occurred. No such envelope was created here.

The planned feed is a **manual controller transfer of actual MCP results**,
filtered in memory before any body request or persistence. Later use must retain
only the exact test-recipient record/body from its window. There is no automated
MCP transport in this adapter and no claim that this bridge is already operational.
No unrelated mailbox metadata or bodies are published.

The actual existing `decodeEntities` and `extractVerification` functions were
extracted verbatim from Spot `convex/researchInbox.ts` into a private TSX module.
They preserve the existing HTTPS-link filtering, unsubscribe/preferences exclusion,
code filtering and caps of15 links/5 codes. There is no invented email projection
used as success evidence. Hashes of the source file, extracted block, exact
candidate `skills/inbox/client.ts` and browse policy are in
[local-http-result.json](artifacts/website-tech-skill-outcomes-2026-10-20/inbox-readiness-sol/local-http-result.json).

The source success response is `{address, emails:[{from,subject,receivedAt,links,codes}]}`.
The actual candidate client validates its `InboxSchema`, caps20 emails and256KiB,
and exposes accepted messages through `onAccept`. That positive schema/accept path
was not exercised. Local `permittedInboxUrl` accepted localhost only with an
isolated `{CL_ROUTER_JOB_CALLBACK_HOSTS:"localhost"}` options object, and refused
it without that option. No process-wide or production callback configuration changed.

## Actual local workflow and reproduction

[readiness.mjs](artifacts/website-tech-skill-outcomes-2026-10-20/inbox-readiness-sol/readiness.mjs)
runs actual HTTPS requests and imports the exact candidate `createInboxClient`
and `permittedInboxUrl`. Its final run made seven local requests: two wrong-capability,
one unbound-recipient query, two expired-capability and two missing-receipt checks.
There were **two local workflow runs /14 requests total**: one initial run, then
one rerun after using repository `dayjs` for QA date handling. Both exposed zero
messages; no provider, MCP or browser calls accompanied either run. These are
HTTP workflow checks, not new unit tests.

Node **24.14.1**. `npm ci --ignore-scripts --no-audit --no-fund`, the policy-only
build, script syntax, JSON, source hashes, artifact privacy, links and
`git diff --check` passed. No independent full router check was rerun; the manager's
reported full-check/CI PASS remains separately attributed. The exact router source
checkout is clean.

Private setup is mode0700; all contained files are mode0600. It contains one
`config.json` with `recipient`, allowed `name`, `issuedAt`, original30-minute
`expiresAt`, random64-hex `capability`, synthetic code/link and sendAttempts0.
Local `ca.key/ca.crt` and `server.key/server.crt` were generated using OpenSSL;
server certificate has `subjectAltName=DNS:localhost,IP:127.0.0.1`. These are
private local TLS files, not API credentials. Certificate hostname/chain validation
passed. No keys, address, raw code/link, capability or private logs are committed.

With that retained private preparation, the **refusal-only** workflow command is:

```sh
NODE_EXTRA_CA_CERTS=/private/store/ca.crt \
QA_PRIVATE_ROOT=/private/store \
QA_ROUTER_CHECKOUT=/path/to/exact-857074d-checkout \
QA_SPOT_CHECKOUT=/path/to/spot \
/path/to/exact-857074d-checkout/node_modules/.bin/tsx \
  docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/inbox-readiness-sol/readiness.mjs
```

Run only when dispatched. The script deliberately expects sends0 and no real
feed; it cannot establish the missing positive workflow. A later packet needs
the exact user-supplied From, the preserved MCP conversation ID, one controlled
send, bounded in-memory exact-recipient polling, and only that received message's
body. Then actual candidate read/accept can be checked without sending a real
verification capability to a model. Do not reuse an expired capability as ready
evidence; prepared code/TLS are reusable, while the current address/window is
time-bound. No customer submission allowance has been consumed.

[readiness.json](artifacts/website-tech-skill-outcomes-2026-10-20/inbox-readiness-sol/readiness.json)
records exact pending prerequisites and counts.
[manifest.json](artifacts/website-tech-skill-outcomes-2026-10-20/inbox-readiness-sol/manifest.json)
records artifact integrity. No production keys/access were extracted, no TLS
validation was disabled, and no synthetic successful inbox was substituted.
STOP after this bounded blocked handoff.
