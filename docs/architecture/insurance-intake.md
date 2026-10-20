# Reusable insurance request intake

`procurementRequests` owns the application and fulfillment lifecycle. `clientOrgId` is optional only before company attachment. New drafts require `ownerUserId`; existing requests retain their prior ownership fields. Optional additions need no production backfill. All shared packet, proposal, event, and fulfillment boundaries reject requests without a company.

`requestHandoffs` holds a hashed, 30-minute, one-use bootstrap capability and landing contact details. POST `/api/intake` accepts `{name,email,phone,handoffKey?}` and returns `{signupUrl,existingAccount}`. A landing form should generate one random 64-character hex `handoffKey` per submission and retain it for retries. Never put contact details into redirect URLs or analytics. Existing emails require OTP before access. New emails create restricted users and user-owned draft requests; the `intake` Convex Auth credential provider consumes the token to establish a restricted session.

The four questionnaire sections and review live at `/intake?request=<id>`. Partial typed answers, step and revision persist on the request. Saves are serialized, debounced, flushed before navigation, and reject stale revisions. Local pending answers recover after refresh/offline interruption; confirmed server data is authoritative. Cross-device access uses normal email authentication. Verification from another session never inherits an unrelated unverified draft. Existing-session OTP confirmation revokes restricted sessions and issues a fresh session.

`requestIntakeUploadIntents` scopes upload issuance to actor/request and expiration; `requestIntakeFiles` stages completed storage references before company attachment. Uploads use the existing background task provider, bounded file/total sizes, timeout and explicit retry. Submission atomically attaches files to `clientFiles` and `procurementFileItems`, makes them client-visible and keeps broker release hidden. It preserves the submitted snapshot, creates the shared request brief and private packet, and contributes dated company prose without modifying policy evidence or policy overrides. Research uses existing scheduling primitives.

The manual intake readiness review, checklist mutation, and marketing/binding readiness gate are removed. Ordinary procurement lifecycle authorization still applies. Legacy optional readiness fields remain schema-compatible with existing documents but have no active intake writers.

New coverage requests reuse the same questionnaire and prefill authorized current company answers from the latest submitted application; existing companies without an intake snapshot supply missing details. Saved company prose remains owned by `markdownDocuments`, and current policy facts stay on policies. Vendor and broker invitation flows remain separate.

Local QA evidence and isolation failure modes: `docs/testing/insurance-intake.md`. No production deployment or cleanup is part of local validation.

Landing handoffs enter directly at the first request question after contact collection. Entry, questionnaire, recovery, and application overview share `IntakeFrame`. Submission stays at `/intake?request=<id>` and displays editable application sections rather than insurer-status stages. Section links reopen the original input pages. Submitted amendments preserve the original issued snapshot without a separate readiness approval. Owner-authorized answers and uploaded files remain accessible; operator-private activity remains private.

Coverage selections own their limits, optional additional-coverage notes, and
item-level scope. Property scope reuses the existing Mapbox location input;
commercial auto scope stores bounded year/make/model/VIN rows. Company-level
lines bypass item scope. Existing prose is retained as editable previous details
and is never inferred into property or vehicle records. Server submission uses
the same scope and monetary-limit validation as the browser. Optional empty
steps show Skip and do not emit a saved-answer toast; successful Continue emits
a toast after persistence. The application overview derives completeness from
actual applicable answers and skipped steps.

The request picker uses ActionSurfaceButton with Card, CardHeader, CardContent,
and OperationalLabelValueList. Selection changes only card presentation and
requires the shared footer Continue action to navigate or create a request.
Draft/Submitted status remains unchanged. The shared frame header is sticky at
the desktop breakpoint and remains in normal flow on mobile. The footer's
measured height offsets notifications above its controls.

Registered business address uses the shared Mapbox AddressAutofillInput and
supplies typed registration country/state for tax branching. United States
shows FEIN, Canada shows business number, and other countries bypass the tax
step. Mailing asks whether it matches registration; Yes copies the full address
including coordinates and follows later registered-address edits. Registered
address also projects into company confirmation and Markdown. Country/state
Select controls were superseded by this address-based flow. Intake dropdowns
with more than10 items use the shared SearchableSelect.

Two/three-choice intake fields compose Base UI RadioGroup/Radio with the shared
Button primitive in one IntakeRadioChoices owner. Selected cards use the primary
variant. Mailing No opens a saved address-entry substep; related entities starts
with an explicit Yes/No gate. Read-only address preview uses Mapbox Static Images
API because the search SDK minimap hardcodes zoom16. MapboxAddressPreview owns
responsive image dimensions, zoom14, theme styles, green marker, and retained
provider attribution. Search suggestions retain Mapbox's keyboard and retrieval
behavior with the shared typography and dropdown tokens.

