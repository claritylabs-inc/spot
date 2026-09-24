// End-to-end WebMCP check against the local app and native local Convex.
//
//   node scripts/webmcp-e2e.mjs [--base http://localhost:8080] [--seeded-client adyan@cove.dev]
//
// 1. Loads /signup/client and /llms.txt without `document.modelContext` and
//    checks the declarative attributes render and nothing throws.
// 2. Injects a stub `document.modelContext` before app scripts run, then signs
//    up a brand-new synthetic business with no invite: agent-style submits for
//    the email, the captured local OTP, and all three onboarding steps.
// 3. Verifies signed-in `registerTool` calls, JSON Schemas, page scoping,
//    tool execution, and unregistration on sign-out.
// 4. Repeats signup by typing, as a person would, without modelContext.
// 5. With --seeded-client (after `npx convex run seed:seed`), signs in through
//    the login tools and runs the policy, wording, and certificate tools
//    against the seeded policy.
//
// Requires `SPOT_ENV=local` and `EMAIL_DELIVERY_MODE=capture` on the local
// Convex deployment, with Convex logs in .context/logs/convex.log. Writes
// results.json and screenshots to .context/qa/webmcp/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import dayjs from "dayjs";
import { chromium } from "playwright";
import { consumeLocalEmailCaptures } from "./watch-conductor-email-captures.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const baseIndex = process.argv.indexOf("--base");
const base = baseIndex > 0 ? process.argv[baseIndex + 1] : "http://localhost:8080";
const outDir = path.join(repoRoot, ".context", "qa", "webmcp");
const seededIndex = process.argv.indexOf("--seeded-client");
const seededClient = seededIndex > 0 ? process.argv[seededIndex + 1] : null;
const convexLog = path.join(repoRoot, ".context", "logs", "convex.log");
mkdirSync(outDir, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

const STUB = () => {
  const tools = new Map();
  window.__webmcp = { tools, log: [] };
  const record = (entry) => window.__webmcp.log.push({ ...entry, path: location.pathname });
  document.modelContext = {
    registerTool(tool, options) {
      if (tools.has(tool.name)) throw new DOMException(`Duplicate tool ${tool.name}`, "InvalidStateError");
      tools.set(tool.name, tool);
      record({ op: "register", name: tool.name });
      options?.signal?.addEventListener("abort", () => {
        if (tools.get(tool.name) === tool) {
          tools.delete(tool.name);
          record({ op: "abort", name: tool.name });
        }
      });
    },
    unregisterTool(name) {
      if (tools.delete(name)) record({ op: "unregister", name });
    },
  };
  window.__agentSubmit = (selector) => {
    const form = document.querySelector(selector);
    if (!form) return Promise.resolve({ status: "missing_form", selector });
    return new Promise((resolve) => {
      const event = new SubmitEvent("submit", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "agentInvoked", { value: true });
      let responded = false;
      event.respondWith = (promise) => {
        responded = true;
        Promise.resolve(promise).then((value) => resolve(JSON.parse(value)));
      };
      form.dispatchEvent(event);
      if (!responded) resolve({ status: "no_response" });
    });
  };
  window.__agentFill = (selector, values) => {
    const form = document.querySelector(selector);
    for (const [name, value] of Object.entries(values)) {
      const input = form?.querySelector(`[name="${name}"]`);
      if (!input) continue;
      // Set the DOM value the way an agent-driven browser fill would, without
      // React's synthetic input events.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    }
    window.dispatchEvent(Object.assign(new Event("toolactivated"), { toolName: form?.getAttribute("toolname") }));
  };
  window.__callTool = async (name, input) => {
    const tool = tools.get(name);
    if (!tool) return { status: "not_registered", name };
    return JSON.parse(await tool.execute(input));
  };
};

function validateSchema(schema) {
  const problems = [];
  if (schema?.type !== "object") problems.push("type must be object");
  if (!schema?.properties || typeof schema.properties !== "object") problems.push("properties missing");
  for (const key of schema?.required ?? []) {
    if (!schema.properties?.[key]) problems.push(`required ${key} not in properties`);
  }
  for (const [key, value] of Object.entries(schema?.properties ?? {})) {
    if (!value.type) problems.push(`${key} has no type`);
  }
  try {
    JSON.parse(JSON.stringify(schema));
  } catch {
    problems.push("not JSON-serializable");
  }
  return problems;
}

async function registeredTools(page) {
  return await page.evaluate(() =>
    [...window.__webmcp.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  );
}

async function waitForTools(page, names) {
  await page.waitForFunction(
    (expected) => expected.every((name) => window.__webmcp?.tools.has(name)),
    names,
    { timeout: 30_000 },
  );
}

function logOffset() {
  try {
    return readFileSync(convexLog, "utf8").length;
  } catch {
    return 0;
  }
}

async function waitForOtp(email, fromOffset) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const contents = readFileSync(convexLog, "utf8").slice(fromOffset);
    const capture = consumeLocalEmailCaptures(contents).captures.find(
      (item) => item.to.includes(email) && item.codes.length > 0,
    );
    if (capture) return capture.codes[0];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No captured OTP for ${email}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const result = { base, startedAt: dayjs().toISOString() };
try {
  // 1. Without modelContext.
  const plain = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const plainPage = await plain.newPage();
  const plainErrors = [];
  plainPage.on("pageerror", (error) => plainErrors.push(error.message));
  const llms = await plainPage.request.get(`${base}/llms.txt`);
  const llmsText = await llms.text();
  check("llms.txt is public plain text", llms.ok() && llms.headers()["content-type"]?.startsWith("text/plain"));
  check("llms.txt links signup and landing llms.txt", llmsText.includes("/signup/client") && llmsText.includes("https://spot.insure/llms.txt"));
  await plainPage.goto(`${base}/signup/client?email=agent%40example.com`, { waitUntil: "networkidle" });
  const signupForm = await plainPage.evaluate(() => {
    const form = document.querySelector("form[toolname]");
    const input = form?.querySelector("input[name=email]");
    return {
      title: document.title,
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      llmsLink: document.querySelector('link[rel="llms-txt"]')?.getAttribute("href") ?? null,
      toolname: form?.getAttribute("toolname"),
      tooldescription: form?.getAttribute("tooldescription"),
      toolautosubmit: form?.hasAttribute("toolautosubmit"),
      emailParam: input?.getAttribute("toolparamdescription"),
      emailValue: input?.value,
      modelContext: typeof document.modelContext,
    };
  });
  result.signupPage = signupForm;
  check("signup form declares request_signup_code", signupForm.toolname === "request_signup_code" && signupForm.tooldescription && signupForm.toolautosubmit);
  check("signup email param described and prefilled", signupForm.emailParam && signupForm.emailValue === "agent@example.com");
  check("signup page is indexable with canonical", !signupForm.robots?.includes("noindex") && signupForm.canonical?.endsWith("/signup/client"));
  check("llms-txt head hint present", signupForm.llmsLink === "/llms.txt");
  check("no modelContext: no page errors", signupForm.modelContext === "undefined" && plainErrors.length === 0, plainErrors);
  await plainPage.screenshot({ path: path.join(outDir, "signup-client.png") });
  await plainPage.goto(`${base}/login`, { waitUntil: "networkidle" });
  check("login form declares request_login_code", (await plainPage.getAttribute("form[toolname]", "toolname")) === "request_login_code");
  await plain.close();

  // 2. Agent signup with a stubbed modelContext.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(STUB);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const email = `webmcp-e2e-${Date.now()}@example.com`;
  result.email = email;
  await page.goto(`${base}/signup/client`, { waitUntil: "networkidle" });
  check("no imperative tools before sign-in", (await registeredTools(page)).length === 0);

  const offset = logOffset();
  await page.evaluate((value) => window.__agentFill('form[toolname="request_signup_code"]', { email: value }), email);
  const codeSent = await page.evaluate(() => window.__agentSubmit('form[toolname="request_signup_code"]'));
  result.codeSent = codeSent;
  check("request_signup_code responds code_sent", codeSent.status === "code_sent" && codeSent.next_tool === "verify_signup_code", codeSent);

  await page.waitForSelector('form[toolname="verify_signup_code"] input[name="code"]');
  const codeParam = await page.getAttribute('form[toolname="verify_signup_code"] input[name="code"]', "toolparamdescription");
  check("code param has toolparamdescription", Boolean(codeParam), codeParam);
  await page.evaluate(() => window.__agentFill('form[toolname="verify_signup_code"]', { code: "12345" }));
  const shortCode = await page.evaluate(() => window.__agentSubmit('form[toolname="verify_signup_code"]'));
  check("short code returns structured error", shortCode.status === "error" && shortCode.next_tool === "verify_signup_code", shortCode);

  const code = await waitForOtp(email, offset);
  await page.evaluate((value) => window.__agentFill('form[toolname="verify_signup_code"]', { code: value }), code);
  const signedIn = await page.evaluate(() => window.__agentSubmit('form[toolname="verify_signup_code"]'));
  result.signedIn = signedIn;
  check("verify_signup_code responds signed_in", signedIn.status === "signed_in" && signedIn.next_tool === "submit_user_profile", signedIn);

  await page.waitForSelector('form[toolname="submit_user_profile"]', { timeout: 30_000 });
  check("new user lands on onboarding step 1", page.url().includes("/onboarding/setup"), page.url());
  await page.screenshot({ path: path.join(outDir, "onboarding-profile.png") });
  check("no imperative tools during onboarding", (await registeredTools(page)).length === 0);
  await page.evaluate(() => window.__agentFill('form[toolname="submit_user_profile"]', { name: "Agent Tester", title: "Operations", phone: "" }));
  const profile = await page.evaluate(() => window.__agentSubmit('form[toolname="submit_user_profile"]'));
  check("submit_user_profile responds profile_saved", profile.status === "profile_saved", profile);

  await page.waitForSelector('form[toolname="submit_company_profile"]');
  await page.evaluate(() => window.__agentFill('form[toolname="submit_company_profile"]', { organization_name: "WebMCP Test Co", website: "" }));
  const company = await page.evaluate(() => window.__agentSubmit('form[toolname="submit_company_profile"]'));
  check("submit_company_profile creates the org", company.status === "organization_saved" && company.organization_name === "WebMCP Test Co", company);

  await page.waitForSelector('form[toolname="finish_onboarding"]');
  const finished = await page.evaluate(() => window.__agentSubmit('form[toolname="finish_onboarding"]'));
  check("finish_onboarding responds onboarding_complete", finished.status === "onboarding_complete", finished);

  // 3. Signed-in imperative tools.
  const appWide = [
    "list_policies",
    "get_policy",
    "search_policy_wording",
    "list_certificates",
    "list_insurance_requests",
    "get_insurance_request",
    "list_compliance_requirements",
    "open_spot_page",
    "start_spot_agent_thread",
  ];
  await page.waitForURL(/\/policies/, { timeout: 30_000 });
  await waitForTools(page, appWide);
  const policiesTools = await registeredTools(page);
  result.toolsOnPolicies = policiesTools;
  check("client workspace registers app-wide tools", appWide.every((name) => policiesTools.some((tool) => tool.name === name)));
  const schemaProblems = Object.fromEntries(
    policiesTools.map((tool) => [tool.name, validateSchema(tool.inputSchema)]).filter(([, problems]) => problems.length > 0),
  );
  check("all registered input schemas are valid", Object.keys(schemaProblems).length === 0, schemaProblems);
  const readOnly = ["list_policies", "get_policy", "search_policy_wording", "list_certificates", "list_insurance_requests", "get_insurance_request", "list_compliance_requirements"];
  check("reads carry readOnlyHint", readOnly.every((name) => policiesTools.find((tool) => tool.name === name)?.annotations?.readOnlyHint === true));
  check("writes are not readOnly", policiesTools.filter((tool) => !readOnly.includes(tool.name)).every((tool) => tool.annotations?.readOnlyHint === false));
  check("page-scoped writes absent on /policies list", !policiesTools.some((tool) => tool.name === "create_insurance_request"));
  const policies = await page.evaluate(() => window.__callTool("list_policies", {}));
  check("list_policies executes for new client", policies.status === "ok" && Array.isArray(policies.policies), policies);
  const badPolicy = await page.evaluate(() => window.__callTool("get_policy", { policy_id: "not-a-real-id" }));
  check("get_policy with bad id returns structured error", badPolicy.status === "error", badPolicy);
  await page.screenshot({ path: path.join(outDir, "client-policies.png") });

  const opened = await page.evaluate(() => window.__callTool("open_spot_page", { page: "requests" }));
  check("open_spot_page navigates", opened.status === "navigating" && opened.url === "/requests", opened);
  await page.waitForURL(/\/requests/);
  await waitForTools(page, ["create_insurance_request", "attach_request_document"]);
  const requestTools = await registeredTools(page);
  result.toolsOnRequests = requestTools.map((tool) => tool.name);
  check("request writes registered only on /requests", !requestTools.some((tool) => tool.name === "generate_certificate"));
  const created = await page.evaluate(() =>
    window.__callTool("create_insurance_request", {
      title: "WebMCP e2e cyber coverage",
      narrative: "Synthetic local test: need $1M cyber liability for a new customer contract.",
      target_effective_date: "2026-11-01",
    }),
  );
  result.createdRequest = created;
  check("create_insurance_request submits", created.status === "submitted" && created.request_id, created);
  const attached = await page.evaluate(
    (requestId) =>
      window.__callTool("attach_request_document", {
        request_id: requestId,
        file_name: "requirements.txt",
        content_type: "text/plain",
        content_base64: btoa("Synthetic contract insurance requirements."),
      }),
    created.request_id,
  );
  check("attach_request_document uploads", attached.status === "attached", attached);
  const fetched = await page.evaluate((requestId) => window.__callTool("get_insurance_request", { request_id: requestId }), created.request_id);
  check("get_insurance_request shows status and file", fetched.status === "ok" && fetched.request.files.length === 1, fetched);

  await page.evaluate(() => window.__callTool("open_spot_page", { page: "compliance" }));
  await page.waitForURL(/\/compliance/);
  await waitForTools(page, ["recheck_compliance_requirement", "generate_certificate"]);
  const complianceTools = await registeredTools(page);
  result.toolsOnCompliance = complianceTools.map((tool) => tool.name);
  check("request writes unregistered after leaving /requests", !complianceTools.some((tool) => tool.name === "create_insurance_request"));
  const requirements = await page.evaluate(() => window.__callTool("list_compliance_requirements", {}));
  check("list_compliance_requirements executes", requirements.status === "ok" && Array.isArray(requirements.requirements), requirements);
  const certificates = await page.evaluate(() => window.__callTool("list_certificates", {}));
  check("list_certificates executes", certificates.status === "ok", certificates);
  await page.screenshot({ path: path.join(outDir, "client-compliance.png") });

  await page.getByText("Sign out", { exact: true }).first().click();
  await page.waitForFunction(() => window.__webmcp.tools.size === 0, null, { timeout: 30_000 });
  check("sign-out unregisters every tool", (await registeredTools(page)).length === 0);
  check("no page errors during agent flow", pageErrors.length === 0, pageErrors);
  result.registrationLog = await page.evaluate(() => window.__webmcp.log);
  await context.close();

  // 4. The same signup typed by a person, without modelContext.
  const human = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const humanPage = await human.newPage();
  const humanEmail = `webmcp-human-${Date.now()}@example.com`;
  await humanPage.goto(`${base}/signup/client`, { waitUntil: "networkidle" });
  const humanOffset = logOffset();
  await humanPage.fill("#auth-email", humanEmail);
  await humanPage.getByRole("button", { name: "Continue" }).click();
  const firstSlot = humanPage.locator('form[toolname="verify_signup_code"] input:not([name])').first();
  await firstSlot.waitFor();
  await firstSlot.pressSequentially(await waitForOtp(humanEmail, humanOffset));
  await humanPage.getByRole("button", { name: "Verify and continue" }).click();
  await humanPage.waitForSelector("#onboarding-name", { timeout: 30_000 });
  await humanPage.fill("#onboarding-name", "Human Tester");
  await humanPage.fill("#onboarding-role", "Finance");
  await humanPage.getByRole("button", { name: "Continue" }).click();
  await humanPage.waitForSelector("#onboarding-organization");
  await humanPage.fill("#onboarding-organization", "Human Test Co");
  await humanPage.getByRole("button", { name: "Continue" }).click();
  await humanPage.getByRole("button", { name: "Finish setup" }).click();
  await humanPage.waitForURL(/\/policies/, { timeout: 30_000 });
  check("human signup and onboarding still reach the workspace", humanPage.url().includes("/policies"));
  await human.close();

  // 5. Seeded client: login tools plus policy and certificate tools.
  if (seededClient) {
    const seeded = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await seeded.addInitScript(STUB);
    const seededPage = await seeded.newPage();
    await seededPage.goto(`${base}/login`, { waitUntil: "networkidle" });
    const seededOffset = logOffset();
    await seededPage.evaluate((value) => window.__agentFill('form[toolname="request_login_code"]', { email: value }), seededClient);
    const loginSent = await seededPage.evaluate(() => window.__agentSubmit('form[toolname="request_login_code"]'));
    check("request_login_code responds code_sent", loginSent.status === "code_sent" && loginSent.next_tool === "verify_login_code", loginSent);
    await seededPage.waitForSelector('form[toolname="verify_login_code"]');
    const loginCode = await waitForOtp(seededClient, seededOffset);
    await seededPage.evaluate((value) => window.__agentFill('form[toolname="verify_login_code"]', { code: value }), loginCode);
    const loggedIn = await seededPage.evaluate(() => window.__agentSubmit('form[toolname="verify_login_code"]'));
    check("verify_login_code responds signed_in", loggedIn.status === "signed_in", loggedIn);
    await waitForTools(seededPage, ["list_policies"]);
    const seededPolicies = await seededPage.evaluate(() => window.__callTool("list_policies", {}));
    result.seededPolicies = seededPolicies;
    const policy = seededPolicies.policies?.find((item) => item.extraction_status === "final") ?? seededPolicies.policies?.[0];
    check("seeded client lists policies", Boolean(policy), seededPolicies);
    if (policy) {
      const detail = await seededPage.evaluate((id) => window.__callTool("get_policy", { policy_id: id }), policy.policy_id);
      check("get_policy returns coverages", detail.status === "ok" && Array.isArray(detail.policy.coverages), detail.status);
      const wording = await seededPage.evaluate((id) => window.__callTool("search_policy_wording", { policy_id: id, query: "liability", limit: 3 }), policy.policy_id);
      result.seededWording = wording;
      check("search_policy_wording returns excerpts", wording.status === "ok" && wording.matches.length > 0, wording);
      await seededPage.evaluate((id) => window.__callTool("open_spot_page", { page: "policies", record_id: id }), policy.policy_id);
      await waitForTools(seededPage, ["generate_certificate"]);
      const certificate = await seededPage.evaluate(
        (id) => window.__callTool("generate_certificate", { policy_id: id, holder_name: "WebMCP Synthetic Holder LLC", city: "Austin", state: "TX" }),
        policy.policy_id,
      );
      result.seededCertificate = certificate;
      check("generate_certificate returns a PDF or a hold", ["completed", "partial", "held"].includes(certificate.status), certificate);
      const listed = await seededPage.evaluate(() => window.__callTool("list_certificates", {}));
      check("list_certificates includes the synthetic holder", listed.certificates?.some((item) => item.holder === "WebMCP Synthetic Holder LLC"), listed.status);
      await seededPage.screenshot({ path: path.join(outDir, "seeded-policy.png") });
    }
    const seededRequests = await seededPage.evaluate(() => window.__callTool("list_insurance_requests", {}));
    check("client request results omit private fields", !JSON.stringify(seededRequests).includes("private.md"), seededRequests.status);
    await seeded.close();
  }
} catch (error) {
  check("run completed", false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  result.checks = checks;
  result.passed = checks.every((item) => item.ok);
  writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\n${checks.filter((item) => item.ok).length}/${checks.length} checks passed. Artifacts: ${path.relative(repoRoot, outDir)}/`);
  process.exitCode = result.passed ? 0 : 1;
}
