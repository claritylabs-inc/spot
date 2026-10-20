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
Hosted generation uses the existing durable router transport. For `SPOT_ENV=local` only, bounded additional-question text generation explicitly uses the same router's synchronous endpoint before any job submission, avoiding an unreachable local callback. This is not a retry/fallback after a durable request. `generateObjectForPublicTask` permits that mode only for the allowlisted local intake analysis, requirement-prefill and request-owned company-research text tasks, rejecting messages, tools and unbounded output; default callers remain durable.

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

Catalog adapter v5 binds vehicle, driver, location and property questions to known typed subjects before deterministic coverage-pack selection. Subjects without typed records are omitted rather than merged into one yes/no answer. Typed money uses currency; scoped prompts do not request identifiers through Boolean/dropdown controls. Catalog-authored Boolean child questions carry server-approved `conditions` (questionId/answer), appear on a separate page only when the same subject’s parent matches, and clear obsolete child answers when parents change. Saved skipped child history is retained; server saves enforce exact condition definitions and reject entered inactive answers. Review/export hides inactive children. The uninsured-reason question is retired (legacy step 43 redirects to claims step 23); its old typed field remains readable and reserved against AI re-asking. Intake presentation substitutes the saved legal business name (DBA fallback) into generic business/company wording without mutating approved definitions.

Intake review uses shared row primitives for follow-up answers and driver summaries. `lib/intake-submission.ts` shares final validation between review completion links and server submission. `activeIntakeDetails` omits dormant driver/freight data when commercial auto is removed and omits quote details for savings, while retaining the editable draft for recovery. Coverage limit facts already owned by fixed questions are excluded from catalog selection even when blank or unsure. Baked coverage packs are bounded to 120 questions, generated batches to 40, with 160 saved/reserved questions overall; conditional groups fit together or are omitted. Finalization rechecks current capacity, token and context. Failed/unknown outcomes never replay automatically. Only the current approved batch appears on ordinary forward navigation; historical questions remain editable from review.

Vehicle-scoped catalog questions share one “More about [vehicle]” intake page per vehicle, using shared Field/Select/Input primitives and concise labels with unit examples. Ordinary business and generated follow-ups retain one question per page. Each answer keeps its server-approved ID/definition; hidden equipment children remain conditional and clear on parent edits. Navigation persists the first question index of each group, preserving existing draft cursor compatibility, and records blank visible fields as skipped when leaving the page.

Additional questions prepare provisionally during insurance history. A prepared batch exposes no answer controls and cannot authorize saves. Section entry screens current original base and catalog facts; generated answers never recursively trigger more questions. Only changed base/catalog facts or uploads invalidate the terminal list. Failed/unknown outcomes do not replay automatically. Empty or unavailable batches skip their introduction and question page directly to review, preserving saved answers.

Intake section introductions use the shared frame, typography and pill controls, with short copy for each of the seven quote sections and savings-specific policy/review copy. `IntakeDetails.sectionIntroductions` records acknowledged sections as draft-only UI metadata; it is excluded from accepted facts and model context/hash. Review edits and mid-section resumes bypass introductions. Switching purposes resets introductions for changed sections, while company switching retains seen state and request-owned vehicle/driver details entered earlier.

Commercial-auto operating routes use `components/ui/route-input.tsx` and the bounded `lib/route-input.ts` value contract: up to eight ordered cities, optional coordinates, and optional maximum travel distance. City search uses the existing public Mapbox token with permanent geocoding for saved selections. Directions and responsive numbered static maps are presentation only; they are not truck navigation. Search/map failures preserve manual city entry and saved answers. The exact transport-routes catalog adapter issues a versioned `routes` control without changing source catalog JSON; generated follow-ups can use the same kind. Existing text answers remain text. Drafts can retain incomplete routes, but navigation/submission requires either two named stops, distance-only information, or an empty skipped answer. Shared formatting projects readable city sequences into review, exports, Slack and question history.


### Coverage-owned vehicle facts and inferred follow-up answers