Requirements intake now derives document applicability from the reason cards rather than a separate requirements question. Customers can attach the complete mortgage/lease/contract or paste requirement prose. Uploaded requirement files schedule a one-shot `intakeRequirementPrefill` action, reusing the existing contract extractor's parsing, grounded schema, prompt, and durable model router. Results remain request-owned suggestions; the browser fills only missing values, preserves explicit selections, and persists consumed source identifiers. Extraction errors are server-only and never interrupt manual intake. Amount inputs contain their uncertainty checkbox in a shared InputGroup; choosing uncertainty hides the entry area and toggling it back restores the prior local amount.

Website saves now schedule bounded request-owned research before submission. `researchCompanyProfile` shares the existing official identity, evidence gathering, and Jev verification path between organization research and draft intake. Public default router settings are used before an organization exists. `intakeCompanyResearch` projects verified description/founding year and catalog-selected industry/category into suggestions; stale identities are rejected and only missing local answers are filled. No organization membership is created. Missing router configuration leaves manual entry available. Annual and projected revenue are separate persisted screens within cursor 18, each with reporting period before its shared dollar input; the summary retains both period and amount.

The final review and submitted application share one sectioned overview with editable sections and detailed coverage cards. Submit saves the request immediately for the authenticated owner, including restricted intake users; email verification is a follow-up banner, not a submission prerequisite. Restricted users retain only their own request access after company attachment; workspace access still requires verification. Verification proofs can be prepared after submission and retain the same owner, token hash, expiry, and email checks.

Email confirmation is optional for owner-authorized application edits and supporting uploads after submission. Save, upload intent, and attachment mutations use the same request ownership checks before and after submission; revision checks and upload authorization remain enforced.

Submitted applications show collapsed sections and a static confirmation checkmark. Email confirmation is a compact optional banner. Resubmit compares a canonical hash of answers, substantive detail fields, and attachment IDs against the latest acknowledged submission; navigation and prefill bookkeeping do not enable it. Resubmission revalidates the request and returns it for review without replacing the original submitted snapshot. Section edits keep Back on the left and Continue on the right, returning to the overview after the section.

Requirement-upload suggestions also carry extracted coverage conditions, maximum deductibles, required forms/provisions, and retroactive-date requirements into each line’s additional coverage details. Existing entered notes and limits are preserved. Unsupported limit fields remain in the notes rather than disappearing from the intake. The path reuses the same Convex PDF text primitive and requirement extraction schema/prompt as compliance imports; contracts remain evidence, not policy records.

Commercial-auto make/model fields use shared searchable selects backed by the public NHTSA vPIC catalog through `/api/vehicle-catalog`. Models follow the selected make and model year; make/year changes reset dependent models. Catalog requests send no VIN or customer data, cache public results, and retain manual entry for specialty vehicles or catalog outages. Vehicle actions use the same large pill primitive and typography as intake navigation.

Intake Slack activity uses `intakeSlackEvents` as a request-scoped durable outbox, with a thread timestamp and delivery lease on the request. Configure `INTAKE_SLACK_CHANNEL_ID` to the internal #submissions channel and `SLACK_CLARITY_TEAM_ID`; the existing Convex Slack Web API transport owns the bot credentials. Start and step transitions enqueue untagged messages; only submit/resubmit enqueue @here. Progress messages include the actual saved applicant contact and answers, structured coverage limits and current coverage ordinal. Every autosave, including a save on the same question, queues a revision-keyed edit of the original thread message with the latest values. File additions/removals also refresh that summary. Repeated event keys are deduplicated; the existing delivery lease serializes sends and edits, and pending summary edits read the latest stored answers rather than replaying an older snapshot.

The internal summary includes entered applicant fields (including company/request notes), status, revision, verification state, save timestamps, skipped questions and uploaded filenames. It never serializes request/user records, inbox or verification capabilities, signed file URLs, or document contents. Text is escaped literally so applicant Markdown cannot create Slack mentions or links. Long rendered messages are split below Slack's text limit with continuation parts in the same thread. A summary is current saved draft data, not proof of submission or coverage. Failures remain in the outbox, retry up to five times, and never block the saved application. `intakeSlack:refresh` is an internal exact-ID backfill requiring the inspected revision and original thread timestamp plus matching configured team/channel. Backfills edit the existing bot message without changing applicant answers or replaying a submission.

