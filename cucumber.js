// Acceptance runner (IDEA.md §5.3). Runs from the repo root.
//
// `paths` is a deliberate ALLOW-LIST, not a glob over .agents/features. Every feature file
// in that directory was authored in Stage 2, but a scenario only becomes runnable when the
// task that owns its behaviour has wired its step definitions. Globbing would make every
// unwired feature an undefined-step failure forever; listing them one at a time makes the
// acceptance suite grow exactly as fast as the implementation does.
//
// The feature files are read where they were authored — there is no second copy under
// backend/. One file, one source of truth, so the spec and the runnable test cannot drift.
//
// Each task appends its own feature file here as it wires the steps. Next up: I04 adds
// profiling.feature.
//
// I03 is the first task whose steps import backend/src/app.ts, which loads env.ts's Zod
// schema at require time — every key must resolve or the process exits before a single
// scenario runs. Loaded here (once, before requireModule) rather than via a CLI flag so
// this file behaves the same whether it is invoked directly or through the npm script.
// Vars already in process.env (CI sets DATABASE_URL/SHADOW_DATABASE_URL/REDIS_URL itself)
// take precedence over the file (Node's loadEnvFile semantics) — this only fills the rest.
try {
  process.loadEnvFile(require('node:path').join(__dirname, '.env'));
} catch {
  // No .env at repo root: env.ts reports ENV_VALIDATION_FAILED with the missing keys,
  // which is a clearer failure than a silent skip.
}

module.exports = {
  default: {
    paths: [
      '.agents/features/security.feature',
      '.agents/features/ai_provider.feature',
      '.agents/features/question_generation.feature',
    ],
    require: ['backend/features/step_definitions/**/*.ts'],
    requireModule: ['tsx/cjs'],
    // Undefined, pending or ambiguous steps fail the run. Without this a scenario whose
    // steps were never written reports green.
    strict: true,
    format: ['progress'],
  },
};
