// Browser integration fixture: actual Spot components, synthetic Convex/storage boundary.
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const out = path.join(root, ".context/qa/background-tasks");
await mkdir(out, { recursive: true });
const fixture = path.join(root, "scripts/qa/background-tasks");
const chunks = path.join(root, ".next/static/chunks");
const css = (
  await Promise.all(
    (await readdir(chunks))
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFile(path.join(chunks, name), "utf8")),
  )
).join("\n");
const server = await createServer({
  configFile: false,
  root,
  esbuild: { jsx: "automatic" },
  optimizeDeps: {
    entries: ["scripts/qa/background-tasks/fixture.tsx"],
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom/client",
      "react-dom",
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
    ],
  },
  resolve: {
    alias: [
      { find: "@", replacement: root },
      { find: "convex/react", replacement: path.join(fixture, "convex.ts") },
      {
        find: "next/navigation",
        replacement: path.join(fixture, "navigation.tsx"),
      },
      { find: "next/link", replacement: path.join(fixture, "navigation.tsx") },
    ],
  },
  server: { host: "127.0.0.1", port: 4179, strictPort: true },
  plugins: [
    {
      name: "fixture",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === "/fixture.css") {
            response.setHeader("Content-Type", "text/css");
            response.end(css);
          } else if (request.headers.accept?.includes("text/html")) {
            response.setHeader("Content-Type", "text/html");
            response.end(
              '<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/scripts/qa/background-tasks/fixture.tsx"></script></body></html>',
            );
          } else next();
        });
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
await context.tracing.start({
  screenshots: true,
  snapshots: true,
  sources: true,
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") console.error(message.text());
});
page.on("requestfailed", (request) =>
  console.error(request.url(), request.failure()),
);
page.on("pageerror", (error) => {
  errors.push(error.message);
  console.error(error.message);
});
const calls = [];
let nextId = 0;
let duplicate = false;
let failStorage = false;
const uploads = [];
const handoffs = [];
await page.route("**/rpc/**", async (route) => {
  const name = new URL(route.request().url()).pathname.slice(5);
  calls.push({ name, args: route.request().postDataJSON() });
  if (name.includes("checkDuplicate"))
    return route.fulfill({
      json: duplicate ? { fileName: "Existing.pdf" } : null,
    });
  if (name.includes("generateUploadUrl"))
    return route.fulfill({ json: "http://127.0.0.1:4179/storage" });
  if (name.includes("extractFromUpload")) {
    handoffs.push(route);
    return;
  }
  return route.fulfill({ json: null });
});
await page.route("**/register", async (route) => {
  calls.push({ name: "register", args: route.request().postDataJSON() });
  await route.fulfill({ json: `policy-${++nextId}` });
});
await page.route("**/storage", async (route) => {
  if (failStorage)
    return route.fulfill({ status: 503, body: "Synthetic failure" });
  uploads.push(route);
});
async function until(check, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
const pdfs = ["one", "two"].map((name) => ({
  name: `${name}.pdf`,
  mimeType: "application/pdf",
  buffer: Buffer.from(`%PDF-1.7 synthetic ${name}`),
}));
try {
  await page.goto("http://127.0.0.1:4179/");
  await page.screenshot({ path: path.join(out, "initial.png") });
  await page.getByLabel("Policy PDFs").setInputFiles(pdfs);
  await page.getByRole("button", { name: "Submit twice" }).click();
  await until(() => uploads.length === 1, "first upload");
  await uploads.shift().fulfill({ json: { storageId: "storage-1" } });
  await until(() => uploads.length === 1, "second upload");
  await page.getByRole("link", { name: "Another page", exact: true }).click();
  await page
    .getByLabel("Uploading policies. Uploading files · 1 of 2", { exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(out, "policy-navigation.png") });
  await page.getByRole("link", { name: "Policies", exact: true }).click();
  assert(
    await page
      .getByRole("button", { name: "Upload policies", exact: true })
      .isDisabled(),
  );
  await uploads.shift().fulfill({ json: { storageId: "storage-2" } });
  await until(() => handoffs.length === 1, "durable handoff");
  assert.equal(calls.filter((call) => call.name === "register").length, 1);
  const extraction = calls.find((call) =>
    call.name.includes("extractFromUpload"),
  );
  assert.equal(extraction.args.additionalFiles.length, 1);
  await page.getByRole("link", { name: "Another page", exact: true }).click();
  await handoffs.shift().fulfill({ json: { success: true } });
  await page
    .getByRole("button", { name: "Open policy", exact: true })
    .waitFor();
  assert(page.url().endsWith("/away"));
  assert.equal(
    await page.evaluate(
      () =>
        !window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
    false,
  );
  await page.getByRole("button", { name: "Open policy", exact: true }).click();
  await until(() => page.url().endsWith("/policies/policy-1"), "policy action");
  await page.screenshot({ path: path.join(out, "policy-handoff.png") });

  await page.getByRole("link", { name: "Policies", exact: true }).click();
  duplicate = true;
  await page.getByLabel("Policy PDFs").setInputFiles([pdfs[0]]);
  await page
    .getByRole("button", { name: "Upload policies", exact: true })
    .click();
  await page
    .getByRole("alertdialog", { name: "Possible duplicate upload" })
    .waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await until(
    async () => (await page.getByTestId("upload-state").innerText()) === "Idle",
    "duplicate cancelled",
  );
  assert.equal(uploads.length, 0);
  duplicate = false;
  failStorage = true;
  await page
    .getByRole("button", { name: "Upload policies", exact: true })
    .click();
  await page.getByText("Policy upload failed", { exact: true }).waitFor();
  assert(
    await page
      .getByRole("button", { name: "Upload policies", exact: true })
      .isEnabled(),
  );
  failStorage = false;

  await page.getByLabel("Policy PDFs").setInputFiles(pdfs);
  await page.getByLabel("Upload mode").selectOption("separate");
  await page
    .getByRole("button", { name: "Upload policies", exact: true })
    .click();
  for (let index = 0; index < 2; index++) {
    await until(() => uploads.length === 1, "separate storage upload");
    await uploads.shift().fulfill({ json: { storageId: `separate-${index}` } });
  }
  for (let index = 0; index < 2; index++) {
    await until(() => handoffs.length === 1, "separate extraction handoff");
    await handoffs.shift().fulfill({ json: { success: true } });
  }
  await until(
    async () => (await page.getByTestId("upload-state").innerText()) === "Idle",
    "separate completion",
  );
  assert.equal(calls.filter((call) => call.name === "register").length, 3);
  assert.equal(
    calls.filter((call) => call.name.includes("extractFromUpload")).length,
    3,
  );

  await page.getByRole("link", { name: "Request", exact: true }).click();
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles([pdfs[0]]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add file", exact: true })
    .click();
  await until(() => uploads.length === 1, "request file storage");
  await page.getByRole("link", { name: "Another page", exact: true }).click();
  await page.getByRole("link", { name: "Request", exact: true }).click();
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  assert(
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add file", exact: true })
      .isDisabled(),
  );
  await page.getByRole("link", { name: "Another page", exact: true }).click();
  await uploads.shift().fulfill({ json: { storageId: "request-storage" } });
  await page
    .getByRole("button", { name: "Open request", exact: true })
    .waitFor();
  assert(page.url().endsWith("/away"));
  assert.equal(
    calls.filter((call) => call.name === "clientProcurementRequests:attachFile")
      .length,
    1,
  );
  await page.getByRole("button", { name: "Open request", exact: true }).click();
  await until(
    () => page.url().endsWith("/requests/request-1"),
    "request action",
  );
  await page.screenshot({ path: path.join(out, "request-result.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: path.join(out, "request-mobile-dark.png") });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify({ passed: true, calls, errors }, null, 2),
  );
  console.log(
    "Passed policy navigation/duplicate/handoff/error and request attachment navigation/action workflows.",
  );
} finally {
  await context.tracing.stop({ path: path.join(out, "trace.zip") });
  await browser.close();
  await server.close();
}
