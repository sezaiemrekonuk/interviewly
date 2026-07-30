# I15 — Config: extend the env schema with this ledger's keys, fail-fast
REPO: (this repo) · Depends: F03 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — a Zod schema extension over the F03 env base. Mechanical, but the fail-fast-before-serving guarantee is a real contract.

## Goal
Owner's ask:

> "Extend `env.ts`'s Zod schema with this ledger's required keys (`S3_BUCKET`,
> `PUBLIC_ORIGIN`, `REDIS_URL`, `AI_ENABLED`, provider keys, storage endpoint/credentials);
> a missing or malformed one fails startup before serving with `ENV_VALIDATION_FAILED`
> naming the offending var. Scenario AC-5 in `config.feature` green."
> — interview-core decomposition (§7.4, ADR-I05 mode gate)

F03 owns the base `env.ts` fail-fast validator; this task **adds** keys to its schema and owns
the green run. It does not rewrite the base validator.

## Security boundaries
- **Fail closed at boot.** A missing or malformed required var stops startup **before any
  request is served** (`config.feature` @AC-5), so the API never runs with half-configured
  secrets or a wrong origin.
- **Never echo secret values** in the boot error — name the var (e.g. `REDIS_URL`), not its
  value.

## Non-negotiables
- **Each required key is validated** with the right shape: `REDIS_URL` a valid URL,
  `PUBLIC_ORIGIN` a valid origin URL, `S3_BUCKET` a non-empty string, plus `AI_ENABLED`,
  the provider keys, and the storage endpoint/credentials. A malformed `REDIS_URL` or
  `PUBLIC_ORIGIN`, or an unset `S3_BUCKET`, fails boot (`config.feature` @AC-5 examples).
- **The boot error is `ENV_VALIDATION_FAILED` and names the offending key.** Startup fails
  before serving; no request is handled. With every required var valid, startup serves and
  raises no `ENV_VALIDATION_FAILED`.
- **Add, do not rewrite.** Extend F03's existing Zod object; keep its base keys
  (`DATABASE_URL`, etc.) and its fail-fast wiring intact.

## Context (anchors)
- `backend/src/lib/env.ts` — F03. The base Zod schema + fail-fast `ENV_VALIDATION_FAILED`
  boot. **Extend** the schema with this ledger's keys; reuse the existing parse-or-exit path
  so a new invalid key is named the same way.
- `backend/src/lib/error-codes.ts` — F01. `ENV_VALIDATION_FAILED` (confirm present).
- `.env.example` / `compose.yaml` — F03. Add the new keys with placeholder/dev values so a
  valid full set boots.
- Consumers: `storage.ts` (I12: `S3_BUCKET`, endpoint, credentials), `rate-limit.ts`/probes
  (`REDIS_URL`), CSRF/origin (I05: `PUBLIC_ORIGIN`), `ai` client (I02: `AI_ENABLED`, provider
  keys).

  **The trap:** F03 already wired the parse-or-exit. Do **not** add a second validator or a
  second exit path — extend the one Zod object F03 defined so every key (base + new) is
  reported through the same `ENV_VALIDATION_FAILED` boot error. A duplicated validator would
  let one path serve while the other rejects.

## Steps
- [ ] **1. Extend the Zod schema** in `env.ts` with `S3_BUCKET`, `PUBLIC_ORIGIN`, `REDIS_URL`,
  `AI_ENABLED`, provider keys, storage endpoint/credentials — each with its shape.
- [ ] **2. Confirm the single fail-fast path** names any invalid key via
  `ENV_VALIDATION_FAILED` before serving (reuse F03's parse-or-exit; add nothing parallel).
- [ ] **3. Add the new keys** to `.env.example` / `compose.yaml` with valid dev values.
- [ ] **4. Wire acceptance step-defs** for `config.feature` @AC-5 (unset `DATABASE_URL`,
  malformed `REDIS_URL`, unset `S3_BUCKET`, malformed `PUBLIC_ORIGIN` each → boot fails before
  serving with `ENV_VALIDATION_FAILED` naming the key; a full valid set serves and raises no
  boot error).
- [ ] **5. Run the `## Verification` command.**

## Definition of done
- Every required key (base F03 + this ledger's) is validated by the single Zod schema; a
  missing/malformed one fails startup before serving with `ENV_VALIDATION_FAILED` naming it.
- A fully valid env set boots and serves with no `ENV_VALIDATION_FAILED`; no secret value is
  echoed in a boot error.

## Verification
```bash
npm run test:acceptance -- --tags "@config"
```

## Notes
_(fill in when the task is done)_
