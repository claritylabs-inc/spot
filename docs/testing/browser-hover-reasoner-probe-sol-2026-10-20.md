# Hover reasoner model-only probe — single regression PASS

On 2026-10-20 UTC, the one authorized `/v1/manual` POST returned **HTTP200, `openai/gpt-5.6-sol`, finish `stop`, valid six-property output, all six `yes`**. This passes only the exposed saved857 cosmetic-pair regression. It does not accept a helper, native click, accuracy, held-out behavior, model cascade or production change. All previous failures remain immutable; production’s six `.9` Noul requirements are unchanged.

| Property | Exact source scope / image pair | Actual output |
| --- | --- | --- |
| `same_instruction` | Same written instruction/checkbox label; full-frame before/after | `yes` |
| `same_images` | Same depicted pictures in the same positions; full-frame pair | `yes` |
| `same_selection` | Exactly the same selected/checked state; full-frame pair | `yes` |
| `same_control` | Same control, shape, size and position; detail pair | `yes` |
| `no_new_mark` | Exactly the same marks, including additions/removals/replacements; detail pair | `yes` |
| `style_only` | Every difference only color/shade/border/outline under the exact exclusions; detail pair | `yes` |

The full verbatim questions and definitions are in the frozen [declaration](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-probe-sol/predeclaration.json) and [actual request with inline PNGs replaced by references](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-probe-sol/request-sanitized.json). They were extracted from exact router **`af229cc363c6a602f2964bfda2c4961dd0cf6e5f`**, `packages/server/src/browse/primitives.ts:526–541`; only response representation changes from Noul to `yes|no|uncertain`. No expected-case label, prior scores, favorable-answer instruction, caller goal, page-derived command or free-form reasoning request was included. Page text was explicitly untrusted visual evidence. Each of the four images appeared once with a role label; the first three definitions bind the full-frame pair, the last three the detail pair. This is a new neutral manual-generation request, not replay of the previous Jev logical request or execution of `cosmeticHover`.

## Frozen provenance and transport

The private full synthetic request was archived0600 before inference in a0700 directory. Its compact body SHA256 is `41aa09caaf89f1d6c5a9aa8c3b8d9bb0dd3e802a832759c80bfc0ef8b399f2d5`; frozen controller SHA256 is `b4a05893779d74ce136238898054cdaaed052778aa4f30c78a71b3956acb460b`. The declaration binds the prompt/schema through that body hash, the source/closure digests, geometry and four PNGs before the POST. The offline verifier reconstructs the exact body from the published request plus unchanged PNGs and matches its hash to the original private bytes. Both configured router variables were present; their values were never printed, stored, provisioned or exported. Authorization existed only in the actual fetch call, never in the archived body.

| Image role | Original PNG SHA256 |
| --- | --- |
| Full frame before | `b3f4dbeaabfa91531c6a279be18bfdd43051b52cbbecf9ec53d0813f380c8215` |
| Full frame after | `ddbeafbeadc69977792e9d6747ac76702d5424aa71be6385337d6e2f743c319d` |
| Target detail before | `234478538ac49c7b08ca3b41491e45ae22c88edbf77b47d0521d316635f9ed82` |
| Target detail after | `7738abc94688b1876e9dcdfa8fd619b62ad992dae3fde617c75984178db3e0bf` |

All four files match both immutable f299f707 comparison artifacts and3965f4ec original hover canvases byte-for-byte;11 provenance files were checked against their actual Git commits. No recapture, enhancement or image editing occurred. Pixel-by-pixel verification confirmed1024×768 opaque `#808080` canvases, original304×78 frame at viewport `(283,332)`, and the exact original refined Rect `(296.6533333333333,355.04,27.306666666666672,28.159999999999968)`. The detail source region is frame-local `x∈[9,45), y∈[19,56)`, with integer nearest-neighbor scale8 at canvas origin. The prior actual300 changed pixels and frame-local bounds `(13,23)–(40,50)` remain recorded provenance, not a fresh native observation. The source closure digest matches the prior frozen `0087d228841341f7de71e172c4d1424492a111c55124d0416dee995b86a276eb`.

