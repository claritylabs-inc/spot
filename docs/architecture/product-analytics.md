# Product analytics

Spot's PostHog project is [Spot](https://us.posthog.com/project/667578), in the Clarity organization (US region). `instrumentation-client.ts` initializes the browser SDK once (the full no-external entry point bundles the recorder and extensions to avoid blocked runtime script downloads); `lib/analytics.ts` owns configuration and the typed capture helper. `components/analytics.tsx` tracks App Router navigation and authenticated opaque user identity, resetting it on sign-out/account switch. It mounts globally in the sync provider, across client, operator, intake, and shared packet routes.

The public write-only project token is a checked-in default, overridable with `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`. `NEXT_PUBLIC_POSTHOG_HOST` overrides the default first-party `/ingest` proxy in `next.config.ts`. `NEXT_PUBLIC_POSTHOG_DISABLED=true` disables initialization/capture. These are build-time public settings; no personal PostHog API key belongs in the app. The organization's suggested managed proxy was not DNS-resolvable during setup, so Spot uses Next rewrites to US ingestion/static hosts.

Coverage: pageviews/pageleave, automatic interactions, dead clicks, browser exceptions, web vitals, session replay, and explicit intake step/submission/resubmission/upload-outcome events. This is browser product analytics, not a replacement for Convex audit records, server error logs, or authoritative business metrics. No backend event export or production deploy was performed during setup.

Privacy: all input values and DOM text and content-bearing attributes are masked (structural styling attributes are retained so replay preserves the layout). Images, canvases, document viewers, file/hidden inputs and `.ph-no-capture` subtrees are blocked from replay. Console capture, cross-origin iframe capture, and network headers/bodies are disabled. URL query/hash components and long record/token path segments are stripped from analytics URLs. Exception messages are redacted; stack/type remain available. Custom events accept structural metadata only (step, category, success), never answers, files, messages, names, or email addresses. Browser masking is pinned in code, including selective attribute masking, and the project retains its Total privacy default. Explicit browser masking options take precedence over the corresponding project defaults. Session replay is enabled in the project for all sessions, with no trigger restrictions and default 100% sampling. SDK/user opt-out, network/ad blockers, and PostHog quotas can still prevent capture.

QA: use an authenticated local session, navigate between routes and tabs, inspect PostHog Activity for pageviews/autocapture and sanitized URLs, then open Session replay and verify a playable recording with masked content. Exercise intake steps, a disposable upload and successful submission to validate explicit events without changing real applications. Never send sensitive fixtures to analytics for testing.

Replay fidelity: preserve rrweb’s `_cssText` only on STYLE/LINK elements, recorder-generated geometry, and Lucide SVG geometry. Inline stylesheet capture is explicit, so replay retains the recorded CSS instead of depending on an authenticated page or an old build’s CSS URL. Do not replace synthetic stylesheet attributes with redaction markers. Existing recordings with already-redacted CSS cannot be repaired by a client configuration change; this applies to newly captured snapshots after deployment. Text, inputs, document/media blocks and content-bearing attributes retain their masking.

## Google Ads contact conversion

`lib/google-ads.ts` and `components/insurance-intake/signup.tsx` measure the
acquisition contact step separately from PostHog product analytics. Only
`app.spot.insure/signup` and `/intake` may initialize the production Google Ads
tag `AW-18451509957`. Localhost and preview hosts do not send Google Ads events.
The existing **Landing form completed** action uses destination
`AW-18451509957/B7bCCP_so4EdEMXlrt5E` and counts only after `/api/intake` accepts
the signup contact details. Merely entering email on the marketing page,
redirecting to signup, loading a page, or a failed API response does not count.
This is a saved contact lead, not a completed quote application or a bound policy.
Keep Google Ads' count setting at **One**. Completed applications remain the
separate PostHog `intake_submitted` milestone.

The tag disables automatic pageview sending and supplies query-free page
location, an empty referrer, and a fixed generic title. Events contain no names,
email, phone, company answers, or handoff tokens. A SHA-256 digest of the random
handoff key supplies a stable opaque transaction ID; in-memory/sessionStorage
checks avoid duplicate events and Google's transaction ID handles duplicate
queued delivery. Tracker/storage failures never block signup. Marketing and
app subdomains use the same Ads ID; verify click attribution with a real ad
interaction and the shared first-party conversion cookie after deployment.

Production QA: use Tag Assistant with tracking allowed in the test browser;
verify no lead event on landing or signup page load, submit an authorized test
contact, and verify exactly one event for the destination above after the API
succeeds. Retry the same handoff and verify no extra lead event. Check that no
email, contact detail, capability, or query string appears in the event payload.
Existing accounts may then require email OTP before opening their application.
Do not submit invented business facts or submit an actual insurance request as
part of the contact conversion test. An ad blocker can prevent delivery; do not
circumvent the visitor's tracking preferences. Google Ads reporting can lag the
Tag Assistant result. Enhanced conversions are not implemented by this change.
