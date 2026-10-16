# Reviewer account

A reusable, password-protected demonstration client account for store
reviewers and repeatable browser testing. It exists so a reviewer can sign in
to Spot and the browser extension without access to a Spot mailbox, with no
path to real company data.

## Failure modes (written before implementation)

Authentication

- Any reviewer-provider flow except `signIn` (`signUp`, `reset`,
  `reset-verification`, `email-verification`, a missing flow) must be rejected
  before any database access: no public sign-up, no reset, no email verification.
- `signIn` for any email other than the exact reviewer identity must be rejected,
  including case and whitespace variants of other users, `@spot.insure` /
  `@claritylabs.inc` / `@toolsforenlightenment.org` operator aliases, and look-alike
  domains. It must never create an account, user, or session.
- A wrong or missing password, or an unprovisioned account, must fail with no
  session and no account creation. Failed attempts use the library's per-account
  sign-in rate limit.
- The reviewer email must not be reachable through email OTP or any other
  provider. Requesting an email code creates an auth account, linked by email to
  the existing user, before any code is sent, so refusing to send is not enough:
  it would leave a second sign-in path and, because provisioning fails closed on
  a foreign auth account, let anyone lock the reviewer out. `createOrUpdateUser`
  therefore rejects the reviewer email for every provider except
  `review-password`, and for that provider rejects `emailVerified` and any link
  via email or phone to an existing user. `sendVerificationRequest` also refuses
  to send to the address.
- Session creation for the reviewer user is checked for every provider through
  `beforeSessionCreation`, and the collision check rejects any auth account from
  another provider that reaches the reviewer user.
- Sign-in re-checks the identity on every attempt, before the password: it must
  still be a `customer` user with no operator profile, service-account flag or
  intake restriction, a `member` of exactly the one active demo `client`
  organization, and the only member of it. Promotion to operator, a membership
  elsewhere, or an inactive organization denies sign-in.
- No fixed password, test OTP, or bypass exists in source. The password is passed
  to the internal provisioning action at run time and stored only as the
  library's Scrypt hash in `authAccounts.secret`.

Isolation

- The reviewer email is on `review.spot.insure`, which is not an operator domain,
  so the operator bootstrap and alias linking in `createOrUpdateEmailUser` never
  apply. Provisioning refuses an identity that is a bootstrap operator email.
- Provisioning must fail closed, with no writes, when the email already belongs to
  any other user, any auth account under another provider, an operator profile,
  an operator-kind user, or a user with a membership outside the demo
  organization.
- It must fail closed when the demo organization slug exists but is not the
  reviewer's organization alone (another member, wrong type), and when an
  orphan organization exists without the reviewer user.
- The reviewer is an ordinary `member` of one `client` organization with
  `clientAccessStatus: "active"`. It is not an operator, broker, or admin, so it
  cannot invite people, connect mailboxes, or reach settings.
- Sample data is created only inside the demo organization and carries `isDemo`.
  Provisioning starts no research, email, Slack, or model job.

Idempotency and rotation

- Running provisioning twice creates one user, one auth account, one
  organization, one membership, and one set of policies. The second run reports
  `exists`, repairs missing sample data, and does not change the password or
  sessions.
- Rotation replaces the hash through the library and revokes every existing
  session for the reviewer user. It refuses to run unless the account is the
  provisioned reviewer account.
- A partial failure (auth account created, workspace not) is repaired by running
  provisioning again; it must not adopt an unrelated organization.

## Contract

Provider `review-password` (`convex/auth.ts`) is the library `Password`
provider with scrypt hashing, configured to accept only
`{flow: "signIn", email: "chrome-review@review.spot.insure", password}`, with
`authorize` wrapped to call `reviewerAccounts:assertSignIn` first. It adds no
public sign-up, reset, or verification. Failed attempts use the library's
per-account sign-in rate limit; rotation uses library APIs and clears no limits.

Internal functions in `convex/reviewerAccounts.ts` (none are public):

| Function | Kind | Args | Returns |
| --- | --- | --- | --- |
| `reviewerAccounts:provision` | internalAction | `{password: string}` (24-256 chars) | `{status: "created" \| "exists", email, userId, orgId}` |
| `reviewerAccounts:rotatePassword` | internalAction | `{password: string}` (24-256 chars) | `{status: "rotated", email, userId}` |
| `reviewerAccounts:status` | internalQuery | `{}` | `{provisioned: false}` or `{provisioned: true, email, userId, orgId, sessions, signInRateLimited}` (read only; there is no unlock) |
| `reviewerAccounts:prepare` | internalQuery | `{}` | `{kind: "create"}` or `{kind: "exists", userId}`; throws on any collision |
| `reviewerAccounts:assertSignIn` | internalQuery | `{}` | `{userId}`; throws otherwise |
| `reviewerAccounts:ensureWorkspace` | internalMutation | `{userId}` | `{orgId}` |