I read the exact local `ManualRequest`/`RouterMessage`/structured-output contracts, input adaptation, manual route selection, generation options and attempt handling. `api/contracts.ts:119–164` strictly validates the outer manual request and exactly one input form; the six-property object schema requires all six enums and `additionalProperties:false`. The actual candidate `ManualRequestSchema.parse` passed locally without stripping/changing any request field. `services/router-service.ts:481–517` selects only the requested manual registry route; generation options at302–356 use structured output and max output tokens. `providers/options.ts:5–9` has no override for this model, so this probe uses **provider-default effort, not high**. No public effort, `store` or `maxRetries` fields exist here. No SDK/router settings were changed. No tools were offered; manual no-tools routing has no need for tool-selection inference (`providers/generation-decision.ts:54`).

The existing configured HTTPS broker was used; userinfo/query/hash and Vercel preview endpoints were refused locally. One allowed health GET returned200/ok/database true and reported SHA `12ca9ec27d6fd87fb560d27c3e91a1e7afd633ac`. This differs from the local af229cc source used to bind semantics/schema; **deployed broker source equality to af229cc is not established**. The health payload/base URL were not archived. No deployment/configuration change was made. Normal broker execution and telemetry apply; this is not proposed direct-helper transport acceptance.

## Actual request/result and limits

The fixed request used `maxTokens:8192`, `executionBudgetMs:30000`, client hard timeout45000ms, `redirects:error`, no client retry and no fallback/alias/alternate route. One exclusive private attempt lock was created before fetch. There was exactly **one client POST**, elapsed4240ms, at22:26:52.950–22:26:57.190 UTC. No second inference, repair, prompt variant or diagnostic request followed.

The actual response reported manual route/model `openai/gpt-5.6-sol`, tier3, `attemptCount:1`, `finishReason:stop`,4365 input tokens,114 output tokens,0 cached-input tokens,4362 cache-write tokens and73 reasoning tokens; reported priced cost **$0.0306975**. These are broker-returned usage/cost fields, not an independent billing audit. No reasoning text was requested or persisted. A separate underlying provider revision/version was not exposed: the returned model identifier and route are retained exactly, without a version guarantee. The normal broker’s attemptCount does not prove exactly one SDK/provider HTTP attempt; internal attempts are unobservable here. `store:false` was neither requested nor established. See the [actual result](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-probe-sol/result.json).

Commands: Node24.14.1; `node --check controller.mjs` PASS; `node --import <existing router tsx loader> controller.mjs prepare` PASS (no inference); immutable Git/pixel/schema verification PASS before send; `controller.mjs send` produced the one result above; `verify-offline.mjs <private directory>` PASS for exact request reconstruction, hashes, roles/schema,0600 archive and freeze-before-send ordering. [Replay/inspection guide](artifacts/website-tech-skill-outcomes-2026-10-20/reasoner-probe-sol/README.md) records paths and the no-repeat guard. The publication ledger identifies the four exact image-field substitutions; no auth headers, configured endpoint, cookies, raw errors, customer data or inbox material are published.

No browser/native input, customer/mail/inbox/backend action, new test, product/contract/env/credential edit, preview or deployment ran. The short-lived controller exited; no browser/services were started, and the pre-existing backend/private inbox remain untouched. The private request and exclusive attempt lock remain for audit. Only this new report and `reasoner-probe-sol` artifacts are owned changes on `conductor/spot-skill-outcomes-qa`.

**Decision:** record the single exposed regression PASS and stop. It supplies no negative-case claim or causal estimate. Cancellation QA, genuinely new independent positive/negative corpus, and separately authorized current native integration remain required before any cascade adoption. No next stage or model-setting change is authorized by this result.
