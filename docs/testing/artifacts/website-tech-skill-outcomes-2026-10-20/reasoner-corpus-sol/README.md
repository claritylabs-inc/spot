# New synthetic comparison corpus — capture only

[Report](../../../browser-hover-reasoner-corpus-sol-2026-10-20.md).
Six cosmetic positives and ten meaningful negatives, all new browser captures.
**Zero inference.** This is data preparation awaiting manager review, not model,
native, helper or cascade acceptance. No later evaluation is authorized here.

`case-plan.json` freezes expected facts/labels,16 layouts and extraction rules.
`fixture.html` is a new local renderer with its own SVG illustrations and controls;
it does not consume saved857/HH images or old fixture code. `freeze.json` binds
fixture/controller/plan/pixel-helper bytes before capture. `source-binding.json`
pins af229cc's actual closure and six question/scope strings to accepted889daaa.
`corpus-manifest.json` joins frozen expectations to actual image hashes/geometry.
`capture-receipt.json` retains actual DOM bounds/state, original screenshot hashes,
pixel bounds, containment, padding proof and process cleanup. Expected labels and
case IDs appear only in these audit files/paths, never in the rendered images or
neutral request. The c16 visible instruction is deliberately untrusted page text,
not a case label or comparator instruction supplied by the controller.

Every case directory contains six immutable PNGs:

- `viewport-before.png`, `viewport-after.png`: actual full1024×768 Chrome screenshots.
- `frame_before.png`, `frame_after.png`: whole fixture panel, unscaled at its
  original viewport position on opaque1024×768 gray. Legends/context stay intact.
- `target_before.png`, `target_after.png`: the ORIGINAL before target+4 region,
  clipped to the frame, integer nearest-neighbor scaling1..8 at canvas origin.

All64 transported images were individually opened for visual review. See
`visual-review.json`; no ambiguous label, interrupted capture or supersession
was found. No image was masked, enhanced or repaired after capture. c04 is a
rendered existing focus-style outline; there is no native focus transition test.
All16 changes fit the declared region; this corpus contains no unchanged-path
or out-of-region control. Never reinterpret a future uncontained case as semantic
approval: it must stay a deterministic refusal and be excluded from inference.

`request-template.json` equals the accepted889daaa neutral logical request except
its four image fields, now role placeholders. A later separately authorized
runner may fill those exact fields with the corresponding PNG data URLs, once
each. First3 questions use the full-frame pair; last3 use detail. Do not append
this README, filenames, case IDs, expected labels, DOM facts, counts, prior scores
or corpus metadata to that model input. Do not silently adjust the frozen prompt,
schema, meanings, thresholds, geometry, images or padding.

Historical capture commands (Node24, existing dependencies), from Spot root:

```sh
node /path/to/controller.mjs freeze
Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp
node /path/to/controller.mjs capture
# Chrome/server/profile close in finally; stop owned Xvfb afterward.
node /path/to/verify-offline.mjs
```

The renderer used ordinary headed Chrome155 through Playwright on one ephemeral
loopback HTTP page. DOM evaluation applies known synthetic states and reads
bounds; it is explicitly not candidate BrowserTargets/native Box/skill/runtime
execution. Candidate private-host guards were never changed. The controller has
no provider or credential access; its node:http import serves only
this loopback fixture. Chrome children receive system-only environment entries.
Page routing refuses other origins; CSP contains no external resources.

No recapture/reprepare is needed or authorized now. `freeze` refuses an existing
freeze and `capture` uses an exclusive scratch lock. Never delete/overwrite
original evidence to repair a failure. Any authorized correction must preserve
its interrupted receipt/originals and use a new superseding revision.

The OFFLINE verifier imports only local filesystem/path/hash/assert and PNG
math. It has no browser/provider/credential/network imports and performs no
HTTP. It independently reads each transported pixel from the ORIGINAL full
screenshot using the frozen mapping, verifies all gray padding, all96 PNG hashes,
changed pixel bounds/containment, exact template equality except images, frozen
file hashes and human review linkage. Supply a PNGJS module path if the existing
scratch dependency location differs:

```sh
node /path/to/verify-offline.mjs /absolute/node_modules/pngjs/lib/png.js
```

It checks committed inputs; it does not capture again or infer scores. No product
unit tests, backend/env/inbox writes, customer/live-CAPTCHA/provider requests,
preview or deployment occurred. `cleanup.json` records stopped Chrome/server/
Xvfb, removed profile and closed ports. Original backend/private inbox untouched.
