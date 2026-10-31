// Vercel preview browser E2E, run by .github/workflows/preview-e2e.yml.
//
//   APP_URL=https://<preview>.vercel.app PREVIEW_E2E_PASSWORD=... node scripts/preview-e2e.mjs
//
// Signs in as the reviewer account that `reviewerAccounts:provisionPreview`
// seeds into the preview's own Convex deployment. `VERCEL_AUTOMATION_BYPASS_SECRET`
// gets past Vercel Deployment Protection. Artifacts: .context/qa/preview/*.png.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const app = (process.env.APP_URL ?? "").replace(/\/$/, "");
const password = process.env.PREVIEW_E2E_PASSWORD;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
assert(app.startsWith("https://"), "APP_URL must be the preview's https URL");
assert(password, "PREVIEW_E2E_PASSWORD is required");
const email = "chrome-review@review.spot.insure";
const out = path.resolve(".context/qa/preview");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  extraHTTPHeaders: bypass
    ? {
        "x-vercel-protection-bypass": bypass,
        "x-vercel-set-bypass-cookie": "true",
      }
    : {},
});
const page = await context.newPage();
const pass = (name) => console.log(`PASS ${name}`);

try {
  await page.goto(`${app}/login?next=/policies`);
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(`${app}/policies`, { timeout: 60000 });
  await page.getByText("DEMO-GL-0001").first().waitFor({ timeout: 60000 });
  await page.screenshot({ path: path.join(out, "01-policies.png") });
  pass(
    "reviewer signs in against the preview's Convex deployment and sees seeded policies",
  );

  await page.goto(`${app}/extension`);
  await page
    .getByRole("button", { name: /Ask anything|New chat/i })
    .first()
    .waitFor({ timeout: 60000 });
  await page.screenshot({ path: path.join(out, "02-extension.png") });
  pass("signed-in app shell renders");
} catch (error) {
  await page
    .screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
