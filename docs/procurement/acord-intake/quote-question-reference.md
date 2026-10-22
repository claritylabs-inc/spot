# Historical question hints for the final intake pass

The October 21 question export contains 2,571 nonempty question rows, 2,404
exact unique questions and 2,370 after NFKC/case/punctuation/whitespace
normalization. Numbers remain distinct: different age thresholds or reporting
periods are not automatically merged.

`quote-question-reference.json` contains 74 reviewed generic concepts, mapped
many-to-many to the existing coverage IDs, with subject and applicability notes.
Existing catalog IDs are reused where possible. No historical answers, account
names, contact details, addresses or raw customer-specific prompts are shipped.
The CSV's dirty coverage labels do not determine runtime coverage membership.

The import is deliberately two layers:

1. A complete normalized question-only audit of the source export. Topic patterns
   associate 283 unique questions with reviewed concepts. The other 2,087 remain
   explicitly unmapped for review. Matches are topic suggestions, not claims that
   every matching compound question is semantically identical.
2. The reviewed generic runtime concepts, selected by coverage and existing
   subjects. At most 50 hints / 12,000 characters enter the final generation call.
   Source frequency never makes a question mandatory. Reserved base/catalog facts
   and answered/skipped/unsure history take precedence over every hint.

The full private audit also carries coverage-line hints for 2,322 unique
questions, normalized to the product's coverage IDs; 48 have no usable source
line. These are explicitly source hints, separate from reviewed concept mappings:
package labels and mislabeled source rows cannot promote themselves into runtime.

Unmapped rows include non-intake workflow requests, specialized lines outside the
current product, account-specific wording and facts requiring more careful
decomposition. They are not silently accepted into applicant intake. Expand the
reviewed pack by adding generic, atomic concepts with explicit applicability;
do not paste the raw export into a model prompt or this repository.

Reproduce the aggregate import with no model calls:

```sh
python3 scripts/intake/import-quote-question-reference.py /path/to/all-quote-questions.csv
```

Optionally provide a second path outside version control for the full private
question-only review JSON. It contains the deduplicated questions, occurrence
counts, candidate concept/coverage mappings and unmapped status, but no source
answers or account metadata. `quote-question-reference-import.json` contains only
the source fingerprint and aggregate counts for reproducibility. Pattern changes
require rerunning the import; semantic merges require review.

After coalesced draft saves (once company and coverage are known), or at terminal
section entry if needed, one `intake_additional_questions` call receives deduplicated
application facts/history and the shortlist. The prompt is bounded to 96,000 UTF-8
bytes; hints are trimmed before any application facts, and oversized facts fail before inference. It performs gap assessment,
semantic novelty, applicability and primitive selection together. It returns
up to eight questions or an empty list. Deterministic shape, reference-ID,
exact-repeat, capacity, owner, token and context checks remain in code. No
separate gap/novelty/prefill/repair inference runs. New definitions retain the
reference ID in their source marker; legacy date hints exclude these definitions.
An unchanged context is cached, including empty/failed outcomes. History saves prepare a current context in the background; only a complete,
validated batch becomes visible. Revision checks coalesce saves and pending batches prevent overlap. A successfully completed result made
stale by changed base facts may start one pass for that new context; failed or
unknown inference never automatically replays.

For example, payment-provider hints may suggest a question only if existing
tech-stack facts and the catalog history do not already establish the provider.
Email MFA, remote-access MFA and administrator MFA remain separate facts. A
sprinkler flow-test date applies only to an existing sprinklered location and
does not substitute for its ordinary inspection date. No child question assumes
an unknown prerequisite is true.
