# Website tech skill outcomes — independent consumer QA

Status: **PASS for the skill-outcome consumer changes** and the focused offline
request integration below. Latest integration candidate:
`2c1b6d4fbb1570c065ea5e0470b74c74c41489bb` (isolated checkout; not production).
Historical actual UI tested Spot SHA:
`101b96ba4daa6ef77faf884e863c9ca566ac1035`. Initial behavioral SHA
`f96d921916515d75f14e4a181cd305221c9b46ea` failed two checks, both corrected
and retested on the final SHA. Setup baseline was
`0c8dda83ff64b32289271b23f652c8dce932e049`. A separate mobile app-shell overflow
remains open; full-shell mobile acceptance is not claimed. Branch:
`conductor/spot-skill-outcomes-qa`. The original UI packet covers consumption,
storage, presentation and access boundaries. The focused follow-up checks request
configuration/pin compatibility offline; final router corrections and production
provider execution remain separate work.

## Focused request integration — 2c1b6d4f

**PASS, scoped offline integration.** Exact Spot candidate
`2c1b6d4fbb1570c065ea5e0470b74c74c41489bb`, fetched from
`wkezhi/tech-stack-browse-trace` into a detached worktree. The QA branch and
previous evidence were preserved. Node `v24.14.1`. No app/backend startup,
shared/production/environment/fixture writes, provider calls, Vercel previews,
new unit tests or new browser runs occurred in this packet.

| Check | Result and evidence scope |
| --- | --- |
| Required contract check | PASS: **22 fixtures / 11 operations**. Includes extraction and all ten skill names. |
| Snapshot provenance | PASS: checked-in bytes match the snapshot fetched from exact router revision `add09df452266e94bc724d4c764aec45c07c1896`; SHA-256 `1a5f4f44362222bb14fe40d0088738a28f40f00747d1aafd286ef1f155267d2a`; provenance marks clean source. |
| Actual request construction | PASS: executed the actual `browseCompanySite`, goal and findings-schema source extracted with TypeScript, using in-memory identity/durable-options seams, through the actual candidate `clRouterBrowse` serializer. Every captured body passes strict Ajv validation against the pinned BrowseRequest schema. This is source-function/transport evidence, not the full Convex action or router runtime. |
| Exact selection | PASS: nine names below, no `account.cleanup`. The ten-name contract vocabulary intentionally still includes cleanup. |
| Trace and execution placement | PASS: tenantId injected; only tenantId/input/config/executionBudgetMs at the body root. `maxSteps:30` is inside input; root budget is `360000`. TraceId/channel/taskKind are passed to durable options with `taskKind:website_tech_browse`, absent from this action's request body. |
| Identity unavailable | PASS: identity-creation rejection is handled by the actual `settle` source; signup is omitted and the serialized request remains valid. Identity without inbox is also valid. Spot still requests the same nine names; router capability filtering is separate. |
| Optional config / old response | PASS: absent config remains absent and valid; an old response without skills is accepted. Explicit empty skill list also remains valid. These checks do not assert that router defaults exclude cleanup. |
| Research goal | PASS: enabled atomic procedures, observed-state CAPTCHA continuation, honest blockers, signup submission not proving account creation, no payment entry, and explicit no account deletion. |
| Root/Convex types and focused lint | PASS once on this exact isolated candidate. No full build or repeated full suite. |
| Prior UI evidence | **CARRIED, not rerun**: 15 app groups from actual UI candidate `101b96ba`. Eleven relevant UI/shared-style/storage/operator/tenant/package blobs are identical; exact hashes are preserved in integration-results.json. This is not whole-app, extraction behavior, router-runtime or post-release acceptance. |

The requested names, in order, are `site.find_pages`, `page.dismiss_overlays`,
`account.signup`, `account.sign_in`, `inbox.wait_for_email`,
`account.verify_email`, `account.enter_otp`, `challenge.captcha`, and
`checkout.observe_payment`.

