import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = ["AGENTS.md", "AGENT_TOOLS.md", "README.md", "CHANGELOG.md"];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(name);
    else if (name.endsWith(".md")) files.push(path.relative(root, name));
  }
}
collect(path.join(root, "docs"));
files.push(".agents/skills/spot-primitives/SKILL.md");
let failures = 0;
for (const file of files) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of content.matchAll(/\[[^\]]+\]\((<?[^)>]+>?(?:#[^)]*)?)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const relative = decodeURIComponent(target.split("#")[0]);
    if (!relative) continue;
    const resolved = path.resolve(path.dirname(path.join(root, file)), relative);
    if (!fs.existsSync(resolved)) {
      console.error(`${file}: missing ${target}`);
      failures++;
    }
  }
}
if (failures) process.exitCode = 1;
else console.log(`Checked Markdown link paths in ${files.length} files.`);
