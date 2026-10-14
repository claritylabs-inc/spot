# Reusable insurance request intake

`procurementRequests` owns the application and fulfillment lifecycle. `clientOrgId` is optional only before company attachment. New drafts require `ownerUserId`; existing requests retain their prior ownership fields. Optional additions need no production backfill. All shared packet, proposal, event, and fulfillment boundaries reject requests without a company.

`requestHandoffs` holds a hashed, 30-minute, one-use bootstrap capability and landing contact details. POST `/api/intake` accepts `{name,email,phone,handoffKey?}` and returns `{signupUrl,existingAccount}`. A landing form should generate one random 64-character hex `handoffKey` per submission and retain it for retries. Never put contact details into redirect URLs or analytics. Existing emails require OTP before access. New emails create restricted users and user-owned draft requests; the `intake` Convex Auth credential provider consumes the token to establish a restricted session.

The four questionnaire sections and review live at `/intake?request=<id>`. Partial typed answers, step and revision persist on the request. Saves are serialized, debounced, flushed before navigation, and reject stale revisions. Local pending answers recover after refresh/offline interruption; confirmed server data is authoritative. Cross-device access uses normal email authentication. Verification from another session never inherits an unrelated unverified draft. Existing-session OTP confirmation revokes restricted sessions and issues a fresh session.

`requestIntakeUploadIntents` scopes upload issuance to actor/request and expiration; `requestIntakeFiles` stages completed storage references before company attachment. Uploads use the existing background task provider, bounded file/total sizes, timeout and explicit retry. Submission atomically attaches files to `clientFiles` and `procurementFileItems`, makes them client-visible and keeps broker release hidden. It preserves the submitted snapshot, creates the shared request brief and private packet, and contributes dated company prose without modifying policy evidence or policy overrides. Research uses existing scheduling primitives.

Readiness is separate from procurement status. Customer submission means ready for review, with deterministic follow-up items. An operator explicitly confirms readiness for market; marketing/binding transitions for intake requests require this confirmation. Existing requests retain their existing behavior.

New coverage requests reuse the same questionnaire and prefill authorized current company answers from the latest submitted application; existing companies without an intake snapshot supply missing details. Saved company prose remains owned by `markdownDocuments`, and current policy facts stay on policies. Vendor and broker invitation flows remain separate.

Local QA evidence and isolation failure modes: `docs/testing/insurance-intake.md`. No production deployment or cleanup is part of local validation.

Landing handoffs enter directly at the first request question after contact collection. Entry, questionnaire, recovery, and application overview share `IntakeFrame`. Submission stays at `/intake?request=<id>` and displays editable application sections rather than insurer-status stages. Section links reopen the original input pages. Submitted amendments preserve the original issued snapshot and invalidate market-readiness approval when answers change. Owner-authorized answers and uploaded files remain accessible; operator-private activity remains private.

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
