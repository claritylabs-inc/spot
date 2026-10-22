import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import dayjs from "dayjs";
import { convert } from "html-to-text";

// Public documentation only: never follow model-switch, search, or external links.
const modelRoot =
  "https://modelviewers.pilotfishtechnology.com/modelviewers/ACORD-PCS/model/";
const output = resolve(process.argv[2] ?? ".context/acord-pcs-2.11.0/snapshot");
const modelLabelResponse = await fetch(
  new URL("currentModelLabel", modelRoot),
  {
    signal: AbortSignal.timeout(45000),
  },
);
if (!modelLabelResponse.ok) throw new Error("Could not verify model version");
if ((await modelLabelResponse.text()).trim() !== "ACORD PCS|2.11.0")
  throw new Error(
    "The public model version changed; use a new snapshot directory",
  );
const limit = 12000;
const queue = [new URL("index/all.html", modelRoot).href];
const seen = new Set(queue);
const records = [];
const failures = [];
await mkdir(join(output, "html"), { recursive: true });
const plain = (html) =>
  convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "noscript", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  }).trim();
function links(html, base) {
  const urls = new Set();
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const url = new URL(match[1].replaceAll("&amp;", "&"), base);
    if (
      url.href.startsWith(modelRoot) &&
      url.pathname.endsWith(".html") &&
      !url.search
    ) {
      url.hash = "";
      urls.add(url.href);
    }
  }
  return [...urls];
}
async function retrieve(url) {
  const file = createHash("sha256").update(url).digest("hex") + ".html.gz";
  const path = join(output, "html", file);
  let html;
  try {
    html = gunzipSync(await readFile(path)).toString("utf8");
  } catch {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(45000),
          headers: {
            "User-Agent":
              "Spot-ACORD-Reference/1.0 (public documentation archive)",
          },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        html = await response.text();
        if (!/<html[\s>]/i.test(html))
          throw new Error("Expected an HTML documentation page");
        await writeFile(path, gzipSync(html));
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((done) => setTimeout(done, 1000 * (attempt + 1)));
      }
    }
  }
  const title = plain(
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? url.split("/").pop(),
  );
  const values = [
    ...html.matchAll(
      /<tr\b[^>]*class=["']TypeCodeDetailRow["'][^>]*>([\s\S]*?)<\/tr>/gi,
    ),
  ].flatMap((row) => {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (cell) => plain(cell[1]),
    );
    return cells.length >= 2 ? [{ code: cells[0], description: cells[1] }] : [];
  });
  return {
    url,
    title,
    text: plain(html),
    rows: [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((row) =>
        [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
          (cell) => plain(cell[1]),
        ),
      )
      .filter((cells) => cells.length),
    links: links(html, url),
    ...(values.length ? { values } : {}),
    htmlFile: `html/${file}`,
    sha256: createHash("sha256").update(html).digest("hex"),
  };
}
let cursor = 0;
while (cursor < queue.length && cursor < limit) {
  const batch = queue.slice(cursor, Math.min(cursor + 4, limit));
  cursor += batch.length;
  const results = await Promise.allSettled(batch.map(retrieve));
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === "rejected") {
      failures.push({ url: batch[index], error: String(result.reason) });
      continue;
    }
    const record = result.value;
    records.push(record);
    for (const url of record.links)
      if (!seen.has(url)) {
        seen.add(url);
        queue.push(url);
      }
  }
  if (Math.floor(cursor / 100) !== Math.floor((cursor - batch.length) / 100))
    console.log(
      `${records.length} extracted; ${queue.length - cursor} queued; ${failures.length} failed`,
    );
}
records.sort((a, b) => a.url.localeCompare(b.url));
await writeFile(
  join(output, "model.jsonl"),
  records.map((record) => JSON.stringify(record)).join("\n") + "\n",
);
const manifest = {
  model: "ACORD PCS",
  version: "2.11.0",
  source: modelRoot,
  extractedAt: dayjs().toISOString(),
  discovered: queue.length,
  extracted: records.length,
  codeListPages: records.filter((record) => record.url.includes("/codelists/"))
    .length,
  pagesWithEnumerations: records.filter((record) => record.values).length,
  complete: cursor === queue.length && failures.length === 0,
  failures,
  capped: cursor < queue.length,
};
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const lineOfBusiness = records.find(
  (record) => record.url === new URL("LOBCd.html", modelRoot).href,
);
if (lineOfBusiness?.values)
  await writeFile(
    join(output, "line-of-business.json"),
    JSON.stringify(
      {
        model: manifest.model,
        version: manifest.version,
        source: lineOfBusiness.url,
        values: lineOfBusiness.values,
      },
      null,
      2,
    ) + "\n",
  );
console.log(JSON.stringify(manifest));
if (!manifest.complete) process.exitCode = 1;