Standard commercial-auto vehicle facts are deterministic optional fields in the
Coverage scope cards, owned by `lib/intake-vehicle-underwriting.ts` and
`vehicle-underwriting-fields.tsx`. `vehicles[].underwriting` stores request-owned
answers. Legacy scoped catalog answers remain readable through exact vehicle
identity matching; explicit typed corrections win. These facts are reserved
before catalog relevance and additional-question generation, even when blank.
They do not promote to the company profile. Coverage review includes each
vehicle, commercial-auto quote details and the driver schedule. Vehicle headings
use the same element and primitive/scoped styling as Locations.

The visible flow has six sections: request, coverage, company, insurance history,
additional details, review. Persisted ACORD step 29 and generated step 30 retain
their IDs and share Additional details; there is no standalone Application
questions section. Remaining catalog answers appear under Coverage in review.

For selected/generated yes/no follow-ups, one independent Jev Choice per question
selects Yes, No or Unknown from application evidence. Only Yes/No whose confidence
and chosen probability meet `max(0.70, JEV_PROCEED_THRESHOLD)` produce proposals.
Unknowns, invalid results and router failures leave ordinary questions visible.
Final writers recheck batch token, status, capacity, base context and the complete
human-answer evidence hash. They never overwrite a human answer or explicit skip,
or fill an inactive conditional child. Saved prefills carry server-owned confidence
and context provenance; public saves reject forged provenance. Prefills are omitted
from ordinary question navigation, labeled in review, and editable through review.
Evidence edits revoke untouched inferences, while manual corrections survive.
Provenance is excluded from semantic submission comparisons. No failed or unknown
inference is automatically replayed.

The route primitive writes version 2 with up to six independent routes of up to
twelve ordered cities. It reads legacy version-1 single routes without rewriting
saved source. A route title uses its start and last entered stop with an ArrowRight
icon; controls use Start, Stop, or numbered stops. There are no reorder controls,
Clear route action, distance input or approximate-route banner. Add route and Add a
stop use the same large secondary PillButton. Legacy maximum-distance values remain
in source but are omitted from presentation and export. Travel radius is retired
and reserved against model re-asking. The route answer limit is 16,000 characters,
within the existing overall intake document budgets.

Requirement intake quietly adds grounded coverage suggestions even when another line is already selected, fills only blank limits, and remembers explicit coverage deselections. Unspecified limit bases default to aggregate where the coverage supports an aggregate field; explicit bases keep their mapping, and unsupported fields remain in notes. No extraction status banner is shown. Local text-only requirement prefill selects the bounded synchronous router path before inference; hosted and image calls remain durable, with no automatic replay after unknown outcomes.

Intake and operator multiline controls grow with their content using the shared textarea primitive and scoped content sizing. Requirement prefill does not copy the base coverage requirement into additional coverages; only extra conditions or limits without a matching fixed field are carried there. On ordinary navigation, Back from a section’s first question reopens its saved introduction before leaving the section. Crossing into another section resets that introduction acknowledgment; review edits retain their direct return behavior. The legal-name question title stays generic while the applicant types.

Company identity intake asks for the optional Company name (typed DBA/trading name) first, then legal name and website together. Saved question history uses that same field ordering. These two question titles stay static. Intake treats the applicant-provided website as the confirmed source and retrieves its cited content directly, without a company-name identity match. A website alone can start research; legal/trading names are optional context. Local request-owned research selects synchronous router retrieval and bounded text generation before submission (description output at most 1,500 tokens); hosted research stays durable. Facts still need website support, entered answers are preserved, and failed/unknown attempts never automatically replay.

Business-description industry prefill uses the request-owner-authorized `actions/intakeIndustry:suggest` action and `clRouterDecide` (`/v1/decide`) against the shared industry taxonomy. It runs for a prefilled description on its page or after description blur, only when industry is blank. Client guards reject stale descriptions, changed requests, manual industry selections and values filled while the decision was pending. Decisions are attempted once per description per mounted request and never automatically replayed after failure. Empty ready follow-up batches skip their intro and answer pages after entry screening; pending/enriching batches wait, and failed batches skip directly to review without an empty question page.

