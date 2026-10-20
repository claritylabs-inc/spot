# Exact cc8bb050 final consumer replay

Fresh actual UI, storage/access and offline request evidence for Spot
`cc8bb050c20f6cb45798da7c6eb986d4b0b884af`. This is not carried UI evidence,
router/provider/native CAPTCHA acceptance, or a production deployment.
See [report](../../../website-tech-final-consumer-sol-2026-10-20.md).

Normal setup follows the [original replay guide](../README.md#normal-local-prerequisites).
This run used a new detached checkout and a **fresh database**, copying only the
existing native-local `.convex/local/default/config.json` and its three loopback
selector/URL entries into private local files. No database/env values were cloned
from a hosted backend. Identical package/lock bytes allowed dependency hardlinks;
no package install or tracked product change was needed. Existing root local
database and private inbox preparation remain untouched.

`local-lane.mjs <absolute checkout> convex` starts native local Convex8083/8084
with a minimal system-only child environment, excluding ambient deploy keys and
provider credentials. It disables codegen to preserve exact candidate artifacts.
`bootstrap` refuses nonempty local env, establishes `SPOT_ENV=local` on that empty
explicit loopback backend, then rechecks it before every later env/seed write.
It uses repo-generated local auth keys, capture-only email and `seed:seed`;
its transient0600 bootstrap env file is deleted. Both router variables start
absent and remain absent; there were no credential values to remove/restore.
`web` checks local selection then starts ordinary Next8080. Never use this fresh
bootstrap command against a populated/shared/hosted database.

Keep the processes private and in separate terminals. Native Convex logs contain
local OTPs and must not be printed/committed. Use visible Xvfb `:99` and Chrome;
scripts retain no browser profile. Runtime results are under the checkout's
`.context/qa/final-consumer-cc8bb050-sol/`, not this durable directory.

Historical workflow order, from the exact candidate checkout:

```sh
export QA_CHECKOUT=/absolute/path/to/exact-cc8bb050-checkout
# scripts below live in this evidence directory, supplied as absolute paths
node /path/to/this/login.mjs
node /path/to/this/boundary.mjs
node /path/to/this/access-qa.mjs
node /path/to/this/check-request.mjs "$QA_CHECKOUT"
node /path/to/this/prepare-local.mjs
node /path/to/this/app-qa.mjs
node /path/to/this/app-followup.mjs
node /path/to/this/cleanup-local.mjs
```

Login is the normal operator OTP browser flow with fresh local email capture.
Client access denial also uses ordinary OTP auth. No stored auth capability is
included here; later replays must sign in afresh. Delete the private auth snapshot
after cleanup. The original fixture website is saved privately by preparation
and restored by cleanup through the existing authorized writer. Claim/finish
only stage synthetic outcomes; real Rescan reaches its genuine credential-free
terminal state. Synthetic outcomes are not evidence that a router skill ran.

Adaptations from the immutable original scripts are recorded with hashes in
`replay-adaptations.json`: exact candidate guard, unique paths, candidate imports,
guarded helper JSON return type, and unchanged checks at the proper current roots.
The real scheduler raced the original five-attempt fixture helper; a bounded
diagnostic proved claim loss. Setup now has20 attempts, without changing any
guard, mutation or storage assertion. Local table reads paginate with a5000-row
cap for complete cleanup. This is fixture preparation, not inference retry or a
product fix. Both interrupted app receipts remain under `results/`.

Access's authorized fourth group checks the current stored result after setup;
it does not assert fresh `websiteTech:null`. The initial null read preceded an
adapter error and is not counted as a final passed assertion. The not-scanned
empty-profile UI was not separately replayed. All15 listed app groups are fresh.
The390px shell416px scroll-content failure is retained separately, even though
skill text wraps within the card and document scrollWidth alone reports no overflow.

Protocol capture stores only status/origin/path and websocket message types/UDF
names. It never stores auth frames, arguments, headers, body contents or URL query
strings. Publication additionally normalizes a public analytics project ID in
one HTTP path; `publication-sanitization.json` records hash/span provenance.
Only a whitelist of safe runtime receipts and five synthetic-only screenshots
is published. No raw logs/env/inbox/auth files are in this bundle.

`publish.mjs <absolute checkout>` performs offline whitelist packaging and writes
the manifest. It never starts a browser, mutation or provider call. The
`source-binding.json` pins actual source bytes; `contract-provenance.json` binds
Spot bytes to exact router af229cc. No old evidence is overwritten by replay or
publication. Cleanup receipts record original website restoration, research
settled, zero shared job IDs, both router values still absent, auth removed and
all owned ports closed.
