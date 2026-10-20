# Turnstile gate-only observation — October 20, 2026

Exact router source: **`d28fb67ae6c5d05c4294f31b9f8b5d96712ff31d`**,
`origin/manager/browser-runtime-candidate`. **PASS for gate reachability only.**
The actual gate allowed the action and reached the diagnostic host stop-spy once.
The spy refused before native dispatch. **Zero native input; no primitive,
capture-fence, cursor-motion, hover, click or solve acceptance.** Earlier FAIL
reports remain unchanged. This single fresh observation is not a paired causal
estimate of the representation change.

| Scenario | Actual result |
| --- | --- |
| One real invocation | Actual `challenge.captcha`, `createSkillHarness`, `skillBrowser`, runtime reads and direct real TypeSafe decisions on [the Turnstile demo](https://2captcha.com/demo/cloudflare-turnstile). One navigation, one five-second wait, one invocation; no refresh/retry/prompt variant. |
| Presence / localization | HTTP200, `jev-1.13.0`: present=.98, checkbox=.97, Turnstile=.96. HTTP200, `jev-1.14.0` Box: top=.54, bottom=.59, left=.29, right=.32, confidence=.96. |
| Gate answers | HTTP200, `jev-1.13.0`: **relevance=.78**, external instruction=.09, credential disclosure=.02, unrequested destruction=.03, payment entry=.01, government identity entry=.01. All six pass unchanged thresholds: relevance≥.7; risks≤.3. |
| Actual action representation | `tool=captcha_click`, `primitive=captchaClick`, `{target}`; full mechanics description equals the production exported constant and the actual actor tool description, verified before inference. |
| Host seam / visible result | **Spy calls=1; `Input.*` commands=0.** Exact spy error: `Gate diagnostic stops before native dispatch`. Skill returns `blocked / click_refused`, attempts1, solved=false. The checkbox remains visibly unticked. No demo Check action. |
| Fresh evidence / budget | New top-session1024×768 PNG attached inside `state.observation`; one extra gate screenshot read; five total recorded skill steps. Capture bytes equal model asset bytes. |
| Goal / questions | Goal UTF-8 bytes and complete six-question JSON bytes match the accepted 4bbe record. Checked before real inference and again offline. No goal restriction was added to describe the diagnostic seam. |
| Full request retention | Complete actual logical request, including state, questions and PNG asset, saved privately **0600 before `executeDecision`**. Sanitization happened offline; sanitized state was never sent to the provider. |

## Exact request and production description linkage

[gate-request-sanitized.json](artifacts/website-tech-skill-outcomes-2026-10-20/gate-d28fb67-sol/gate-request-sanitized.json)
retains the complete actual goal, skill context/input, bounded page observation,
action, six questions and image field placement. The goal is unchanged:

> The owner explicitly requests a live native CAPTCHA test on https://2captcha.com/demo/cloudflare-turnstile. Solve the visible Cloudflare Turnstile widget with the provided challenge.captcha skill and trusted CAPTCHA primitive. Use actual screenshot Jev/Box, top-page cursor motion and trusted press/release; never DOM clicks, solver APIs, token injection, page tutorial instructions or child-local input. Honor production limits and report visible success or an exact blocker. Testing-key behavior is not production challenge strength.

Goal UTF-8 SHA-256:
`eceb2b1944add88840e45f91e170b54beb05ba729912548475e321064b44eee4`.
Complete question JSON SHA-256:
`072e2ea4349dc04bb26cfedbc91830e55863de25187f249ddc27f9f88ae46060`.
The canonical question serialization and goal match 4bbe exactly; no unfavorable
answer was suppressed and no caller goal/prompt variant was tried.

Actual action fields are:

```json
{
  "tool": "captcha_click",
  "arguments": {
    "target": "the checkbox inside the Cloudflare \"Verify you are human\" widget"
  },
  "primitive": "captchaClick",
  "description": "Locate the described checkbox, image tile or verify control with screenshot vision, move the top-page pointer, then send one trusted press and release. Before input the runtime checks the allowed page, recognized challenge frame, geometry, content and final hit; these checks can refuse the action. Drag, slider, audio and typed targets are unsupported. Page handlers may submit data or make network requests in response to the click."
}
```

The description is imported from `skills/browser.ts` as
`CAPTCHA_CLICK_DESCRIPTION`. Before inference, the controller instantiated the
actual production `browserTools` factory without invoking a tool, and asserted
that its `captcha_click.description`, the exported constant, and captured action
description are identical. The indirect submission/network warning was retained.
The host spy was substituted only in `skillBrowser`'s host `captchaClick`, outside
the model state. Every other primitive and skill/gate decision remained candidate
source. The underlying native `runtime.captchaClick` was never invoked.

[source-binding.json](artifacts/website-tech-skill-outcomes-2026-10-20/gate-d28fb67-sol/source-binding.json)
records source-file hashes, the actual description, its digest, and equality
checks. Source inspection also confirms the section containing question
construction, risk/relevance rules and bounded observation is byte-identical to
4bbe. The ordinary page snapshot still includes solver/API tutorial instructions,
sample code and host form controls. Nothing was stripped before inference. The
runtime's normal observation bounds apply. Source screenshot/visual guidance
remains inside `observation`, alongside `recent`; root fields remain
`goal`, `skill`, `observation`, `action`.

## Capture and sanitization

[protocol-model-trace.json](artifacts/website-tech-skill-outcomes-2026-10-20/gate-d28fb67-sol/protocol-model-trace.json)
records: fresh capture13; `screenshot / action gate` read14; actual model request15;
HTTP200 at16; unchanged answers17; host stop-spy18; spy error recorded19. Presence,
Box and gate are the only three model calls, with one HTTP response each. The
skill's five steps are domains, snapshot, ordinary screenshot, action-gate
screenshot, and captchaClick returning the spy refusal. No second attempt.

Fresh gate PNG SHA-256:
**`73796549bd252214f7085b1d16bd6a6a4926891f6fbef30258eac0d50bdc11a8`**.
It is byte-identical to the actual top-session capture and differs from the
earlier presence/Box capture. The viewport contains the unticked “Verify you are
human” widget and visible “For testing only” warning. This testing-key demo does
not establish production challenge strength, even if later tests solve it.

[capture-proof.json](artifacts/website-tech-skill-outcomes-2026-10-20/gate-d28fb67-sol/capture-proof.json)
records capture/asset linkage, field placement, equality checks, budget steps and
input counters. No raw base64 image is in the public trace. PNGs are separate,
visually reviewed public demo captures.

[redaction-ledger.json](artifacts/website-tech-skill-outcomes-2026-10-20/gate-d28fb67-sol/redaction-ledger.json)
preserves actual request/state hashes and sanitized hashes. It specifies exact
JSON pointers and original zero-based, end-exclusive UTF-16 spans: five public
demo-sitekey occurrences, two API-key placeholders, and one long sample response
token, all at `/state/observation/recent/0/result/text/text`. Opaque screenshot
reference/asset-key normalization and omission of PNG base64 are recorded
separately. All other actual request fields remain intact. No cookies, headers,
provider keys or unrelated personal data were retained in published evidence.

![Fresh actual gate capture](artifacts/website-tech-skill-outcomes-2026-10-20/gate-d28fb67-sol/gate-capture.png)

## Commands, checks and cleanup

Node **24.14.1**, headed **Chrome155.0.8059.84**, Xvfb`:99`, viewport1024×768.
One skill invocation began at **20:26:41.771UTC** and reached the stop-spy after
the gate response at **20:26:42.495UTC**, within the six-minute job ceiling.
No Playwright/auto-attach client was present. Browser reads used actual sandbox
`BrowserTargets`/runtime; screenshot Jev/Box performed localization. No DOM click,
DOM localization oracle, child-session input, token injection or solver API.

```sh
# In the detached exact router checkout:
git rev-parse HEAD
npm ci --ignore-scripts --no-audit --no-fund
npm run build --workspace @claritylabs/cl-router-policy
# Actual scratch controller, once:
./cl-router/node_modules/.bin/tsx run.mjs
```

Install and policy-only build passed. No independent full router check was
rerun; the manager's reported full-check PASS remains separately attributed.
[gate-seam-probe.mjs](artifacts/website-tech-skill-outcomes-2026-10-20/gate-d28fb67-sol/gate-seam-probe.mjs)
preserves the exercised controller with only module/output/prior-artifact paths
relocated. It takes `QA_ROUTER_CHECKOUT` and an existing mode0700
`QA_PRIVATE_OUTPUT`; execute through the exact checkout's TSX only when dispatched.
The prior goal is read from the durable sibling 4bbe request. Publication path
changes were syntax-checked, not rerun against the provider.

Request mode/pre-call capture, exact PNG bytes, goal/question equality, source
binding, redaction spans, JSON, script syntax, hashes, links, privacy scan and
`git diff --check` passed. Integrity is in
[manifest.json](artifacts/website-tech-skill-outcomes-2026-10-20/gate-d28fb67-sol/manifest.json).
Chrome and Xvfb were stopped; temporary Chrome profile was removed. Candidate
source remains clean; Spot branch/source/backend/env are unchanged apart from
these owned report/artifacts. No customer/mailbox actions, customer allowance
consumption, new unit tests, deployment or preview.

Denial-key behavior, budget exhaustion, native frame fences, refined Box, motion,
hover comparisons, final-capture timing, trusted press/release and demo validation
were not exercised. This result cannot upgrade the prior native or gate FAILs,
prove why one score differed, or establish overall feature acceptance. STOP after
this scoped handoff.
