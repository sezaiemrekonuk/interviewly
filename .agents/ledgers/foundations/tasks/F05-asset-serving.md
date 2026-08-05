# F05 — Edge asset route + MinIO anonymous-read policy
REPO: (this repo) · Depends: F02, F03 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — two known one-line infra defects with a curl-verifiable outcome.

## Goal
Every `/assets/*` request 404'd (later 403'd) in the composed stack, so no avatar or mascot
ever rendered. Found in W03, recorded as a frontend STATE blocker, unowned until now.

## Non-negotiables
- **The policy is prefix-scoped.** `uploads/*` shares the bucket and holds candidate CVs and
  job listings — signed-URL only (I12). A bucket-wide public-read policy leaks them.
- No frontend change: `mascotUrl`/`avatarUrl` already resolve the right key.

## Steps
- [x] 1. `Caddyfile` — `handle_path /assets/*` + `rewrite * /{$S3_BUCKET:interviewly}{uri}`.
- [x] 2. `compose.yaml` — pass `S3_BUCKET` (that var only) to `edge`.
- [x] 3. `seed.ts` — `publishAssetPrefixes()` (`PutBucketPolicy`, `mascot/*` + `personas/*`).

## Verification
```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d
DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly \
  S3_ENDPOINT=http://localhost:9000 npx tsx backend/prisma/seed.ts
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost/assets/mascot/wave-<sha>.webp"   # 200
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost/assets/uploads/anything.pdf"     # 403
```

## Notes
Two defects, one symptom. (1) `handle /assets/*` proxied the path unchanged, so MinIO read
`assets` as the bucket name. (2) The `CacheControl` header on each object was never enough —
MinIO denies unsigned GETs until a bucket policy allows them.

Verified: mascot 200, `personas/{id}/idle-<sha>.webp` 200, `uploads/*` **403**, landing page
renders with its mascot.

**`docker compose run --rm api npm run seed` does not work** — `tsx` is a devDependency and the
api image is pruned, so it exits `sh: tsx: not found`. EXECUTE.md § Local environment documents
that command; run the seed from the host against the dev overlay's published ports instead
(above). Fixing the image or the documented command is a separate call.
