---
task: F05
author: Sezai
sessions: [2026-08-05]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 1
tools: [caveman, ponytail]
---

## Session 1 — 2026-08-05

### What I asked for / what came back
- Ask: "I only see Loading… at http://localhost", then "fix the foundation work".
- First finding was not a bug: the `web` image was built 2026-08-03, the landing page landed
  2026-08-04 (`c8fbb39`). The container was serving W02's placeholder `<main>{t("loading")}</main>`.
  Rebuild fixed it; nothing to change in code.
- Second was the real one: the recorded `/assets/*` blocker (found in W03, unowned since).

### Methodology trace
- `curl http://localhost/assets/mascot/wave-<sha>.webp` → MinIO read `assets` as the bucket name.
  `handle` → `handle_path` + `rewrite * /{$S3_BUCKET:interviewly}{uri}`.
- Still 403 after the route fix — the object `CacheControl` header never granted anonymous read.
  Added `PutBucketPolicy` in `seed.ts`.
- Verified: mascot 200, persona avatar 200, `uploads/*` **403**, landing renders.
- Gates: `docker compose config -q`, lint, typecheck, `npm test` (280) green.

### Friction
- `docker compose run --rm api npm run seed` (documented in EXECUTE.md) fails: `sh: tsx: not
  found` — devDependency, pruned image. Seeded from the host against the dev overlay's ports.
- Ran `docker compose up -d web edge` **without** the dev overlay, which recreated db/cache/
  bucket/api with their host ports gone. Restored with the two-file invocation. Told the user.

### What I rejected and rewrote by hand
- **A bucket-wide public-read policy** (the obvious `s3:GetObject` on `arn:.../*`). `uploads/*`
  lives in the same bucket and holds candidate CVs — that policy would have published them.
  Scoped to `mascot/*` and `personas/*`, and added the 403 assertion to the verification.
- **`env_file: [.env]` on the `edge` service** — one variable is needed, the file carries the S3
  credentials and the session secret. Passed `S3_BUCKET` alone.
- **Hardcoding `/interviewly`** in the Caddyfile — `{$S3_BUCKET:interviewly}` keeps it one source.
