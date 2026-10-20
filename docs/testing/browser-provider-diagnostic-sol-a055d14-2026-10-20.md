# Preserved-pixel hover diagnostic — October 20, 2026

Exact router: **`a055d14d7bf565946e5e547117781e89c81777e3`**, detached scratch checkout of
`origin/manager/browser-runtime-candidate`. **FAIL: the original recorded native
Box does not contain the recorded pixel change within the candidate's margin.**
The unchanged `cosmeticHover` closure returned `false` before constructing a
request. **One closure invocation; zero `executeDecision` calls; zero provider
requests.** Six-question provider discrimination is **BLOCKED / NOT TESTED**.
Native clicking and challenge solving are **NOT TESTED**.

| Check | Observed result |
| --- | --- |
| Original geometry provenance | PASS: retained 96d native Box at trace sequence 52, screenshot 1024×768; anchor content quad at sequences 49 and 69. No inferred DOM target, altered coordinates, or skill-level Box substituted. |
| Original image bytes | PASS: both exact 304×78 PNG hashes match the private originals and durable 96d artifacts. The before crop's decoded pixels also exactly equal its region in the recorded native Box screenshot. |
| Located rectangle | Actual candidate formula applied to original native Box: x=307.2, y=353.28000000000003, width=30.720000000000027, height=38.39999999999999. |
| Candidate region | Crop coordinates **x=[20,59), y=[17,64)**, with unchanged 4-pixel margin. |
| Actual differences | 300 changed RGBA pixels; inclusive crop bounds **x=13…40, y=23…50**; **108 pixels outside** the candidate region. |
| Actual closure result | `false`, at `left < region.x` (**13 < 20**), before canvas/image/question construction. |
| Provider / answers | No HTTP request, status, selected model, logical request state, or answers exist for this run. Source-declared questions are retained separately, explicitly unreached. |

This is a concrete deterministic blocker for **these original inputs**. The
recorded native Box's left edge is 11.2 pixels to the right of the leftmost
changed pixel in viewport coordinates; its 4-pixel margin does not cover that
change. The closure's fail-closed containment works as written, while replay of
this previously observed hover cannot reach the new semantic comparison. No
rectangle was enlarged or moved, no margin/threshold was changed, and no alternate
Box or provider request was tried. This does not establish a general failure
rate or authorize weakening the containment rule.

## Evidence and exact mappings

The original target is:

> the unticked CAPTCHA checkbox labeled I'm not a robot or Verify you are human

The **native** sequence-52 answer is
`{top:0.46,bottom:0.51,left:0.30,right:0.33}`, confidence **.93**, from real
`jev-1.14.0`. It is bound to screenshot SHA-256
`b5b3ff95dd1cb6a5076618f7fb8cbf04eb50f519ed777a07b42e97536a92ffee`.
The different preceding skill-level Box was not used. The recorded frame content
quad is `[282.5,332,586.5,332,586.5,410,282.5,410]`; source rounding produces
visible crop **(283,332,304,78)**. Original normalized Box, target, geometry,
questions and image bytes in the durable trace were compared with the privately
retained original trace/files; relevant values and bytes match exactly.

| Image / mapping | SHA-256 or exact coordinates |
| --- | --- |
| Original before PNG | `11f676baf297afd5985984ad19924902304ddd77c27455c69b3c52aff0ecac94` |
| Original after PNG | `17ce9f58c431c43bc6d4383c3276a255cf529fa4f7f7f23b9204412b062d9f5d` |
| Original crop pixel `(u,v)` → viewport | `(283+u,332+v)`, 0≤u<304, 0≤v<78. Changed bounds map to viewport x=296…323, y=355…382. |
| Full-frame padding, source only | Would copy each original pixel unscaled at `(283+u,332+v)` onto opaque `#808080` 1024×768. **Not generated or sent:** early return precedes padding. |
| Target region, source only | Would use original crop x=[20,59), y=[17,64), size39×47, integer scale8, occupying top-left312×376 on gray1024×768. Target output pixel `(p,q)` would sample crop `(20+floor(p/8),17+floor(q/8))`. **Not generated or sent.** |

The following are the unchanged original crops, linked from the immutable 96d
bundle, rather than newly synthesized transport images:

![Original before crop](artifacts/website-tech-skill-outcomes-2026-10-20/live-96d1db5-sol/v2-hover-before.png)

![Original after crop](artifacts/website-tech-skill-outcomes-2026-10-20/live-96d1db5-sol/v2-hover-after.png)