Exact-pin router **source review only** confirms that
[capabilities derive from signup, accepted inbox and configured Jev](https://github.com/claritylabs-inc/cl-router/blob/add09df452266e94bc724d4c764aec45c07c1896/packages/server/src/browse/index.ts#L224),
then [registry selection intersects requested names with every required capability](https://github.com/claritylabs-inc/cl-router/blob/add09df452266e94bc724d4c764aec45c07c1896/packages/server/src/skills/registry.ts#L22).
Signup/sign-in require identity and Jev; email verification/code entry require
identity, inbox and Jev; inbox selection requires inbox and Jev. Missing identity
is therefore a valid Spot request, not a promise those procedures will be offered.
The [omitted-config defaults contain all ten names](https://github.com/claritylabs-inc/cl-router/blob/add09df452266e94bc724d4c764aec45c07c1896/packages/server/src/skills/catalog.ts#L19),
including cleanup; Spot's explicit nine-name list is the exclusion boundary for
this research flow. Router corrections are still pending, and this pin is not a
production/provider acceptance claim.

Durable evidence:
[request captures](artifacts/website-tech-skill-outcomes-2026-10-20/integration-2c1b6d4f/request-results.json),
[provenance, source carry and checks](artifacts/website-tech-skill-outcomes-2026-10-20/integration-2c1b6d4f/integration-results.json),
and [offline replay script](artifacts/website-tech-skill-outcomes-2026-10-20/integration-2c1b6d4f/check-request.mjs).
Captured JSON stores field presence, names and placement only; generated test
passwords/inbox capabilities and full signup payloads are never persisted.

Reproduction from the repository root, with dependencies available in a separate
checkout pinned to the exact candidate:

```sh
node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/integration-2c1b6d4f/check-request.mjs /absolute/path/to/exact-candidate-checkout
```

The script verifies the checkout SHA and writes only gitignored runtime results.
In that candidate checkout, this packet also ran `npm run check:cl-router-contract`,
`npx tsc --noEmit`, `npx tsc --noEmit -p convex/tsconfig.json`, and
`npx eslint convex/actions/websiteTech.ts convex/lib/clRouterClient.ts contracts/cl-router/policy.ts scripts/check-cl-router-contract.mjs`.
All exited 0. The separate existing 416px mobile shell overflow at 390px remains
open; no shell fix or new mobile acceptance was included.

## Lane and fixture

Node `v24.14.1`; native-local Convex HTTP/site ports `8083`/`8084`; Next at
`localhost:8080`; headed Google Chrome on Xvfb `:99`. Normal seeded operator
sign-in used a fresh locally captured OTP. The actual route is
`/operator/clients/<local-fixture-id>/wiki`, Tech stack tab. No invented page
markup, hosted previews, production/shared-development writes or deployments.

Initial setup inherited router credentials. With manager authorization, this
packet removed only `CL_ROUTER_URL`/`CL_ROUTER_SECRET` from the verified local
backend, keeping restoration values in a mode-0600 private file. Every environment
or fixture mutation checks the explicit loopback backend and `SPOT_ENV=local`;
ambient cloud selectors/deploy keys are excluded. Shared hosted settings and
tracked router configuration remain unchanged.

The existing synthetic Cove fixture temporarily uses `https://skill-qa.example`.
Fixtures use authorized `operator.updateClientSettings`, authenticated
`websiteTech.rescanForOperator`, and existing internal `websiteTech.claim` /
`websiteTech.finish`; no product files or new seed endpoints were added. A bounded
helper wins the scheduled action race and verifies each saved result. Real Rescan
runs to its genuine failure with router credentials absent. Such a failure proves
consumer live updates and fail-closed presentation, not successful browsing.

A scratch harness importing the actual `WebsiteTechSection` and app CSS was used
while isolation was pending. Its results are supplementary; the populated
presentation scenarios below were subsequently repeated in the authenticated app.

## Historical UI packet scenarios — 101b96ba

| ID | Final outcome | Evidence / scope |
| --- | --- | --- |
| UI-01 | PASS | Fresh OTP operator login, actual Profile → Tech stack; not-scanned state. |
| UI-02 | PASS | All ten exact labels: Account signup, Sign in, Email verification, Verification code, Account cleanup, Verification email, CAPTCHA, Site pages, Page overlays, Payment page. |
| UI-03 | PASS | Unknown `custom.new_workflow`, `constructor`, `toString` render readable fallbacks; no inherited-map resolution. |
| UI-04 | PASS | `succeeded`/`blocked`/`failed`/`skipped` render Completed/Blocked/Failed/Skipped badges. |
| UI-05 | PASS | No-findings and failed scans retain Browser research and skill outcomes. |
| UI-06 | PASS | Legacy missing browse has no Site visit; browse without skills retains Site visit and a distinct no-outcomes message. |
| UI-07 | PASS | Zero observed steps says No steps recorded; finished/partial visits and singular/plural step labels render correctly. |
| UI-08 | PASS | Forty skill rows plus one Site visit, persisted and rendered in the real app. |
| UI-09 | PASS after correction | At 390px, valid unbroken 100-character name and 500-character summary wrap inside the card. Measured text right edges 145.69px and 346.25px stay inside card edge 366px. Ordinary summaries render in light/dark modes. |
| UI-10 | PASS | Actual navbar Rescan visibly transitions Scanning → terminal failed without reload. Browser research hides while scanning and returns afterward. |
| UI-11 | PASS | Keyboard Tech stack entry and reload retain saved outcomes. |
| SHELL-01 | FAIL, separate existing chrome | Inner app-shell wrapper is 416px in a 390px viewport even with ordinary skills. Navbar right edge clips; see separate observation below. Not fixed by the skill-row-only correction. |
| BND-01 | PASS | Imported actual `clRouterBrowse`, synthetic durable response: old response without skills accepted. |
| BND-02 | PASS | Forty skills accepted, forty-one rejected; name >100, version >40, summary >500, invalid statuses/types, fractional/negative steps and non-array skills rejected. All four statuses and zero steps accepted. |
| BND-03 | PASS, narrower | Actual `skillOutcomes` source extracted/transpiled and executed with synthetic inputs: extra keys dropped; at most 40 entries. This is source-function execution, not a provider-backed full action. |
| BND-04 | PASS | Synthetic inbox capability, verification URL tokens, test address, other email and random password are removed by the source function. Its projected output is then saved through actual local `finish` and read back through the operator tool. No credentials are retained in report artifacts. |
| TOOL-01 | PASS | Actual local `operatorAgent.invokeRegisteredToolInternal`, channel `mcp`: `get_organization.websiteTech.browse.skills` exactly matches saved sanitized skills. |
| TOOL-02 | PASS | Same authorized registered executor: `research_client_tech_stack` queues a run and returns saved skills under `current.browse.skills`. |
| ACCESS-01 | PASS | Anonymous and normally signed-in tenant queries denied; client actor rejected by registered operator executor. |
| ACCESS-02 | PASS | Actual imported tenant catalog excludes both operator tools; tenant dispatcher rejects both even with write scope. |
| MCP-HTTP | NOT RUN | No local OAuth/HTTP MCP transport integration. TOOL results prove the actual shared registered executor, not end-to-end MCP transport. |
| CONTRACT | PASS after correction | Required offline command validates 19 fixtures / 10 operations. Fixture now includes synthetic tenantId, matching actual runtime consumer serialization. |
| ROUTER-LIVE | NOT RUN | Original UI packet snapshot `a8df40fd3c673b6bc4fcaf6904f80965a7fffe6e` only knew the inbox skill. The newer nine-skill request/pin is checked in the focused integration section above; real router/provider results remain untested. |

## Findings and correction evidence

1. **RESOLVED: contract fixture lacked tenantId.** On initial behavioral SHA f96d9219 and Node 24, run
   `npm run check:cl-router-contract`. It exits 1:
   `Spot website research with inbox skill is invalid: / must have required property 'tenantId'`.
   The fixture is at `contracts/cl-router/fixtures.v1.json:636`. This does not
   demonstrate a transport defect: a separate runtime capture of the real consumer
   serializer includes tenantId and passes the checked-in schema. Manager supplied
   fixture correction `e4cfc3daaf82797e9168d516c81daf6ba62dcb3f`, cherry-picked
   as `101b96ba`. The required command passes on the final candidate.
2. **RESOLVED: skill text clipping.** On f96d9219, store one otherwise-valid skill with name
   `'x'.repeat(100)` and summary `'y'.repeat(500)` through the existing local
   finish path. At a 390px viewport, open actual Profile → Tech stack. Both text
   runs cross the card's right edge and are hidden. The skill summary container
   in `website-tech-section.tsx` and the shared inline label have no emergency
   wrapping for unbroken text. The procedure label also collides with the status
   area. [app-long-mobile-initial-f96d9219.png](artifacts/website-tech-skill-outcomes-2026-10-20/screenshots/app-long-mobile-initial-f96d9219.png) reproduces the initial failure.
   Correction `49555270` adds wrapping within the skill label/value; final
   [app-long-mobile.png](artifacts/website-tech-skill-outcomes-2026-10-20/screenshots/app-long-mobile.png) and [overflow-geometry.json](artifacts/website-tech-skill-outcomes-2026-10-20/results/overflow-geometry.json) show both text runs within
   the card. All 15 app check groups pass on 101b96ba. No product changes were
   authored in this QA workspace.
3. **OPEN, separate mobile shell observation.** Even ordinary skills have a 416px-wide
   inner app-shell wrapper in a 390px viewport. Navbar actions exceed the visible
   right edge and an inner horizontal scrollbar appears. Document-level
   `scrollWidth` alone misses this; earlier document-only assertions are not
   whole-shell acceptance. [app-inner-overflow.json](artifacts/website-tech-skill-outcomes-2026-10-20/results/app-inner-overflow.json) identifies the overflowing
   wrapper. This observation is distinct from skill text wrapping and needs
   manager scope/triage; it is not silently counted as a passing mobile shell.

## Historical UI packet commands and results

Script rows below use their durable replay paths. Recorded behavior comes from
the original `.context` copies; relocated copies were statically checked only.

| Command | Result |
| --- | --- |
| `node --version` | `v24.14.1` |
| `npm run check:cl-router-contract` | PASS on final SHA: 19 fixtures, 10 operations; initial failure preserved in [validation.json](artifacts/website-tech-skill-outcomes-2026-10-20/results/validation.json). |
| `npx tsc --noEmit` | PASS on final SHA. |
| `npx tsc --noEmit -p convex/tsconfig.json` | PASS on final SHA. |
| Focused ESLint: website-tech-section, websiteTech action/library, clRouterClient, websiteTech mutations | PASS on final SHA. |
| `npm test` | PASS: 18 files, 127 tests on f96d9219. Final delta is only skill-row wrapping and fixture tenantId; no new unit tests written. |
| `node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/boundary.mjs` | PASS: 8 grouped consumer checks. |
| `node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/request-contract-diagnostic.mjs` | PASS: actual consumer request matches pinned schema. |
| `node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/access-qa.mjs` | PASS: 5 grouped access/catalog checks. |
| `node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/app-qa.mjs` | PASS: all 15 groups on final SHA; initial 14 PASS / 1 clipping FAIL retained separately. |
| `node docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/app-followup.mjs` | PASS: keyboard, reload, scan/card lifecycle; separate inner-overflow observation. |
| `git diff --check` | PASS before report delivery. |

No broad production build or deployment was run. The existing suite emitted its
usual mocked-provider stderr and a timer warning but passed all tests. Memory
sampling remained above 6.5 GiB available during browser/check work. One saved
auth snapshot expired during final setup; normal fresh OTP sign-in restored the
lane before repeating acceptance. That interrupted attempt is not a product failure.

## Artifacts and cleanup

Durable evidence is committed under
[artifacts/website-tech-skill-outcomes-2026-10-20/](artifacts/website-tech-skill-outcomes-2026-10-20/README.md).
The [replay guide](artifacts/website-tech-skill-outcomes-2026-10-20/README.md#normal-local-prerequisites)
documents normal native-local setup, fresh OTP authentication, private generated
inputs, fixture preparation, execution order and restoration. Scripts write only
to the gitignored runtime directory; no private files from this workspace are
required. This preservation update performed no new behavioral runs. Relocated
scripts received import-path, provenance, unique-invocation-key and preparation
adjustments; only static syntax/import/link/content checks were run on the copies.

| Preserved evidence | Relative link |
| --- | --- |
| Final / initial app scenarios | [Final](artifacts/website-tech-skill-outcomes-2026-10-20/results/app-results.json), [initial f96d9219](artifacts/website-tech-skill-outcomes-2026-10-20/results/app-results-initial-f96d9219.json) |
| Consumer bounds and redaction | [Results](artifacts/website-tech-skill-outcomes-2026-10-20/results/boundary-results.json), [sanitized fixture](artifacts/website-tech-skill-outcomes-2026-10-20/results/projected-fixture.json) |
| Access / request contract | [Access](artifacts/website-tech-skill-outcomes-2026-10-20/results/access-results.json), [request](artifacts/website-tech-skill-outcomes-2026-10-20/results/request-contract-diagnostic.json) |
| Live Rescan / keyboard and reload | [Transitions](artifacts/website-tech-skill-outcomes-2026-10-20/results/app-rescan-transitions.json), [follow-up](artifacts/website-tech-skill-outcomes-2026-10-20/results/app-followup-results.json) |
| Geometry before / after | [Initial](artifacts/website-tech-skill-outcomes-2026-10-20/results/overflow-geometry-initial-f96d9219.json), [corrected](artifacts/website-tech-skill-outcomes-2026-10-20/results/overflow-geometry.json) |
| Separate existing mobile shell issue | [416px inner wrapper at 390px](artifacts/website-tech-skill-outcomes-2026-10-20/results/app-inner-overflow.json) |
| Validation / cleanup | [Commands and restoration](artifacts/website-tech-skill-outcomes-2026-10-20/results/validation.json), [cleanup](artifacts/website-tech-skill-outcomes-2026-10-20/results/cleanup-results.json) |
| Actual synthetic UI screenshots | [Desktop](artifacts/website-tech-skill-outcomes-2026-10-20/screenshots/app-known-desktop.png), [initial clipping](artifacts/website-tech-skill-outcomes-2026-10-20/screenshots/app-long-mobile-initial-f96d9219.png), [corrected wrapping](artifacts/website-tech-skill-outcomes-2026-10-20/screenshots/app-long-mobile.png) |

The original synthetic fixture website is restored, automatic research has
settled, and 50 prepared local router jobs were cancelled before restoring
credentials. No shared router job IDs were created. Both native-local router
variables were restored and privately compared with their original values;
presence only is reported. The mode-0600 restoration file and browser-auth
snapshots were removed. Named synthetic scan/audit rows remain only in the local
database. Private values, cookies, JWTs, OTPs and passwords are not committed.

Final delivery commit and branch are supplied with the handoff; this report itself
contains only sanitized evidence. HTTP/OAuth MCP integration and final router
skill configuration/provider execution remain outside this consumer verdict.
