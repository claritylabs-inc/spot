# Password sign-in E2E

Reproducible local evidence that public password sign-up and reset are closed, that
optional password setup is bound to the authenticated user, and that the reviewer
credential migrated with its hash intact. Both scripts are local only: they pin
`127.0.0.1:8083` with the admin key from `.convex/local/default/config.json`, strip
`CONVEX_*` and `CONDUCTOR_CONVEX*` from the child environment, create only synthetic
`pw-*@example.com` users, delete nothing, and keep every password in memory.

Start the native-local backend and app (see `scripts/run-conductor-dev.mjs`); email
codes are read from `.context/logs/convex.log`.

```bash
node scripts/password-account-e2e.mjs            # ~20 s, 5 cases
node scripts/password-account-e2e.mjs --stale    # adds a ~10.5 min stale-session case (6 cases)
node scripts/password-account-boundary-e2e.mjs   # ~90 s, 4 cases
```

`password-account-e2e.mjs` covers: the reviewer credential moving from `review-password`
to `password` with its hash kept and a no-op re-run; reviewer sign-in through the standard
provider with a wrong password rejected; `signUp`, `reset`, `reset-verification`,
`email-verification` and unknown users rejected without creating users; a verified user
setting a password with no duplicate user, only a hash stored and nothing logged; and a
change revoking every other session. With `--stale`, a session older than 10 minutes needs
the current password, and a wrong one fails.

`password-account-boundary-e2e.mjs` covers: `status` exposing `recentSignInExpiresAt`; a
revoked session's token neither reading `status` nor changing the password; two concurrent
changes leaving exactly one live password; and two concurrent first-time sets leaving one
account row, one winner and no duplicate user.

Last results: 5/5, 4/4 and 6/6 (`--stale`) on commit `9dde7311`. Not covered: the email-change
account rename and the lockout error mapping.