The actual extracted closure SHA-256 is
**`8ba7534171851d4d74e0ecb29e800943530ed19a01d43f6aa24ff2315a4d43aa`**.
[Source extraction](artifacts/website-tech-skill-outcomes-2026-10-20/diagnostic-a055d14-sol/source-extraction.json)
records the entire source-file hash, exact constants and Box-to-Rect formula.
The [verbatim closure](artifacts/website-tech-skill-outcomes-2026-10-20/diagnostic-a055d14-sol/cosmetic-closure.ts.txt)
retains all six source questions and scopes; all require **.9**, unchanged.

| Source question ID | Exact question sentence | Actual answer |
| --- | --- | --- |
| `same_instruction` | Does the challenge in `after` show the same written instruction or checkbox label as in `before`? | Not requested |
| `same_images` | Does every image or tile in `after` show the same picture, in the same position, as in `before`? | Not requested |
| `same_selection` | Are exactly the same tiles, boxes or checkboxes selected or checked in `after` as in `before`? | Not requested |
| `same_control` | Do `before_target` and `after_target` show the same control, with the same shape, size and position? | Not requested |
| `no_new_mark` | Is there no check mark, tick, spinner, symbol, text, picture or other mark in `after_target` that is absent from `before_target`, and none removed? | Not requested |
| `style_only` | Is every difference between `before_target` and `after_target` only a change of color, shade, border or outline? | Not requested |

[result.json](artifacts/website-tech-skill-outcomes-2026-10-20/diagnostic-a055d14-sol/result.json)
contains complete source question objects/scopes, provenance, exact floating-point
rectangle, pixel counts and actual invocation counters. Its `sourceQuestionsNotReached`
is source inspection, not a reconstructed actual model request.
`actualLogicalRequest`, `actualRequestState`, and `actualAnswers` are `null`;
`transportImages` is empty. The capture hook would privately save the full unchanged
logical request with permissions0600 **before** delegating to actual candidate
`executeDecision`, if reached. It was never reached; no artificial request/state
or substitute inference was produced to fill that evidence gap.

## Reproduction and handoff

The [diagnostic script](artifacts/website-tech-skill-outcomes-2026-10-20/diagnostic-a055d14-sol/diagnose.mjs)
extracts the closure verbatim and imports actual candidate `executeDecision` and
viewport constants. TSX erases types; the wrapper observes requests without
changing the candidate's closure, options, images, questions or responses.
The exact source Box-to-Rect snippet constructs the input Rect. Pixel inspection
is offline evidence analysis, not browser localization or input. One invocation
was executed; no retry, alternate region or live provider probe followed.

Commands/results, using Node **v24.14.1**:

```sh
# In a clean detached checkout at the exact router SHA above:
git rev-parse HEAD
npm ci --ignore-scripts --no-audit --no-fund
npm run build --workspace @claritylabs/cl-router-policy

# Existing private output directory must have mode0700. Only run when dispatched.
QA_ROUTER_CHECKOUT=/path/to/exact-router-checkout \
QA_PRIOR_ARTIFACTS=/path/to/spot/docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/live-96d1db5-sol \
QA_PRIVATE_OUTPUT=/path/to/private-output \
/path/to/exact-router-checkout/node_modules/.bin/tsx \
  docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/diagnostic-a055d14-sol/diagnose.mjs
```

Dependency install and policy-only build passed. Diagnostic exited0 with
`cosmeticHoverApproved=false`, closureInvocations1, executeDecisionCalls0,
providerAttempts0. JSON parsing, source/PNG hashes, original-private provenance,
pixel equality, script syntax, report links, credential-value exclusion and
`git diff --check` were checked. No full router check was rerun; the manager's
reported full check PASS is not independent QA validation. Candidate source
remains clean. Artifact integrity is recorded in
[manifest.json](artifacts/website-tech-skill-outcomes-2026-10-20/diagnostic-a055d14-sol/manifest.json).

Actionable reproduction: supply the preserved pair and native Box above to the
candidate's unchanged closure. It returns at the deterministic guard. Review the
recorded Box's incomplete coverage of the visible border change before assessing
whether this is the desired refusal or a localization problem; no correction was
implemented here. The prior four-question **.61** semantic failure and all earlier
gate/native FAIL reports remain immutable. There was no Turnstile replay, browser,
native press, customer/mailbox action, backend/env change, new unit test, product
edit, preview or deployment. STOP after this bounded handoff.
