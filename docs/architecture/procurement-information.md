# Procurement information requests

`convex/procurementInformation.ts` owns request-scoped questions, the providers
who requested them and immutable answers; `convex/procurementInformationForms.ts`
owns fixed supplementary forms and `convex/procurementInformationEmail.ts` the
email queue and extraction records. `components/procurement/information/` uses Spot row
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

## Partially filled applications

A requirement without a provider outreach is Spot's own request, shown as Spot
in Requested by. Operators choose Spot (application) in Add question, and the
agent omits `procurementOutreachId` in `add_procurement_information_questions`.
This completes applications imported from documents: `get_procurement_information`
lists the accepted application's `unansweredApplicationQuestions` (blank base
fields and applicable catalog questions from `intakeQuestionHistory`), the agent
asks only for facts the documents did not answer, then publishes a form and
drafts the client email with the existing tools. Answers stay supplementary
facts and never rewrite the accepted application; apply them with
`update_procurement_application` when the operator approves, passing the copied
questions as `archiveInformationQuestionIds` so they are archived in the same
write. Only answered questions qualify, with the same prerequisite and open-form
guards as archiving in the UI (`assertInformationQuestionsArchivable`). Spot-owned answers
are included in every provider's packet and have no provider delivery record.

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

`convex/actions/procurementInformation.ts` runs a code-owned provider flow
(`convex/lib/procurementInformationProviderExtraction.ts`):

1. The body is split deterministically into paragraph, list-item and sentence
   segments with source offsets (`convex/lib/procurementInformationSegments.ts`).
2. One Jev Noul per segment asks whether it requests anything. Only a confident
   no skips a segment; if detection is unavailable every segment is processed and
   the extraction is flagged for review.
3. Contiguous request segments are grouped and each group gets one bounded
   structured generation, all in parallel. There is no model-reported
   completeness flag and no continuation loop.
4. Verification runs atomic Nouls in parallel. Per request segment: is any request
   unrepresented, is anything conditional on a yes/no answer, and is one fact
   asked for several locations or entities. Code then requires zero uncovered
   requests, a conditioned proposal where the source is conditional, and more than
   one subject where the source repeats a fact. Per proposal: requested,
   conditions and any semantic reuse, combined with `jevAtomicConjunction`.
   Deterministic scope checks still apply.

Clear, supported requirements populate the tracker automatically. Unknown scopes,
uncertain decisions, invalid definitions and failures remain available for manual
review through From email. A matching provider/fact already tracked resolves its
review indicator even when it was recognized from a later message.

For client replies, only unresolved request questions are offered as targets.
Generation returns the explicitly stated answer and an exact quote. Jev uses the
prefill band on three atomic Nouls (stated, target/scope, quote support),
combined with `jevAtomicConjunction`. Final code
rechecks the sender/target, quote, primitive, literal value and current answer
revision. Numeric grouping commas may be removed; units/multipliers and currency
conversions are not inferred. Prerequisites are processed first and must apply.
Existing operator or client answers are never silently overwritten.

Extraction is persisted once per request/message; duplicate deliveries do not
repeat inference. An atomic per-request claim serializes extraction so each message
reads facts saved by preceding messages. The request/status index selects the
oldest running row without scanning completed history. `processingStartedAt: 0`
marks unclaimed work; a positive timestamp owns inference and starts its watchdog.
Absent markers are legacy work that may already own inference and are not replayed.
Completion, failure and expiry wake the next queued row. Unknown outcomes never replay generation. Confidence-check
failure holds the proposal, and a watchdog closes stalled work. Hosted generation
uses durable router jobs; native-local generation uses the existing bounded
synchronous transport for this task kind. Email content cannot send messages,
change the accepted application, grant access or make insurance eligibility
choices.

## Public research suggestions

Before the client is asked, Spot tries to pre-answer unresolved questions from
cited public research. `convex/lib/procurementInformationResearch.ts` owns
eligibility, answer normalization, queueing and suggestion resolution;
`convex/actions/procurementInformationResearch.ts` runs the research and
`convex/procurementInformationSuggestions.ts` owns runs, reads and review.

