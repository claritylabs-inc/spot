// Shared safety and helpers for local-only Convex E2E scripts.
//
// Everything here is pinned to the native-local backend (127.0.0.1:8083, admin
// key from .convex/local/default/config.json). Cloud and deploy keys are
// stripped from the child environment, so no command can reach another project.
// Helpers only read tables and call functions; nothing deletes data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { consumeLocalEmailCaptures } from "../watch-conductor-email-captures.mjs";

export const convexUrl = "http://127.0.0.1:8083";
export const convexLog = ".context/logs/convex.log";

const local = JSON.parse(readFileSync(".convex/local/default/config.json", "utf8"));
assert.equal(local.ports?.cloud, 8083, "Local Convex config must use port 8083");
assert.equal(new URL(convexUrl).hostname, "127.0.0.1");

const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith("CONVEX_") || name.startsWith("CONDUCTOR_CONVEX")) delete env[name];
}

const cli = (...args) => {
  const result = spawnSync(
    "./node_modules/.bin/convex",
    [...args, "--url", convexUrl, "--admin-key", local.adminKey],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 0, "Local Convex command failed (arguments omitted to protect credentials)");
  return result.stdout;
};

/** Runs an internal or public function on the local backend. */
export const run = (fn, args = {}) => cli("run", fn, JSON.stringify(args));

/** Reads a table from the local backend. */
export const rows = (table) => {
  const text = cli("data", table, "--format", "json");
  return text.trim().startsWith("[") ? JSON.parse(text) : [];
};

/** A random value that exists only in this process; it is never written anywhere. */
export const randomPassword = () => randomBytes(24).toString("base64url");

/** A synthetic address no real person owns. */
export const syntheticEmail = (prefix) => `${prefix}-${randomBytes(4).toString("hex")}@example.com`;

export const rejects = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return String(error?.message ?? error);
  }
  throw new Error("Expected the call to be rejected");
};

/** Signs a ConvexHttpClient in through the real email-code flow, using the local capture log. */
export async function signInWithEmailCode(client, anyApi, email) {
  const from = readFileSync(convexLog, "utf8").length;
  await client.action(anyApi.auth.signIn, { provider: "resend-otp", params: { email } });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const capture = consumeLocalEmailCaptures(readFileSync(convexLog, "utf8").slice(from)).captures.find(
      (item) => item.to.includes(email) && item.codes.length,
    );
    if (capture) {
      const result = await client.action(anyApi.auth.signIn, {
        provider: "resend-otp",
        params: { email, code: capture.codes[0] },
      });
      client.setAuth(result.tokens.token);
      return result.tokens;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No captured sign-in code for ${email}`);
}

export const logContains = (text) => readFileSync(convexLog, "utf8").includes(text);
