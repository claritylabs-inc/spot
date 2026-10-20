# Website tech research

Best-effort public research of a client's payment processor, hosting provider, data region and other technology. It never gates a workflow; every stage is optional and a failure only marks the scan row.

## Flow

1. `scheduleWebsiteTechScan` (`convex/websiteTech.ts`) queues `actions/websiteTech:run` for the website hostname. Recent completed scans (30 days), recent failures (24 hours) and in-flight runs are reused unless the caller forces a rescan.
2. The action runs two scans in parallel:
   - DNS, response headers and homepage HTML, matched against `convex/lib/websiteTechSignatures.ts`.
   - A cl-router durable `browse` job with a per-run test identity on `research.spot.insure` and a 30-minute inbox capability URL. The password is random and never stored. The browser never enters payment details.
3. Browser findings are kept only when their quote appears on a visited page and a Jev composite confirms the company itself uses the vendor. A second composite reconciles candidates per underwriting question.
4. `websiteTech:finish` stores signals, disclosures, inferences and the `browse` summary on `websiteTechProfiles`. A failed rescan keeps the last good findings but records the latest `browse` summary.

## Browser skill outcomes

The router may report procedure outcomes in `BrowseResponse.skills`, for example `inbox.wait_for_email`. `clRouterBrowse` validates them (at most 40; bounded name, version and summary; status `succeeded`, `blocked`, `failed` or `skipped`; integer step count). The action copies only those five fields into `browse.skills`, so unexpected keys cannot fail the finish mutation.

Before storage each summary is redacted: the run's inbox capability URL and password are replaced, any link is reduced to its hostname (verification links carry tokens), the test address becomes "the test email address" and other email addresses become `[email]`.

Older records and router responses without skills simply omit `browse.skills`; nothing is backfilled. Spot does not currently request skills through `BrowseRequest.config`; which skills run is set by the router.

Skill outcomes describe what the browser could do on the site. They are not independent proof of a vendor finding, and a submitted signup form does not mean an account was created.

## Access

| Surface | Path | Notes |
| --- | --- | --- |
| Operator Profile, Tech stack tab | `websiteTech:getForOperator` → `readWebsiteTechProfile` → `profile.browse.skills` | Browser research card lists Site visit (Finished, Stopped before finishing or No steps recorded) plus one row per outcome with a plain label for known procedures (for example Account signup, Sign in, Verification code, Verification email, CAPTCHA, Payment page) or the readable procedure name, status and summary. It is shown for completed, empty and failed scans and hidden while a scan runs. Rescan in the navbar starts a new scan. |
| Operator agent and operator MCP `get_organization` | `operatorAgent.ts` → `readWebsiteTechProfile` → `websiteTech.browse.skills` | Client organizations only. Operator-only (`operator.organizations.read`). |
| `research_client_tech_stack` | `operatorAgent.ts` → `readWebsiteTechProfile` → `current.browse.skills` | Returns the stored result from before the queued run; read `get_organization` later. |

`readWebsiteTechProfile` returns the stored `browse` object unchanged, so no other projection is needed. Tenant agents and tenant MCP have no tech-stack access. The raw action trace (`browse.actions`) and browse `error` are stored but not shown in the UI.

## Limits

- Results are public signals for underwriting convenience. Confirm with the client before relying on them.
- Sites with CAPTCHA, email allowlists, payment walls or bot protection often block signup and checkout; the outcomes show where that happened.
- One browse run per scan, 30 steps and a 6-minute execution budget.