Generated follow-up controls are chosen by Jev Choice during the existing novelty screen, including the shared DateField for a single calendar date. The approved `date` kind persists like other declarative controls; partial date typing is recoverable, while navigation and final submission require a valid entered date or an empty skipped answer. Existing approved text questions receive request-owner-authorized, read-only date presentation hints through `actions/intakeFollowupInputs:dates`, without rewriting question definitions or saved answers.

Each successful Continue save schedules a request-owned Jev gap assessment over the current typed application, paired question history, file metadata and planned follow-ups. Assessments are deduplicated by application context and token; stale/unknown results do not authorize generation. Only a confident Yes starts terminal LLM follow-up generation; a confident No preserves planned questions without generating more. The same Jev gate protects ordinary section-entry generation and preloads. Pending inference is retained, and provisional results are screened before acceptance. Driver birth dates/license identifiers remain redacted.

All intake question generation, relevance/novelty, input-selection, Boolean-prefill and gap-gate prompts share the applicant audience rule in `convex/lib/intakeQuestionGuidance.ts`: ask only facts an applicant can reasonably know, never insurer reserves, paid/incurred totals or internal underwriting/claims data. The question-context version includes this policy and input-control change so cached batches are rescreened on entry; saved answer history is retained. Review address values use the same typography role as surrounding row values.

Final additional-question generation is a terminal layer over original base and
ACORD/catalog facts. Its context hash, gap assessment, generation evidence and
stale-result checks exclude generated additional answers. Existing generated
question definitions are supplied only to prevent duplicates. Completing or
revisiting the final list cannot generate another list; only changed base or
catalog facts/uploads invalidate it. Accepting a screened provisional list no
longer schedules an automatic enrichment pass. Current ready batches open
without a preparation screen, and completed/skipped additional answers receive
the same Complete badge as other review sections.

Request notes (`answers.requestDetails`) also inform coverage preselection through
owner-authorized `actions/intakeCoverage:suggest`. Atomic Jev Nouls select only
supported coverage categories requested or clearly described in the notes;
uncertain results stay manual. The existing requirements-suggestion merger adds
missing lines without replacing entered limits, scope or explicit deselections.
A hashed consumed-notes marker uses existing request-owned prefill source metadata,
so unchanged notes do not replay on reload. Stale notes/request results are ignored.
No progress banner is shown. Tenant insurance does not imply building ownership.

ACORD/catalog pages now belong to Coverage (cursor 29, section 1), following
fixed scope/vehicle/driver pages and preceding Company. Final additional questions
remain terminal after history (cursor 30); old drafts that already completed
history can finish their catalog batch without repeating company pages. The
separate business-location page (19) is retired; resumes redirect past it and
submission no longer requires that duplicate field. Historical location data
remains readable.

Saved history progress schedules `warmFollowupsAfterSave` in Convex for provisional additional candidates. Standard catalog packs are local and require no warmup. Existing pending tokens retain ownership; failed or unknown inference does not replay. Structural preparation logs carry no answers.

`lib/intake-applicant-wording.ts` owns applicant-facing catalog presentation without
rewriting approved definitions. Scoped location/property questions keep one page
per question, with a named subsection and address above the title. Saved names are
matched by address, preferring a named property over an unnamed duplicate business
location. Content examples use the existing industry taxonomy and remain
placeholders only. Subsections reuse the section-introduction primitive with
“More information about {name}”; request-owned `subsectionIntroductions` tracks
acknowledgment and is excluded from inference, prefill invalidation and accepted
fact projections. Back from the first subsection question reopens its start card;
review edits bypass the introduction.

Property scope now collects only location name/address. Activities, owned/leased
status and staff count are fixed typed pages in each location subsection, composed
by `lib/intake-property-subsections.ts` with matching catalog questions. Their
answers read/write `CoverageRequest.properties` directly, never generated follow-up
answer rows. Base-question history reserves those facts, and the catalog adapter
excludes duplicates. They are composed with the local catalog pack without an inference wait. IDs include address identity;
subsection navigation and introductions use the ordinary persisted catalog cursor.


