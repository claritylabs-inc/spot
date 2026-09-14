# Central employee provisioning

Spot exposes a dedicated server API to the central `onboarding-terraform` CLI.
The CLI runs on the Railway onboarding service; Railway SSH and its MCP access
both drive that same saved-plan engine. Spot does not host a second CLI or MCP
server. The machine-readable contract is
[employee-provisioning.openapi.json](employee-provisioning.openapi.json).

## Configuration and credential custody

Configure these values on the intended Spot Convex deployment after its code and
schema release has been approved:

| Variable | Requirement |
| --- | --- |
| `EMPLOYEE_PROVISIONING_SECRET` | A random, deployment-specific secret with at least 32 characters. Generate at least 32 random bytes. Dedicated to the two employee endpoints. |
| `EMPLOYEE_PROVISIONING_DEPLOYMENT` | Exact Convex deployment name, such as `merry-platypus-82`. Must match the canonical request origin. |
| `EMPLOYEE_PROVISIONING_EMAIL_DOMAINS` | Explicit comma-separated company domains, such as `claritylabs.inc`. No wildcard or subdomain inheritance. |
| `SPOT_ENV` | Exactly `production`, `dev`, or `local`; echoed in every successful observation/provision response. |
| Existing auth site configuration | `getAuthSiteUrl()` must resolve to the target HTTPS frontend origin: `AUTH_LINK_SITE_URL`, then `AUTH_SITE_URL`, then `AUTH_PORTAL_URL`, then `SITE_URL`, with the existing Spot production fallback. |

Put the same dedicated secret in the Railway onboarding service's secret
configuration, consumed by its central Spot adapter. Restrict Railway secret
access and the service's persistent plan/journal volume to onboarding operators.
Use distinct values per deployment. Rotate by coordinating both services; remove
the Convex value to disable the API. Do not store it in person records, employee
environments, saved plans, journals, source files, browser bundles, logs, or
handoff output. Employees receive no provisioning credentials and use email OTP.
This principal cannot create owners, manage broker/customer organizations, or
access the operator MCP catalog. Never reuse `OPERATOR_PROVISIONING_SECRET`, a
Convex deploy key, an employee session, or the router/worker credentials.

The central target contains `enabled`, `role`, `deployment`, `environment`,
`appUrl`, and `apiUrl`. `apiUrl` is exactly
`https://<deployment>.convex.site`; the default production origin remains
`https://merry-platypus-82.convex.site` even when normal traffic uses a custom
domain. The server rejects requests through a different origin. This also
prevents copied cloud configuration from enabling this API on a local backend.
The HTTP contract requires HTTPS origins; native local HTTP deployments are not
central CLI targets. Isolated tests exercise the endpoint in memory.

## HTTP protocol

Both paths require `Authorization: Bearer <dedicated-secret>` and
`Content-Type: application/json`. No cookies, CORS permission, employee tokens,
query-string credentials, or unrelated-data listing endpoints are provided.
Bodies are limited to 4,096 UTF-8 bytes and reject unknown fields. Responses use
`Cache-Control: no-store`.

`POST /api/provisioning/v1/operators/observe` accepts exactly:

```json
{
  "personId": "synthetic-employee",
  "email": "synthetic.employee@claritylabs.inc",
  "role": "operator",
  "deployment": "merry-platypus-82",
  "appUrl": "https://app.spot.insure"
}
```

`personId` is a stable lowercase slug (1–128 characters, letters, digits, `_`,
`-`, starting with a letter or digit). Email is trimmed and lowercased; matching
is exact and case-insensitive, without aliases or fuzzy matching. The only role
that can be granted is `operator`. An explicit `owner` request returns `blocked`
with `unsupported_role`, including when an owner already exists.

`POST /api/provisioning/v1/operators/provision` accepts the same fields plus:

