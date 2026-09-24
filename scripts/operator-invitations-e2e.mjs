// Local-only workflow proof. Run with local Convex and Next running:
// node scripts/operator-invitations-e2e.mjs [http://localhost:8080]
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import dayjs from "dayjs";

const base = process.argv[2] ?? "http://localhost:8080";
assert.equal(new URL(base).hostname, "localhost");
const cli = (...args) => JSON.parse(execFileSync("npx", ["convex", "run", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const fixture = cli("seed:seed"); // Seed refuses any non-local deployment.
const out = ".context/qa/operator-invitations";
mkdirSync(out, { recursive: true });
const logs = spawn("npx", ["convex", "logs", "--history", "0"], { stdio: ["ignore", "pipe", "pipe"] });
let captured = "";
for (const stream of [logs.stdout, logs.stderr]) stream.on("data", (data) => { captured += data.toString(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function otp(email, offset) {
  for (let n = 0; n < 100; n++) {
    const tail = captured.slice(offset);
    const start = tail.indexOf(`to: ${email}`);
    const code = start >= 0 ? tail.slice(start).match(/codeCandidates: (\d{6})/)?.[1] : null;
    if (code) return code;
    await wait(200);
  }
  throw new Error("Local OTP capture missing");
}
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const checks = [];
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
try {
  await wait(1500);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const actorEmail = `inviter-qa-${dayjs().valueOf()}@spot.insure`;
  await page.goto(`${base}/operator/login`);
  const offset = captured.length;
  await page.locator('input[type="email"]').fill(actorEmail);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator("#operator-verification-code").fill(await otp(actorEmail, offset));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL(/\/operator(?:\/threads)?$/);
  const email = `invite-qa-${dayjs().valueOf()}@spot.insure`;
  await page.goto(`${base}/operator/settings?section=team`);
  await check("Settings invitation sends captured email", async () => {
    await page.getByRole("button", { name: "Invite operator", exact: true }).click();
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.screenshot({ path: `${out}/settings.png`, fullPage: true });
    await page.getByRole("button", { name: "Send invitation", exact: true }).click();
    await page.getByText(`Invitation sent to ${email}`, { exact: true }).waitFor();
  });
  const anonymous = new ConvexHttpClient("http://127.0.0.1:8083", { logger: false });
  await check("Anonymous invitations are rejected", async () => {
    await assert.rejects(() => anonymous.action(anyApi.operatorInvitations.inviteOperator, { email }));
  });
  await check("Agent internal action uses correct arguments", async () => {
    const result = cli("operatorInvitations:inviteOperatorForAgentInternal", JSON.stringify({ email, operatorUserId: fixture.operatorUserId }));
    assert.equal(result.outcome, "adopted"); assert.equal(result.emailSent, true);
  });
  await check("MCP shared execution requires exact approval", async () => {
    const args = { operatorUserId: fixture.operatorUserId, conversationKey: `invite-qa-${email}`, channel: "mcp", toolName: "invite_operator", input: { email }, idempotencyKey: `invite-qa-${email}` };
    const result = cli("operatorAgent:invokeRegisteredToolInternal", JSON.stringify(args));
    assert.equal(result.outcome.status, "confirmation_required");
    cli("operatorAgent:confirmActionInternal", JSON.stringify({ operatorUserId: fixture.operatorUserId, threadId: result.threadId, confirmationId: result.outcome.confirmationId, decision: "approve", channel: "mcp" }));
    let status;
    for (let i = 0; i < 20; i++) {
      const observed = cli("operatorAgent:getRunResultForOperatorInternal", JSON.stringify({ operatorUserId: fixture.operatorUserId, runId: result.runId }));
      status = observed.run.status;
      if (["completed", "failed"].includes(status)) break;
      await wait(300);
    }
    assert.equal(status, "completed");
    const replay = cli("operatorAgent:invokeRegisteredToolInternal", JSON.stringify(args));
    assert.equal(replay.duplicate, true);
  });
  await check("Cross-domain duplicate identity is rejected", async () => {
    assert.throws(() => cli("operatorInvitations:inviteOperatorForAgentInternal", JSON.stringify({ email: email.replace("spot.insure", "claritylabs.inc"), operatorUserId: fixture.operatorUserId })));
  });
  await check("Customer cannot invite operators", async () => {
    assert.throws(() => cli("operatorInvitations:inviteOperatorForAgentInternal", JSON.stringify({ email, operatorUserId: fixture.clientUserId })));
  });
  await check("Invited operator can verify OTP and enter console", async () => {
    const context = await browser.newContext();
    const recipient = await context.newPage();
    await recipient.goto(`${base}/operator/login?email=${encodeURIComponent(email)}`);
    assert.equal(await recipient.locator('input[type="email"]').inputValue(), email);
    const offset = captured.length;
    await recipient.getByRole("button", { name: "Continue", exact: true }).click();
    await recipient.locator("#operator-verification-code").fill(await otp(email, offset));
    await recipient.getByRole("button", { name: "Verify and continue" }).click();
    await recipient.waitForURL(/\/operator(?:\/threads)?$/);
    await recipient.screenshot({ path: `${out}/accepted.png`, fullPage: true });
    await context.close();
  });
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ checkedAt: dayjs().toISOString(), checks }, null, 2));
  await browser.close(); logs.kill();
}