Standard Coverage questions come from reviewed IDs in `docs/procurement/acord-intake/coverage-question-packs.json`, projected by `lib/intake-coverage-questions.ts` and the shared `lib/intake-acord-questions.ts` adapter. No runtime ACORD Jev selection or question fetch is required. Typed coverage, industry, subject and parent-answer gates determine applicability; specialized tail/extended-reporting elections are excluded from initial quote packs. Conditional child definitions are approved up front, and saves compare condition fields independent of object key order. Final generated questions remain a separate bounded terminal pass. Applicant choice questions with fewer than eight options use the shared large radio controls; larger sets use shared Select primitives.

Coverage review has no Other coverage details subsection. Property identity, address, activities, occupancy, staff and scoped catalog answers share one named location row card, using the common review primitives. General catalog answers appear directly under Coverage. Saved inactive child answers remain hidden.

The retired `eo.terms.extended_reporting` question is hidden by shared follow-up visibility, including historical answers in draft/review/export; saved history remains intact and does not prevent saves. Coverage review sorts catalog answers in pack order under their owning coverage before named location cards. Location subheadings use `heading.micro`, and question navigation keeps general coverage terms before each grouped location subsection.

Quote navigation now orders Request → Business → Coverage → Insurance history →
Additional details → Review. Persisted step and section IDs remain unchanged;
progress indicators and review ordering use the displayed sequence. Saved-business
confirmation also leads to Coverage. Navigation-derived introduction state is
initialized before any loading/empty early return, so automatic optional-section
skips cannot access uninitialized bindings. Temporary unavailable batches must not
persist a clamped follow-up cursor.

Vehicle scope collects Year/Make/Model/VIN per coverage. Fixed underwriting facts
are request-owned typed pages in named vehicle subsections, composed by
`lib/intake-vehicle-subsections.ts`, with a subsection introduction and coverage
header. Body type uses a bounded Jev suggestion from make/model/year and only fills
an unchanged blank field. Vehicle distance/weight/count inputs use shared number
primitives with explicit miles/lb/seats; legacy metric units remain preserved.
Applicant presentation uses the authored `lib/intake-catalog-wording.ts` map without
rewriting saved approved definitions. Numeric, currency, date, text and choice
follow-ups accept the intentional “I'm not sure” answer across UI/save/review.

`convex/actions/intakeCyberResearch.ts` runs request-owned background public website,
privacy, terms and technology-profile retrieval through cl-router. Existing website
research evidence is reused. A bounded structured LLM extraction proposes facts;
exact retrieved quotes/source URLs and independent Jev Nouls gate each answer and
technology. Public website technologies never establish internal security controls
or vendor-feature adoption. The request stores context-keyed proposals, not direct
answer writes. The owner UI merges only untouched, unskipped, non-current questions
through ordinary revision saves; server saves bind provenance to exact approved
proposals. Entered/unsure/cleared/skipped answers always win. Changed source facts
revoke untouched inferred answers. Failed/unknown outcomes do not replay for the
same context, do not block navigation, and never imply No. Missing policy links
have optional shared URL fields in Cyber; accepted user links remain request-owned.

Workers’ compensation owner elections have an adapter-authored conditional child
for names, roles and include/exclude choices. No/unsure hides and clears obsolete
child values using the existing condition contract. Payroll now uses a versioned
structured answer (`lib/intake-payroll.ts`) with up to six employee groups, optional
headcounts, total amount, currency and reporting period/custom dates. Legacy prose
is preserved, and review/export render readable group summaries rather than JSON.
Shared questions use the selected coverage pack’s ownership before generic catalog
coverage groups, preventing payroll from being labeled Professional liability.

Final quote and savings submission accepts invalid or missing phone numbers.
Review completeness and the server submission gate do not validate phone syntax.
The raw entered value remains in the accepted application. Updating the user's
normalized phone is best-effort: invalid/blank values are omitted, an existing
profile phone is preserved, and numbers belonging to another user are not assigned.
Initial contact capture and explicit profile phone changes retain their own rules.
