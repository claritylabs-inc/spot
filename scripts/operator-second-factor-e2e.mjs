// Local-only workflow proof for operator TOTP second factor. Run with local
// Convex and Next running: node scripts/operator-second-factor-e2e.mjs [http://localhost:8080]
// Artifacts: .context/qa/operator-second-factor/results.json and PNGs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { generateTOTP } from "@oslojs/otp";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import dayjs from "dayjs";

const base = process.argv[2] ?? "http://localhost:8080";
const convexUrl = "http://127.0.0.1:8083";
assert.equal(new URL(base).hostname, "localhost");
// Never let an inherited deploy key point the CLI at a hosted deployment.
const childEnv = { ...process.env };
delete childEnv.CONVEX_DEPLOY_KEY;
const out = ".context/qa/operator-second-factor";
mkdirSync(out, { recursive: true });
const logs = spawn("npx", ["convex", "logs", "--history", "0"], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
let captured = "";
for (const stream of [logs.stdout, logs.stderr]) stream.on("data", (data) => { captured += data.toString(); });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function emailOtp(email, offset) {
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
const email = `twofa-qa-${dayjs().valueOf()}@spot.insure`;

let lastEmailAt = 0;
async function firstFactor() {
  // Sign-in emails are limited to one per minute per address.
  await wait(Math.max(0, lastEmailAt + 61_000 - dayjs().valueOf()));
  lastEmailAt = dayjs().valueOf();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/operator/login`);
  const offset = captured.length;
  await page.locator('input[type="email"]').fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator("#operator-verification-code").fill(await emailOtp(email, offset));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.getByRole("heading", { name: "Two-factor authentication" }).waitFor();
  return page;
}
async function backendClient(page) {
  const token = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("__convexAuthJWT"))?.[1]);
  assert(token, "Convex auth token in local storage");
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  return client;
}
async function nextStepCode(key, used) {
  for (;;) {
    const code = generateTOTP(key, 30, 6);
    if (code !== used) return code;
    await wait(1000);
  }
}

try {
  await wait(1500);
  const page = await firstFactor();
  let key;
  let enrollCode;
  let recoveryCodes;
  await check("Email code alone reaches enrollment, not the console", async () => {
    await page.getByAltText("Authenticator setup QR code").waitFor();
    await page.screenshot({ path: `${out}/01-enroll.png`, fullPage: true });
    const client = await backendClient(page);
    await assert.rejects(client.query(anyApi.operator.current, {}), /OPERATOR_REQUIRED|only to Spot operators/);
    await page.goto(`${base}/operator/clients`);
    await page.waitForURL(/\/operator\/login$/);
  });
  await check("Wrong enrollment code is rejected", async () => {
    await page.getByAltText("Authenticator setup QR code").waitFor();
    key = decodeBase32IgnorePadding(await page.getByText(/^[A-Z2-7]{32}$/).innerText());
    const right = generateTOTP(key, 30, 6);
    await page.locator("#operator-totp-enroll").fill(right === "000000" ? "111111" : "000000");
    await page.getByRole("button", { name: "Turn on two-factor" }).click();
    await page.getByRole("alert").filter({ hasText: "That code didn't work." }).waitFor();
  });
  await check("Valid code enrolls, shows recovery codes, and opens the console", async () => {
    enrollCode = generateTOTP(key, 30, 6);
    await page.locator("#operator-totp-enroll").fill(enrollCode);
    await page.getByRole("button", { name: "Turn on two-factor" }).click();
    const list = page.locator("ul li");
    await list.first().waitFor();
    recoveryCodes = await list.allInnerTexts();
    assert.equal(recoveryCodes.length, 10);
    await page.screenshot({ path: `${out}/02-recovery-codes.png`, fullPage: true });
    await page.getByRole("button", { name: "Continue to operator console" }).click();
    await page.waitForURL(/\/operator(?:\/threads)?$/);
    const client = await backendClient(page);
    assert.equal((await client.query(anyApi.operator.current, {})).profile.email, email);
  });

  const second = await firstFactor();
  await check("Enrolled operator gets a challenge; a used TOTP step is a replay", async () => {
    await second.locator("#operator-totp").waitFor();
    await second.screenshot({ path: `${out}/03-challenge.png`, fullPage: true });
    await second.locator("#operator-totp").fill(enrollCode);
    await second.getByRole("button", { name: "Verify and continue" }).click();
    await second.getByRole("alert").filter({ hasText: /didn't work|Too many attempts/ }).waitFor();
  });
  await check("Recovery code signs in once", async () => {
    await second.getByRole("button", { name: "Use a recovery code instead" }).click();
    await second.locator("#operator-recovery-code").fill(recoveryCodes[0]);
    await second.getByRole("button", { name: "Verify and continue" }).click();
    await second.waitForURL(/\/operator(?:\/threads)?$/);
  });

  const third = await firstFactor();
  await check("Used recovery code is rejected; next TOTP step signs in", async () => {
    await third.getByRole("button", { name: "Use a recovery code instead" }).click();
    await third.locator("#operator-recovery-code").fill(recoveryCodes[0]);
    await third.getByRole("button", { name: "Verify and continue" }).click();
    await third.getByRole("alert").filter({ hasText: /didn't work|Too many attempts/ }).waitFor();
    await third.getByRole("button", { name: "Use your authenticator app" }).click();
    await third.locator("#operator-totp").fill(await nextStepCode(key, enrollCode));
    await third.getByRole("button", { name: "Verify and continue" }).click();
    await third.waitForURL(/\/operator(?:\/threads)?$/);
  });
  await check("Profile shows second factor status with one recovery code used", async () => {
    await third.goto(`${base}/operator/profile`);
    await third.getByText(/9 of 10 recovery codes left/).waitFor();
    await third.screenshot({ path: `${out}/04-profile.png`, fullPage: true });
  });

  const fourth = await firstFactor();
  await check("Repeated wrong codes are rate limited", async () => {
    let limited = false;
    for (let n = 0; n < 8 && !limited; n++) {
      // Type like a person: the field is cleared and refocused after each failure.
      await fourth.locator("#operator-totp").click();
      await fourth.keyboard.type(n % 2 ? "000000" : "999999");
      await fourth.getByRole("button", { name: "Verify and continue" }).click();
      // A settled failure clears the field and re-enables the form.
      await fourth.waitForFunction(() => document.querySelector("#operator-totp-hidden-input")?.value === "" && !document.body.innerText.includes("Verifying..."));
      const alert = fourth.locator("p[role=alert]");
      await alert.waitFor();
      limited = /Too many attempts/.test(await alert.innerText());
    }
    assert(limited, "rate limit reached");
    await fourth.screenshot({ path: `${out}/05-rate-limited.png`, fullPage: true });
  });
  writeFileSync(`${out}/results.json`, JSON.stringify({ email, checks }, null, 2));
} catch (error) {
  for (const [index, open] of browser.contexts().flatMap((c) => c.pages()).entries())
    await open.screenshot({ path: `${out}/failure-${index}.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  logs.kill();
  await browser.close();
}
