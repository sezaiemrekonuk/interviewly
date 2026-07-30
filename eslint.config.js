const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");

module.exports = [
  {
    ignores: [
      "frontend/**",
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "packages/types/dist/**",
      // Everything outside the four code-writable workspaces (.agents/, docs/, ci/, db/,
      // edge/, elasticsearch/, kibana/, internal_docs/) is spec/tooling, not lintable source.
      ".agents/**",
      "ci/**",
      "db/**",
      "docs/**",
      "edge/**",
      "elasticsearch/**",
      "internal_docs/**",
      "kibana/**",
    ],
  },
  {
    // backend/prisma holds seed.ts (F02) — TypeScript, so it needs the TS parser too.
    files: [
      "backend/src/**/*.ts",
      "backend/prisma/**/*.ts",
      "packages/*/src/**/*.ts",
      "worker/src/**/*.ts",
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: { sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
    },
  },
];
