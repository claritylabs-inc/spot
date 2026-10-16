# Extension review and optional passwords

The Chrome Web Store uses an ordinary Spot client account with synthetic policies.
It signs in at `/login` using **Use a password instead**. It has no dedicated
login screen, auth provider, membership restrictions, or special session gates.
The application enforces its ordinary organization and resource authorization.

## Optional passwords

New accounts continue to use email codes. Spot does not assign passwords during
signup. Verified users may choose **Set password** in their profile settings;
the same card lets them change it later. Email-code sign-in remains available for
recovery. Passwords use Convex Auth's standard Scrypt hashing and password-attempt
rate limiting. Public password sign-up and reset flows are disabled; setting a
password derives the user and email from the authenticated session.

`convex/passwordAccounts.ts` owns status and setting credentials. A recent
sign-in or the current password authorizes a credential change. Other sessions
are revoked after changing the password. The shared email-change transaction
moves an existing password account to the new verified email, checking for
conflicting credentials before writing.

## Sample account maintenance

`convex/reviewerAccounts.ts` is an internal seed/maintenance utility. It creates
`chrome-review@review.spot.insure`, a client workspace, and two fictional policies
marked `isDemo`. This fixture is useful for both store reviews and repeatable QA.
Provisioning is idempotent and avoids overwriting unrelated accounts or data.
It does not provision passwords for other users or affect their sign-in behavior.

The manual **Spot reviewer account** GitHub workflow on `main` supports status,
provisioning, and password rotation using `SPOT_REVIEWER_PASSWORD` and the
production deployment secret. Keep the password out of commits, logs, screenshots,
and public store listing text. Supply it only in the store's private test
instructions. Rotation requires updating those instructions.

The original `review-password` credential is migrated to the standard `password`
provider without changing its hash when provisioning/rotation runs after deploy.

## Verification

Run `node scripts/password-login-e2e.mjs` against the native local app to verify
email-code default, opt-in, wrong-password rejection, password sign-in, password
change and session revocation. Artifacts live in `.context/qa/password-login/`.
Run `node scripts/reviewer-account-e2e.mjs` for demo provisioning, ordinary login,
policy visibility and rotation. It refuses cloud deployment selectors and keeps
credentials out of artifacts. See `docs/testing/workflow-qa.md`.
