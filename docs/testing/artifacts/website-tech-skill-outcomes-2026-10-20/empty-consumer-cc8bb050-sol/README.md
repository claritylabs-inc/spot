# Fresh no-profile consumer replay

Exact Spot `cc8bb050c20f6cb45798da7c6eb986d4b0b884af`; Node24.
See [report](../../../website-tech-empty-consumer-sol-2026-10-20.md).
This bundle adds only the previously missing authorized null read and rendered
not-scanned state. It preserves the prior accepted union and its limitations.

Use the [normal local prerequisites](../README.md#normal-local-prerequisites).
Create a detached exact-source checkout with a NEW native database. Copy only an
existing native-local config privately (`.convex/local/default/config.json`,0600)
and its three anonymous/local selector and loopback URL entries (`.env.local`,0600).
Never copy a database, hosted settings or production credentials. Ports must be
8083/8084, frontend8080. Create0700 `.context/logs` and
`.context/qa/empty-consumer-cc8bb050-sol` under the checkout. Dependencies must
match its package/lock bytes. Keep raw Convex logs private: they contain OTPs.

Supply absolute script paths from this directory, in separate process terminals:

```sh
node /path/to/local-lane.mjs /absolute/exact-checkout convex
# Wait for native functions ready in the PRIVATE log, then:
node /path/to/local-lane.mjs /absolute/exact-checkout bootstrap
node /path/to/local-lane.mjs /absolute/exact-checkout web
Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp
```

Controller children receive a minimal system environment, no ambient deployment
keys. Bootstrap refuses nonempty env, establishes local mode on explicit empty
loopback, checks it before further writes, generates local auth and capture-only
channels, and runs the ordinary seed. No router credentials are configured.
This run's first seed CLI command failed; after actual query proved zero
organizations, the guarded `finish-seed.mjs` completed the existing seed. It is
only for that known incomplete bootstrap and refuses populated organizations.
Do not rerun bootstrap or seed over an existing fixture.

From the candidate checkout (normal browser auth is obtained afresh):

```sh
export QA_CHECKOUT=/absolute/exact-checkout
node /path/to/empty-qa.mjs
node /path/to/cleanup.mjs
# Stop owned web, Convex and Xvfb processes, then offline packaging:
node /path/to/publish.mjs "$QA_CHECKOUT"
```

`empty-qa` first proves all profiles absent, signs in through the normal operator
OTP page using only a new exact-recipient local capture, queries the real
operator endpoint, and invokes the actual registered get_organization executor.
It asserts the own websiteTech field is null before navigating to actual Profile
Tech stack. No Rescan, website writer, claim/finish, mock UI or synthetic browser
outcome is used. It takes one real screenshot and proves profiles/jobs remain0.
The executor uses existing private local admin access with an authorized operator
actor; this is not HTTP/OAuth MCP transport coverage.

Only safe projections/counts and protocol message types/UDF names are retained.
Headers, arguments, auth frames, cookies, OTPs, raw logs and full organization
responses are never published. `auth-private.json` is0600 and removed; Chrome's
temporary profile is closed/removed. There were no router values to restore.
Original backend/private inbox were not opened. The new stopped local DB remains
isolated and never generated a scan. `publish` verifies source bytes and closed
ports without browser/provider activity. The screenshot was visually reviewed.
