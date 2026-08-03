module.exports = {
  extends: ['@commitlint/config-conventional'],
  // GitHub UI "Commit suggestion" (Copilot Autofix) writes its own subject; we can't edit it.
  ignores: [(message) => /^Potential fix for /.test(message)],
};
