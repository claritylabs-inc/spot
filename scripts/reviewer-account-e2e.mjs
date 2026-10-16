// Local reviewer-account browser E2E.
//
//   node scripts/reviewer-account-e2e.mjs
//
// Pinned to the native-local Convex backend (127.0.0.1:8083, admin key from
// .convex/local/default/config.json) and the local app (localhost:8080). It
// refuses anything else, never reads cloud deploy keys, and generates its own
// random password per run: the account is created or rotated to it, and rotated
// again to another random value at the end, so no password outlives the run.
// Artifacts: .context/qa/reviewer/results.json and PNGs. No credentials are written.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const app = "http://localhost:8080";
const convexUrl = "http://127.0.0.1:8083";
const email = "chrome-review@review.spot.insure";
const out = path.resolve(".context/qa/reviewer");
mkdirSync(out, { recursive: true });

const local = JSON.parse(readFileSync(".convex/local/default/config.json", "utf8"));
assert.equal(local.ports?.cloud, 8083, "Local Convex config must use port 8083");
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith("CONVEX_") || name.startsWith("CONDUCTOR_CONVEX")) delete env[name];
}
const convex = (...args) =>
  execFileSync(
    "./node_modules/.bin/convex",
    [...args, "--url", convexUrl, "--admin-key", local.adminKey],
    { encoding: "utf8", env },
  );
const run = (fn, args = {}) => convex("run", fn, JSON.stringify(args));
const rows = (table) => {
  const text = convex("data", table, "--format", "json");
  return text.trim().startsWith("[") ? JSON.parse(text) : [];
};
const randomPassword = () => randomBytes(30).toString("base64url");
const results = [];
const pass = (name) => {
  results.push({ name, status: "passed" });
  console.log(`PASS ${name}`);
};

// Provision (or rotate) to a password only this run knows.
const password = randomPassword();
const before = JSON.parse(run("reviewerAccounts:status"));
if (before.provisioned) run("reviewerAccounts:rotatePassword", { password });
else run("reviewerAccounts:provision", { password });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

try {
  // Ordinary password login, with the same errors as any account.
  await page.goto(`${app}/login?next=/policies`);
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Work email", {exact: true}).fill(email);
  await page.getByLabel("Password", {exact: true}).fill("incorrect-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("alert").waitFor();
  pass("wrong password is rejected through normal login");
  const auth = async (provider, params) => {
    const response = await page.request.post(`${app}/api/auth`, {data: {action: "auth:signIn", args: {provider, params}}});
    const body = await response.json().catch(() => ({}));
    return response.ok() && Boolean(body.tokens?.token);
  };
  // 4. The right password signs in as an ordinary active demo client.
  await page.goto(`${app}/login?next=/policies`);
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Work email", {exact: true}).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(`${app}/policies`, { timeout: 30000 });
  await page.getByText("DEMO-GL-0001").first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(out, "03-signed-in-policies.png") });
  pass("reviewer signs in and sees the demonstration policies");

  // 5. Account shape, no outbound work scheduled, and the extension route accepts it.
  await page.goto(`${app}/extension`);
  await page.getByRole("button", { name: /Ask anything|New chat/i }).first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(out, "04-extension-route.png") });
  const reviewer = rows("users").find((user) => user.email === email);
  const memberships = rows("orgMemberships").filter((m) => m.userId === reviewer._id);
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].role, "member");
  const org = rows("organizations").find((item) => item._id === memberships[0].orgId);
  assert.equal(org.type, "client");
  assert.equal(org.clientAccessStatus, "active");
  assert(!org.agentHandle, "demo org has no agent mailbox");
  assert.equal(reviewer.accountKind, "customer");
  assert(!rows("operatorProfiles").some((p) => p.userId === reviewer._id));
  assert(rows("policies").filter((p) => p.orgId === org._id).every((p) => p.isDemo === true));
  const status = JSON.parse(run("reviewerAccounts:status"));
  assert.equal(status.signInRateLimited, false);
  const scheduled = JSON.stringify(rows("_scheduled_functions"));
  assert(
    !scheduled.includes(reviewer._id) && !scheduled.includes(org._id),
    "provisioning and sign-in schedule no jobs for the reviewer or its org",
  );
  pass("one ordinary member of one active client org with no mailbox or scheduled work; /extension accepts it");

  // 6. Rotation revokes the session and the old password; the new one works.
  const rotated = randomPassword();
  run("reviewerAccounts:rotatePassword", { password: rotated });
  await page.goto(`${app}/policies`);
  await page.waitForURL(/\/login/, { timeout: 60000 });
  pass("rotation signs the existing session out");
  assert.equal(await auth("password", { flow: "signIn", email, password }), false);
  assert.equal(await auth("password", { flow: "signIn", email, password: rotated }), true);
  pass("old password is rejected and the rotated password works");
} finally {
  await browser.close();
  // Leave no run password behind.
  run("reviewerAccounts:rotatePassword", { password: randomPassword() });
  writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
}
console.log(`PASS all ${results.length} cases`);
