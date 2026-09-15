import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import spotTypographyPlugin from "./eslint-rules/no-untyped-typography.mjs";
import spotSelectPlugin from "./eslint-rules/require-select-value-label.mjs";
import spotPillButtonPlugin from "./eslint-rules/no-pill-button-size-overrides.mjs";

const spotPlugin = {
  rules: { ...spotTypographyPlugin.rules, ...spotSelectPlugin.rules, ...spotPillButtonPlugin.rules },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / external
    ".context/**",
    ".worktrees/**",
    ".claude/worktrees/**",
    // Convex codegen output — regenerated on every `convex dev`.
    "convex/_generated/**",
  ]),
  // Allow underscore-prefixed identifiers to mark intentionally-unused values
  // across the repo. Matches the existing convention (`_unused`, `catch (_)`).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: [
      "app/**/*.{ts,tsx,js,jsx}",
      "components/**/*.{ts,tsx,js,jsx}",
      "lib/**/*.tsx",
    ],
    ignores: ["app/**/opengraph-image.{ts,tsx,js,jsx}"],
    plugins: { spot: spotPlugin },
    rules: {
      "spot/no-untyped-typography": "error",
      "spot/require-select-value-label": "error",
      "spot/no-pill-button-size-overrides": "error",
    },
  },
  // Convex functions deal with dynamic data: cl-sdk discriminated unions,
  // LLM JSON output, and `v.any()`-typed schema fields (document, analysis,
  // declarations, etc). Explicit `any` is the pragmatic choice here rather
  // than a code smell, so relax the rule in this directory.
  {
    files: ["convex/**/*.{ts,tsx,js}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
