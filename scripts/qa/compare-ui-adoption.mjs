// node scripts/qa/compare-ui-adoption.mjs <baseline-dir> <after-dir> <report-dir>
import sharp from "sharp";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const [before, after, out] = process.argv.slice(2);
if (!before || !after || !out)
  throw new Error("Expected baseline, after, and report directories");
mkdirSync(out, { recursive: true });
const report = [];
for (const file of readdirSync(before).filter((name) =>
  name.endsWith(".png"),
)) {
  const a = await sharp(path.join(before, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const b = await sharp(path.join(after, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height)
    throw new Error(`Size mismatch: ${file}`);
  let changed = 0;
  const diff = Buffer.alloc(a.data.length, 255);
  for (let i = 0; i < b.data.length; i += 4) {
    const delta = Math.max(
      ...[0, 1, 2].map((c) => Math.abs(a.data[i + c] - b.data[i + c])),
    );
    if (delta > 12) {
      changed++;
      diff[i + 1] = 0;
      diff[i + 2] = 0;
    }
  }
  await sharp(diff, { raw: a.info }).png().toFile(path.join(out, file));
  report.push({
    file,
    changedPixels: changed,
    changedPercent: (changed / (a.info.width * a.info.height)) * 100,
  });
}
writeFileSync(
  path.join(out, "comparison.json"),
  JSON.stringify({ channelTolerance: 12, report }, null, 2),
);
console.log(JSON.stringify(report, null, 2));
