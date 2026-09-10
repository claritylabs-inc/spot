import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("worker production sources and manifest contain no direct provider execution", async () => {
  const sourceDirectory = new URL("../src/", import.meta.url);
  const sourceFiles = (await readdir(sourceDirectory, { recursive: true }))
    .filter((path) => path.endsWith(".ts"))
    .map((path) => new URL(path, sourceDirectory));
  const files = [
    ...sourceFiles,
    new URL("../package.json", import.meta.url),
    new URL("../package-lock.json", import.meta.url),
    new URL("../.env.template", import.meta.url),
  ];
  const productionText = (
    await Promise.all(files.map((file) => readFile(file, "utf8")))
  ).join("\n");
  const forbidden = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "FIREWORKS_API_KEY",
    "DEEPSEEK_API_KEY",
    "MISTRAL_API_KEY",
    "COHERE_API_KEY",
    "XAI_API_KEY",
    "PARALLEL_API_KEY",
    "EXA_API_KEY",
    "AI_GATEWAY_API_KEY",
    "VERCEL_AI_GATEWAY_API_KEY",
    "MOONSHOTAI_API_KEY",
    "MOONSHOT_API_KEY",
    "providerKeys",
    "CL_ROUTER_TASKS",
    "@ai-sdk/",
    '"ai"',
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
  ];
  for (const token of forbidden) {
    assert.equal(
      productionText.includes(token),
      false,
      `production worker contains ${token}`,
    );
  }
  const source = await readFile(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /requiredEnv\("CL_ROUTER_URL"\)/);
  assert.match(source, /requiredEnv\("CL_ROUTER_SECRET"\)/);
  assert.match(source, /requiredEnv\("CL_ROUTER_TENANT_ID"\)/);
  assert.match(
    source,
    /validatedConvexSiteUrl\(\s*requiredEnv\("CONVEX_SITE_URL"\),\s*SPOT_ENV/,
  );
  assert.equal(source.includes("createClRouterClient({"), true);
});
