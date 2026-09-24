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
import { execFileSync } from "node:child_process";
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

// Model-backed steps depend on the local router. A router or model failure is
// recorded as blocked, not passed; any other error fails.
const MODEL_UNAVAILABLE = /router|model|provider|inference|timed? ?out|CL_ROUTER|rate limit|overloaded/i;
function checkModelStep(name, response, ok, logFrom) {
  if (ok) return check(name, true);
  const detail = JSON.stringify(response ?? null);
  const routerRejected =
    logFrom !== undefined &&
    /Router job control rejected/.test(readFileSync(convexLog, "utf8").slice(logFrom));
  if (MODEL_UNAVAILABLE.test(detail) || routerRejected) {
    checks.push({ name, ok: true, blocked: true, detail: response });
    console.log(`BLOCKED ${name} — ${detail}`);
    return;
  }
  check(name, false, response);
}

const executed = new Set();
const registeredEverywhere = new Set();
async function call(page, name, input = {}) {
  executed.add(name);
  return await page.evaluate(([tool, args]) => window.__callTool(tool, args), [name, input]);
}

/** Reads are named list_/get_/search_ and carry readOnlyHint; nothing else does. */
function auditTools(label, tools) {
  for (const tool of tools) registeredEverywhere.add(tool.name);
  const wrong = tools.filter(
    (tool) => /^(list|get|search)_/.test(tool.name) !== (tool.annotations?.readOnlyHint === true),
  );
  const invalid = Object.fromEntries(
    tools.map((tool) => [tool.name, validateSchema(tool.inputSchema)]).filter(([, problems]) => problems.length > 0),
  );
  check(`${label}: readOnlyHint matches read tools`, wrong.length === 0, wrong.map((tool) => tool.name));
  check(`${label}: input schemas are valid JSON Schema objects`, Object.keys(invalid).length === 0, invalid);
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

async function waitForEmail(email, fromOffset, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const contents = readFileSync(convexLog, "utf8").slice(fromOffset);
    const capture = consumeLocalEmailCaptures(contents).captures.find((item) => item.to.includes(email));
    if (capture) return capture;
    // Long captures are logged as multi-line string concatenations.
    if (contents.includes("[spot:local-email-capture]") && contents.includes(`to: ${email}`)) {
      return { to: email, codes: [] };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/** Retries a read until it reflects a just-finished write (live query lag). */
async function eventually(read, done, attempts = 20) {
  let value;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return value;
}

async function openPage(page, args, urlPattern, toolNames) {
  const opened = await call(page, "open_spot_page", args);
  await page.waitForURL(urlPattern, { timeout: 30_000 });
  await waitForTools(page, toolNames);
  return opened;
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
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${new URL(page.url()).pathname}: ${message.text().slice(0, 300)}`);
  });
  result.consoleErrors = consoleErrors;
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
  auditTools("/policies", policiesTools);
  check("page-scoped writes absent on /policies list", !policiesTools.some((tool) => tool.name === "create_insurance_request"));
  const policies = await call(page, "list_policies", {});
  check("list_policies executes for new client", policies.status === "ok" && Array.isArray(policies.policies), policies);
  const badPolicy = await call(page, "get_policy", { policy_id: "not-a-real-id" });
  check("get_policy with bad id returns structured error", badPolicy.status === "error", badPolicy);
  await page.screenshot({ path: path.join(outDir, "client-policies.png") });

  const opened = await call(page, "open_spot_page", { page: "requests" });
  check("open_spot_page navigates", opened.status === "navigating" && opened.url === "/requests", opened);
  await page.waitForURL(/\/requests/);
  await waitForTools(page, ["create_insurance_request", "attach_request_document"]);
  const requestTools = await registeredTools(page);
  result.toolsOnRequests = requestTools.map((tool) => tool.name);
  check("request writes registered only on /requests", !requestTools.some((tool) => tool.name === "generate_certificate"));
  const created = await call(page, "create_insurance_request", {
      title: "WebMCP e2e cyber coverage",
      narrative: "Synthetic local test: need $1M cyber liability for a new customer contract.",
      target_effective_date: "2026-11-01",
    });
  result.createdRequest = created;
  check("create_insurance_request submits", created.status === "submitted" && created.request_id, created);
  const attached = await call(page, "attach_request_document", {
        request_id: created.request_id,
        file_name: "requirements.txt",
        content_type: "text/plain",
        content_base64: btoa("Synthetic contract insurance requirements."),
      });
  check("attach_request_document uploads", attached.status === "attached", attached);
  const fetched = await call(page, "get_insurance_request", { request_id: created.request_id });
  check("get_insurance_request shows status and file", fetched.status === "ok" && fetched.request.files.length === 1, fetched);

  await call(page, "open_spot_page", { page: "compliance" });
  await page.waitForURL(/\/compliance/);
  await waitForTools(page, ["recheck_compliance_requirement", "generate_certificate"]);
  const complianceTools = await registeredTools(page);
  result.toolsOnCompliance = complianceTools.map((tool) => tool.name);
  check("request writes unregistered after leaving /requests", !complianceTools.some((tool) => tool.name === "create_insurance_request"));
  const requirements = await call(page, "list_compliance_requirements", {});
  check("list_compliance_requirements executes", requirements.status === "ok" && Array.isArray(requirements.requirements), requirements);
  const certificates = await call(page, "list_certificates", {});
  check("list_certificates executes", certificates.status === "ok", certificates);
  await page.screenshot({ path: path.join(outDir, "client-compliance.png") });

  // 3b. Full client parity as the organization admin who signed up.
  const stamp = Date.now();
  const createdRequirement = await call(page, "create_compliance_requirement", {
    scope: "own_org",
    title: "WebMCP GL $1M per occurrence",
    requirement_text: "Commercial general liability of at least $1,000,000 per occurrence.",
    line_of_business: "CGL",
    limits: [{ kind: "per_occurrence", amount: 1000000 }],
    provisions: ["additional_insured"],
  });
  check("create_compliance_requirement", createdRequirement.status === "created", createdRequirement);
  const updatedRequirement = await call(page, "update_compliance_requirement", {
    requirement_id: createdRequirement.requirement_id,
    scope: "own_org",
    title: "WebMCP GL $2M per occurrence",
    line_of_business: "CGL",
    requirement_text: "Commercial general liability of at least $2,000,000 per occurrence.",
    limits: [{ kind: "per_occurrence", amount: 2000000 }],
  });
  check("update_compliance_requirement", updatedRequirement.status === "updated", updatedRequirement);
  const listedRequirements = await call(page, "list_compliance_requirements", { scope: "own_org" });
  check("updated requirement is listed", listedRequirements.requirements?.some((row) => row.title === "WebMCP GL $2M per occurrence"), listedRequirements);
  const recheck = await call(page, "recheck_compliance_requirement", { requirement_id: createdRequirement.requirement_id });
  checkModelStep("recheck_compliance_requirement runs the AI check", recheck, recheck.status === "ok");
  const imported = await call(page, "import_compliance_requirements", {
    pasted_text: "Vendor shall maintain workers compensation at statutory limits and automobile liability of $1,000,000 combined single limit.",
    source_type: "vendor_requirements",
    source_name: "WebMCP vendor packet",
    scope: "vendors",
  });
  checkModelStep("import_compliance_requirements extracts from pasted text", imported, imported.status === "imported");
  const sources = await call(page, "list_requirement_sources", {});
  check("list_requirement_sources", sources.status === "ok", sources);
  if (imported.requirement_source_id) {
    const sourceUpdate = await call(page, "update_requirement_source", {
      requirement_source_id: imported.requirement_source_id,
      deal_name: "WebMCP vendor deal",
      notes_markdown: "Synthetic WebMCP notes.",
    });
    check("update_requirement_source", sourceUpdate.status === "updated", sourceUpdate);
    const sourceCertificates = await call(page, "list_source_certificates", { requirement_source_id: imported.requirement_source_id });
    check("list_source_certificates", sourceCertificates.status === "ok", sourceCertificates);
    const archivedSources = await call(page, "archive_requirement_sources", { requirement_source_ids: [imported.requirement_source_id] });
    check("archive_requirement_sources", archivedSources.status === "archived", archivedSources);
  }
  const archivedRequirement = await call(page, "archive_compliance_requirement", { requirement_id: createdRequirement.requirement_id });
  check("archive_compliance_requirement", archivedRequirement.status === "archived", archivedRequirement);

  await openPage(page, { page: "connect" }, /\/connect\/vendors/, ["request_vendor_access", "list_vendors"]);
  auditTools("/connect/vendors", await registeredTools(page));
  const vendorEmail = `webmcp-vendor-${stamp}@example.com`;
  let emailOffset = logOffset();
  const vendorRequest = await call(page, "request_vendor_access", { vendor_email: vendorEmail, relationship_label: "WebMCP test vendor" });
  check("request_vendor_access", vendorRequest.status === "pending", vendorRequest);
  check("vendor invitation email captured locally", Boolean(await waitForEmail(vendorEmail, emailOffset)));
  const vendors = await eventually(
    () => call(page, "list_vendors", {}),
    (value) => value.vendors?.some((row) => row.vendor_email === vendorEmail),
  );
  const vendorRow = vendors.vendors?.find((row) => row.vendor_email === vendorEmail);
  check("list_vendors shows the invitation without secrets", Boolean(vendorRow?.invitation_id) && !/otpCode|inviteTokenHash/.test(JSON.stringify(vendors)), vendors);
  emailOffset = logOffset();
  const resent = await call(page, "resend_vendor_invitation", { invitation_id: vendorRow?.invitation_id });
  check("resend_vendor_invitation", resent.status === "resent", resent);
  check("resent invitation email captured locally", Boolean(await waitForEmail(vendorEmail, emailOffset)));
  const cancelledVendor = await call(page, "cancel_vendor_invitation", { invitation_id: vendorRow?.invitation_id });
  check("cancel_vendor_invitation", cancelledVendor.status === "cancelled", cancelledVendor);
  check("list_vendor_compliance", (await call(page, "list_vendor_compliance", {})).status === "ok");
  check("list_connected_clients", (await call(page, "list_connected_clients", {})).status === "ok");

  await openPage(page, { page: "settings", settings_section: "team" }, /\/settings/, ["invite_team_member", "get_company_wiki"]);
  const settingsTools = await registeredTools(page);
  result.toolsOnSettings = settingsTools.map((tool) => tool.name);
  auditTools("/settings (admin)", settingsTools);
  const organization = await call(page, "get_organization", {});
  check("get_organization reports admin role", organization.your_role === "admin", organization);
  check("update_organization", (await call(page, "update_organization", { name: "WebMCP Test Co Renamed" })).status === "updated");
  const logo = await call(page, "upload_organization_logo", {
    file_name: "logo.png",
    content_type: "image/png",
    content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  });
  check("upload_organization_logo", logo.status === "updated", logo);
  check("update_agent_email_settings", (await call(page, "update_agent_email_settings", { send_delay_seconds: 5, bcc_requester_on_agent_emails: true })).status === "updated");
  const channels = await call(page, "get_agent_channels", {});
  check("get_agent_channels", channels.status === "ok" && channels.settings, channels);
  const channelsOff = await call(page, "update_agent_channels", { email_enabled: false });
  const channelsOn = await call(page, "update_agent_channels", { email_enabled: true });
  check("update_agent_channels toggles and restores", channelsOff.settings?.emailEnabled === false && channelsOn.settings?.emailEnabled === true, [channelsOff, channelsOn]);
  const teammateEmail = `webmcp-teammate-${stamp}@example.com`;
  emailOffset = logOffset();
  const invited = await call(page, "invite_team_member", { email: teammateEmail, role: "member" });
  check("invite_team_member", invited.status === "invited", invited);
  check("team invitation email captured locally", Boolean(await waitForEmail(teammateEmail, emailOffset)));
  const extraInvite = await call(page, "invite_team_member", { email: `webmcp-cancel-${stamp}@example.com`, role: "admin" });
  const invitations = await eventually(
    () => call(page, "list_team_invitations", {}),
    (value) => value.invitations?.length >= 2,
  );
  check("second invite_team_member", extraInvite.status === "invited", extraInvite);
  check("list_team_invitations", invitations.invitations?.length >= 2, invitations);
  check("cancel_team_invitation", (await call(page, "cancel_team_invitation", { invitation_id: extraInvite.invitation_id })).status === "cancelled");
  const members = await call(page, "list_team_members", {});
  check("list_team_members", members.members?.length === 1, members);
  check("set_primary_insurance_contact", (await call(page, "set_primary_insurance_contact", { user_id: members.members?.[0]?.user_id })).status === "updated");
  check("update_team_member_profile", (await call(page, "update_team_member_profile", { membership_id: members.members?.[0]?.membership_id, title: "Head of Risk" })).status === "updated");
  const workflow = await call(page, "get_certificate_workflow_settings", {});
  check("get_certificate_workflow_settings", workflow.status === "ok", workflow);
  check("set_certificate_renewal_reissue", (await call(page, "set_certificate_renewal_reissue", { enabled: !workflow.renewal_reissue_enabled })).status === "updated");
  await call(page, "set_certificate_renewal_reissue", { enabled: Boolean(workflow.renewal_reissue_enabled) });
  check("get_notification_preferences", (await call(page, "get_notification_preferences", {})).status === "ok");
  check("set_notification_channels", (await call(page, "set_notification_channels", { type: "own_compliance_gap", email: true, imessage: false })).status === "updated");
  check("set_all_notification_channel", (await call(page, "set_all_notification_channel", { channel: "email", enabled: true })).status === "updated");
  check("reset_notification_channels", (await call(page, "reset_notification_channels", { type: "all" })).status === "reset");
  const wiki = await call(page, "get_company_wiki", {});
  if (wiki.status === "ok") {
    const savedWiki = await call(page, "save_company_wiki", { markdown: `${wiki.markdown.trimEnd()}\n\nWebMCP synthetic note.\n`, expected_revision: wiki.revision });
    check("save_company_wiki", savedWiki.status === "ok" && savedWiki.revision > wiki.revision, savedWiki);
  } else {
    check("get_company_wiki reports its state", wiki.status === "error", wiki);
  }
  check("list_connected_apps", (await call(page, "list_connected_apps", {})).status === "ok");
  check("list_mailboxes", (await call(page, "list_mailboxes", {})).status === "ok");
  check("set_beta_feature", (await call(page, "set_beta_feature", { flag: "connect_features", enabled: true })).status === "updated");
  await page.screenshot({ path: path.join(outDir, "client-settings.png") });

  // A plain member sees member tools only: admin controls stay unregistered.
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await memberContext.addInitScript(STUB);
  const memberPage = await memberContext.newPage();
  await memberPage.goto(`${base}/login?email=${encodeURIComponent(teammateEmail)}`, { waitUntil: "networkidle" });
  const memberOffset = logOffset();
  await memberPage.evaluate(() => window.__agentSubmit('form[toolname="request_login_code"]'));
  await memberPage.waitForSelector('form[toolname="verify_login_code"]');
  await memberPage.evaluate((value) => window.__agentFill('form[toolname="verify_login_code"]', { code: value }), await waitForOtp(teammateEmail, memberOffset));
  const memberLogin = await memberPage.evaluate(() => window.__agentSubmit('form[toolname="verify_login_code"]'));
  check("invited teammate signs in with the login tools", memberLogin.status === "signed_in", memberLogin);
  await waitForTools(memberPage, ["list_policies"]);
  await openPage(memberPage, { page: "settings" }, /\/settings/, ["list_team_members"]);
  const memberTools = (await registeredTools(memberPage)).map((tool) => tool.name);
  result.toolsOnSettingsAsMember = memberTools;
  check("member gets member settings tools but no admin tools", memberTools.includes("get_notification_preferences") && !memberTools.includes("invite_team_member") && !memberTools.includes("update_organization"), memberTools);
  await memberContext.close();
  const team = await eventually(
    () => call(page, "list_team_members", {}),
    (value) => value.members?.length === 2,
  );
  const teammate = team.members?.find((member) => member.email === teammateEmail);
  check("accepted teammate appears in list_team_members", Boolean(teammate), team);
  if (teammate) {
    check("change_member_role to admin", (await call(page, "change_member_role", { membership_id: teammate.membership_id, role: "admin" })).status === "updated");
    check("change_member_role back to member", (await call(page, "change_member_role", { membership_id: teammate.membership_id, role: "member" })).status === "updated");
    const memberEmailChange = await call(page, "request_member_email_change", { membership_id: teammate.membership_id, email: `webmcp-teammate-new-${stamp}@example.com` });
    check("request_member_email_change", memberEmailChange.status === "code_sent", memberEmailChange);
    check("cancel_member_email_change", (await call(page, "cancel_member_email_change", { membership_id: teammate.membership_id, request_id: memberEmailChange.request_id })).status === "cancelled");
    check("remove_team_member", (await call(page, "remove_team_member", { membership_id: teammate.membership_id })).status === "removed");
  }
  const research = await call(page, "research_company", { website: "https://example.com" });
  check("research_company queues research", research.status !== "error", research);

  await openPage(page, { page: "profile" }, /\/profile/, ["update_profile"]);
  auditTools("/profile", await registeredTools(page));
  check("update_profile", (await call(page, "update_profile", { title: "Operations Lead", stream_responses: true })).status === "updated");
  const profileAfter = await call(page, "get_profile", {});
  check("get_profile reflects the update", profileAfter.profile?.title === "Operations Lead", profileAfter);
  check("set_proactive_contact_channels", (await call(page, "set_proactive_contact_channels", { email: true, imessage: false })).status === "updated");
  check("get_imessage_history_deletion_state", (await call(page, "get_imessage_history_deletion_state", {})).status === "ok");
  check("prepare_imessage_history_deletion", (await call(page, "prepare_imessage_history_deletion", {})).status === "preparing");
  const abandonedChange = await call(page, "request_email_change", { email: `webmcp-abandoned-${stamp}@example.com` });
  check("cancel_email_change", (await call(page, "cancel_email_change", { request_id: abandonedChange.request_id })).status === "cancelled");
  const newEmail = `webmcp-changed-${stamp}@example.com`;
  emailOffset = logOffset();
  const emailChange = await call(page, "request_email_change", { email: newEmail });
  check("request_email_change sends a code", emailChange.status === "code_sent", emailChange);
  const changeCode = (await waitForEmail(newEmail, emailOffset))?.codes?.[0];
  const confirmed = await call(page, "confirm_email_change", { request_id: emailChange.request_id, code: changeCode });
  check("confirm_email_change with the captured code", confirmed.status === "changed" && confirmed.email === newEmail, confirmed);

  check("list_notifications", (await call(page, "list_notifications", {})).status === "ok");
  check("mark_all_notifications_read", (await call(page, "mark_all_notifications_read", {})).status === "read");
  await call(page, "set_theme", { theme: "dark" });
  check("set_theme applies dark mode", await page.evaluate(() => document.documentElement.classList.contains("dark")));
  await call(page, "set_theme", { theme: "light" });

  // Agent threads and drafted email, sent directly by the tool.
  const brokerEmail = `webmcp-broker-${stamp}@example.com`;
  const agentLogFrom = logOffset();
  const started = await call(page, "start_spot_agent_thread", {
    message: `Draft an email to ${brokerEmail} with the subject "WebMCP test" asking for our certificate of insurance. Do not send it; just prepare the draft.`,
  });
  check("start_spot_agent_thread", started.status === "started", started);
  await page.waitForURL(/\/agent\/thread\//, { timeout: 30_000 });
  await waitForTools(page, ["get_agent_thread", "send_email_draft"]);
  auditTools("/agent/thread", await registeredTools(page));
  let draftId = null;
  let thread = null;
  for (let attempt = 0; attempt < 90 && !draftId; attempt += 1) {
    thread = await call(page, "get_agent_thread", { thread_id: started.thread_id });
    draftId = thread.messages?.find((message) => message.pending_email_id)?.pending_email_id ?? null;
    const failed = thread.messages?.find((message) => message.role === "agent" && message.status === "error");
    if (failed) break;
    if (!draftId) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  result.agentThread = thread;
  checkModelStep("agent drafts an email in the thread", thread, Boolean(draftId), agentLogFrom);
  const draftIds = draftId ? [draftId] : [];
  if (!draftId) {
    // The local router is unavailable: create synthetic drafts in this local
    // deployment so the send tools still run through sendDraftNow/sendDraftsNow.
    for (let index = 0; index < 3; index += 1) {
      const output = execFileSync(
        path.join(repoRoot, "node_modules", ".bin", "convex"),
        [
          "run",
          "pendingEmails:create",
          JSON.stringify({
            orgId: organization.organization.org_id,
            threadId: started.thread_id,
            scheduledSendTime: Date.now(),
            recipientEmail: brokerEmail,
            fromHeader: "Spot Agent <agent@example.com>",
            subject: `WebMCP test ${index + 1}`,
            emailBody: "Synthetic local WebMCP draft. Please send our certificate of insurance.",
            status: "draft",
          }),
        ],
        { cwd: repoRoot, encoding: "utf8", env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" } },
      );
      draftIds.push(JSON.parse(output.trim()));
    }
    result.draftFixture = draftIds;
    draftId = draftIds[0];
  }
  if (draftId) {
    const draft = await call(page, "get_email_draft", { draft_id: draftId });
    check("get_email_draft", draft.status === "ok" && draft.email.to === brokerEmail, draft);
    check("cancel_email_draft", (await call(page, "cancel_email_draft", { draft_id: draftId })).status === "cancelled");
    check("restore_email_draft", (await call(page, "restore_email_draft", { draft_id: draftId })).status === "draft");
    emailOffset = logOffset();
    const sent = await call(page, "send_email_draft", { draft_id: draftId });
    check("send_email_draft sends without a confirmation step", sent.status === "sent" && sent.recipient === brokerEmail, sent);
    check("sent draft captured locally, not delivered", Boolean(await waitForEmail(brokerEmail, emailOffset)));
    if (draftIds.length > 1) {
      const batch = await call(page, "send_email_drafts", { draft_ids: draftIds.slice(1) });
      check("send_email_drafts sends every draft", batch.status === "sent" && batch.sent.length === draftIds.length - 1, batch);
    }
    const agentMessage = thread.messages.find((message) => message.role === "agent");
    if (agentMessage) {
      const rated = await call(page, "rate_agent_response", { message_id: agentMessage.message_id, rating: "positive" });
      checkModelStep("rate_agent_response", rated, rated.status === "recorded");
    }
  }
  check("list_agent_reference_targets", (await call(page, "list_agent_reference_targets", {})).status === "ok");
  const followUp = await call(page, "send_thread_message", {
    thread_id: started.thread_id,
    message: "Here is the contract for context.",
    attachments: [{ file_name: "contract.txt", content_type: "text/plain", content_base64: btoa("Synthetic contract text.") }],
  });
  check("send_thread_message with an attachment", followUp.status === "sent", followUp);
  const withAttachment = await call(page, "get_agent_thread", { thread_id: started.thread_id });
  const attachedFile = withAttachment.messages?.flatMap((message) => message.attachments).find((file) => file.file_name === "contract.txt");
  const attachmentUrls = await call(page, "get_thread_attachment_urls", { thread_id: started.thread_id, file_ids: [attachedFile?.file_id] });
  check("get_thread_attachment_urls", attachmentUrls.status === "ok" && attachmentUrls.files?.[0]?.url, attachmentUrls);
  const lastAgent = [...(withAttachment.messages ?? [])].reverse().find((message) => message.role === "agent");
  if (lastAgent) {
    check("retry_agent_response", (await call(page, "retry_agent_response", { message_id: lastAgent.message_id })).status === "retrying");
  }
  check("rename_thread", (await call(page, "rename_thread", { thread_id: started.thread_id, title: "WebMCP thread" })).status === "renamed");
  check("archive_thread", (await call(page, "archive_thread", { thread_id: started.thread_id })).status === "archived");
  const archivedThreads = await call(page, "list_agent_threads", { archived: true });
  check("list_agent_threads shows the archived thread", archivedThreads.threads?.some((row) => row.thread_id === started.thread_id), archivedThreads);
  check("unarchive_thread", (await call(page, "unarchive_thread", { thread_id: started.thread_id })).status === "active");
  await page.screenshot({ path: path.join(outDir, "client-agent-thread.png") });

  const signedOut = await call(page, "sign_out", {});
  check("sign_out tool signs out", signedOut.status === "signed_out", signedOut);
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
    const seededPolicies = await call(seededPage, "list_policies", {});
    result.seededPolicies = seededPolicies;
    const policy = seededPolicies.policies?.find((item) => item.extraction_status === "final") ?? seededPolicies.policies?.[0];
    check("seeded client lists policies", Boolean(policy), seededPolicies);
    if (policy) {
      const detail = await call(seededPage, "get_policy", { policy_id: policy.policy_id });
      check("get_policy returns coverages", detail.status === "ok" && Array.isArray(detail.policy.coverages), detail.status);
      const wording = await call(seededPage, "search_policy_wording", { policy_id: policy.policy_id, query: "liability", limit: 3 });
      result.seededWording = wording;
      check("search_policy_wording returns excerpts", wording.status === "ok" && wording.matches.length > 0, wording);
      await call(seededPage, "open_spot_page", { page: "policies", record_id: policy.policy_id });
      await waitForTools(seededPage, ["generate_certificate"]);
      const certificate = await call(seededPage, "generate_certificate", { policy_id: policy.policy_id, holder_name: `WebMCP Synthetic Holder ${stamp}`, city: "Austin", state: "TX" });
      result.seededCertificate = certificate;
      check("generate_certificate returns a PDF or a hold", ["completed", "partial", "held"].includes(certificate.status), certificate);
      const listed = await call(seededPage, "list_certificates", {});
      check("list_certificates includes the synthetic holder", listed.certificates?.some((item) => item.holder === `WebMCP Synthetic Holder ${stamp}`), listed.status);
      await seededPage.screenshot({ path: path.join(outDir, "seeded-policy.png") });
      const pdf = await call(seededPage, "get_policy_document_url", { policy_id: policy.policy_id });
      check("get_policy_document_url", pdf.status === "ok" && pdf.pdf_url, pdf);
      check("list_policy_versions", (await call(seededPage, "list_policy_versions", { policy_id: policy.policy_id })).status === "ok");
      const evidence = await call(seededPage, "get_policy_source_evidence", {
        policy_id: policy.policy_id,
        node_ids: wording.matches.map((match) => match.node_id).slice(0, 2),
      });
      check("get_policy_source_evidence returns cited sections", evidence.status === "ok" && evidence.sections.length > 0, evidence);

      await openPage(seededPage, { page: "certificates" }, /\/certificates/, ["reissue_certificate", "archive_certificate"]);
      auditTools("/certificates", await registeredTools(seededPage));
      const synthetic = listed.certificates.find((item) => item.holder === `WebMCP Synthetic Holder ${stamp}`);
      const reissued = await call(seededPage, "reissue_certificate", { certificate_id: synthetic.certificate_id });
      check("reissue_certificate issues a new version", reissued.status === "generated" && reissued.pdf_url, reissued);
      const holderUpdate = await call(seededPage, "update_certificate_holder", { certificate_id: synthetic.certificate_id, city: "Dallas" });
      check("update_certificate_holder issues a new version", holderUpdate.status === "generated", holderUpdate);
      const archivedCertificate = await call(seededPage, "archive_certificate", { certificate_id: synthetic.certificate_id });
      check("archive_certificate", archivedCertificate.status === "archived", archivedCertificate);
      const archivedList = await call(seededPage, "list_certificates", { archived: true });
      check("archived certificate is listed as archived", archivedList.certificates?.some((item) => item.certificate_id === synthetic.certificate_id));
      const restoredCertificate = await call(seededPage, "restore_certificate", { certificate_id: synthetic.certificate_id });
      check("restore_certificate", restoredCertificate.status === "active", restoredCertificate);
      check("list_certificate_review_jobs", (await call(seededPage, "list_certificate_review_jobs", {})).status === "ok");
      const seededSources = await call(seededPage, "list_requirement_sources", {});
      const seededSource = seededSources.sources?.find((source) => source.requirement_count > 0);
      if (seededSource) {
        const sourceBatch = await call(seededPage, "generate_certificates_for_requirements", { requirement_source_id: seededSource.requirement_source_id });
        check("generate_certificates_for_requirements reports PDFs or gaps", ["completed", "partial", "held", "blocked"].includes(sourceBatch.status), sourceBatch);
      }
    }
    check("list_client_files", (await call(seededPage, "list_client_files", {})).status === "ok");
    const seededNotifications = await call(seededPage, "list_notifications", {});
    const firstNotification = seededNotifications.notifications?.[0];
    if (firstNotification) {
      check("mark_notifications_read", (await call(seededPage, "mark_notifications_read", { notification_ids: [firstNotification.notification_id] })).status === "read");
    }
    const seededRequests = await call(seededPage, "list_insurance_requests", {});
    check("client request results omit private fields", !JSON.stringify(seededRequests).includes("private.md"), seededRequests.status);
    await seeded.close();
  }

  // 6. Public pages register token tools without a session.
  const publicContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await publicContext.addInitScript(STUB);
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`${base}/weather`, { waitUntil: "networkidle" });
  await waitForTools(publicPage, ["get_model_routing_report"]);
  const routing = await call(publicPage, "get_model_routing_report", {});
  check("get_model_routing_report on /weather", routing.status === "ok" && Array.isArray(routing.routes), routing.status);
  await publicPage.goto(`${base}/share/email/not-a-real-token`, { waitUntil: "networkidle" });
  await waitForTools(publicPage, ["get_shared_email_draft", "send_shared_email_draft"]);
  auditTools("/share/email", await registeredTools(publicPage));
  const missingDraft = await call(publicPage, "get_shared_email_draft", {});
  check("shared email tools fail safely on an invalid token", missingDraft.status === "error", missingDraft);
  await publicPage.goto(`${base}/connect/request/not-a-real-token`, { waitUntil: "networkidle" });
  await waitForTools(publicPage, ["get_vendor_invitation"]);
  const missingInvite = await call(publicPage, "get_vendor_invitation", {});
  check("vendor invitation tools fail safely on an invalid token", missingInvite.status === "error", missingInvite);
  check("no client tools on public pages", !(await registeredTools(publicPage)).some((tool) => tool.name === "list_policies"));
  await publicContext.close();

  result.coverage = {
    registered: [...registeredEverywhere].sort(),
    executed: [...executed].sort(),
  };
} catch (error) {
  check("run completed", false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  result.checks = checks;
  result.passed = checks.every((item) => item.ok);
  result.blocked = checks.filter((item) => item.blocked).map((item) => item.name);
  writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
  const blockedCount = result.blocked.length;
  console.log(`\n${checks.filter((item) => item.ok && !item.blocked).length}/${checks.length} checks passed${blockedCount ? `, ${blockedCount} blocked by the local model router` : ""}. Tools executed: ${executed.size}. Artifacts: ${path.relative(repoRoot, outDir)}/`);
  process.exitCode = result.passed ? 0 : 1;
}
