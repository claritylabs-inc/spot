// Step 7: composer typing, plain message send, new chat, history, console errors, dev-overlay issue.
import { writeFileSync } from "node:fs";
import { launch, base, ids, wait, labels, OUT } from "./lib.mjs";
const { browser, page, consoleLog } = await launch();
const log = {};
await page.goto(`${base}/operator/clients/${ids.bolt}/procurement/${ids.request}`, { waitUntil: "domcontentloaded" });
await wait(3500);
// Restored tab from earlier session: existing chat behavior (history of the prior plain message).
log.restoredThreadShowsPriorMessage = (await page.locator("body").innerText()).includes("What is the status of this placement?");
// Start a new chat from the dock tab strip.
await page.keyboard.press("Alt+n");
await page.locator('ul[aria-label="Suggested prompts"]').waitFor({ timeout: 20000 });
await wait(3000);
log.labelsNewChat = await labels(page);
const composer = page.locator("textarea").first();
await composer.click();
await page.keyboard.type("Draft a summary of open items", { delay: 15 });
log.composerValue = await composer.inputValue();
log.suggestionsWhileTyping = await labels(page);
await page.screenshot({ path: `${OUT}/step7-typing.png` });
await composer.fill("");
log.composerClears = (await composer.inputValue()) === "";
// History panel lists suggestion-launched threads by their label titles.
await page.getByRole("button", { name: /All chats/ }).click();
await wait(1500);
const body = await page.locator("body").innerText();
log.historyHasLabelTitles = ["Coastal Foods renews in 20 days", "Review 2 uncertain limits"].every((t) => body.includes(t));
await page.screenshot({ path: `${OUT}/step7-history.png` });
await page.keyboard.press("Escape");
// Dev overlay issue text.
const issues = page.getByRole("button", { name: /Open issues overlay/ });
if (await issues.count()) {
  await issues.click().catch(() => {});
  await wait(1000);
  log.devOverlay = (await page.locator("nextjs-portal").first().innerText().catch(() => "")).slice(0, 1200);
  await page.screenshot({ path: `${OUT}/step7-dev-overlay.png` });
}
log.console = consoleLog.filter((c) => !/favicon|gravatar|Failed to load resource/.test(c.text) && !/not an animatable value/.test(c.text));
console.log(JSON.stringify(log, null, 1));
writeFileSync(".context/qa/health.json", JSON.stringify(log, null, 2));
await browser.close();