The saved-business choice shows a compact identity summary. New company detaches only the owned, unsubmitted application from its saved company and clears company answers while preserving coverage/request answers. The mutation checks the revision; finalization creates a separate company without modifying the saved company profile.

Final review requires an explicit accuracy and insurance-shopping authorization checkbox before submit or resubmit. The server checks the owner’s consent and exact application revision, then records the consenting user, timestamp, statement, and submitted content hash. Editing clears the local confirmation; existing submissions are never retroactively marked as consented.

### Client workspace activation

Client organizations use `clientAccessStatus: "intake" | "active"`. An unset status defaults to intake. The client shell redirects intake clients to `/signup` (the application picker) before rendering workspace routes. Active clients land on `/requests` from `/`. Operators can manually change the status with `orgs:setClientAccessStatus` using `{orgId, status}`; clients cannot activate themselves. This rollout flag is separate from email verification and existing server resource authorization.

Submitted procurement pages open the structured Application tab. `intakeSubmittedApplication` contains accepted answers, typed details, attachment references, timestamp, and revision. The original snapshots remain immutable; mutable draft saves never update accepted facts or shared prose. Resubmission updates the accepted version and packet revision. Company administrators also promote allowlisted company facts into `organizations.intakeBusinessProfile`; policy evidence remains independent.

Owner intake, client request detail, operator application, and company views reuse the intake row-card components directly. Client request detail exposes the typed application only while its managed block remains in the authorized shared packet; it omits intake upload references and preserves the separately filtered shared-file list. Notes remain independently editable Markdown. Shared packets generate Markdown from the accepted application inside the existing `spot-current-application` control markers, preserving authored prose outside that range. Reads and view switches never write. Generated facts cannot be edited through the Markdown editor; amend the intake and resubmit. Deliberately removing the entire managed block remains a publication choice. Issued snapshots and existing links are not rewritten or rotated by migration.

`intakeApplicationMigrations:promoteSubmittedApplications` is an additive, resumable migration using the installed migrations component. Run a dry run against an explicitly selected deployment, then apply after review. It promotes the prior acknowledged baseline (or original snapshot), never unsubmitted edits, and promotes company facts only from administrator-owned submissions. Legacy fields remain optional for rollout compatibility. The local migration processed 12 records; production rollout is separate.

Operator procurement navigation exposes Application, Brokers, and Files. Internal request notes appear as an autosaving editable field above Application, still stored in operator-only `private.md` with revision checks and preserved front matter. The separate Notes tab and Markdown import/download/view toolbar are removed from procurement. The duplicate Shared tab is removed; old `view=shared` links resolve to Application for submitted intakes. The Share link action remains on Application and publication still uses the authorized `public.md` projection. Operator review surfaces use 14px body text, 15px headings, and compact row padding; client intake and public packet typography are unchanged.

Operator request and Profile edits auto-save; Back flushes pending changes before leaving. Account identity/access fields live in Profile, alongside editable structured company facts. Coverage limits use a compact operator-only grid. Intake information steps allow skips while retaining partial answers; final submission still enforces its existing required facts and authorization. Commercial auto starts with one vehicle and accepts partial vehicle details, including missing VIN. Company enrichment silently fills only empty fields after verified research; failures remain in server logs. Loading uses the shared Skeleton primitive within the intake frame.

The separate company accuracy confirmation page is retired. Its former step index remains reserved for saved-draft compatibility and redirects to insurance history (or back to locations); it is not rendered or required for completion/submission. The final application accuracy and shopping authorization checkbox remains the confirmation boundary.

Policy savings intake uses the shared buying-reason choice. Savings applicants upload at least one PDF policy, then provide business information; request timing, coverage selection, and procurement questions are skipped. The existing owner-scoped intake record stores recovery and the accepted snapshot with `intakeGoal: savings`; it remains excluded from Procurement lists and resource access. Submission creates idempotently linked policy uploads through `createOwnedIntakePolicyUpload` and the existing policy extraction pipeline, without procurement packets, file items, or marketing lifecycle. Admin follow-up is under the business’s Policies page. The received confirmation makes no fixed turnaround promise, and accepted savings reviews are read-only.

Savings intake enters through the shared buying-reason question (“Save money on my current policies”), not a separate quote/savings page. Draft saves derive the purpose from the recognized reason. Selecting savings leads to current-policy upload and then company information, bypassing coverage questions. Review exposes the reason for correction before submission. Existing savings records remain supported.

## Adaptive follow-up questions

