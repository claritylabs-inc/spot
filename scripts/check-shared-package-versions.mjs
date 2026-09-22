import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedPackages = [
  "@claritylabs/cl-sdk",
];
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function readPackageJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

const appPackage = readPackageJson("package.json");
const workerPackage = readPackageJson("extraction-worker/package.json");

for (const packageName of sharedPackages) {
  const appVersion = appPackage.dependencies?.[packageName];
  const workerVersion = workerPackage.dependencies?.[packageName];

  if (!appVersion || !workerVersion) {
    console.error(
      `${packageName} must be listed in both root and extraction-worker dependencies.`,
    );
    process.exit(1);
  }

  if (appVersion !== workerVersion) {
    console.error(
      `${packageName} version mismatch: root has ${appVersion}, extraction-worker has ${workerVersion}.`,
    );
    process.exit(1);
  }

  if (!exactVersion.test(appVersion)) {
    console.error(
      `${packageName} must use an exact version in both manifests; got ${appVersion}.`,
    );
    process.exit(1);
  }

  console.log(`${packageName} versions aligned at ${appVersion}.`);
}
