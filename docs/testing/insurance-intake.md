# Insurance intake foundation QA

## Acceptance workflows

Use local synthetic accounts and captured email codes only. Do not use production.

1. New customer: landing handoff → restricted session → fill each section → refresh between edits → upload requirements/policies → review → fresh email code → submit → exactly one organization and request, company prose and request packet available.
2. Existing customer: existing-email code required before session; new coverage request reuses authorized company information, confirms scope, and resumes a draft.
3. Persistence: text/selection/step saves; immediate refresh recovery; offline edits retained and retried; stale second-tab writes rejected without losing edits.
4. Files: successful upload survives reload, failed upload is retryable, request ownership checked, submission attaches files with explicit visibility.
5. Finalization: missing minimum answers block submission; wrong/expired codes fail; retries do not duplicate request/company/files.
6. Access: other user/token cannot edit/read draft, consume a handoff twice, attach unauthorized company, use unverified account for company/workspace operations, or read another session's draft after email verification.
7. Presentation: desktop/mobile, keyboard, light/dark, loading/error/saved states.

## Isolation failure modes (specified before implementation)

- Restricted session escapes into organization creation/membership or workspace access.
- Handoff replay creates an additional session for an existing account.
- Final OTP linking exposes an unrelated draft to a mailbox owner.
- Wrong owner accesses request/upload or stale revision overwrites accepted answers.
- Submission retry duplicates promotion or attaches an unauthorized organization.

## Ledger

| Workflow | Status | Evidence |
| --- | --- | --- |
| New customer | Baseline passed; latest rerun pending | `.context/qa/intake-submitted.png`; final OTP/submission baseline |
| Existing customer | Baseline passed; latest rerun pending | Existing-email OTP and company reuse baseline; scope persistence case below |
| Persistence/recovery | Passed baseline and structured scope | `.context/qa/intake-conflict.png`, `intake-recovered.png`, `intake-structured-scope.png` |
| Uploads | Baseline passed; latest amendment rerun pending | `.context/qa/intake-upload-layout.png`; same-origin bounded upload handoff |
| Finalization | Baseline passed; latest rerun pending | OTP/submission baseline plus 63 passing boundary tests |
| Ownership/authorization | Passed current boundary suites | `.context/qa/foundation-tests-current.log`, 63 tests across four suites |
| Responsive/keyboard/themes | Partial | Mobile logo/footer/toast/calendar and desktop header passed; full keyboard/light-theme sweep pending |

Additional domain failure modes selected before structured intake implementation:
- A multi-coverage save drops another selected line's limits, accepts duplicate/unknown line IDs, or silently changes unknown limits into an amount.
- Address/entity edits lose original prose, infer inclusion from policy named insureds, or escape the owner/revision boundary.
- Autosave recovery loses a partial date, coverage limit cursor, or an unsaved entity/location row.

Submitted application amendments must enforce owner and verified-session access, reject stale revisions, preserve the original submission snapshot, and invalidate insurer-readiness approval only when answers change. Navigation-only saves must not invalidate readiness. New uploads must retain the existing scoped upload/replay checks and be promoted to client-visible, broker-hidden request files.

### Request picker regression — October 14, 2026

Actor: authenticated synthetic Foundation QA user on the local backend. In a
separate visible Chrome tab, open `/signup`, select the submitted General
liability / Cyber card, then press Continue.

Passed: no request is initially selected; Continue starts disabled; there is no
Sign out action. Selecting the card enables Continue without navigation and
preserves its Submitted status. Continue opens the selected application. The
application footer shows disabled Submit and View all requests for this user's
multiple requests. Missing request/coverage/business/history answers show Needs
details. Shared Card supplies the spacing variable used by CardHeader and
CardContent inside ActionSurfaceButton. Evidence:
`.context/qa/intake-picker-selection.png`. TypeScript and intake ESLint passed.
The single-request footer branch and mobile picker still require browser checks.

### Coverage and shared-frame follow-up — October 14, 2026

Passed in visible local Chrome: General liability and Cyber show separate
additional-coverage fields with different examples. Skip on an empty additional
coverage step navigates without a saved-answer toast and bypasses the item-level
scope screen for these lines. The date field filters letters/symbols, formats
`11112026` as `11/11/2026`, and Clear empties the field and disables Continue.
The shared header has computed `position: sticky; top: 0px` on desktop and
`position: static` at 390px mobile width. Evidence:
`.context/qa/intake-date-clear-mask.png` and
`.context/qa/intake-sticky-header.png`.

