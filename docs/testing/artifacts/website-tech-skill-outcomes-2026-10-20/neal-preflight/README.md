# Live CAPTCHA site preflight — October 20, 2026

**Candidate-independent browser inventory, not product/runtime acceptance.**
Primary target changed by owner steering to [2Captcha demos](https://2captcha.com/demo).
Neal observations are secondary only; no further Neal play followed that steering.
Headed Google Chrome **155.0.8059.84**, Xvfb `:99`, 1280×900 CSS-pixel viewport.
Neal inspection began about 18:58 UTC; primary demo interaction ran about
19:03–19:06 UTC. Both stayed within their bounded windows. No Spot app/backend,
environment or fixture changes, product edits, deployments or unit tests.

## Primary: actual provider demos

| Observed surface | Actual controls / result | Scope fit |
| --- | --- | --- |
| [reCAPTCHA v2](https://2captcha.com/demo/recaptcha-v2) | Real Google `api2/anchor` iframe, 304×78 at (345,282). Checkbox is a frame-local `span[role=checkbox]`, 28×28 at (13,22.5). Ordinary top-page click at (372,319) opened the challenge. | Provider checkbox is a suitable final native localization/motion target. |
| v2 challenge | Distinct Google `api2/bframe`, 400×580 at (397,29.5), titled “recaptcha challenge expires in two minutes.” Prompt: crosswalks, 3×3 grid, Verify, refresh/audio/info controls. | Suitable bounded grid/replanning test, not a promise the next round is static or identical. |
| One grid tile | Top-left tile clicked at (467,220); screenshot after a 1500ms post-release wait shows a selected/faded check overlay with the original crosswalk image still recognizable. | **No new replacement image or replacement latency was captured before navigation.** No Verify/completion attempt. Existing skill supports up to three replacement plans per manager update; this preflight did not exercise that runtime or budget. |
| [Turnstile](https://2captcha.com/demo/cloudflare-turnstile) | Actual `challenges.cloudflare.com` attached frame; 300×65 host widget at (347,352), explicitly marked testing-only. Click (368,385); after 1800ms wait screenshot shows Success. | Suitable ordinary provider-checkbox/crop target; test-key behavior does not establish production challenge capability. |
| Turnstile page Check | Separate host button at roughly (367,457), 120×40. Click (427,477) produced visible success; returned metadata explicitly says `result_with_testing_key:true`, `success:true`, no error codes. | Distinguishes provider widget success from the demo form's validation. No paid API or token injection used. |

The v2 grid cells were 130×130 frame-local CSS pixels, starting at (5,125).
Verify was frame-local (292,530), 100×42. The challenge popup is **not** at the
anchor's origin. Those measurements explain the geometry; they must not become
cached answers or hard-coded coordinates in final candidate QA. Frame border,
viewport clip, scaling and relocation must be resolved from current observations.

The grid instruction asked to verify when no matching images remain. Only one
selected-tile state was observed; do not infer a replacement sequence from the
instruction alone. Refresh/audio controls were visible but not invoked. No audio,
drag/rotation, sequential-image, invisible-v2 or other demo variants were tested.

Turnstile was absent from a main-document `querySelectorAll('iframe')` result but
present in Playwright's attached-frame inventory. That is useful coverage for the
current protocol + `DOM.getFrameOwner` discovery path, not proof of a new product
defect. Shadow containment is a plausible explanation; shadow mode was not proved
by DOM inspection. Unrelated support-chat frames must not become CAPTCHA targets.

## Secondary: Neal game, limited observation

[Neal's game](https://neal.fun/not-a-robot/) initially rendered **Level 1: Checkbox**.
The visible checkbox is a first-party main-document custom
`div.captcha-box-checkbox-input`, 27×27 at (497.5,159.5), without an input checkbox
or checkbox role. It is drawn in reCAPTCHA's style but is not the Google frame.
A Google `api2/aframe` was present at **0×0**, alongside advertising/sync frames;
a visible ad frame occupied (1120,120), 160×600. Matching provider URLs alone is
insufficient to establish that the visible first-party widget is targeted.

No game level was completed, and no subsequent game puzzle type was observed.
A fresh session encountered a separate Cloudflare “Verify you are human” gate
before the game; a normal click reached a verifying state. CDP reconnect/tab
selection also encountered auxiliary advertisement targets and a zero-width
capture error; those attempts are not accepted game interactions or native bugs.
Neal play stopped when the owner selected 2Captcha as primary. Its custom game
mechanics must not be treated as generic CAPTCHA-provider requirements.

## Final native replay to dispatch later

1. Use the exact final actor/skill candidate in a fresh visible session on the v2
   demo. Observe the actual provider anchor and initialize the first cursor
   position in the upper **content viewport**, never browser chrome.
2. Use actual Jev/Box screenshot localization and the candidate's crop/coordinate
   mapping. Dispatch the real **top-page CDP trajectory plus trusted press and
   release**, continuing from the previous pointer position. No DOM coordinate
   oracle, DOM.click, token injection, child-session input or puzzle-state shortcut
   may stand in for localization/motion evidence.
3. Re-observe the independently positioned challenge. If a grid appears, use its
   current prompt/cells. Record before/after images and timing for each tile,
   replacement or lack of replacement, and the actual bounded plan count (up to
   three). If the provider returns a different or unsupported puzzle, report it;
   do not force a particular round or claim completion from selected highlights.
4. Separately run the Turnstile demo: protocol/frame-owner discovery, actual
   widget crop, Box target, motion/click, visible provider success, then ordinary
   host Check and testing-key result. Keep test-key limitations explicit.
5. Treat Neal first-party discovery as a separate optional coverage case. A
   provider-iframe-only `captchaClick` path need not recognize a custom game DIV;
   do not attribute that gap to iframe coordinate clipping.

## Method and durable evidence

Preflight used ordinary **top-page Playwright** `mouse.move`, `mouse.down` and
`mouse.up`, not the product actor or skill. The first demo pointer started near
(433.86,23.77); subsequent movements started at the preceding endpoint, including
across demo navigation. The helper configured 24–35 interpolated movements (28–35 observed), a random
curved offset, variable per-step waits and separate press/release. This records
ordinary control mechanics only: no raw CDP trajectory/isTrusted event audit was
captured, and no Jev/Box/native-motion success is claimed. DOM/frame inspection was
read-only and helped identify geometry; it is not final localization evidence.

- [Sanitized inventory and measured geometry](inventory.json)
- [Observed pointer endpoints/step counts](motion-summary.json)
- [v2 grid before tile click](primary-v2-grid.png)
- [v2 selected tile after 1500ms wait](primary-v2-selected-tile.png)
- [Turnstile checkbox](primary-turnstile-checkbox.png)
- [Turnstile widget + demo validation success](primary-turnstile-verified.png)
- [Neal first-party checkbox](secondary-neal-checkbox.png)

Screenshots are actual public pages. Public demo sitekeys/test-key labels are
visible in some page examples; no private credentials, response tokens, cookies,
profiles, raw page dumps, solver API calls or session-bearing frame URLs are
preserved. No accounts, extensions, payment or paid 2Captcha integration were used.
The site's API/token-injection tutorial content was not followed. Actionable
findings were sent to the parent manager through Conductor; no workers dispatched.

## Readiness retained for the next bounded form packet

The owner separately authorized one synthetic registration at
[Bankers Almanac beta](https://beta.validate.bankersalmanac.com/ba-mgmt/registration/new-user)
and one clearly marked authorized test submission per
[Pearson Canada](https://www.pearson.com/en-ca/work/forms/contact-us.html) and
[Pearson Netherlands](https://www.pearson.com/nl/en_NL/higher-education/Custom-solutions/custom-contact-form.html).
**No visits or submissions to these forms were performed in this preflight.**
Use randomized identity and an actually controlled email address, the explicit
“Authorized test / no action needed” message, and no invented third-party email
or phone. A timed-out or ambiguous submission must be reconciled before retrying;
this authorization does not permit casual duplicate writes. Final actor source
and the next packet's scope are still pending.

Read-only inspection of the retained native-local SQLite configuration on
October 20 found `SPOT_ENV=local`, `EMAIL_DELIVERY_MODE=capture`, and nonempty
`CL_ROUTER_URL`, `CL_ROUTER_SECRET`, `AUTH_RESEND_KEY` and
`RESEND_WEBHOOK_SECRET`. Values were neither printed nor copied. Local backend
configuration retains ports 8083/8084; Next, Convex and browser CDP listeners are
stopped. No environment, fixture or service was changed for this check.

This establishes **configuration presence only**, not a working live Jev
connection or external mailbox. Existing research-inbox source can issue a
30-minute research-domain address/capability, accept mail only for a live issued
address, and retrieve verification content through Resend. Local email capture
is for local app authentication and does not itself route external registration
mail into this backend. No current inbox was issued, public webhook routing was
not verified, and no controlled test phone was established. Before the authorized
form writes, the next runtime packet must establish a live controlled inbox path
and actual Jev/Box connectivity without disclosing capabilities or secrets; if a
mandatory phone cannot be supplied from controlled test data, record that blocker.
No production configuration or cookies were inspected or extracted.
