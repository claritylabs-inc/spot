// Local synthetic fixtures only. Run after capture-ui-adoption with the same Convex log.
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const baseUrl = process.argv[2] || "http://localhost:8080";
const target = new URL(baseUrl);
assert(
  ["http:", "https:"].includes(target.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
    !target.username &&
    !target.password,
  "Loopback HTTP(S) required",
);
const out = process.argv[3] || ".context/qa/shell/behavior";
const log = process.argv[4] || ".context/logs/convex-capture.log";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
async function login(page, email) {
  await page.goto(`${baseUrl}/login`);
  const offset = readFileSync(log, "utf8").length;
  await page.locator('input[type="email"]').fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const inputs = page.locator('input[inputmode="numeric"]');
  await inputs.first().waitFor();
  let otp;
  for (let attempt = 0; attempt < 30; attempt++) {
    const text = readFileSync(log, "utf8")
      .slice(offset)
      .replaceAll("\\r\\n", "\n")
      .replaceAll("\\n", "\n");
    otp = [...text.matchAll(/codeCandidates:\s*([0-9,\s]+)/g)]
      .at(-1)?.[1]
      .split(",")[0]
      .trim();
    if (/^\d{6}$/.test(otp || "")) break;
    await page.waitForTimeout(500);
  }
  assert(/^\d{6}$/.test(otp || ""), "Fresh local OTP required");
  if ((await inputs.count()) === 6) {
    for (let i = 0; i < 6; i++) await inputs.nth(i).fill(otp[i]);
  } else await inputs.first().fill(otp);
  await page.getByRole("button", { name: /verify/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
try {
  if (!process.env.SHELL_OPERATOR_ONLY) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await login(page, "adyan@cove.dev");
    await page.goto(`${baseUrl}/`);
    await page
      .getByRole("button", { name: "Collapse navigation", exact: true })
      .waitFor();
    const original = await page.evaluate(() => ({
      sidebar: localStorage.getItem("sidebar-collapsed"),
      theme: localStorage.getItem("theme"),
    }));
    try {
      await page.evaluate(() => {
        localStorage.setItem("sidebar-collapsed", "1");
        localStorage.setItem("theme", "dark");
      });
      await page.reload();
      await page
        .getByRole("button", { name: "Expand navigation", exact: true })
        .waitFor();
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("sidebar-collapsed")),
        ),
        { collapsed: true, width: 220 },
      );
      await shot(page, "client-legacy-collapsed-dark");
      await page
        .getByRole("button", { name: "Expand navigation", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("sidebar-collapsed")).collapsed,
        ),
        false,
      );
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("button", { name: "Expand navigation", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("sidebar-collapsed")).collapsed,
        ),
        true,
      );
      results.push(
        "client legacy collapsed migration and both toggle directions survive reload",
      );
      await page.evaluate(() => localStorage.setItem("sidebar-collapsed", ""));
      await page.reload();
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .waitFor();
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("sidebar-collapsed")),
        ),
        { collapsed: false, width: 220 },
      );
      results.push("legacy expanded empty value migrates with default width");
      await page.setViewportSize({ width: 390, height: 844 });
      const toggle = page.getByRole("button", {
        name: "Toggle navigation",
        exact: true,
      });
      await toggle.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
        "Mobile navigation receives focus",
      );
      await shot(page, "client-mobile-navigation-dark");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert(
        await toggle.evaluate((el) => el === document.activeElement),
        "Escape restores trigger focus",
      );
      await toggle.click();
      await dialog.waitFor();
      await page.waitForTimeout(200);
      await page.mouse.click(380, 420);
      await dialog.waitFor({ state: "hidden" });
      assert(
        await toggle.evaluate((el) => el === document.activeElement),
        "Outside click restores client menu focus",
      );
      await toggle.click();
      await page.evaluate(() => (window.__shellNavigation = true));
      await dialog.getByRole("link", { name: "Policies", exact: true }).click();
      await page.waitForURL(/\/policies/);
      await dialog.waitFor({ state: "hidden" });
      await toggle.click();
      await dialog.getByRole("link", { name: "Files", exact: true }).click();
      await page.waitForURL(/\/files/);
      await dialog.waitFor({ state: "hidden" });
      assert(
        await page.evaluate(() => window.__shellNavigation),
        "Navigation stays client-side",
      );
      await shot(page, "client-mobile-policies-dark");
      results.push(
        "mobile focus entry, Escape/outside restoration, route close and Next navigation",
      );
      await page.goto(`${baseUrl}/profile`);
      await page
        .getByRole("button", { name: "Use light theme", exact: true })
        .click();
      assert(
        await page
          .locator("html")
          .evaluate((el) => !el.classList.contains("dark")),
      );
      await page.reload();
      await page
        .getByRole("button", { name: "Use light theme", exact: true })
        .waitFor();
      assert(
        await page
          .locator("html")
          .evaluate((el) => !el.classList.contains("dark")),
      );
      await page
        .getByRole("button", { name: "Use dark theme", exact: true })
        .click();
      assert(
        await page
          .locator("html")
          .evaluate((el) => el.classList.contains("dark")),
      );
      await shot(page, "client-mobile-theme-dark");
      results.push("controlled theme options and light persistence");
      const fixtureClient = new ConvexHttpClient("http://127.0.0.1:3210");
      fixtureClient.setAuth(
        await page.evaluate(() =>
          localStorage.getItem("__convexAuthJWT_http1270013210"),
        ),
      );
      const threadId = await fixtureClient.mutation(
        makeFunctionReference("threads:create"),
        { title: "Shell QA title" },
      );
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${baseUrl}/agent/thread/${threadId}`);
        const title = page.locator('button[title="Rename"]');
        await title.waitFor();
        await title.click();
        const input = page.getByRole("textbox", { name: "Title", exact: true });
        assert(
          await input.evaluate((el) => el === document.activeElement),
          "Title focuses on edit",
        );
        await input.fill("Discard this title");
        await input.press("Escape");
        assert.equal(await title.innerText(), "Shell QA title");
        await title.click();
        await input.fill("   ");
        await input.press("Enter");
        assert.equal(await title.innerText(), "Shell QA title");
        await context.setOffline(true);
        await title.click();
        await input.fill("Shell QA first edit");
        await input.press("Enter");
        await title.click();
        await input.fill("Shell QA queued edit");
        await input.press("Enter");
        await page.getByText("Still saving…", { exact: true }).waitFor();
        await shot(page, "client-title-pending-dark");
        await context.setOffline(false);
        await page
          .getByText("Still saving…", { exact: true })
          .waitFor({ state: "hidden" });
        await page.reload();
        await title.waitFor();
        assert.equal(await title.innerText(), "Shell QA queued edit");
        await shot(page, "client-title-restored-dark");
        results.push(
          "controlled title focus, Escape/empty rejection, editing while pending, status and serialized save/reload",
        );
      } finally {
        await context.setOffline(false);
        await fixtureClient.mutation(makeFunctionReference("threads:archive"), {
          id: threadId,
        });
      }
    } finally {
      await page.evaluate((original) => {
        for (const [key, value] of [
          ["sidebar-collapsed", original.sidebar],
          ["theme", original.theme],
        ]) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, original);
    }
    await context.close();
  }
  const operatorContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const operator = await operatorContext.newPage();
  operator.setDefaultTimeout(30000);
  await login(operator, "terry@claritylabs.inc");
  await operator.goto(`${baseUrl}/operator/clients`);
  const navigation = operator.getByRole("separator", {
    name: "Resize navigation",
    exact: true,
  });
  await operator.locator("table tbody tr").first().waitFor();
  await navigation.waitFor();
  await operator.waitForTimeout(800);
  const stored = await operator.evaluate(() =>
    Object.fromEntries(
      Object.entries(localStorage).filter(
        ([key]) =>
          key.startsWith("custom-sidebar:") ||
          key.includes("spot:app-shell-panels:"),
      ),
    ),
  );
  try {
    const before = await navigation.boundingBox();
    await operator.mouse.move(
      before.x + before.width / 2,
      before.y + before.height / 2,
    );
    await operator.mouse.down();
    await operator.mouse.move(before.x + 70, before.y + before.height / 2, {
      steps: 8,
    });
    await operator.mouse.up();
    await operator.waitForTimeout(400);
    const changed = await navigation.boundingBox();
    await shot(operator, "operator-resize-attempt");
    console.log("navigation resize", { before, changed });
    assert(changed.x > before.x + 40, "Navigation resize changes width");
    await operator.reload();
    await navigation.waitFor();
    await operator.waitForTimeout(500);
    assert(
      Math.abs((await navigation.boundingBox()).x - changed.x) < 3,
      "Navigation width survives reload",
    );
    await operator
      .getByRole("button", { name: "Collapse navigation", exact: true })
      .click();
    await operator.reload();
    await operator
      .getByRole("button", { name: "Expand navigation", exact: true })
      .waitFor();
    await operator
      .getByRole("button", { name: "Expand navigation", exact: true })
      .click();
    await operator.locator("table tbody tr").first().click();
    const detail = operator.locator("#app-shell-separator-right");
    await detail.waitFor();
    await detail.focus();
    const detailBefore = await detail.boundingBox();
    await operator.keyboard.press("ArrowLeft");
    await operator.waitForTimeout(300);
    const detailChanged = await detail.boundingBox();
    assert(
      Math.abs(detailBefore.x - detailChanged.x) > 1,
      "Keyboard resizes detail panel",
    );
    await operator.reload();
    await navigation.waitFor();
    await operator.waitForTimeout(800);
    await operator.locator("table tbody tr").first().click();
    await detail.waitFor();
    await operator.waitForTimeout(300);
    console.log("detail resize", {
      detailBefore,
      detailChanged,
      restored: await detail.boundingBox(),
      storage: await operator.evaluate(() =>
        Object.fromEntries(
          Object.entries(localStorage).filter(([k]) =>
            k.includes("spot:app-shell-panels:"),
          ),
        ),
      ),
    });
    await shot(operator, "operator-detail-restored-attempt");
    assert(
      Math.abs((await detail.boundingBox()).x - detailChanged.x) < 3,
      "Detail width survives reload",
    );
    await shot(operator, "operator-resize-restored");
    await operator.reload();
    await operator.locator("table tbody tr").first().waitFor();
    await operator.waitForTimeout(500);
    await operator.setViewportSize({ width: 390, height: 844 });
    const menu = operator.getByRole("button", {
      name: "Toggle navigation",
      exact: true,
    });
    await menu.click();
    const menuDialog = operator.getByRole("dialog", {
      name: "Navigation",
      exact: true,
    });
    await menuDialog.waitFor();
    assert(
      await menuDialog.evaluate((el) => el.contains(document.activeElement)),
      "Operator menu receives focus",
    );
    await shot(operator, "operator-mobile-navigation");
    await operator.keyboard.press("Escape");
    await menuDialog.waitFor({ state: "hidden" });
    assert(
      await menu.evaluate((el) => el === document.activeElement),
      "Operator menu restores focus",
    );
    await menu.click();
    await menuDialog.waitFor();
    await operator.waitForTimeout(200);
    await operator.mouse.click(380, 420);
    await menuDialog.waitFor({ state: "hidden" });
    assert(
      await menu.evaluate((el) => el === document.activeElement),
      "Outside click restores operator menu focus",
    );
    await menu.click();
    await menuDialog
      .getByRole("link", { name: "Clients", exact: true })
      .click();
    await menuDialog.waitFor({ state: "hidden" });
    results.push(
      "custom operator mobile navigation focus, Escape/outside and same-route close",
    );

    results.push(
      "operator navigation resize/collapse persistence and detail keyboard resize persistence",
    );
  } finally {
    await operator.evaluate((stored) => {
      for (const key of Object.keys(localStorage))
        if (
          key.startsWith("custom-sidebar:") ||
          key.includes("spot:app-shell-panels:")
        )
          localStorage.removeItem(key);
      for (const [key, value] of Object.entries(stored))
        localStorage.setItem(key, value);
    }, stored);
    await operatorContext.close();
  }

  writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify({ browser: "headless Chromium", results }, null, 2),
  );
  console.log("PASS", results);
} catch (error) {
  writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      { browser: "headless Chromium", passed: results, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
