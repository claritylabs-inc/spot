import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const NAME = "MCP_EVENTS_ENCRYPTION_KEY";

if (!process.env.CONVEX_DEPLOY_KEY) {
  throw new Error("The production Convex deploy key is required to configure MCP Events.");
}

function readProductionValue() {
  const result = spawnSync("npx", ["convex", "env", "list", "--prod"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error("Could not inspect the production Convex environment.");
  }
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.startsWith(`${NAME}=`));
  return line?.slice(NAME.length + 1);
}

function isValidKey(value) {
  if (!value) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.byteLength === 32 && decoded.toString("base64") === value;
}

const current = readProductionValue();
if (current !== undefined) {
  if (!isValidKey(current)) {
    throw new Error(`${NAME} exists in production but is not canonical base64 for exactly 32 bytes.`);
  }
  console.log(`${NAME} is already configured with a valid 32-byte key.`);
  process.exit(0);
}

const generated = randomBytes(32).toString("base64");
const set = spawnSync("npx", ["convex", "env", "set", "--prod", NAME], {
  encoding: "utf8",
  input: `${generated}\n`,
  maxBuffer: 1024 * 1024,
});
if (set.status !== 0) {
  throw new Error(`Could not set ${NAME} in the production Convex environment.`);
}

if (readProductionValue() !== generated || !isValidKey(generated)) {
  throw new Error(`${NAME} failed production readback validation.`);
}

console.log(`${NAME} was configured and verified as canonical base64 for exactly 32 bytes.`);
