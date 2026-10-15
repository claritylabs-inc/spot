// Builds the static Spot browser extension into extensions/spot/dist.
//
//   npm run extension:build                       production app origin
//   npm run extension:build -- --local            http://localhost:<workspace web port>
//   npm run extension:build -- --origin http://localhost:8080
//
// Load extensions/spot/dist as an unpacked extension (see extensions/spot/README.md).
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { conductorPorts, repoRoot } from "./lib/conductor-workspace.mjs";

const sourceDir = path.join(repoRoot, "extensions", "spot");
const outDir = path.join(sourceDir, "dist");
const config = JSON.parse(
  readFileSync(path.join(repoRoot, "config", "browser-extension.json"), "utf8"),
);

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

function appOrigin() {
  const explicit = argValue("--origin");
  if (explicit && process.argv.includes("--local")) {
    throw new Error("Use either --local or --origin, not both");
  }
  const raw = explicit ?? (process.argv.includes("--local")
    ? `http://localhost:${conductorPorts().web}`
    : config.appOrigin);
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`App origin must be https (or http on localhost): ${raw}`);
  }
  if (url.origin !== raw.replace(/\/$/, "")) {
    throw new Error(`App origin must be an origin without a path: ${raw}`);
  }
  return url;
}

// Chrome derives an extension ID from the first 128 bits of the SHA-256 of the
// public key, written with the letters a-p.
function extensionIdFromKey(key) {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest();
  return [...digest.subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15)))
    .join("");
}

const computedId = extensionIdFromKey(config.key);
if (computedId !== config.extensionId) {
  throw new Error(
    `config/browser-extension.json key produces ${computedId}, expected ${config.extensionId}`,
  );
}

const origin = appOrigin();
const manifest = JSON.parse(
  readFileSync(path.join(sourceDir, "manifest.template.json"), "utf8"),
);
const iconSizes = [16, 32, 48, 128];
manifest.key = config.key;
// Match patterns take no port: http://localhost/* covers every localhost port.
manifest.host_permissions = [`${origin.protocol}//${origin.hostname}/*`];
manifest.content_security_policy = {
  extension_pages: `script-src 'self'; object-src 'self'; frame-src ${origin.origin}`,
};
manifest.icons = Object.fromEntries(iconSizes.map((size) => [size, "icons/spot.png"]));
manifest.action.default_icon = manifest.icons;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "icons"), { recursive: true });
for (const file of ["service-worker.js", "sidepanel.html", "sidepanel.css", "sidepanel.js", "capture.js"]) {
  cpSync(path.join(sourceDir, file), path.join(outDir, file));
}
cpSync(
  path.join(repoRoot, "public", "spot", "logo-icon.png"),
  path.join(outDir, "icons", "spot.png"),
);
writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  path.join(outDir, "config.js"),
  `globalThis.SPOT_EXTENSION = Object.freeze(${JSON.stringify({
    appOrigin: origin.origin,
    path: config.path,
    protocolVersion: config.protocolVersion,
    maxTextLength: config.maxTextLength,
    maxTitleLength: config.maxTitleLength,
    maxUrlLength: config.maxUrlLength,
  })});\n`,
);

console.log(`Built Spot extension for ${origin.origin}${config.path}`);
console.log(`Extension ID ${computedId}`);
console.log(`Load unpacked from ${path.relative(repoRoot, outDir)}`);
