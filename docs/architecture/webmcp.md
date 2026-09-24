# WebMCP tools

Spot registers [WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools so
browser agents can sign a business up and manage its insurance in the web app.
`lib/webmcp/catalog.ts` is the source of truth for tool names, descriptions,
parameter descriptions, input schemas, and where each tool is registered. Forms,
imperative registration, and `/llms.txt` all read it. Keep this page in sync
with that catalog and the public contract with spot.insure: renaming a tool
breaks the agent docs that the landing site mirrors.

## Runtime

- `lib/webmcp/runtime.ts` feature-detects `document.modelContext`. Without it
  (normal browsers and SSR) registration is a no-op. Imperative tools register
  with an `AbortSignal`; cleanup aborts it and also calls `unregisterTool` for
  older previews.
- Declarative forms get `toolname`, `tooldescription`, `toolautosubmit`, and
  per-field `name`/`toolparamdescription` from `webMcpFormAttributes` and
  `webMcpParamAttributes`. When `SubmitEvent.agentInvoked` is true, handlers read
  the submitted `FormData` (not React state) and return JSON through
  `respondToAgent`, which calls `respondWith`. The `toolactivated` event copies
  agent-filled values into React state.
- Every result is a JSON string with `status`. Errors use
  `{ status: "error", error }` and usually name the `next_tool` to retry.
  Successful steps name the `next_tool` or `next_url`.
- `components/webmcp/client-webmcp-tools.tsx` registers the signed-in tools. It
  runs only for a verified customer account (not operators, including during
  impersonation) with completed onboarding, in a live client organization. It
  never runs on auth, onboarding, or operator routes. Tools call the same public
  Convex functions the UI uses, so existing authorization applies unchanged.

## Declarative tools

| Tool | Page | Parameters | Success result |
| --- | --- | --- | --- |
| `request_signup_code` | `/signup/client`, `/signup` (email step) | `email` | `code_sent`, `next_tool: verify_signup_code` |
| `verify_signup_code` | `/signup/client`, `/signup` (code step) | `code` | `signed_in`, `next_url: /onboarding`, `next_tool: submit_user_profile` |
| `request_login_code` | `/login` (email step) | `email` | `code_sent`, `next_tool: verify_login_code` |
| `verify_login_code` | `/login` (code step) | `code` | `signed_in`, `next_url` |
| `submit_user_profile` | `/onboarding/setup` step 1 | `name`, `title`, `phone` (optional, E.164) | `profile_saved`, `next_tool: submit_company_profile` |
| `submit_company_profile` | `/onboarding/setup` step 2 | `organization_name`, `website` (optional) | `organization_saved`, `next_tool: finish_onboarding` |
| `finish_onboarding` | `/onboarding/setup` step 3 | none | `onboarding_complete`, `next_url: /` |

OTP verification remains mandatory. Agents must get the code from the account
owner or from a mailbox they are authorized to read.

## Imperative tools (signed-in clients)

| Tool | Registered | Read-only | Backend |
| --- | --- | --- | --- |
| `list_policies` | All client pages | yes | `policies.listForClient` |
| `get_policy` | All client pages | yes | `policies.getSummary` |
| `search_policy_wording` | All client pages | yes (untrusted content) | `sourceNodes.listByPolicy`, filtered in the browser |
| `list_certificates` | All client pages | yes | `certificateLifecycle.listForOrg` |
| `list_insurance_requests` | All client pages | yes | `clientProcurementRequests.list` |
| `get_insurance_request` | All client pages | yes | `clientProcurementRequests.get` |
| `list_compliance_requirements` | All client pages | yes | `compliance.listRequirements` |
| `open_spot_page` | All client pages | no (navigation) | Next router |
| `start_spot_agent_thread` | All client pages | no | `threads.create` + `threads.sendMessage` |
| `generate_certificate` | `/certificates`, `/compliance`, `/policies`, `/policies/:id` | no | `certificates.generateBatchForPolicy` (policy mode) |
| `create_insurance_request` | `/requests/*` | no | `clientProcurementRequests.create` |
| `attach_request_document` | `/requests/*` | no | `clientProcurementRequests.generateUploadUrl` + `attachFile` |
| `recheck_compliance_requirement` | `/compliance` | no | `actions.complianceReview.recheckOwnRequirement` |

No tool sends email, contacts a broker, or binds coverage. The agent thread
keeps its existing email-draft confirmation. Certificate requests that need
endorsements are held for broker review, as they are in the UI. Policy uploads
remain operator-only. Clients share documents through requests.

## Discovery

- `app/llms.txt/route.ts` serves `/llms.txt` as static plain text generated
  from the catalog. `proxy.ts` skips paths with a file extension, and the route
  is outside `AuthGuard`.
- The root layout adds `<link rel="llms-txt" href="/llms.txt">`.
- `/signup/client` is the canonical signup URL and supports `?email=`.

## Verification

`node scripts/webmcp-e2e.mjs [--seeded-client adyan@cove.dev]` runs against
the local app and native local Convex with captured OTPs. It loads the app in
headless Chrome with a stub `document.modelContext` injected before app scripts
run. It checks the declarative attributes and the no-op path without
`modelContext`. It then signs up a new business through agent-style submits and
verifies the `registerTool` calls, schemas, page scoping, execution, and
sign-out unregistration. It also repeats signup by typing. With
`--seeded-client` (after `npx convex run seed:seed`), it runs the login tools
plus policy, wording, and certificate tools. It writes `results.json` and
screenshots to `.context/qa/webmcp/`.
