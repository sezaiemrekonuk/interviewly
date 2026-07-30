# F04 — Local pre-commit hooks (husky + lint-staged) for backend, frontend, packages
REPO: (this repo) · Depends: F03 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — mechanical tooling wiring over an existing spec (this file), same
risk profile as F01/F03: deterministic, cheaply verified by running a hook and checking the exit
code.

## Goal
Owner's ask:

> "Add as a real task, I will execute it to organize a pre-commit hook for code writable
> places such as backend, frontend."
> — Sezai, 2026-07-30 (this session)

Today the only enforcement of lint/typecheck is CI, after a push (`.github/workflows/ci.yml`).
There is no local git hook anywhere in the repo — no `husky`, no `lint-staged`, no
`.pre-commit-config.yaml`, and `.agents/docs/IDEA.md` never mentions one. `commitlint.config.js`
exists but is only invoked in CI's `lint` job (`npx commitlint --from <base-sha>`), never
locally. This task wires a local `pre-commit` git hook via husky + lint-staged that lints (and
typechecks, where cheap) staged files in every code-writable workspace — `backend/`,
`frontend/`, `packages/*/`, `worker/` — before a commit is allowed to land, so a broken commit
is caught in seconds instead of at the next CI run.

## Non-negotiables
- **The hook runs on staged files only**, via `lint-staged` — never a full-repo lint/typecheck
  on every commit. A hook slow enough to make people reach for `--no-verify` is worse than no
  hook.
