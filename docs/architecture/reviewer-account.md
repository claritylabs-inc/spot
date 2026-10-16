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
  `review-password`.
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
| `reviewerAccounts:status` | internalQuery | `{}` | `{provisioned: false}` or `{provisioned: true, email, userId, orgId, sessions}` |
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
