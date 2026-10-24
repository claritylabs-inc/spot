// Step 4: fresh page context, fine-grained label timeline to catch urgency -> Jev reorder.
import { writeFileSync } from "node:fs";
import { launch, base, ids, wait, labels, OUT } from "./lib.mjs";
const { browser, page, consoleLog } = await launch();
const path = process.argv[2] ?? `/operator/clients/${ids.bolt}/compliance`;
await page.goto(`${base}${path}`, { waitUntil: "commit" });
const timeline = [];
const t0 = Date.now();
let last = "";
let opened = false;
for (let i = 0; i < 200; i++) {
  if (!opened) {
    const b = page.getByRole("button", { name: /Ask anything/ }).first();
    if (await b.count()) { await b.click().catch(() => {}); opened = true; }
  }
  const now = await labels(page).catch(() => []);
  const sig = JSON.stringify(now);
  if (sig !== last && now.length) { timeline.push({ ms: Date.now() - t0, labels: now }); last = sig; }
  await wait(100);
}
await page.screenshot({ path: `${OUT}/step4-ranking-${path.split("/").pop()}.png` });
console.log(JSON.stringify(timeline, null, 1));
writeFileSync(`.context/qa/ranking-timeline.json`, JSON.stringify({ path, timeline, consoleLog }, null, 2));
await browser.close();
