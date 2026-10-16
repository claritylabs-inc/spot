// Local E2E for optional password sign-in, closed public sign-up/reset, and the
// reviewer credential migration. Local backend only (see scripts/lib/local-convex-e2e.mjs).
//
//   node scripts/password-account-e2e.mjs            # about 20 s
//   node scripts/password-account-e2e.mjs --stale    # adds a ~10.5 minute stale-session case
//
// Needs the native-local backend running with email capture (.context/logs/convex.log).
// Creates only synthetic users (pw-e2e-*@example.com) and may provision/rotate the local
// demo reviewer account to a random password that is never printed or stored.
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import {
  convexUrl,
  logContains,
  randomPassword as pw,
  rejects,
  rows,
  run,
  signInWithEmailCode,
  syntheticEmail,
} from "./lib/local-convex-e2e.mjs";

const email = syntheticEmail("pw-e2e");
const results = [];
const pass = (n) => { results.push(n); console.log("PASS " + n); };
const otp = (client, addr) => signInWithEmailCode(client, anyApi, addr);

const passwordSignIn = async (addr, password, flow = "signIn") => {
  const c = new ConvexHttpClient(convexUrl, { logger: false });
  const r = await c.action(anyApi.auth.signIn, { provider: "password", params: { flow, email: addr, password } });
  return Boolean(r.tokens?.token);
};

// 1. Reviewer migration keeps the hash; rotation then signs in through `password`.
const REVIEW = "chrome-review@review.spot.insure";
const before = rows("authAccounts").filter((a) => a.providerAccountId === REVIEW);
if (before.length) {
  const hash = before[0].secret;
  const m = JSON.parse(run("reviewerAccounts:migrateToPasswordProvider"));
  const after = rows("authAccounts").filter((a) => a.providerAccountId === REVIEW);
  assert.equal(after.length, 1);
  assert.equal(after[0].provider, "password");
  assert.equal(after[0].secret, hash, "hash preserved");
  assert.equal(JSON.parse(run("reviewerAccounts:migrateToPasswordProvider")).status, "already");
  pass(`reviewer credential migrated (${m.status}) with its hash intact; re-run is a no-op`);
}
const reviewerPw = pw() + pw();
if (JSON.parse(run("reviewerAccounts:status")).provisioned) run("reviewerAccounts:rotatePassword", { password: reviewerPw });
else run("reviewerAccounts:provision", { password: reviewerPw });
assert.equal(await passwordSignIn(REVIEW, reviewerPw), true);
await rejects(passwordSignIn(REVIEW, "wrong-password-wrong-password"));
pass("reviewer signs in through the standard password provider; wrong password rejected");

// 2. Password sign-in is signIn only; unknown users are rejected.
for (const flow of ["signUp", "reset", "reset-verification", "email-verification"]) {
  await rejects(passwordSignIn("brand-new@example.com", pw(), flow));
}
await rejects(passwordSignIn("nobody@example.com", pw()));
assert(!rows("users").some((u) => u.email === "brand-new@example.com" || u.email === "nobody@example.com"));
pass("sign-up, reset, verification and unknown users are rejected without creating users");

// 3. A signed-in verified user opts in; no duplicate user; hash only.
const client = new ConvexHttpClient(convexUrl, { logger: false });
await otp(client, email);
const user = rows("users").find((u) => u.email === email);
assert(user?.emailVerificationTime);
const usersBefore = rows("users").length;
let status = await client.query(anyApi.passwordAccounts.status, {});
assert.deepEqual({ ...status, reason: undefined, recentSignInExpiresAt: undefined }, { eligible: true, hasPassword: false, recentSignIn: true, reason: undefined, recentSignInExpiresAt: undefined });
const secret = pw();
assert.match(await rejects(client.action(anyApi.passwordAccounts.setPassword, { newPassword: "short" })), /password/i);
await rejects(new ConvexHttpClient(convexUrl, { logger: false }).action(anyApi.passwordAccounts.setPassword, { newPassword: secret }));
await client.action(anyApi.passwordAccounts.setPassword, { newPassword: secret });
status = await client.query(anyApi.passwordAccounts.status, {});
assert.equal(status.hasPassword, true);
assert.equal(rows("users").length, usersBefore, "no duplicate user");
const accounts = rows("authAccounts").filter((a) => a.userId === user._id);
assert.deepEqual(accounts.map((a) => a.provider).sort(), ["password", "resend-otp"]);
const pwAccount = accounts.find((a) => a.provider === "password");
assert.equal(pwAccount.providerAccountId, email);
assert(pwAccount.secret && !pwAccount.secret.includes(secret));
assert(!logContains(secret), "password never logged");
assert.equal(await passwordSignIn(email, secret), true);
await rejects(passwordSignIn(email, pw()));
pass("verified user sets a password: no duplicate user, hash only, never logged, sign-in works, wrong one rejected");

// 4. Changing revokes other sessions; the current one survives; recovery is OTP.
assert.equal(rows("authSessions").filter((s) => s.userId === user._id).length, 2, "OTP session plus the password sign-in");
const next = pw();
await client.action(anyApi.passwordAccounts.setPassword, { newPassword: next });
assert.equal(rows("authSessions").filter((s) => s.userId === user._id).length, 1, "only the current session remains");
assert.equal((await client.query(anyApi.passwordAccounts.status, {})).hasPassword, true);
await rejects(passwordSignIn(email, secret));
assert.equal(await passwordSignIn(email, next), true);
pass("changing the password invalidates the old one and revokes every other session");

if (process.argv.includes("--stale")) {
  console.log("waiting for the session to age past 10 minutes...");
  await new Promise((r) => setTimeout(r, 10.5 * 60 * 1000));
  status = await client.query(anyApi.passwordAccounts.status, {});
  assert.equal(status.recentSignIn, false);
  const err = await rejects(client.action(anyApi.passwordAccounts.setPassword, { newPassword: pw() }));
  assert.match(err, /RECENT_SIGN_IN_REQUIRED|Sign in again/);
  const wrong = await rejects(client.action(anyApi.passwordAccounts.setPassword, { newPassword: pw(), currentPassword: "wrong-wrong-wrong-wrong" }));
  assert.match(wrong, /CURRENT_PASSWORD_INCORRECT|incorrect/);
  const final = pw();
  await client.action(anyApi.passwordAccounts.setPassword, { newPassword: final, currentPassword: next });
  assert.equal(await passwordSignIn(email, final), true);
  pass("a stale session needs the current password; a wrong one fails; the right one changes it");
}
mkdirSync(".context/qa/password", { recursive: true });
writeFileSync(".context/qa/password/results.json", JSON.stringify(results, null, 2));
console.log(`PASS all ${results.length}`);
