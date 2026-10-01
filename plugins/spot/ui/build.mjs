import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await build({
  entryPoints: [resolve(root, "ui/src/main.jsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  write: false,
  legalComments: "none",
  loader: { ".js": "jsx" },
});

const javascript = output.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Spot workspace</title>
    <style>
      :root { color-scheme: light dark; }
      html, body, #root { margin: 0; min-height: 100%; width: 100%; }
      body { background: #f7f7f5; color: #171716; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button, input, textarea, select { font: inherit; }
      button { cursor: pointer; }
      @media (prefers-color-scheme: dark) {
        body { background: #191918; color: #f4f4f0; }
      }
    </style>
  </head>
  <body><div id="root"></div><script>${javascript}</script></body>
</html>`;

const destination = resolve(root, "ui/dist/workspace.html");
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html);
await writeFile(resolve(root, "../../convex/lib/chatgptWorkspaceHtml.ts"), `export const SPOT_WORKSPACE_HTML = ${JSON.stringify(html)};\n`);
console.log(`Wrote ${destination} (${Buffer.byteLength(html)} bytes)`);
