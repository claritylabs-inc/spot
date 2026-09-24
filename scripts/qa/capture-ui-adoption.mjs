// Capture the local seeded operator workflow; fails closed on authentication errors.
// Usage: node scripts/qa/capture-ui-adoption.mjs <outdir> <baseUrl> <convexLog>
import { chromium } from "playwright";
import { readFileSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const outDir = process.argv[2] || ".context/screenshots/after";
const baseUrl = process.argv[3] || "http://localhost:8080";
const convexLog = process.argv[4] || ".context/logs/convex-capture.log";

mkdirSync(outDir, { recursive: true });

let loginLogOffset = 0;
function readOtpFromLog() {
  const text = readFileSync(convexLog, "utf8")
    .slice(loginLogOffset)
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n");
  const matches = [...text.matchAll(/codeCandidates:\s*([0-9,\s]+)/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1][1];
  const code = last.split(",")[0].trim();
  return /^\d{6}$/.test(code) ? code : null;
}

async function shoot(page, name, { width, height }) {
  await page.setViewportSize({ width, height });
  try {
    await page.waitForLoadState("networkidle", { timeout: 8000 });
  } catch {}
  await page.waitForTimeout(700);
  const suffix = width === 390 ? "-mobile" : "";
  await page.screenshot({
    path: path.join(outDir, `${name}${suffix}.png`),
    fullPage: false,
  });
}

async function main() {
  const browser = await chromium.launch();
  const state = process.env.UI_ADOPTION_AUTH_STATE
    ? JSON.parse(readFileSync(process.env.UI_ADOPTION_AUTH_STATE, "utf8"))
    : undefined;
  if (state)
    state.origins = state.origins.map((origin) => ({
      ...origin,
      origin: new URL(baseUrl).origin,
    }));
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(120000);

  const sizes = [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ];

  if (!process.env.UI_ADOPTION_TOAST_ONLY) {
    // --- Login ---
    await page.goto(`${baseUrl}/login`);
    for (const size of sizes) await shoot(page, "01-login", size);

    await page.setViewportSize({ width: 1440, height: 900 });
    loginLogOffset = readFileSync(convexLog, "utf8").length;
    await page.fill('input[type="email"]', "terry@claritylabs.inc");
    await page
      .getByRole("button", { name: /continue|send|sign in/i })
      .first()
      .click();
    await page.waitForTimeout(1500);
    for (const size of sizes) await shoot(page, "02-login-otp", size);

    const otp = readOtpFromLog();
    if (!otp) {
      console.error("NO_OTP_FOUND");
      await browser.close();
      process.exit(1);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const otpInputs = page
      .locator('input[inputmode="numeric"], input[type="text"]')
      .filter({ hasNot: page.locator("[type=email]") });
    const count = await otpInputs.count();
    if (count >= 6) {
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).fill(otp[i]);
      }
    } else {
      await page.locator("form").last().locator("input").last().fill(otp);
    }
    await page
      .getByRole("button", { name: /verify/i })
      .first()
      .click();
    await page.waitForURL(/\/operator\//, { timeout: 30000 });
    assert(!page.url().includes("login"), "Authentication must succeed");
    for (const size of sizes) await shoot(page, "03-dashboard", size);

    // --- List page: operator clients ---
    await page.goto(`${baseUrl}/operator/clients`);
    await page.waitForTimeout(2500);
    for (const size of sizes) await shoot(page, "04-clients-list", size);

    // --- Detail page: first client row ---
    await page.setViewportSize({ width: 1440, height: 900 });
    const firstRow = page
      .locator("table tbody tr, [data-slot=table-body] tr")
      .first();
    if (await firstRow.count()) {
      await firstRow.click();
      await page.waitForTimeout(2500);
      for (const size of sizes) await shoot(page, "05-client-detail", size);
    } else {
      throw new Error("NO_CLIENT_ROW_FOUND");
    }

    // --- Settings ---
    await page.goto(`${baseUrl}/operator/settings`);
    await page.waitForTimeout(2500);
    for (const size of sizes) await shoot(page, "06-settings", size);

    // --- Dialog: "Create client" modal on the operator clients page ---
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/operator/clients`);
    await page.waitForTimeout(2000);
    const createClientBtn = page
      .getByRole("button", { name: /create client/i })
      .first();
    if (await createClientBtn.count()) {
      await createClientBtn.click();
      await page.waitForTimeout(1000);
      for (const size of sizes) await shoot(page, "07-dialog", size);
      await page.setViewportSize({ width: 1440, height: 900 });
      const submit = page
        .locator('button[form="operator-create-client-form"]:visible')
        .first();
      assert(await submit.isDisabled(), "Empty client form must be disabled");
      await page
        .getByPlaceholder("Client organization")
        .filter({ visible: true })
        .first()
        .fill("UI adoption unsaved fixture");
      assert(await submit.isEnabled(), "Named client form must be enabled");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    } else {
      throw new Error("NO_DIALOG_TRIGGER_FOUND");
    }

    assert(
      (await page.locator("#operator-create-client-form:visible").count()) ===
        0,
      "Escape closes unsaved form",
    );
    await page.goto(`${baseUrl}/operator/clients`);
    await page.waitForSelector("table tbody tr");
    await page.evaluate(() => {
      window.__uiAdoptionNavigation = true;
    });
    await page.locator("table tbody tr a").first().click();
    await page.waitForURL(/\/operator\/clients\/[^/]+$/);
    assert(
      await page.evaluate(() => window.__uiAdoptionNavigation),
      "Record link must use client navigation",
    );
    await context.storageState({ path: path.join(outDir, "auth-state.json") });
    chmodSync(path.join(outDir, "auth-state.json"), 0o600);
  }
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto(`${baseUrl}/operator/settings?mcp=oauth_error`);
    const toast = page.locator("[data-sonner-toast]").first();
    await toast.waitFor({ state: "visible" });
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(
        outDir,
        `08-toast${size.width === 390 ? "-mobile" : ""}.png`,
      ),
    });
    await toast.getByRole("button", { name: /close/i }).click();
    await toast.waitFor({ state: "hidden" });
  }
  console.log(
    process.env.UI_ADOPTION_TOAST_ONLY
      ? "PASS: synthetic OAuth-error toast dismissal"
      : "PASS: fresh OTP login, authenticated routes, row sidebar, form validation/cancel, SPA record link, synthetic OAuth-error toast dismissal",
  );
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