- **No second, divergent lint config.** `frontend/` already lints itself cleanly
  (`npm run -w frontend lint`, `create-next-app`'s `eslint.config.mjs`) — reuse it. `backend/`,
  `worker/`, and `packages/*/` have **no lint script and no ESLint config at all** yet; this
  task creates exactly one root-level flat config for them, not one per workspace.
- **The hook is a fast local pre-check, not a CI replacement.** CI (`lint`, `typecheck`, `unit`,
  `acceptance` jobs) stays the authority; the hook only needs to catch what CI would catch
  anyway, earlier.
- **`docker compose up` on a clean clone still works with no manual step** (IDEA.md §10,
  `foundations` PLAN.md invariant) — none of this task's changes are runtime code, so this is
  trivially preserved, but don't add a `postinstall` step that requires network access or fails
  in the Docker build stage (`npm ci` runs there too; `husky install` must no-op or be skipped
  in a non-git, non-dev context — see Step 3's guard).
- **Never bypass or weaken `commitlint`.** This task adds a **second** hook (`pre-commit`,
  lint-staged) alongside whatever already validates commit messages in CI; it does not touch
  `commitlint.config.js` or add a `commit-msg` hook unless explicitly asked (out of scope below
  covers this).

## Context (anchors)
- `package.json` (root) — `"lint": "eslint . --ext .ts,.tsx"` is wired but **currently crashes**:
  no root `eslint.config.js` exists (confirmed this session — `npm run lint` at repo root fails
  with "ESLint couldn't find an eslint.config file"). This task must fix that as a prerequisite:
  a pre-commit hook cannot lint backend/worker/packages files without a working root lint
  command. Add `husky`, `lint-staged` to root `devDependencies`; add a `"prepare": "husky"`
  script (the standard husky v9 install hook, runs on `npm install`).
- `backend/package.json` — **no `"lint"` script exists.** Add one once the root ESLint config
  covers `backend/src/**`; `"lint": "eslint ."` run from `backend/` (or just rely on the root
  config + lint-staged calling `eslint` directly on staged file paths — either is fine, pick one
  and be consistent with `packages/*` and `worker/`).
- `frontend/package.json` — already has a working `"lint": "eslint"` and its own
  `eslint.config.mjs` (Next.js flat config, `eslint-config-next`). **Do not create a second
  config for `frontend/`** — lint-staged should shell out to `npm run -w frontend lint` (or
  `eslint` from within `frontend/`) for files under `frontend/**`, not the root config.
- `packages/types/`, `packages/ai/` — workspace packages, currently no lint script. Cover them
  with the same root ESLint config as `backend/`.
- `worker/` — referenced in root `workspaces` array (`package.json`) and in Dockerfile
  comments, but **does not exist yet** as a directory in this repo. Write the config so it
  covers `worker/src/**` once that workspace lands (a glob pattern, not a hard dependency on the
  directory existing today) — do not fail if `worker/` is absent.
- `.agents/ledgers/foundations/STATE.md` → `## Backlog` — this task closes the **first** of the
  two backlog items logged there this session ("Root `eslint.config.js` missing"). Remove that
  backlog line when this task is `done`. The **second** item ("Root `\"test\"` script missing")
  is unrelated (no test runner involved in linting) — leave it; do not fold it in here.
- `commitlint.config.js` (root) — already exists, already wired into CI. Read it, don't edit it,
  unless Step 4 finds it genuinely needs a local `commit-msg` hook too (see Out of scope).

## Steps
- [ ] **1. Root ESLint flat config** — create `eslint.config.js` at repo root covering
  `backend/src/**/*.ts`, `packages/*/src/**/*.ts`, `worker/src/**/*.ts` (glob; fine if the
  directory doesn't exist). Use `@typescript-eslint` (already a root `devDependency`) with a
  reasonable recommended ruleset. **Explicitly ignore `frontend/**`** (it lints itself),
  `**/dist/**`, `**/.next/**`, `**/node_modules/**`, `packages/types/dist/**`.
- [ ] **2. Fix `npm run lint` at root** — confirm `npm run lint` (root) now exits 0 on the
  current tree (or fails only on genuine lint violations, none of which should exist yet).
- [ ] **3. Install husky + lint-staged** — `npm install -D husky lint-staged` at root; add
  `"prepare": "husky"` to root `package.json` scripts; run `npx husky init` (or the
  equivalent manual `.husky/pre-commit` file creation for husky v9) so `.husky/pre-commit`
  exists and runs `npx lint-staged`. Confirm the `prepare` script no-ops safely in a
  non-interactive/CI/Docker-build context (husky v9's generated hook already does this; verify
  it, don't fight it).
- [ ] **4. Configure lint-staged** — add a `"lint-staged"` key to root `package.json` (or a
  `.lintstagedrc.json`) mapping staged-file globs to commands, at minimum:
  - `frontend/**/*.{ts,tsx}` → `npm run -w frontend lint -- --file` (or equivalent scoped
    invocation — check what `eslint-config-next`'s CLI actually accepts; fall back to a plain
    `eslint --fix` scoped to the matched files if `--file` isn't supported)
  - `{backend,worker,packages/*}/**/*.ts` → `eslint --fix` (using the new root config)
  - Do **not** run `tsc --noEmit` per-file in lint-staged (TypeScript project-wide typecheck
    doesn't work meaningfully on a file subset) — typecheck stays a CI/manual gate
    (`npm run typecheck`), not a pre-commit one. Document this choice in `## Notes`.
- [ ] **5. Add `backend`'s missing `"lint"` script** to `backend/package.json` (and
  `packages/types/package.json`, `packages/ai/package.json` if they don't have one) pointing at
  the new root config, so `npm run -w @interviewly/backend lint` works standalone too, not just
  through lint-staged.
- [ ] **6. Remove the "Root `eslint.config.js` missing" line** from foundations `STATE.md` →
  `## Backlog` once Step 2 is verified green.
- [ ] **7. Run the `## Verification` command(s).**

## Definition of done
- `npm run lint` at repo root exits 0.
- `.husky/pre-commit` exists and invokes `lint-staged`.
- Staging a file with a deliberate lint violation under `backend/`, `frontend/`, or
  `packages/*/` and attempting `git commit` is **blocked** (non-zero exit, commit does not
  land) — verified for at least one file under `backend/` (root config) and one under
  `frontend/` (Next.js config), not just one.
- Staging a clean file and committing succeeds normally (the hook doesn't false-positive on
  passing code).
- `docker compose build` (or `npm ci` alone, if Docker isn't available in the verifying
  environment) still succeeds — the `prepare`/husky install step must not break a CI/Docker
  `npm ci` run with no `.git` directory or no TTY.
- The "Root `eslint.config.js` missing" STATE.md backlog line is gone.

## Verification
```bash
# 1. root lint is fixed
npm run lint

# 2. hook exists and is wired
test -f .husky/pre-commit && cat .husky/pre-commit

# 3. a bad file under backend/ is blocked by the hook
printf 'const unused_var_xyz = 1;\n' > backend/src/lib/__hook_test.ts
git add backend/src/lib/__hook_test.ts
git commit -m "test: this should be blocked by pre-commit" ; echo "commit exit: $?"
git reset HEAD backend/src/lib/__hook_test.ts >/dev/null 2>&1
rm -f backend/src/lib/__hook_test.ts

# 4. a bad file under frontend/ is blocked by the hook
printf 'export default function Bad() { const unused_var_xyz = 1; return null; }\n' \
  > frontend/src/app/__hook_test.tsx
git add frontend/src/app/__hook_test.tsx
git commit -m "test: this should be blocked by pre-commit" ; echo "commit exit: $?"
git reset HEAD frontend/src/app/__hook_test.tsx >/dev/null 2>&1
rm -f frontend/src/app/__hook_test.tsx

# 5. npm ci still works with no .git (simulates CI/Docker build context) — run in a scratch
#    clone or accept a `docker compose build` run as the equivalent check.
```
Expected: (1) exits 0. (2) prints the pre-commit hook contents, non-empty, calling
`lint-staged`. (3) and (4) both print a non-zero `commit exit:` — the hook blocked the commit
(and no orphan commit was created; the `git reset`/`rm` lines clean up the scratch files
either way). (5) `npm ci` / `docker compose build` succeeds unmodified from F03's baseline.

## Out of scope
- A `commit-msg` hook running `commitlint` locally. `commitlint` is already CI-enforced
  (`.github/workflows/ci.yml` → `lint` job); adding a local copy is a separate, smaller task if
  someone wants it — don't fold it into this one silently (two asks, two tasks).
- The root `"test"` script gap (`npm test` → "Missing script"). Unrelated to linting; stays its
  own `STATE.md` backlog line.
- Prettier / code formatting. Nothing in this repo's specs or ledgers currently mandates a
  formatter; don't introduce one as a side effect of wiring lint-staged. If a future task wants
  it, that's its own ADR.
- Per-file `tsc --noEmit` in the hook (see Step 4 — deliberately deferred to CI/manual
  `npm run typecheck`).

## Notes
_(fill in when the task is done: what actually happened, the exact lint-staged config chosen,
why `--file` vs plain `eslint --fix` for the frontend command, and confirmation that
`docker compose build` / `npm ci` was actually exercised in Step 3's verification, not just
assumed.)_