`provision` creates the account when `prepare` says `create`, then runs
`ensureWorkspace`. When the account exists it repairs sample data only; the
password and sessions are untouched, so re-running it with any password is safe.
`rotatePassword` requires an existing, valid account, replaces the hash through
the library, and revokes every session. Neither function logs the password.
`status` reports no secret.

The reviewer is `chrome-review@review.spot.insure`, a `customer` user named
"Spot Review", an ordinary `member` of the client organization
"Spot Review Demo (demonstration)" (slug `spot-review-demo`, active). The
workspace holds two fabricated policies, `DEMO-GL-0001` and `DEMO-CY-0002`,
marked `isDemo`. It has no agent handle, mailbox, Slack connection, or research
job. Existing authorization is unchanged: the reviewer sees only that org.

Sign-in page: `/login/review` (optional `?next=/path`). It posts to the existing
`/api/auth` route and needs no change to `AuthGuard` or the shell, which already
treat `/login/*` as public and shell-less.

## Required edits in `convex/orgs.ts` (manager-owned)

Invitations can otherwise give the reviewer a
membership in a foreign tenant. `assertNotReviewerUser` and `isReviewerEmail`
come from `./lib/reviewerAuth`:

```ts
// invite, after the isBootstrapOperatorEmail check
if (isReviewerEmail(email)) throw new Error("This address cannot be invited");

// acceptInvitation, after assertCustomerUser(ctx, userId)
await assertNotReviewerUser(ctx, userId);
```

`createClientOrg` and vendor-invitation org creation already refuse users who
belong to an organization, and the reviewer is a `member`, so neither applies.
Without the two edits above sign-in still fails closed once a foreign membership
exists, but a reviewer already signed in could acquire one. Existing sessions are
not revoked on drift; rotation revokes them.

## Operating it

Run with a Convex deployment key for the intended deployment; never with an
ambient key. The password is supplied only as `{password}`.

```bash
npx convex run reviewerAccounts:provision '{"password":"<generated>"}'
npx convex run reviewerAccounts:rotatePassword '{"password":"<generated>"}'
npx convex run reviewerAccounts:status '{}'
```

If provisioning reports a collision, stop: another user, auth account, or
organization already holds the identity or slug, and nothing was written.
Resolve it by hand rather than adopting it.

## Local validation

1. Start the native-local backend and app with the cloud keys removed
   (`env -u CONVEX_DEPLOY_KEY -u CONDUCTOR_CONVEX_SOURCE_DEPLOY_KEY`), per
   `scripts/run-conductor-dev.mjs`.
2. Generate a password without printing it and provision:
   `node -e 'process.stdout.write(require("crypto").randomBytes(30).toString("base64url"))' > .context/qa/reviewer/password`
   then `npx convex run reviewerAccounts:provision` with that value as `password`.
3. Run the local Playwright script (written during this work at
   `.context/qa/reviewer/e2e.mjs`; commit it as `scripts/reviewer-account-e2e.mjs`
   to keep it). It checks: the public page; a wrong
   password; rejected sign-up, reset, other identities and OTP with no user,
   auth account or session created; sign-in landing on `/policies` with the demo
   policies; the account being one `member` of one active `client` org with no
   operator profile; `/extension` accepting it; and rotation revoking the
   existing session and old password. Artifacts are `.context/qa/reviewer/*.png`
   and `results.json`.
4. `npx vitest run convex/reviewerAccounts.test.ts` runs the isolation checks
   for flows, identity collisions, idempotency, and sign-in drift.

## Managed production operation

The manual **Spot reviewer account** GitHub workflow runs only on `main` with
that repository's production Convex deploy key. Its `provision` and
`rotate-password` tasks read `SPOT_REVIEWER_PASSWORD` from repository secrets.
Changing the secret alone does not change an existing password: run
`rotate-password` afterward. Rotation still works when workspace health checks
fail, so existing sessions can be revoked before repairing drift. `status`
fails closed with the collision reason when the account has drifted.

Invitation creation and acceptance reject the reserved reviewer identity;
insurance intake cannot pre-create it. No production credentials belong in
source control, test reports, screenshots, or workflow inputs.
