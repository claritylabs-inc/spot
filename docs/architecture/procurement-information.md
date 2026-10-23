# Procurement information requests

`convex/procurementInformation.ts` owns request-scoped questions, the providers
who requested them, fixed supplementary forms and immutable answers. `components/procurement/information-requests.tsx` uses Spot row
cards and the app-shell SettingsDrawer. Each card has one question-level status
and a Requested by list using `OrgBrandIcon`, the same branding primitive as
provider outreach. Provider acceptance and delivery records remain historical
backend evidence; they are not statuses for a client's answer.

## Questions and answers

A question represents one fact for a coverage, subject, reporting period and
optional currency. Multiple providers can request that fact. Exact definitions
and scope deduplicate deterministically; semantic reuse of a known question is
proposed through cl-router and confirmed with a Jev Noul. Different subjects,
periods, currencies and prerequisite scopes stay separate. Each requirement
retains its source message and exact quote.

Questions show Needs answer, Waiting for client or Answered. Questions whose
prerequisite answers do not apply are hidden from the operator list; the condition
still governs the client form. Add provider lives in the Requested by row.
Operators answer on behalf of clients directly in typed inline controls. Client form submissions and grounded email answers also count as answers.
Corrections create immutable answer revisions, preserving the original accepted
application and company profile. Client email provenance includes its message and
quote. Operator-authored corrections never silently inherit the client's source.

## Automatic email processing

Both incoming paths schedule the same idempotent `queueEmail` mutation:
`convex/lib/teamEmailStore.ts` (shared inbox/outreach) and
`convex/procurementRequests.ts` (request-address mail and newly linked threads).
The queue rechecks a live request, inbound message and exact known correspondent.
Provider mail must match one request outreach contact; client mail must belong
to a client conversation and match a current applicant/member contact from the
existing client-outreach recipient helper. Forwarded client content is excluded.
An active operator already associated with the conversation/request is retained
as the responsible staff member. No new permission or send authorization is
created. The bounded Sync inbox action catches up recent linked mail.

`convex/actions/procurementInformation.ts` makes one bounded structured CL-router
generation call for the message. Provider requests become individual questions
with exact source quotes. A batched set of atomic Jev Nouls verifies explicit
requests and any proposed semantic reuse; deterministic scope checks still apply.
Clear, supported requirements populate the tracker automatically. Unknown scopes,
uncertain decisions, invalid definitions and failures remain available for manual
review through From email. A matching provider/fact already tracked resolves its
review indicator even when it was recognized from a later message.

For client replies, only unresolved request questions are offered as targets.
Generation returns the explicitly stated answer and an exact quote. Jev uses the
existing prefill confidence band to confirm responsiveness and scope. Final code
rechecks the sender/target, quote, primitive, literal value and current answer
revision. Numeric grouping commas may be removed; units/multipliers and currency
conversions are not inferred. Prerequisites are processed first and must apply.
Existing operator or client answers are never silently overwritten.

Extraction is persisted once per request/message; duplicate deliveries do not
repeat inference. Unknown outcomes never replay generation. Confidence-check
failure holds the proposal, and a watchdog closes stalled work. Hosted generation
uses durable router jobs; native-local generation uses the existing bounded
synchronous transport for this task kind. Email content cannot send messages,
change the accepted application, grant access or make insurance eligibility
choices.

## Batched client forms and invitations

Information Needed is the complete request-owned question list. Forms have their
own sidebar entries and an Add form action; there are no Questions/Forms tabs.
Each new batch selects from unresolved questions not already in another open
batch. All eligible questions start selected and operators can choose a smaller
set. Unknown prerequisites are included automatically. Selection is checked on
the server against current request ownership, applicability, answer revisions and
other open batches, with a 40-question limit including dependencies.

Creating a batch keeps other forms open. Exact unchanged snapshots may be reused;
otherwise each batch has its own immutable question set, title and response state.
The lightweight operatorForms query supplies sidebar metadata with stable ids,
including when multiple forms share a title. Existing forms remain independently
addressable through `?view=information&form=<id>`.

Answered prerequisites are snapshotted as version guards and omitted from the
client's questions. Remaining conditional questions are ordered before dependents;
hidden answers are excluded by both browser and server. Changing any snapshotted
prerequisite blocks stale submission. Operator/email answers close affected open
forms so clients do not submit stale facts. Closed links render a clear message,
and the next request includes only the remaining unresolved questions.

The existing client email composer opens with the questions and form link, offering
reply-by-email or form completion. Rebuilding an unchanged generated invitation
replaces its prior generated block while preserving other authored draft text.
Drafts are separated by request/form within the current browser session. Creating
a form opens its own invitation draft and sending remains explicit. Sending links
the form to one client outreach sequence (`outreachSequenceId` /
`informationFormId`), which supplies email status, recipient, subject and the
conversation link. Different batches may have independent sequences to the same
contact, while legacy unscoped duplicate-send guards remain. Claims and the final
send checkpoint reject unavailable, completed or cancelled forms. Sender identity,
recipient and approval checks remain authoritative. Client request views and submitted intake show open forms.

`components/insurance-intake/information-form.tsx` reuses the intake frame,
conditional primitives, save/reload, review and explicit submission. Saves use
form revisions and submission rejects answer revisions changed since publication.
Client DTOs exclude provider identities, raw mail and operator notes. Normal
client membership is checked against the target company; writes require an admin
or request owner. Restricted applicants retain the original owner/proof checks.
Deleted requests deny access and impersonated client writes use the existing audit.

Uploads reuse actor/request-bound expiring one-use intake upload intents and the
existing client-request file writer. PDF, PNG, JPEG and DOCX are bounded to 20 MB
per file and 100 MB per request. Only active client-visible associations can be
submitted. Client and provider release controls remain independent.

## Presentation and editing

Questions, client-form previews and published question order group by coverage.
Operator answers use always-editable typed row controls, save on blur or choice,
retain supporting files and enforce immutable-answer revision checks. Blank or
unsure answers remain unresolved. Failed edits remain visible with retry.

Client question titles, progress labels and review labels prefer the submitted
DBA/trading name, then a saved intake DBA, with legal name as the fallback.
Whitespace-only names are ignored.

The client form reuses the initial intake introduction, coverage icon mapping,
header progress bars, large arrow navigation and review rows. One review coverage
is always expanded; multiple coverages use the original review disclosures.

Future-intake reuse controls, observation/review mutations and learned-reference
injection have been removed. The existing curated historical question catalog is
unchanged. Deprecated library storage remains inert for compatibility with local
records; no database migration or data deletion was performed.

No model-callable/MCP tools, database migrations or production deployments are part
of this implementation. Schema changes are additive.

## Form navigation and names

Information needed is a separate request sidebar section containing Overview,
individual forms and Add form. Form detail uses the same coverage-grouped question
cards, answer rows, statuses and provider branding as Overview. Submitted forms
render their saved response snapshot; open forms reuse guarded inline answers.
Supporting documents use the shared attachment chip and authorized file URL query,
with PDFs opening in the existing app-shell viewer.

Names use the creation date in America/Toronto, for example `Oct 23, 2026`, followed
by `(2)`, `(3)` for later forms on that date within the request. Server projections
apply the same naming rule to existing forms without rewriting stored snapshots;
new forms receive the generated name when published.
