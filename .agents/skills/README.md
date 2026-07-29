# Agent skills

Shared skills for this repo. GitHub Copilot CLI loads `.agents/skills/` natively at
session start — clone the repo and they are there. No install step.

- `/skills` lists what loaded.
- `/skills reload` picks up edits without restarting the CLI.

A skill is a directory containing `SKILL.md` with YAML frontmatter. Copilot requires
`name` (lowercase, hyphens for spaces) and `description` (what it does and when to
use it). Add a skill by creating a directory here — nothing else to wire up.

## Ledger-driven development

The planning spine. See `.github/copilot-instructions.md` for the rules and the
`.agents/ledgers/<slug>/` path override.

| Skill | Use when |
|---|---|
| `plan-initiative` | You describe something to build and no ledger exists yet. |
| `update-initiative` | A ledger exists and something changed: new ask, re-scope, superseded decision. |

Vendored from
[sezaiemrekonuk/ledger-driven-development-skill](https://github.com/sezaiemrekonuk/ledger-driven-development-skill)
at commit `5efc068`. Re-sync:

```bash
git clone --depth 1 https://github.com/sezaiemrekonuk/ledger-driven-development-skill /tmp/ldd
cp -R /tmp/ldd/skills/* .agents/skills/
```

## Superpowers

Vendored from
[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
`superpowers` v6.2.0 (MIT). Re-sync by copying that plugin's `skills/*` here, then
re-applying the delta below.

| Skill | Use when |
|---|---|
| `systematic-debugging` | A bug needs root-causing, not symptom-patching. |
| `test-driven-development` | Writing code where the test should come first. |
| `verification-before-completion` | About to call something done. |
| `requesting-code-review` / `receiving-code-review` | Review, and acting on review. |
| `brainstorming` | Turning a vague idea into a design. Overlaps `plan-initiative` — prefer the ledger skill for anything that becomes real work. |
| `writing-plans` / `executing-plans` | Plan authoring and execution. Same overlap caveat. |
| `subagent-driven-development`, `dispatching-parallel-agents` | Delegation patterns. Written for Claude Code's subagent tools; treat as guidance, not literal instructions. |
| `using-git-worktrees`, `finishing-a-development-branch` | Branch and worktree hygiene. |
| `writing-skills` | Authoring new skills for this directory. |
| `using-superpowers` | How the set fits together. |

**Delta from upstream:** the `superpowers:` plugin-namespace prefix was stripped
from all cross-references (26 occurrences), because Copilot CLI has no plugin
namespace — a skill is referenced by its bare name. Re-apply after any re-sync:

```bash
grep -rl "superpowers:" .agents/skills | xargs sed -i '' 's/superpowers://g'
```

## Frontend design

Vendored from the `frontend-design` skill in
[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
(Claude Code's official `frontend-design` plugin). Use for aesthetic direction,
typography, and layout choices when building or reshaping UI — avoids templated,
generic-looking output. Re-sync:

```bash
cp -R ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/. .agents/skills/frontend-design/
```

`.claude/skills/frontend-design` and `.github/skills/frontend-design` are symlinks
to this directory (no per-provider content, so one copy serves all).

## Impeccable

Not vendored here — installed natively per provider via the upstream CLI, because
its skill payload is generated per-provider (agent/tool syntax differs) rather than
plain markdown. Covers UI design, redesign, critique, audit, polish, accessibility,
and design-system work; run `/impeccable init` once per project to set up design
context.

Installed from [pbakaus/impeccable](https://github.com/pbakaus/impeccable) into
`.claude/skills/impeccable` and `.github/skills/impeccable` (project scope), plus
`~/.claude/skills/impeccable` and `~/.github/skills/impeccable` (global scope).
Re-sync either scope:

```bash
npx impeccable install --providers=claude,copilot --scope=project --no-hooks
npx impeccable install --providers=claude,copilot --scope=global --no-hooks
```

## Always-on rules

Not skills — these load on every request, from `.github/instructions/`:

| File | Effect |
|---|---|
| `caveman.instructions.md` | Terse responses. Technical substance kept, filler dropped. Adapted from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) (MIT). |
| `ponytail.instructions.md` | YAGNI discipline. Reuse before writing, shortest working diff, no unrequested abstractions. Vendored from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT). |

To opt out locally, delete them from your working copy — but do not commit that.

## MCP servers — per developer, not shared

Copilot CLI reads MCP config from `~/.copilot/mcp-config.json` only (override the
whole directory with `COPILOT_HOME`). The repository-level MCP configuration in
GitHub repo settings feeds the cloud agent and code review, **not** the CLI. So
these cannot be committed. Add them yourself with `/mcp add` in an interactive
session:

| Server | Why it earns its place here |
|---|---|
| `context7` | Live docs for Elasticsearch, Kibana, and Redis. Their APIs move faster than model training data, and this repo runs all three. |
| `playwright` | Browser automation and e2e against `frontend/`. |

## Deliberately not used

- **spec-kit / speckit** (`github/spec-kit`) — a competing spec-driven workflow with
  its own `.specify/` tree and `/specify`, `/plan`, `/tasks`, `/implement` commands.
  It wants the same job as ledger-driven development. One planning spine, not two.
- **caveman's `cavecrew` skill and its three agents** — they wrap Claude Code's
  subagent tooling, which Copilot CLI does not have.
- **Claude Code plugins** generally — no Copilot equivalent. Where a plugin was worth
  keeping, its skills or rules were vendored above instead.
