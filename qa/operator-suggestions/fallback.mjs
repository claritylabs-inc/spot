// Fallback check: with no live data, static intents fill to 3 and never use the excluded intents.
import { writeFileSync } from "node:fs";
import { launch, base, ids, wait, labels, OUT } from "./lib.mjs";
const pages = [
  ["fallback-global", "/operator/clients"],
  ["fallback-coastal-files", `/operator/clients/${ids.coastal}/files`],
  ["fallback-coastal-compliance", `/operator/clients/${ids.coastal}/compliance`],
];
const { browser, page, consoleLog } = await launch();
const results = {};
for (const [name, path] of pages) {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await wait(2500);
  await page.getByRole("button", { name: /Ask anything/ }).first().click().catch(() => {});
  await page.locator('ul[aria-label="Suggested prompts"]').waitFor({ timeout: 20000 }).catch(() => {});
  await wait(4000);
  results[name] = await labels(page);
  console.log(name, JSON.stringify(results[name]));
  await page.screenshot({ path: `${OUT}/step3-${name}.png` });
}
writeFileSync(".context/qa/fallback.json", JSON.stringify({ results, consoleLog }, null, 2));
await browser.close();
