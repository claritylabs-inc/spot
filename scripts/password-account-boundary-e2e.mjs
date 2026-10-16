// Local boundary E2E for the atomic password writer. Local backend only
// (see scripts/lib/local-convex-e2e.mjs); synthetic users only.
//
//   node scripts/password-account-boundary-e2e.mjs   # about 90 s (one 62 s email-code rate-limit wait)
//
// Covers: status exposes recentSignInExpiresAt; a revoked session's token cannot read
// status or change the password; concurrent changes leave exactly one live password;
// concurrent first-time sets leave one account row, one winner and no duplicate user.
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import {
  convexUrl,
  randomPassword as pw,
  rejects,
  rows,
  signInWithEmailCode,
  syntheticEmail,
} from "./lib/local-convex-e2e.mjs";

const email = syntheticEmail("pw-bound");
const otp = (client, addr = email) => signInWithEmailCode(client, anyApi, addr);

const A = new ConvexHttpClient(convexUrl, { logger: false });
await otp(A);
const user = rows("users").find((u) => u.email === email);
const status = await A.query(anyApi.passwordAccounts.status, {});
assert.equal(typeof status.recentSignInExpiresAt, "number");
assert(status.recentSignInExpiresAt > Date.now() && status.recentSignInExpiresAt <= Date.now() + 10 * 60 * 1000);
await A.action(anyApi.passwordAccounts.setPassword, { newPassword: pw() });
console.log("PASS status exposes recentSignInExpiresAt; first set works");

await new Promise((r) => setTimeout(r, 62000)); // per-email OTP rate limit
const B = new ConvexHttpClient(convexUrl, { logger: false });
await otp(B);
assert.equal(rows("authSessions").filter((s) => s.userId === user._id).length, 2);
await A.action(anyApi.passwordAccounts.setPassword, { newPassword: pw() });
const sessions = rows("authSessions").filter((s) => s.userId === user._id);
assert.equal(sessions.length, 1, "B's session (and refresh tokens) revoked in the commit");
const hashAfterA = () => rows("authAccounts").find((a) => a.userId === user._id && a.provider === "password").secret;
const h0 = hashAfterA();
assert.equal(await B.query(anyApi.passwordAccounts.status, {}), null, "revoked token is not a caller");
await rejects(B.action(anyApi.passwordAccounts.setPassword, { newPassword: pw() }));
assert.equal(hashAfterA(), h0, "revoked token wrote nothing");
console.log("PASS a revoked session's token cannot read status or change the password");

// Concurrent changes from the same session: both pass the pre-checks, exactly one commits.
const signIn = async (addr, password) => {
  const c = new ConvexHttpClient(convexUrl, { logger: false });
  try { const r = await c.action(anyApi.auth.signIn, { provider: "password", params: { flow: "signIn", email: addr, password } }); return Boolean(r.tokens?.token); } catch { return false; }
};
const [p1, p2] = [pw(), pw()];
const settled = await Promise.allSettled([
  A.action(anyApi.passwordAccounts.setPassword, { newPassword: p1 }),
  A.action(anyApi.passwordAccounts.setPassword, { newPassword: p2 }),
]);
const ok = settled.filter((r) => r.status === "fulfilled").length;
assert(ok >= 1, "at least one concurrent change commits");
const wins = [await signIn(email, p1), await signIn(email, p2)];
assert.equal(wins.filter(Boolean).length, 1, "exactly one password is live, never both or neither");
if (ok === 2) console.log("note: the two changes serialized (second saw the first's hash)");
else assert.match(String(settled.find((r) => r.status === "rejected").reason?.message ?? ""), /PASSWORD_CHANGE_CONFLICT|changed while saving/);
console.log("PASS concurrent changes: exactly one password is live");

// Concurrent first-time sets for a fresh user: one account row, one winner.
const email2 = syntheticEmail("pw-bound");
const C = new ConvexHttpClient(convexUrl, { logger: false });
await otp(C, email2);
const user2 = rows("users").find((u) => u.email === email2);
const usersBefore = rows("users").length;
const [q1, q2] = [pw(), pw()];
await Promise.allSettled([
  C.action(anyApi.passwordAccounts.setPassword, { newPassword: q1 }),
  C.action(anyApi.passwordAccounts.setPassword, { newPassword: q2 }),
]);
const accs = rows("authAccounts").filter((a) => a.userId === user2._id && a.provider === "password");
assert.equal(accs.length, 1, "exactly one password account");
assert.equal(accs[0].providerAccountId, email2);
assert.equal(rows("users").length, usersBefore, "no duplicate user");
assert.equal([await signIn(email2, q1), await signIn(email2, q2)].filter(Boolean).length, 1);
console.log("PASS concurrent first-time sets: one account row, one winner, no duplicate user");
console.log("PASS all 4");
