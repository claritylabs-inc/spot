import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
export const base = "http://localhost:8080";
export const OUT = "qa/operator-suggestions";
export const ids = JSON.parse(readFileSync(".context/qa/ids.json", "utf8"));
export async function launch() {
  const context = await chromium.launchPersistentContext(".context/qa/profile", { executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"], viewport: { width: 1440, height: 900 } });
  const browser = context;
  const page = context.pages()[0] ?? (await context.newPage());
  const consoleLog = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) consoleLog.push({ type: m.type(), text: m.text().slice(0, 400), url: page.url() }); });
  page.on("pageerror", (e) => consoleLog.push({ type: "pageerror", text: String(e).slice(0, 400), url: page.url() }));
  page.on("response", (r) => { if (r.status() >= 400) consoleLog.push({ type: "http" + r.status(), text: r.url().slice(0, 200), url: page.url() }); });
  return { browser, context, page, consoleLog };
}
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function labels(page) {
  const list = page.locator('ul[aria-label="Suggested prompts"] li button');
  return (await list.allInnerTexts()).map((t) => t.trim());
}