Quote drafts add two sections before review: Application questions and Additional
details. Every selected/generated question is a separate page, with Back,
Continue/Skip within its section. Persisted section IDs
29 and 30 and `IntakeDetails.followupProgress` retain the current position;
review keeps ID 28 for existing links. Savings reviews skip both sections.

The canonical `docs/procurement/acord-intake/question-catalog.json` is imported
unchanged from PR #519 at `d982690a2e19bbeb3004d1c3fb920a201109daa0`:
475 original Spot questions, 36 groups, seven coverage lines, and business
supplements. ACORD-code mappings remain explicitly unverified. The adjacent
source schemas, index, manifest, model graph and contract are retained.
`convex/lib/intakeAcordQuestions.ts` adapts the catalog to the current six
input primitives, preserving the original ID in the answer source. Company/coverage money fields use the shared dollar input. Rich values
use text with currency/period/unit/subject guidance; this does not implement the
source contract's proposed typed schedules and subject-scoped answer storage.
Coverage mappings and explicit parent conditions gate candidates in code.
Unknown parents do not qualify: dependent questions can qualify on a later
preparation with known parent answers, not dynamically during the same batch.
Restricted identifiers, upload-reference questions, and questions requiring an
unspecified history period stay out of this adapter. Uploads use existing flows.
Each eligible candidate gets an atomic Jev Noul with the full saved application
and source metadata. Twelve decisions share a request, with at most three
requests in flight; only answers meeting `jevProceeds` qualify. At most 40
questions are retained, ordered by probability. Catalog revision and adapter
version participate in the context hash so old boilerplate batches refresh.

`convex/actions/intakeFollowups.ts` then asks the routed `analysis` task for up
to eight further questions using the saved application, previous ACORD
questions and answers. Its bounded schema permits yes/no, short text, long
text, number, currency and dropdown inputs; model output cannot supply executable UI.
Hosted generation uses the existing durable router transport. For `SPOT_ENV=local` only, bounded additional-question text generation explicitly uses the same router's synchronous endpoint before any job submission, avoiding an unreachable local callback. This is not a retry/fallback after a durable request. `generateObjectForPublicTask` rejects that mode outside local intake analysis, or for messages/tools/unbounded output; default callers remain durable.

`requestIntake.prepareFollowups` authenticates the owner and schedules one
batch per application-context hash. Private results use a token and a fresh
context check to discard stale work. Pending/failed outcomes do not
implicitly replay inference. A failed or stalled batch permits the applicant
to continue. Edits and reloads retain prior question definitions and answers.
The UI position is excluded from submission and generation-context hashing.

Follow-up answers use `IntakeDetails.followups`, validated against server-issued
or previously saved definitions. They flow into the immutable accepted
application, review/edit UI, operator application review, amendment comparison,
Slack context and Markdown projection. They do not promote into the company's
allowlisted business profile. Existing detail fields retain their 32 KB limit;
combined details including the bounded follow-up rows permit 128 KB.

See [the follow-up workflow guide](../testing/intake-followups.md) for coverage
and external router prerequisites.


The retired compound starter question `acord126_subcontracted_work` expands to
separate description and annual dollar-spending steps for unanswered drafts.
Stable child IDs are server-allowlisted only from that existing source question;
previously answered prose and submitted snapshots are preserved. Draft question
lists deduplicate expanded IDs. Generated follow-ups explicitly request one fact
per question and support currency; source text fields remain text. Currency
answers reuse the intake's dollar formatter and retain dollar notation in review,
Markdown export and Slack context. Period-bound and repeated-subject source
amounts retain text until their scope/period can be represented faithfully.


Follow-up context includes `questionHistory`: every base step and its labeled
fields paired with saved answers and answered/skipped/unanswered status, plus
all previously asked follow-up definitions and answers. Base facts are reserved
regardless of status; neither blank nor skipped revenue permits a new revenue
question. Granular `IntakeDetails.skippedBaseFields` distinguishes annual and
projected revenue skips on shared step 18. Follow-up answers retain an optional
`skipped` flag, cleared when edited. Legacy blank follow-ups are asked/unanswered
and receive the same no-repeat treatment. Existing typed answers/details and
upload metadata are sent alongside the history. Skip metadata and the history
contract version participate in generation context hashing. Generated follow-ups
pass a separate atomic Jev novelty screen against base facts, history, answers
and earlier candidates; only confident new facts qualify. Exact normalized
duplicates are removed in code. Unanswered retired questions outside the current
ready batch stay in history instead of being appended back to the UI; answered
rows remain available for review/editing.


## Commercial-auto VINs and driver schedules

