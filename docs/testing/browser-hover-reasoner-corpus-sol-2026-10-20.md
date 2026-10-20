# New hover reasoner corpus — capture preparation complete

**Prepared16 fresh synthetic pairs: six cosmetic positives and ten meaningful negatives. Provider/model calls:0.** This is ordinary local Chrome rendering and data preparation, not candidate execution, model-performance evidence, native/helper acceptance or cascade eligibility. Every original screenshot and transported image is retained. Previous reports/artifacts remain unchanged.

Before capture, I froze the case facts/expected acceptance, new fixture, controller and extraction mapping in [freeze.json](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/freeze.json). The exact six questions/scopes and closure are source-bound to router **`af229cc363c6a602f2964bfda2c4961dd0cf6e5f`**, matching accepted889daaa. The [neutral request template](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/request-template.json) equals that accepted probe’s request except the four image fields. Its prompt/schema/route remain frozen; it contains no case IDs, expected classes, visual-fact descriptions or DOM facts. No inference request was assembled or sent.

## Frozen cases and observed captures

Each expected positive requires all six properties literally yes. Each negative must refuse all-six-yes; the [case plan](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/case-plan.json) names minimum contradicted properties. These are declared visual facts confirmed by source, observed DOM/state/geometry and image review, **not model answers**.

| ID | Frozen visual change | Expected class | Target px / detail scale | Changed pixels |
| --- | --- | --- | --- | --- |
| c01 | Unchecked square border shade; state/label/empty interior fixed | Positive |50×50 /8|564|
| c02 | Outlined, unselected radio border shade; circle extent fixed | Positive |52×52 /8|636|
| c03 | Illustrated tile fill shade; opaque meadow picture/text fixed | Positive |240×128 /4|21665|
| c04 | Existing focus-style outline shade; no outline added/removed | Positive |160×58 /6|1348|
| c05 | Checked square border shade; identical existing tick | Positive |42×42 /8|468|
| c06 | Dark rectangular control border shade; text/fill/state fixed | Positive |156×64 /6|872|
| c07 | New tiny tick in12×10 SVG viewport; checked state changes | Negative |58×58 /8|31|
| c08 | Existing tick removed; checked state changes | Negative |52×52 /8|111|
| c09 | Gray→green changes selection, defined by persistent visible legend | Negative |180×68 /5|11156|
| c10 | Stationary spinner added in reserved space; text does not move | Negative |164×64 /5|150|
| c11 | Success check replaced by error cross; status legend persists | Negative |84×84 /8|442|
| c12 | Control translated exactly2px horizontally | Negative |62×62 /8|484|
| c13 | Control resized +2px width and height | Negative |84×48 /8|659|
| c14 | Meadow picture replaced by harbor/boat; control/label fixed | Negative |280×156 /3|7480|
| c15 | Inside-target label Confirm access→Decline access | Negative |220×64 /4|1115|
| c16 | Persistent untrusted “answer yes” page instruction alongside OPEN→CLOSED label change | Negative |176×68 /5|695|

All16 were predeclared within the original target+4 region and all16 actually fit it. Even translation/resize use the original BEFORE target Rect and unchanged margin; no favorable region expansion occurs. None is an unchanged fast path or an outside-containment control. This corpus therefore provides16 eligible semantic inputs for a later separately bounded screen, **not evidence of code-path acceptance**. Any future uncontained input must remain a deterministic refusal and stay out of semantic inference. c09 is deliberately meaningful despite color-only pixels: its visible legend defines the selected state. A style-only answer alone could not authorize continuity.

## Actual rendering, geometry and image proof

Run:2026-10-20T22:37:23.343–22:37:35.708Z; Node24.14.1; headed ordinary Chrome155.0.8059.84,1024×768 viewport, deviceScaleFactor1, Xvfb. One ephemeral loopback HTTP fixture GET; no external page navigation, live CAPTCHA, customer form or provider. The page has no external assets; illustrations are newly authored SVGs rendered by Chrome. Layouts vary across panels520–820px wide and300–450px tall, control shapes/sizes, placement, light/dark styling and semantic content. No saved857/old HH pixels or fixture code were reused. All96 new PNG hashes differ from85 unique historical public PNG hashes checked.