The four existing boundary suites currently pass all 63 tests, including
restricted-session access, ownership, revision conflicts, submission retries,
and preserved original submission snapshots. A regression found that legacy
scope prose was rejected by structured scope validation; legacy prose is now
retained and accepted only before structured replacements exist. Property and
auto row editing, invalid VIN handling, refreshed per-line persistence, and
calendar sizing on narrow screens remain to be verified in the browser.

### Structured scope persistence — October 14, 2026

Actor: existing authenticated Foundation QA user. New isolated local draft
`zx75wqeeefdk9pvqqzvzygm7218g93dp`, created via New insurance request + Continue.
Opened Coverage using the section navigation; selected Property and Commercial
auto; entered each line's monetary limits; entered Earthquake and Hired auto in
the respective additional fields. Added one property address and one vehicle.
An invalid VIN kept Continue disabled. A valid 17-character VIN enabled it.
Continue saved the scope; Back and a full browser reload retained the property
address/details and all vehicle fields. Back again retained each line's separate
additional answer. Evidence: `.context/qa/intake-structured-scope.png`.
This case tests scope persistence, not complete submission: the request's
required request/date questions were deliberately left unanswered.

### Enlarged date picker — October 14, 2026

Visible Chrome at 390×844: the calendar popover measured 276px wide, left86px,
right362px within the 390px viewport; Clear remained visible. No date was changed
in this read-only sizing check. Viewport override reset afterward. Evidence:
`.context/qa/intake-date-mobile-large.png`.

Browser execution uses visible local Chrome because cloud Chrome is unavailable
in this desktop environment. This is a workflow-environment deviation, not a
claim of cloud-browser coverage.

### Current existing-customer finalization — October 14, 2026

The structured scope fixture above completed required request reason/date/
requirements, reused authorized company details with explicit confirmation, and
answered current insurance and claims No. Conditional uploads were bypassed.
Final review showed the separate property/auto limits, item scope, and additional
requests. Submit insurance request succeeded, opening the editable application
overview with the correct coverage lines, company, and November 1 start date.
Coverage and insurance history were Complete; omitted business details and
documents remained Needs details. Evidence:
`.context/qa/intake-structured-submitted.png`. This verified-user flow does not
replace the separate restricted-user final OTP workflow.

Shared UI patch replay passed: applying the patch in an empty ignored directory
produced Calendar and DateField sources byte-for-byte equal to the installed
sources. A clean authenticated package reinstall remains a separate check.

### Registration and tax branching — October 14, 2026

In the submitted synthetic property/auto request, registration begins with
Country defaulted to United States, then an unselected State. The shared state
Select contains 51 options (50 states plus DC). Mapbox address selection populated
United States/New York; country, state, and LLC persisted after Continue/Back/
reload. Canada/Ontario shows only the Canadian business number field with Skip
and no optional label. United Kingdom/England advances directly to mailing
address, bypassing tax ID. Hidden tax IDs are omitted from company confirmation
and final review, and do not count toward completeness for another country.

### Searchable primitives and submitted upload amendment — October 14, 2026

Country and state lists use the existing SearchableSelect primitive. Typing
United States or Delaware filters to the intended result; Delaware's image was
loaded from its local state-specific asset. The 50 states and DC each have their
own flag asset; national flags remain sourced from the phone-input assets.
Intake select helpers automatically use SearchableSelect for more than10 choices,
including industry/category lists. TypeScript and intake lint passed. Evidence:
`.context/qa/intake-actual-state-flags.png`.

Submitted request `zx75wqeeefdk9pvqqzvzygm7218g93dp` accepted the synthetic
`intake-policy.pdf` through the normal chooser/background task flow. It showed
Uploaded, changed Skip to Continue, and remained listed when reopened in a new
tab. This proves browser upload/persistence; backend client visibility and
readiness invalidation still require read-back evidence for this upload.

### Registered-address reuse — October 14, 2026