A run considers needed, applicable, company-scoped questions (subject
`company`; other subjects can name people, vehicles or sites) of kind yes/no,
short text, number, currency, date or dropdown (never long text or routes) without a pending or
dismissed suggestion for their current answer revision. Automatic runs also skip
a question whose current answer revision any earlier completed or partial run
assessed (`researchAssessedAnswerId` / `researchAssessedAt` on the question).
Questions added by the
Information panel, provider email extraction or `add_procurement_information_questions`
queue an automatic run after 60 seconds, so questions added together share it;
an active run is reused and its completion queues a follow-up for questions it
missed. `research_procurement_information` queues one immediately. Runs are
idempotent on a fingerprint of the sorted question/answer revisions and the
entity; a failed run, or one that found nothing to assess when it started, is
never reused. A run starts by recomputing its questions; a failure doing so ends
it as failed (`claim_failed`). A watchdog scheduled at enqueue fails a run still
queued or running 15 minutes after its scheduled start. When cl-router does not advertise a
configured research provider (`/v1/capabilities` `research.providers`), an
automatic run is dropped and an operator run fails with `research_unavailable`.

Exactly this is sent to the research providers: the client's name, its public
website, and the city and state/province of its registered (else mailing)
address as the entity; a fixed objective; and, per researched question, its type,
its dropdown options and a description made of the question label, the reporting
period when not `current`, the coverage line when known, the currency for amounts
and the dropdown options. The question's subject, answers, request content,
emails, wiki notes and provider identities are never sent.

Question wording can come from a provider's email, so the label and options are
gated before research. A question is provider-originated when any of its
requirements links a provider outreach or a source email (`outreachId` or
`sourceMessageId`). Catalog questions (non-empty `source`) and Spot's own
questions, whose requirements have neither (added by an operator as Spot
(application) or by the agent without a provider), pass deterministically. The
action then:

1. Asks one batched Jev request with a Noul per question: could a careful
   researcher answer it from public sources without private information
   (`jevProceeds` required). For each provider-originated question the same
   request asks whether its label or options contain specifics of the client's
   own situation (amounts, incident or loss dates, people's names, street
   addresses, claim, policy or account numbers); it proceeds only when that is
   confidently false, at most `1 − JEV_PREFILL_THRESHOLD` (the prefill band's
   low verdict). At most 40 questions are researched per run; rejected
   questions count as assessed. Jev sees the label, kind, options, period,
   coverage and currency, never the subject.
2. Calls cl-router `research` (durable `/v1/jobs`, task kind
   `procurement_information_research`) with at most 10 typed fields per job and
   `standard` depth. Yes/no maps to boolean, number/currency to number, date to
   date, dropdown to enum and short text to string.
3. Keeps values that fit the question (normalized to `Yes`/`No`, number strings,
   ISO dates or an exact option), have high or medium provider confidence and at
   least one public citation. A citation without excerpts (Exa) is grounded by a
   bounded retrieval of that page (its URL and the field description); an answer
   without grounding text is dropped. Excerpts are cut to 600 characters here.
4. Verifies every candidate in one Jev request with two atomic Nouls: the
   evidence is about this company rather than a namesake, and the excerpt states
   the answer for the question's period. Both must `jevProceeds`.

Suggestions store the normalized answer, provider confidence, provider, up to
five citations (only the leading citation's excerpt, exactly the verified text of
at most 600 characters, which operators see in full) and the
question's answer revision. Web content is untrusted evidence; runs store only
counts and short Spot-owned error codes, never provider output.

Suggestions are never answers and do not resolve questions or close forms. Any
recorded answer (operator, client form or client email) supersedes the question's
pending suggestions as `answered_elsewhere`, and reads ignore suggestions whose
answer revision is no longer current. Operators accept (the operator answer
writer records it with `Public web research (<provider>), accepted by operator:
<source>` provenance) or dismiss them in `procurementInformationSuggestions` or
with `review_procurement_information_suggestions`; `get_procurement_information`
shows each question's pending suggestion and the latest run. The client form read
includes only high-confidence pending suggestions for an open form's unchanged
questions, with source URLs and titles. Submitting the form confirms a shown
suggestion whose answer matches (`client_confirmed`) or records the correction
(`client_edited`); clients never see medium-confidence suggestions, run status or
other requests' suggestions. The internal `stats` query reports status, resolution
and confidence counts for acceptance and correction rates.

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
recipient and approval checks remain authoritative. Submitting or cancelling a
form atomically terminalizes only its exact linked client sequence and cancels
pending reminders. Submitted-form email remains available, with zero automatic
follow-ups reflected in both the composer and send backend. Client request views and submitted intake show open forms.

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
