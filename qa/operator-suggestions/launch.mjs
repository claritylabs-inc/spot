// Step 5/6: click a suggestion by label on a page, screenshot the resulting thread.
import { launch, base, wait, labels, OUT } from "./lib.mjs";
const [, , path, label, shot] = process.argv;
const { browser, page, consoleLog } = await launch();
await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
await wait(2500);
await page.getByRole("button", { name: /Ask anything/ }).first().click().catch(() => {});
await page.locator('ul[aria-label="Suggested prompts"]').waitFor({ timeout: 20000 });
await wait(2500);
console.log("before:", JSON.stringify(await labels(page)));
await page.locator('ul[aria-label="Suggested prompts"] li button', { hasText: label }).first().click();
await wait(6000);
console.log("url:", page.url());
await page.screenshot({ path: `${OUT}/${shot}.png` });
console.log("body:", (await page.locator("body").innerText()).slice(0, 1800).replace(/\n+/g, " | "));
console.log("console:", JSON.stringify(consoleLog.filter((c) => !/favicon|Failed to load resource/.test(c.text))));
await browser.close();