Latest UI replaces the country/state dropdowns with the existing Mapbox address
primitive, keeping Entity type. A selected registered address derives country
and state for tax branching. Mailing first asks whether the registered address
is also the mailing address; Yes reuses the complete selected address and its
coordinates. Browser Continue/Back/reload retained Yes and the same address,
and the Mapbox minimap remained present. The registered address Input and entity
Select both measured 48px high with16px text. Evidence:
`.context/qa/intake-mailing-reuse.png`, `.context/qa/intake-consistent-address.png`.
Earlier country/state-dropdown checks document superseded UI, not the current
acceptance requirement. SearchableSelect remains in intake helpers for lists
larger than10 options.

Submitted upload backend read-back: the synthetic policy has a clientFileId,
exists in clientFiles, is clientVisible, and has brokerRelease hidden. The
request is ready_for_review. This matches browser persistence evidence.

### Fixed-format input constraints — October 14, 2026

FEIN filters non-digits, caps at nine digits, and inserts the hyphen after two.
Browser input `12a34567890123` became `12-3456789`; partial `123` disabled
Continue. Empty was restored to the synthetic fixture afterward. Canadian
business number is nine digits only, years cap at four digits, and VIN caps at17
valid uppercase alphanumeric characters. Existing shared phone/date primitives
retain their own format constraints. Server submission rejects malformed
provided tax IDs for the relevant country. Evidence:
`.context/qa/intake-fein-mask.png`.

Production build completed successfully before this input-format follow-up:
`.context/qa/build-current.log`. A final build after all remaining edits is still
required; this is not a release-completion claim.

### Related-company radio gate — October 14, 2026

Initial related-company screen has two unselected large radio cards. Yes reveals
one blank structured entity card; incomplete details disable Continue. Add entity
measured64px high. No hides the editor, projects an explicit No answer, and
Continue saves and advances. Existing entity rows remain stored when hidden.
Evidence: `.context/qa/intake-related-radio.png`. All intake choice helpers use
radio cards for fewer than4 options, Select for4–10, and SearchableSelect above10.

Mailing address now has a separate saved substep: No + Continue opens What is
your mailing address; Back returns to the Yes/No question. Map theme follows the
shared useTheme hook and native AddressMinimap light-v11/dark-v11 styles.
Zoom-out verification remains pending because the installed SDK fixes its static
preview zoom rather than exposing a zoom prop.

### Mailing substep and zoomed-out map — October 14, 2026

Mailing No + Continue opens a separate What is your mailing address screen.
Back returns to the Yes/No radio question; Yes reuses the registered address and
advances to related companies. The duplicate small label is absent. Selected
radio cards use the shared Button primary variant: observed selected background
rgb(61,161,255), white foreground, and aria-checked true.

Mapbox's installed search SDK hardcodes minimap zoom16. The existing address
preview now requests the Mapbox Static Images API at zoom14, using shared Card
and Image presentation, a green centered marker, provider-rendered attribution,
and useTheme-selected light-v11/dark-v11. In visible Chrome the dark-v11 image
loaded successfully and the URL's zoom parameter was14 (token omitted from
recorded output). Evidence: `.context/qa/intake-map-zoom-dark.png`.
Light-theme runtime switching remains to be checked. TypeScript/lint passed.

Requirements prefill failure modes to verify before implementation: extraction cannot read an attachment from another request; replay cannot dispatch another inference for the same source; removed or edited client answers must not be replaced by delayed extraction; unsupported or failed extraction remains invisible and leaves manual entry available; source text is evidence, never an instruction; only grounded, supported coverage/limit values can prefill. Browser QA owns visible prefill and silent fallback; server source ownership and one-shot claim must remain transactional.

Latest observed UI: six reason radio cards; date Continue bypasses the removed requirement-source question; pasted requirements saved and recovered after reopening; uncertainty hid the amount and toggling back restored 1,000,000. Screenshots: `intake-pasted-requirements.png`, `intake-hidden-limit.png`. Subsequent integrated-checkbox and automatic document-prefill changes are **not tested**, per the user's explicit instruction to open the draft PR without more tests. Local Convex has no CL_ROUTER_URL/CL_ROUTER_SECRET, so successful model extraction was not exercised. Earlier validation applies only to its recorded implementation checkpoint; latest checks and broader final workflow reruns remain pending.

Website prefill failure modes (before implementation): draft research must stay request-owned without granting organization membership; stale website/name results must not apply; delayed research must not overwrite entered description/year/industry; public identity and facts retain the existing Jev/source gates; missing router configuration leaves manual entry available; dispatch is bounded and replay cannot repeat a claimed research run. Live retrieval success remains unverified without local router configuration.
