// Step 3/4: open the dock (empty chat) on each page, record the label timeline, screenshot.
import { writeFileSync } from "node:fs";
import { launch, base, ids, wait, labels, OUT } from "./lib.mjs";
const pages = [
  ["global-clients-list", "/operator/clients"],
  ["global-operator-home", "/operator"],
  ["coastal-client", `/operator/clients/${ids.coastal}`],
  ["bolt-policies", `/operator/clients/${ids.bolt}/policies`],
  ["failed-policy", `/operator/clients/${ids.bolt}/policies/${ids.failedPolicy}`],
  ["procurement-request", `/operator/clients/${ids.bolt}/procurement/${ids.request}`],
  ["coastal-files-nothing-notable", `/operator/clients/${ids.coastal}/files`],
];
const only = process.argv[2];
const { browser, page, consoleLog } = await launch();
const results = {};
for (const [name, path] of pages) {
  if (only && !name.includes(only)) continue;
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await wait(2500);
  const opener = page.getByRole("button", { name: /Ask anything/ }).first();
  await opener.click().catch(() => {});
  const timeline = [];
  const t0 = Date.now();
  let last = "";
  for (let i = 0; i < 80; i++) {
    const now = await labels(page);
    const sig = JSON.stringify(now);
    if (sig !== last && now.length) { timeline.push({ ms: Date.now() - t0, labels: now }); last = sig; }
    await wait(250);
  }
  await page.screenshot({ path: `${OUT}/step3-${name}.png` });
  results[name] = { path, final: timeline.at(-1)?.labels ?? [], timeline };
  console.log(name, JSON.stringify(timeline.map((t) => t.labels)));
}
writeFileSync(`.context/qa/pages-${only ?? "all"}.json`, JSON.stringify({ results, consoleLog }, null, 2));
await browser.close();
