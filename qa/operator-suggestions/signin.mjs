// Signs in a synthetic @spot.insure operator (email OTP + TOTP enrollment) exactly as
// scripts/operator-second-factor-e2e.mjs does, then saves browser storage + TOTP key.
// Helper logic (emailOtp / firstFactor / enrollment steps) is copied from that script,
// which has no exports. Usage: node qa/operator-suggestions/signin.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { generateTOTP } from "@oslojs/otp";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import dayjs from "dayjs";

const base = "http://localhost:8080";
const childEnv = { ...process.env, CONVEX_AGENT_MODE: "anonymous" };
delete childEnv.CONVEX_DEPLOY_KEY;
delete childEnv.CONVEX_DEPLOYMENT_TOKEN;
mkdirSync(".context/qa", { recursive: true });
const logs = spawn("npx", ["convex", "logs", "--history", "0"], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
let captured = "";
for (const s of [logs.stdout, logs.stderr]) s.on("data", (d) => { captured += d.toString(); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function emailOtp(email, offset) {
  for (let n = 0; n < 150; n++) {
    const tail = captured.slice(offset);
    const start = tail.indexOf(`to: ${email}`);
    const code = start >= 0 ? tail.slice(start).match(/codeCandidates: (\d{6})/)?.[1] : null;
    if (code) return code;
    await wait(200);
  }
  throw new Error("Local OTP capture missing");
}
const email = `suggestions-qa-${dayjs().valueOf()}@spot.insure`;
const context = await chromium.launchPersistentContext(".context/qa/profile", { executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"], viewport: { width: 1440, height: 900 } });
try {
  await wait(4000);
  const page = await context.newPage();
  await page.goto(`${base}/operator/login`);
  const offset = captured.length;
  await page.locator('input[type="email"]').fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator("#operator-verification-code").fill(await emailOtp(email, offset));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.getByRole("heading", { name: "Two-factor authentication" }).waitFor();
  await page.getByAltText("Authenticator setup QR code").waitFor();
  const secret = await page.getByText(/^[A-Z2-7]{32}$/).innerText();
  const key = decodeBase32IgnorePadding(secret);
  await page.locator("#operator-totp-enroll").fill(generateTOTP(key, 30, 6));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  const list = page.locator("ul li");
  await list.first().waitFor();
  const recoveryCodes = await list.allInnerTexts();
  assert.equal(recoveryCodes.length, 10);
  await page.getByRole("button", { name: "Continue to operator console" }).click();
  await page.waitForURL(/\/operator(?:\/threads)?$/);
  writeFileSync(".context/qa/signin.json", JSON.stringify({ email, secret }, null, 2));
  console.log("SIGNED IN", email, page.url());
  await page.screenshot({ path: ".context/qa/00-after-signin.png" });
} finally {
  logs.kill();
  await context.close();
}
