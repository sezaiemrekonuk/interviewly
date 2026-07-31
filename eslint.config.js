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
    // backend/modules is the modular-monolith code (auth, interview, …); backend/tests
    // holds the Cucumber acceptance harness — both are TypeScript.
    files: [
      "backend/src/**/*.ts",
      "backend/modules/**/*.ts",
      "backend/tests/**/*.ts",
      "backend/prisma/**/*.ts",
      // Cucumber step definitions (I01). Feature files themselves live in .agents/features
      // and are ignored above; the TypeScript that runs them is real source.
      "backend/features/**/*.ts",
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
      // `_`-prefixed args are intentionally unused — e.g. Express error handlers,
      // which must keep their 4-arg (err, req, res, next) signature to be recognised.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];
