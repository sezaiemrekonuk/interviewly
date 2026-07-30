#!/usr/bin/env bash
# Every `done` task has a devlog file. See .agents/EXECUTE.md § Devlog.
#
# SKETCH — NOT WIRED INTO CI YET. CI itself is foundations task F03; when that lands, add
# this to the `commit-hygiene` job (warning-only, alongside commitlint) rather than creating
# a new job. Until then it is a human check at PR review: no devlog, no approval.
#
# Usage: ci/check-devlogs.sh
# Exit 0 = every done task has a devlog. Exit 1 = at least one is missing.
#
# ponytail: parses the STATE.md markdown table with awk on `|` fields. Ceiling — a task
# title containing a literal `|` shifts the columns and the row is skipped silently. If that
# ever happens, the fix is to read status from the task file's line-2 header instead, but
# STATE is the authority on status today so this is the source that cannot go stale.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

missing=0
checked=0

for state in .agents/ledgers/*/STATE.md; do
  [ -f "$state" ] || continue

  # Ledger table rows look like: | A01 | Title | | done | — |
  # Field 2 = ID, field 5 = Status. Keep only ID-shaped, done rows.
  while read -r id; do
    checked=$((checked + 1))
    if ! compgen -G ".agents/devlogs/${id}-*.md" > /dev/null; then
      echo "MISSING devlog: ${id} is done in ${state} but .agents/devlogs/${id}-*.md does not exist"
      missing=$((missing + 1))
    fi
  done < <(awk -F'|' '
    NF >= 6 {
      id = $2; status = $5
      gsub(/^[ \t]+|[ \t]+$/, "", id)
      gsub(/^[ \t]+|[ \t]+$/, "", status)
      if (id ~ /^[A-Z][0-9]+$/ && status == "done") print id
    }
  ' "$state")
done

echo "checked ${checked} done task(s), ${missing} missing devlog(s)"
[ "$missing" -eq 0 ]
