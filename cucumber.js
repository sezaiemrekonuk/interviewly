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
// Each task appends its own feature file here as it wires the steps. Next up: I03/I04 add
// question_generation.feature and profiling.feature.
module.exports = {
  default: {
    paths: ['.agents/features/security.feature'],
    require: ['backend/features/step_definitions/**/*.ts'],
    requireModule: ['tsx/cjs'],
    // Undefined, pending or ambiguous steps fail the run. Without this a scenario whose
    // steps were never written reports green.
    strict: true,
    format: ['progress'],
  },
};