`lib/intake-vehicles.ts` validates nonblank VINs for 17 allowed characters and
US/Canadian-market position-nine check digits. This checks structure, not registry
existence, ownership or matching the selected make/model. Blank VINs remain
allowed for initial quoting. Partial entries remain saveable as drafts, while
vehicle-page advancement and final server submission reject malformed entered
VINs. Non-auto scope and savings navigation retain their existing behavior.

Commercial-auto coverage routes vehicle scope into driver steps 31–40 before
company details. The roster collects names; subsequent questions repeat per
driver for licensing jurisdiction/class, experience and a clearly stated
five-year accident/violation history, including conditional detail pages. These
fields can be skipped; unknown does not mean No. Birth-date and license-number
pages are optional and off by default, enabled on the roster when the applicant
wants to provide them. Valid entered dates/experience remain enforced. Names are
the only required driver data for initial application submission; this is not a
claim that every carrier can produce a firm quote without more information.
Progressive's commercial-auto quote checklist explicitly allows driving-history
information instead of license numbers for an initial quote; market-specific
requirements still determine later collection.

Stable request-scoped driver IDs and a saved driver cursor retain multiple-driver
navigation and recovery. Review and the accepted snapshot preserve the schedule;
company-profile promotion excludes it. Markdown packet summaries omit birth dates
and license numbers. Driver inputs, review and amendment comparison block session
replay. `driverModelContext` redacts those fields before follow-up inference,
while the question book reserves all driver base facts against repeated prompts.

Commercial-auto quote intake collects freight hauled and approximate current value per vehicle (optional currency) in fixed steps 41–42 before the driver schedule. The retired uninsured-reason step 43 redirects to the existing claims-history step 23. Typed details (`freightHauled`, per-vehicle `estimatedValue`, `noCurrentInsuranceReason`) persist in accepted applications, review/export, Slack summaries, and both model stages’ answered/skipped question history. UI cursor `autoVehicleIndex` is excluded from submission-change comparison. Legacy scope notes remain saved but their redundant intake textarea is hidden.

Catalog adapter v5 binds vehicle, driver, location and property questions to known typed subjects before Jev relevance selection. Subjects without typed records are omitted rather than merged into one yes/no answer. Typed money uses currency; scoped prompts do not request identifiers through Boolean/dropdown controls. Catalog-authored Boolean child questions carry server-approved `conditions` (questionId/answer), appear on a separate page only when the same subject’s parent matches, and clear obsolete child answers when parents change. Saved skipped child history is retained; server saves enforce exact condition definitions and reject entered inactive answers. Review/export hides inactive children. The uninsured-reason question is retired (legacy step 43 redirects to claims step 23); its old typed field remains readable and reserved against AI re-asking. Intake presentation substitutes the saved legal business name (DBA fallback) into generic business/company wording without mutating approved definitions.

Intake review uses shared row primitives for follow-up answers and driver summaries. `lib/intake-submission.ts` shares final validation between review completion links and server submission. `activeIntakeDetails` omits dormant driver/freight data when commercial auto is removed and omits quote details for savings, while retaining the editable draft for recovery. Coverage limit facts already owned by fixed questions are excluded from catalog selection even when blank or unsure. Each prepared section is bounded to 40 questions, with 60 saved/reserved questions overall; conditional groups fit together or are omitted. Finalization rechecks current capacity, token and context. Failed/unknown outcomes never replay automatically. Only the current approved batch appears on ordinary forward navigation; historical questions remain editable from review.

Vehicle-scoped catalog questions share one “More about [vehicle]” intake page per vehicle, using shared Field/Select/Input primitives and concise labels with unit examples. Ordinary business and generated follow-ups retain one question per page. Each answer keeps its server-approved ID/definition; hidden equipment children remain conditional and clear on parent edits. Navigation persists the first question index of each group, preserving existing draft cursor compatibility, and records blank visible fields as skipped when leaving the page.

Additional questions prepare provisionally during insurance history. A prepared batch exposes no answer controls and cannot authorize answer saves. Section entry screens the cache against current facts, paired answers/skips and ready catalog definitions; new affirmative insurance/claims/cancellation branches, business/coverage changes and uploads invalidate the generation scope. Ready initial questions remain usable while one full-context enrichment pass runs. Enrichment only appends novel questions (eight total), keeps issued IDs/order/answers intact, reserves capacity for all issued definitions, and checks the complete latest question history including additional answers. Successful stale-context results claim a new context evaluation; failed/unknown same-context inference is never replayed. A reduced-motion-aware shared Spinner covers residual waits; only the last issued page waits for pending enrichment, with the bounded wait recovery retained.