```json
{
  "requestId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "approvalDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

These are synthetic example digests. The manager computes `requestId` as
SHA-256 of its canonical `{planDigest, grantKey}` object. A request ID is 1–128
characters, starts with a letter or digit, and otherwise allows letters, digits,
`.`, `_`, `:`, `-`. `approvalDigest` is exactly 64 lowercase hexadecimal
characters and is the approved saved-plan digest. Reusing a request ID with a
different identity, role, target, or digest blocks. A new approved plan may use a
new request ID to adopt matching access. Ledger records are durable and do not
expire by age.

The central engine owns mailbox verification, saved-plan approval and expiry,
fresh observation and plan comparison, the explicit approval digest, and the
write-ahead journal. Spot records the digest and binds idempotency to it; the
digest is not independent proof of human approval. Possession of this dedicated
principal permits additive operator creation within its configured domains, so
its custody must remain confined to the approved-plan engine.

HTTP 200 responses have this shape (example member):

```json
{
  "version": 1,
  "status": "member",
  "personId": "synthetic-employee",
  "email": "synthetic.employee@claritylabs.inc",
  "deployment": "merry-platypus-82",
  "environment": "production",
  "appUrl": "https://app.spot.insure",
  "role": "operator",
  "remoteId": "synthetic-user-id",
  "message": "Active operator access is configured; email OTP is required to sign in.",
  "details": { "reason": "active_operator" }
}
```

`remoteId` is the actual stable Convex `users` ID (the example is illustrative).
For `absent` and `blocked`, both `remoteId` and `role` are omitted; all other
fields remain. `details` contains only `reason`. There are no `invited`, `manual`,
email-verification, or first-sign-in claims. `member` proves a human operator
user with no customer membership, one matching active profile, exactly the
requested `operator` role, and compatible OTP identity. It means access is
configured for normal authentication, not that the employee has signed in.

The client must check version, normalized email, person ID, deployment,
environment, app origin, member role, and a nonempty remote ID. Validate against
the reviewed target; never trust the response as target discovery. Preserve only
sanitized reason/environment details. A blocked result or any error is never
absence and cannot be overridden by an operator attestation.

| `details.reason` | Status and meaning |
| --- | --- |
| `active_operator` | `member`: exact active operator access. |
| `missing_identity` | `absent`: no matching user, profile or auth account. |
| `unsupported_role` | `blocked`: owner grants are not supported. |
| `email_domain_not_allowed` | `blocked`: email is outside the configured company domains. |
| `directory_limit` | `blocked`: a complete case-insensitive identity check exceeded its bound. |
| `duplicate_identity` | `blocked`: more than one case-insensitive user match. |
| `orphaned_identity` | `blocked`: a matching profile/auth account exists without a matching user. |
| `invalid_identity` | `blocked`: matching user has malformed whitespace, anonymous or service-account state. |
| `customer_membership` | `blocked`: the user has any organization membership. |
| `account_kind_conflict` | `blocked`: customer or unknown account kind; no conversion. |
| `ambiguous_profile` | `blocked`: missing, duplicate or mismatched email/user profile counts. |
| `profile_identity_conflict` | `blocked`: profile email and user ownership disagree or the profile email is malformed. |
| `role_conflict` | `blocked`: an active existing owner cannot be adopted as an operator. |
| `inactive_profile` | `blocked`: disabled profile. |
| `auth_identity_conflict` | `blocked`: duplicate, foreign, noncanonical or incompatible auth identity. |
| `missing_auth_identity` | `blocked`: existing access cannot be proven to use the same user on OTP login. |
| `person_identity_conflict` | `blocked`: a previously recorded person/email/user binding differs. |
| `previous_identity_missing` | `blocked`: a previously provisioned identity disappeared; no recreation. |
| `request_identity_conflict` | `blocked`: a request ID was reused with a different approved action. |

Non-2xx bodies are only `{ "error": "<sanitized message>" }`: 400 invalid
JSON/schema/content type, 401 missing/invalid credentials, 409 deployment/app or
canonical API origin mismatch, 413 oversized body, 503 disabled/misconfigured
service or unconfirmed execution. Framework failures may also produce non-JSON
errors; the central transport must sanitize these. Following any ambiguous
mutation result, freshly observe before considering another apply. Do not
blindly retry mutation transport failures. A matching observation can resolve
access state; only the journal/ledger establishes the particular write outcome.

## Identity, transaction and login behavior

Observation uses only an internal query; it does not write a nonce, audit,
session, or invitation. The existing user/profile/auth indexes are
case-sensitive, so the query reads bounded complete directories internally and
returns only the requested identity's result. Each of `users`,
`operatorProfiles`, and `authAccounts` is capped at 2,000 rows. If any exceeds the
cap, both endpoints block, even if an early row matches. Before scaling beyond
that, implement and verify a normalized-identity index migration across every
writer; never replace this with a partial scan or assume absence on failure.
The API does not return directory records or unrelated identifiers.

Provision rechecks all eligibility inside one Convex mutation. A wholly absent
identity creates a `users` row (`accountKind=operator`, `onboardingComplete=true`),
a `resend-otp` `authAccounts` row, and an active `operatorProfiles` row. The auth
account has no secret and neither record asserts email verification. No
verification code, invitation, session, notification or email is created.
Matching active state is adopted without changing user/profile/auth data.
Partial, unknown, inactive, customer and conflicting state is blocked. Convex
transaction conflict detection covers the directory reads, request ID and
person/email bindings, preventing duplicate identities under concurrent writes.

The same transaction adds `employeeProvisioningRequests` and an
`operatorAuditEvents` event with `type=employee_provisioned`,
`serviceActor=central_employee_provisioning`, the employee as `targetUserId`, and
no `operatorUserId`. Metadata records person/email/target, role, stable
`provisioningRequestId`, approval digest, and `created`/`adopted` outcome. It does
not impersonate the employee. Repeating the exact request rechecks current
access without another audit; disabled or conflicting state still blocks.
`requestId` on older operator audit events remains a procurement request ID;
the central ID is deliberately named `provisioningRequestId` in metadata.

The normal `/operator/login` page canonicalizes email before requesting and
verifying OTP. Installed Convex Auth reuses the reserved provider/account ID,
then marks email verified and creates a session only after correct OTP
verification. Other clients must use the canonical email too; noncanonical
legacy auth identity blocks central observation instead of claiming login will
link safely. No custom global auth callback or provider bypass is introduced.

`operator.bootstrapViewer` now acknowledges matching active existing profiles
without consulting bootstrap/owner allowlists or overwriting their role. It
rejects disabled and duplicate profiles, conflicting account kind and customer
memberships. Initial bootstrap remains available to authenticated allowlisted
users with no profile, no explicit customer/operator kind and no memberships;
`OPERATOR_OWNER_EMAILS` applies only to that initial legacy creation. Ordinary
operator login cannot promote an existing operator or reactivate a disabled one.

Schema changes are additive: the request ledger is new; audit events add an
optional service actor and make the human actor optional. Existing human audit
writers retain their actor. No data migration or bootstrap allowlist update is
needed for new centrally provisioned employees. Release backend/schema and
frontend login changes before enabling the dedicated secret. Existing ambiguous
state requires a separate reviewed remediation; this API does not repair it.

Tests live in `convex/employeeProvisioning.test.ts`. They exercise HTTP auth and
target checks, read-only observations, blocked identities, repeat/concurrent
writes, audit/ledger bindings, and the installed Convex Auth store's OTP creation
and verification against synthetic in-memory records. Outbound delivery and
production credentials are never used. These tests do not establish live
cross-repository integration, browser delivery or completed employee sign-in.
