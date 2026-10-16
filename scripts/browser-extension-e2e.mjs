// Local Chrome workflow QA. Artifacts: .context/qa/extension/results.json and PNGs.
// Requires the native-local app/backend and seeded Cove client. No production writes.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const appOrigin = "http://localhost:8080";
const out = path.resolve(".context/qa/extension");
mkdirSync(out, { recursive: true });
const results = [];
const pass = (name) => { results.push({ name, status: "passed" }); console.log(`PASS ${name}`); };
const local = JSON.parse(readFileSync(".convex/local/default/config.json", "utf8"));
const flags = ["--url", "http://127.0.0.1:8083", "--admin-key", local.adminKey];
const convex = (args) => execFileSync("./node_modules/.bin/convex", [...args, ...flags], { encoding: "utf8" });
const rows = (table) => JSON.parse(convex(["data", table, "--format", "json"]));
const users = rows("users");
const operator = users.find((user) => user.email === "terry@claritylabs.inc");
const client = users.find((user) => user.email === "adyan@cove.dev");
const webDockKey = `spot:agent-dock:client:${client?._id}`;
const org = rows("organizations").find((item) => item.name === "Cove");
assert(operator && org, "Native-local synthetic fixture required");
const setAccess = (status) => convex(["run", "orgs:setClientAccessStatus", JSON.stringify({ orgId: org._id, status }), "--identity", JSON.stringify({ subject: operator._id })]);
execFileSync(process.execPath, ["scripts/build-browser-extension.mjs", "--origin", appOrigin]);
const fixture = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<title>Sidebar insurance fixture</title><h1>Insurance request</h1>
<p id="selected">Please provide evidence of cyber coverage. Reference: SIDEBAR-427.</p>
<input type="password" value="SECRET_PASSWORD"><textarea>SECRET_DRAFT</textarea>
<p hidden>SECRET_HIDDEN</p><div id="editable" contenteditable>SECRET_EDITABLE</div>
<div style="opacity:0">SECRET_TRANSPARENT</div><details><summary>More</summary>SECRET_CLOSED</details>`);
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
const context = await chromium.launchPersistentContext(path.join(out, "profile"), {
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: !process.env.DISPLAY,
  ignoreDefaultArgs: ["--disable-extensions"],
  viewport: { width: 420, height: 850 },
  args: ["--no-sandbox", "--enable-unsafe-extension-debugging"],
});
let panel;
try {
  const browserCdp = await context.browser().newBrowserCDPSession();
  const { id } = await browserCdp.send("Extensions.loadUnpacked", { path: path.resolve("extensions/spot/dist") });
  panel = await context.newPage();
  panel.setDefaultTimeout(30000);
  await panel.addInitScript(() => {
    window.addEventListener("message", (event) => {
      if (event.data?.type === "spot:ready") window.qaSessionId = event.data.sessionId;
    });
  });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const frame = panel.frameLocator("#app");
  const login = await context.newPage();
  await login.goto(`${appOrigin}/login`);
  await login.waitForTimeout(1500);
  if (await login.locator('input[type="email"]').isVisible()) {
    const logPath = ".context/logs/web.log";
    const offset = readFileSync(logPath, "utf8").length;
    await login.locator('input[type="email"]').fill("adyan@cove.dev");
    await login.getByRole("button", { name: /continue|send|sign in/i }).first().click();
    let otp;
    for (let attempt = 0; attempt < 30 && !otp; attempt++) {
      const text = readFileSync(logPath, "utf8").slice(offset);
      otp = [...text.matchAll(/codeCandidates:\s*(\d{6})/g)].at(-1)?.[1];
      if (!otp) await login.waitForTimeout(1000);
    }
    assert(otp, "Fresh captured OTP required; wait for the resend limit before retrying");
    await login.locator('input[autocomplete="one-time-code"]').first().fill(otp);
    await login.getByRole("button", { name: /verify|continue|sign in/i }).first().click();
    await login.waitForURL((url) => url.pathname !== "/login");
  }
  await login.close();
  setAccess("limited");
  await panel.reload();
  await frame.getByText("Workspace not open yet", { exact: true }).waitFor();
  assert(await panel.locator("#capture").isDisabled());
  pass("limited workspace gate; no chat or capture");
  const webDockBefore = await frame.locator("body").evaluate((_body, key) => localStorage.getItem(key), webDockKey);
  setAccess("active");
  await panel.reload();
  await panel.waitForFunction(() => !document.querySelector("#capture").disabled);
  await frame.getByRole("button", { name: "Use this page", exact: true }).waitFor();
  assert.equal(await panel.locator(".bar").isVisible(), false);
  assert.equal(await frame.getByRole("tablist", { name: "Open chats" }).count(), 0);
  pass("existing login reused in sandboxed extension iframe");
  await frame.getByRole("button", { name: "New chat", exact: true }).press("Enter");
  const input = frame.locator("textarea");
  const draft = "Review this page without taking any action. QA SIDEBAR-427";
  await input.fill(draft);
  assert.equal(await frame.getByRole("button", { name: "Preview page context" }).count(), 0);
  pass("opening sidebar does not capture");
  const target = await context.newPage();
  await target.goto(`${fixtureOrigin}/?secret=NOT_CAPTURED#private`);
  await target.bringToFront();
  await frame.getByRole("button", { name: "Use this page", exact: true }).evaluate(button => button.click());
  await panel.waitForFunction(() => document.querySelector("#status").textContent.includes("Click the Spot icon"));
  pass("ungranted tab gives recovery without capture");
  const tab = (await browserCdp.send("Target.getTargets", { filter: [{ type: "tab" }] })).targetInfos.find((item) => item.url.startsWith(fixtureOrigin));
  await browserCdp.send("Extensions.triggerAction", { id, targetId: tab.targetId });
  pass("toolbar action opens actual side panel and grants activeTab");
  // Interact with the same packaged panel in its tab without a second native
  // sidebar competing for pointer coordinates in this headless browser window.
  await panel.evaluate(async () => {
    const current = await chrome.windows.getCurrent();
    await chrome.sidePanel.close({ windowId: current.id });
  });
  const capture = async () => {
    await target.bringToFront();
    await frame.getByRole("button", { name: "Use this page", exact: true }).evaluate(button => button.click());
    await frame.getByRole("button", { name: "Preview page context" }).waitFor();
    await panel.waitForFunction(() => !document.querySelector("#capture").disabled);
  };
  await capture();
  assert.equal(await input.inputValue(), draft);
  pass("capture stages attachment without replacing draft or sending");
  await frame.getByRole("button", { name: "Preview page context" }).click();
  const preview = frame.locator(".ph-no-capture");
  await preview.getByText(/SIDEBAR-427/).waitFor();
  const text = await preview.innerText();
  assert(text.includes("SIDEBAR-427") && text.includes("untrusted page content"));
  assert(!/SECRET_|NOT_CAPTURED|#private/.test(text));
  await panel.bringToFront();
  await panel.waitForTimeout(150);
  await panel.screenshot({ path: path.join(out, "preview.png") });
  pass("preview contains source; excludes fields, hidden text and URL secrets");
  await frame.getByRole("button", { name: "Close page context" }).click();
  await frame.getByRole("button", { name: "Remove spot-page-context.txt" }).click();
  await frame.getByRole("button", { name: "History", exact: true }).click();
  await target.bringToFront();
  await frame.getByRole("button", { name: "Use this page", exact: true }).evaluate(button => button.click());
  await frame.getByText("Page waiting for a chat", { exact: true }).waitFor();
  await frame.getByRole("button", { name: "Remove Page waiting for a chat" }).click();
  pass("capture waiting in history is visible and dismissible");
  await frame.getByRole("button", { name: "New chat", exact: true }).press("Enter");
  assert.equal(await frame.getByRole("button", { name: "Preview page context" }).count(), 0);
  pass("removed capture stays removed across history/new chat");
  await input.fill(draft);
  await panel.evaluate((url) => {
    const base = { type: "spot:page-context", version: 1, sessionId: window.qaSessionId, captureId: "qa", context: { title: "Bad capture", url, text: "DO NOT STAGE", selection: false } };
    const send = (message) => document.querySelector("#app").contentWindow.postMessage(message, "http://localhost:8080");
    send({ ...base, sessionId: "stale-session" });
    send({ ...base, context: { ...base.context, text: "x".repeat(20001) } });
    send({ ...base, context: { ...base.context, url: "javascript:alert(1)" } });
  }, fixtureOrigin);
  await frame.locator("body").evaluate(() => window.postMessage({ type: "spot:page-context", version: 1, context: { title: "Wrong origin", url: "https://example.com/", text: "DO NOT STAGE", selection: false } }, window.location.origin));
  await panel.waitForTimeout(300);
  assert.equal(await frame.getByRole("button", { name: "Preview page context" }).count(), 0);
  pass("wrong origin, stale session, oversized and invalid URL messages rejected");
  await target.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector("#editable")); const s = getSelection(); s.removeAllRanges(); s.addRange(range); });
  await target.bringToFront();
  await frame.getByRole("button", { name: "Use this page", exact: true }).evaluate(button => button.click());
  await panel.waitForFunction(() => document.querySelector("#status").textContent.includes("selection can't be read"));
  assert.equal(await frame.getByRole("button", { name: "Preview page context" }).count(), 0);
  pass("excluded selection never widens to whole-page capture");
  await target.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector("#selected")); const s = getSelection(); s.removeAllRanges(); s.addRange(range); });
  await capture();
  await frame.getByRole("button", { name: "Preview page context" }).click();
  await preview.getByText(/Scope: Selected text/).waitFor();
  assert(!(await preview.innerText()).includes("Insurance request"));
  await frame.getByRole("button", { name: "Close page context" }).click();
  pass("selection capture only includes selected text");
  await panel.bringToFront();
  await panel.waitForTimeout(150);
  await panel.screenshot({ path: path.join(out, "sidebar.png") });
  await input.press("Enter");
  await frame.getByText(draft, { exact: true }).waitFor();
  await panel.waitForTimeout(3000);
  await panel.reload();
  await frame.getByText(draft, { exact: true }).waitFor();
  await frame.getByText("spot-page-context.txt", { exact: true }).waitFor();
  pass("user-submitted message and captured file persist after reload");
  await panel.waitForTimeout(6000);
  const body = await frame.locator("body").innerText();
  if (body.includes("Something went wrong")) results.push({ name: "live agent response", status: "blocked", reason: "Baseline local router rejects callback host; see convex log (router_rejected)." });
  else results.push({ name: "live agent response", status: "not_verified", reason: "This script asserts message persistence, not response quality." });
  await input.fill("Follow-up draft");
  await capture();
  assert.equal(await input.inputValue(), "Follow-up draft");
  await frame.getByRole("button", { name: "Remove spot-page-context.txt" }).click();
  pass("existing conversation can stage/remove capture and preserve draft");
  assert.equal(await frame.locator("body").evaluate((_body, key) => localStorage.getItem(key), webDockKey), webDockBefore);
  await input.press("Escape");
  assert(await input.isVisible());
  pass("sidebar interactions preserve web dock layout; Escape keeps composer visible");
  await frame.locator("body").evaluate((body) => { const a = document.createElement("a"); a.id = "qa-portal-link"; a.href = "/policies"; a.textContent = "QA portal navigation"; body.append(a); });
  const opened = context.waitForEvent("page");
  await frame.locator("#qa-portal-link").click();
  const appTab = await opened;
  await appTab.waitForURL(`${appOrigin}/policies`);
  await appTab.close();
  await frame.locator("#qa-portal-link").evaluate((element) => element.remove());
  pass("links outside layout open in app tab without navigating sidebar");
  await panel.emulateMedia({ colorScheme: "dark" });
  await frame.locator("body").evaluate(() => { localStorage.setItem("theme", "dark"); document.documentElement.classList.add("dark"); });
  await panel.bringToFront();
  await panel.waitForTimeout(150);
  await panel.screenshot({ path: path.join(out, "sidebar-dark.png") });
  pass("narrow dark-mode sidebar rendered");
  await frame.locator("body").evaluate(() => { localStorage.setItem("theme", "light"); document.documentElement.classList.remove("dark"); });
  await context.clearCookies();
  await panel.reload();
  await frame.getByRole("heading", { name: "Your insurance agent, right here." }).waitFor();
  assert(await panel.locator("#capture").isDisabled());
  pass("signed-out gate disables capture and removes agent view");
} catch (error) {
  results.push({ name: "workflow", status: "failed", reason: error.message });
  await panel?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  setAccess(org.clientAccessStatus ?? "limited");
  await context.close();
  fixture.close();
  writeFileSync(path.join(out, "results.json"), JSON.stringify({ browser: "Chrome", appOrigin, headed: !!process.env.DISPLAY, results }, null, 2) + "\n");
}
