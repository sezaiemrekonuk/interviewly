# Agent toolchain — design

**Date:** 2026-07-29
**Status:** implemented
**Target harness:** GitHub Copilot CLI

## Problem

Agent skills and rules were configured per-developer in `~/.claude/`. A teammate
cloning the repo got none of them. Several overlapping planning workflows were
candidates — superpowers, spec-kit, ledger-driven development — each wanting to own
how work gets planned.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Ledger-driven development is the planning spine. | The repo already scaffolds `.agents/ledgers/` and `.agents/specs/`. One spine, not several. |
| 2 | GitHub Copilot CLI is the target harness. Nothing Claude-specific is committed. | Team standard. `.claude/` stays gitignored. |
| 3 | Skills live in `.agents/skills/`. | Copilot CLI loads that path natively as a repository skill directory, alongside `.github/skills` and `.claude/skills`. No symlink, no config, no install step. |
| 4 | Always-on rules live in `.github/instructions/*.instructions.md` with `applyTo: '**'`. | Copilot CLI reads repo-wide instructions from `.github/copilot-instructions.md` and path-specific ones from `.github/instructions/**/*.instructions.md`. One file per concern keeps each independently re-syncable from upstream. |
| 5 | caveman and ponytail are converted from Claude plugins to instruction files. | They were session-start hooks injecting style rules. Copilot has no plugin or hook system; an always-on instruction file is the equivalent. Both are MIT and ponytail ships its own `copilot-instructions.md`. |
| 6 | All 14 superpowers skills vendored, despite the planning overlap with decision 1. | They are plain `SKILL.md` files and port unchanged. The README flags which ones overlap `plan-initiative` and which assume Claude subagent tooling. |
| 7 | The `superpowers:` namespace prefix stripped from all cross-references. | Copilot CLI has no plugin namespace — `superpowers:brainstorming` would not resolve, `brainstorming` does. 26 occurrences across 9 files. Recorded in the README as a re-sync step. |
| 8 | spec-kit rejected. | A CLI that writes a competing `.specify/` tree and `/specify`, `/plan`, `/tasks`, `/implement` commands. Direct collision with decision 1. |
| 9 | Ledgers write to `.agents/ledgers/<slug>/`, overriding the skill's `.<slug>/` repo-root default. | Keeps the `.agents/` convention. Recorded in `.github/copilot-instructions.md`, which loads every request. |
| 10 | MCP servers documented but not committed. | Copilot CLI reads MCP config only from `~/.copilot/mcp-config.json`. Repository-level MCP config serves the cloud agent and code review, not the CLI. Per-developer `/mcp add` is the only path. |

## Layout

```
.github/
  copilot-instructions.md              # repo conventions + LDD spine
  instructions/
    caveman.instructions.md            # applyTo '**'
    ponytail.instructions.md           # applyTo '**'
.agents/skills/                        # loaded natively by Copilot CLI
  README.md                            # inventory, upstream URLs, re-sync steps
  plan-initiative/  update-initiative/  # LDD @ 5efc068
  brainstorming/ dispatching-parallel-agents/ executing-plans/
  finishing-a-development-branch/ receiving-code-review/ requesting-code-review/
  subagent-driven-development/ systematic-debugging/ test-driven-development/
  using-git-worktrees/ using-superpowers/ verification-before-completion/
  writing-plans/ writing-skills/       # superpowers v6.2.0
```

`.claude/` remains fully gitignored. Local Claude Code symlinks under
`.claude/skills/` are left in place for individual use and are not tracked.

## Cut

- **spec-kit** — see decision 8.
- **caveman `cavecrew` skill and its three agents** — wrap Claude subagent tooling.
- **`code-simplifier`, `feature-dev`, `supabase`, `chrome-devtools-mcp`** — Claude
  plugins with no Copilot equivalent, and each either duplicates something kept
  (`ponytail`, the LDD spine, `playwright`) or targets services this repo does not
  run.

## Verification

```bash
for d in .agents/skills/*/; do test -f "$d/SKILL.md" || echo "no SKILL.md: $d"; done
grep -r "superpowers:" .agents/skills --exclude=README.md   # expect no matches
git check-ignore .claude                                    # Claude config stays out
git ls-files --others --exclude-standard .github .agents    # everything shared is trackable
```

In a fresh Copilot CLI session at the repo root: `/skills` lists all 16 skills, and
responses follow the caveman and ponytail rules without being asked.
