# Preserved website-tech consumer QA

Historical acceptance: Spot `101b96ba4daa6ef77faf884e863c9ca566ac1035`.
[Focused report](../../website-tech-skill-outcomes-sol-2026-10-20.md).
This bundle preserves the accepted run; this preservation commit performs no new
behavioral runs. Results are historical, not results of running the relocated
copies. Replay copies have repository-relative imports, current-HEAD provenance,
unique invocation keys and a fixture-preparation entrypoint. Only syntax, import
paths, JSON structure, links and artifact content were checked after relocation.

## Evidence

- [Final app checks](results/app-results.json), [initial app checks](results/app-results-initial-f96d9219.json).
- [Consumer bounds/redaction](results/boundary-results.json), [sanitized stored fixture](results/projected-fixture.json).
- [Access/tenant catalog](results/access-results.json), [request contract](results/request-contract-diagnostic.json).
- [Rescan transitions](results/app-rescan-transitions.json), [keyboard/reload/card lifecycle](results/app-followup-results.json).
- [Initial clipping geometry](results/overflow-geometry-initial-f96d9219.json), [corrected geometry](results/overflow-geometry.json).
- [Separate mobile shell overflow](results/app-inner-overflow.json): 416px inner wrapper at 390px. This remains open; skill-row wrapping does not fix it.
- [Validation and presence-only restoration](results/validation.json), [fixture/job cleanup](results/cleanup-results.json).

The three screenshots are actual local Next/Convex UI with the seeded Cove client,
`skill-qa.example`, synthetic procedure descriptions, and repeated x/y text.
They contain no login codes, emails, browser-session credentials or capabilities.

| Desktop outcomes, final SHA | Initial clipping, f96d9219 | Corrected wrapping, final SHA |
| --- | --- | --- |
| [Screenshot](screenshots/app-known-desktop.png) | [Screenshot](screenshots/app-long-mobile-initial-f96d9219.png) | [Screenshot](screenshots/app-long-mobile.png) |

## Normal local prerequisites

Run from the repository root, with Node 24.x and installed repository dependencies.
Use the normal native-local setup, not a hosted deployment:

```sh
node --version
npm run conductor:setup:cloud
npm run conductor:dev
```

Keep the dev process running in its own terminal. Existing workspaces can use
`npm run conductor:dev` after their normal setup. Setup creates
`.convex/local/default/config.json`, loopback ports 8083/8084, `SPOT_ENV=local`,
`EMAIL_DELIVERY_MODE=capture`, local JWT keys and ordinary synthetic seeded users.
No private helper files from the original workspace are needed. The fixture
identity constants come from `convex/lib/localSeedData.ts`; these are local seeded
accounts, not authorization to sign into hosted accounts.

Use the visible desktop Chrome/display when available. The original cloud run
used `/usr/bin/google-chrome` and Xvfb `:99`:

```sh
sudo dnf install -y xorg-x11-server-Xvfb
Xvfb :99 -screen 0 1440x1000x24 -ac
```

Keep that display process in another terminal. The browser scripts explicitly use
`:99`; adapt only that display path if the environment already provides a visible
desktop. The app URL stays `http://localhost:8080`.

## Replay commands

These commands mutate only the disposable native-local synthetic fixture. They
are documentation for a later authorized run; none were rerun for preservation.

```sh
mkdir -p .context/qa/skill-outcomes-sol
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/isolate-local.mjs
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/login.mjs
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/boundary.mjs
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/request-contract-diagnostic.mjs
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/prepare-local.mjs
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/app-qa.mjs
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/app-followup.mjs
```

`isolate-local.mjs` is for a local backend that inherited both router variables.
It saves their values privately and removes only those two local values. If a
fresh credential-free backend already has neither variable, skip that command
and its restoration counterpart. The fixture helpers refuse to write unless both
variables are absent, ports match 8083/8084 and the backend says `SPOT_ENV=local`.
CLI environment mutations strip ambient cloud selectors/deploy keys and pass an
explicit loopback URL/admin key read from the generated private local config.

`login.mjs` uses normal operator email-code sign-in and fresh local email capture;
it writes only a mode-0600 `.context/qa/skill-outcomes-sol/auth-private.json`.
`fixtures.mjs` reads that private state and looks up synthetic fixture IDs at run
time. `prepare-local.mjs` privately saves the original website and updates it
through the existing authorized mutation. It refuses to overwrite an unfinished
run's original snapshot. `boundary.mjs` creates the redacted fixture consumed by
`app-qa.mjs`. A stale auth snapshot requires another normal `login.mjs` run.

For a **fresh seeded backend with no prior Cove website-tech profile**, run
`access-qa.mjs` before `prepare-local.mjs` as well. It includes an explicit
pre-scan `websiteTech:null` assertion. On a reused local database that assertion
is not applicable; do not delete existing database contents to satisfy it. The
historical access evidence records that fresh-fixture case separately.

Always clean up, including after a failed assertion:

```sh
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/cleanup-local.mjs
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/isolate-local.mjs --restore
rm -f .context/qa/skill-outcomes-sol/auth-private.json
```

Run cleanup before restoring router credentials. Cleanup restores the original
fixture website, waits for automatic research to settle, and cancels prepared
local jobs through the existing mutation. It refuses jobs bearing a shared router
job ID. Restoration privately compares the original values, reports presence
only and deletes its private backup. If cleanup has not settled, keep credentials
isolated and inspect the local failure instead of restoring prematurely. When
isolation was skipped because no router values existed, skip `--restore` too.
If preparation never completed, inspect whether its private original snapshot
exists before invoking cleanup; do not fabricate a replacement snapshot.

Runtime outputs, auth/restoration data and raw local capture logs remain under
`.context`, never this committed directory. Historical JSON and screenshots are
copied evidence; replay scripts do not overwrite them. No product edits, provider
calls, HTTP/OAuth MCP acceptance or new unit tests are implied by this bundle.

## Focused request integration follow-up

The separate [2c1b6d4f offline request packet](integration-2c1b6d4f/integration-results.json)
checks the all-ten-name contract and explicit nine-skill Spot research request.
[Captures](integration-2c1b6d4f/request-results.json) distinguish identity/inbox
presence and trace/budget placement. The [replay script](integration-2c1b6d4f/check-request.mjs)
takes an exact-candidate checkout as its first argument and writes only `.context`
results; it uses the actual extracted request-construction source and imported
consumer serializer with in-memory seams, not a provider or full Convex action.
Previous browser evidence above remains historical; no new UI acceptance is implied.
