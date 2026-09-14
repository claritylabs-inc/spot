import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = resolve(
  process.argv.slice(2).find((arg) => arg !== "--check") ??
    "../montgomery-risk",
);
const sites = JSON.parse(
  await readFile(resolve(source, "ledger/sites.json"), "utf8"),
).sites;
const domains = JSON.parse(
  await readFile(resolve(source, "ledger/domains.json"), "utf8"),
).domains;
const registered = domains.filter((entry) => entry.status === "registered");
const brands = registered.map((entry) => {
  const site = sites.find((site) => site.domain === entry.domain);
  if (!site)
    throw new Error(`Registered domain has no site identity: ${entry.domain}`);
  return {
    domain: entry.domain,
    name: site.brand.name,
    alias: site.slug.replaceAll("-", " "),
  };
});
for (const site of sites.filter((site) => site.status === "live")) {
  if (!brands.some((brand) => brand.domain === site.domain)) {
    throw new Error(
      `Live site is missing registered ownership: ${site.domain}`,
    );
  }
}
if (!brands.length) throw new Error("Acquisition domain ledger is empty");
const destination = fileURLToPath(
  new URL("../config/spot-acquisition-domains.json", import.meta.url),
);
const output = `${JSON.stringify(brands, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== output) {
    throw new Error(
      "Spot acquisition domains differ from the Montgomery Risk ledger; run this script without --check",
    );
  }
} else {
  await writeFile(destination, output);
}
console.log(
  `${brands.length} registered Spot acquisition domains ${process.argv.includes("--check") ? "verified" : "synced"}`,
);