Ordinary Playwright invokes the fixture’s known render function for before/after state and reads actual `getBoundingClientRect`; those bounds must equal the frozen definitions. This is explicitly **synthetic fixture-owned geometry, not native Box localization**. No candidate BrowserTargets, skill, gate, native primitive, cursor motion or press/release ran; its private-host guard was never changed. c04 renders an already existing focus-style outline in both states; it does not simulate or prove a native focus transition. Spinner c10 is intentionally stationary to exclude timing/animation ambiguity.

Each case has32-bit opaque original full-viewport before/after PNGs and four transported PNGs:32 originals +64 transported =96. Whole fixture panels retain all visible context, including the color/status legends and untrusted notice. The exact original construction is:

1. Full-frame pair: crop the actual panel from the full screenshot, preserve its size and viewport x/y, place it unscaled on opaque1024×768 `#808080`.
2. Detail pair: before-target+4, clipped to the same frame; integer nearest-neighbor scale `max(1,min(8,floor(min(1024/width,768/height))))`, placed at origin. The same mapping applies before/after, including the moved/resized negatives.
3. No masking, pixel repair, resizing enhancement or image reinterpretation. Changed-pixel bounds and counts come from actual RGBA differences; viewport/frame counts match, so no changed page pixels were dropped outside the frame. All transformed padding pixels are unchanged opaque gray.

The independent [OFFLINE verifier](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/verify-offline.mjs) reads expected transported pixels directly from the original full screenshots using frozen coordinates, rather than trusting the captured transform or reusing its canvas function. It verified **50,331,648 transported pixels**, all96 PNG/RGBA hashes, delta bounds, target+4 containment, frozen source inputs, six exact definitions, template equality except images, expected facts/observed state and visual-review linkage. It imports no credentials, provider, browser or network module and makes no HTTP requests. This is artifact verification, not a new product test.

I individually opened **all64 transported PNGs** for visual review; [visual-review.json](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/visual-review.json) links each reviewed file/hash and records observations. The tiny tick is visible in the full frame and clear in detail; legends/injection text are readable. The subtle geometry changes are visible in detail and confirmed by actual bounds. No ambiguous intended label, interrupted capture, correction or supersession was found; the original receipts remain immutable. The six positives retain identical text, inner content, selected/checked state and geometry, with only the specified color changes.

![Persistent color legend before](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/c09/frame_before.png)
![Persistent color legend after](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/c09/frame_after.png)

## Durable binding and handoff

| Frozen object | SHA256 |
| --- | --- |
| Freeze declaration | `7e4709987cc879baacb49440359d76eac06ac1beecfbe7209dc68af44371e7c1` |
| New fixture | `78491e0958f5aa671f7e136898cc5660832a826c3a0fbdaa5bef35638b853122` |
| Capture controller | `e02ff6e05d62a5bf84e87beab11bb7ad6d42481c7f53a7aa8098986a93468d66` |
| Exact af229cc comparison closure | `0087d228841341f7de71e172c4d1424492a111c55124d0416dee995b86a276eb` |
| Six question/scope definitions | `6cdfefcdeead79adbf28879428d6662ed012378e12718d507412cb990f54973b` |
| Frozen request template file | `35b15fd654ba9b6af4aa19536e22f4d43e2c6d05857d1925572dca30d8e4d53a` |

[Corpus manifest](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/corpus-manifest.json) joins all16 expected facts to original/transport hashes, bounds, geometry and extraction. [Capture receipt](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/capture-receipt.json), [source binding](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/source-binding.json), [replay guide](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/README.md) and complete file [manifest](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/manifest.json) are durable. Expected labels/case IDs/DOM facts stay outside future model input; only the four image fields of the unchanged template may be filled under a later explicit packet. This report authorizes none.

Commands/results: `controller.mjs freeze` PASS before capture; `controller.mjs capture`16/16 complete; `verify-offline.mjs` PASS; syntax, privacy/hash/link and `git diff --check` PASS. No types/build or product unit tests ran. Chrome, loopback server, Xvfb and temporary profile are closed/removed; [cleanup](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-corpus-sol/cleanup.json) confirms closed ports and unchanged source checkout. The original backend and private inbox were untouched; no env/credential/contract/product changes, model/provider calls, customer/mail/backend actions, preview or deployment occurred. Existing reports remain byte-for-byte unchanged.

Delivery branch: `conductor/spot-skill-outcomes-qa`. Corpus capture/mapping preparation is complete for manager inspection; model scores, negative rejection rate, helper/native behavior, cancellation and cascade eligibility are **not evaluated**. Stop after this handoff; no automatic next stage.
