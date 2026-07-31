// Cucumber config for the acceptance suite. TypeScript step definitions are loaded
// through tsx's CJS hook. `paths` grows as each ledger lands its features; auth is first.
// The `not @wip` filter keeps scenarios whose step definitions are not written yet
// out of the green suite until they are.
module.exports = {
  default: {
    requireModule: ['tsx/cjs'],
    require: ['tests/support/**/*.ts', 'tests/step-definitions/**/*.ts'],
    paths: ['../.agents/features/auth.feature', '../.agents/features/admin_auth.feature'],
    tags: 'not @wip',
  },
};
