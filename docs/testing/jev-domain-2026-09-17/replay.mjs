import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const artifactDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(artifactDirectory, "../../..");
const outputDirectory = path.join(
  repository,
  ".context/jev-domain-artifact-replay",
);
fs.mkdirSync(outputDirectory, { recursive: true });

// This evaluation-only adapter intercepts the shared transport import inside
// the bundle. It never writes a stub into convex/ or invokes the real router.
const evaluationAdapter = `export async function decideWithFallback(args) {
  if (typeof globalThis.__domainEvaluation !== "function") throw new Error("Missing synthetic evaluation hook");
  return globalThis.__domainEvaluation(args);
}`;

for (const floor of [0.9, 0.95, 0.99]) {
  const bundle = path.join(outputDirectory, `replay-${floor}.mjs`);
  const resultsFile = path.join(outputDirectory, `replay-${floor}.json`);
  await build({
    entryPoints: [path.join(artifactDirectory, "evaluate.mjs")],
    bundle: true,
    platform: "node",
    packages: "external",
    format: "esm",
    outfile: bundle,
    plugins: [
      {
        name: "synthetic-domain-replay",
        setup(builder) {
          builder.onResolve({ filter: /^\.\/decisions$/ }, (args) => {
            if (
              path.dirname(args.importer) ===
              path.join(repository, "convex/lib")
            ) {
              return {
                path: "evaluation-adapter",
                namespace: "synthetic-evaluation",
              };
            }
          });
          builder.onLoad(
            { filter: /.*/, namespace: "synthetic-evaluation" },
            () => ({ contents: evaluationAdapter, loader: "js" }),
          );
          builder.onLoad({ filter: /domainDecisionQuestions\.ts$/ }, (args) => {
            const contents = fs.readFileSync(args.path, "utf8");
            const declaration = "export const EVIDENCE_FLOOR = 0.99;";
            if (!contents.includes(declaration))
              throw new Error(
                "Safety-floor declaration changed; review this calibration replay before updating it.",
              );
            return {
              contents: contents.replace(
                declaration,
                `export const EVIDENCE_FLOOR = ${floor};`,
              ),
              loader: "ts",
            };
          });
        },
      },
    ],
  });
  const environment = { ...process.env };
  delete environment.TYPESAFE_API_KEY;
  execFileSync(process.execPath, [bundle], {
    cwd: repository,
    env: {
      ...environment,
      REPLAY_FILE: path.join(artifactDirectory, "live-results.json"),
      EVAL_OUTPUT: resultsFile,
    },
    stdio: "pipe",
  });
  const { results } = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  for (const family of [...new Set(results.map((row) => row.family))]) {
    for (const split of ["calibration", "heldout"]) {
      const rows = results.filter(
        (row) => row.family === family && row.split === split,
      );
      const accepted = rows.filter((row) => row.accepted);
      console.log(
        JSON.stringify({
          floor,
          family,
          split,
          samples: rows.length,
          accepted: accepted.length,
          acceptedLabelMatches: accepted.filter((row) => row.correct).length,
        }),
      );
    }
  }
}
