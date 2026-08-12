# P01 — GHCR: three images, one sha, both targets
REPO: (this repo) · Depends: — · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-5** — a workflow file against three Dockerfiles that already build. One
trap, and `compose.yaml` documents it in the block you will copy from.

## Goal
Owner's ask:

> If I want to deploy my system in fly and use also kuberneets and with fake routing show my
> scale level and note it in docs what would i need

Two deploy targets need the same bytes or their tables cannot be compared (ADR-P06). This task
publishes `api`, `worker` and `web` to GHCR tagged with the commit sha. P05 deploys that tag to
Fly; P07 side-loads the same digest into kind.

Reinstates the image registry IDEA.md §11.5 cut. It was cut because there was no deploy target;
there are two now.

## Non-negotiables
- **`NEXT_PUBLIC_ASSETS_PREFIX`, `NEXT_PUBLIC_MASCOT_SHA256` and `NEXT_PUBLIC_DEFAULT_LOCALE` are
  build arguments.** Next inlines them at build time, so a value supplied at run time is already
  too late and the image ships the source fallbacks — a broken mascot and the wrong default
  locale, visible on the first page load and not on any test. `compose.yaml`'s `web.build.args`
  block explains this at length; read it before writing the `web` build step.
- **Fail the build when one is missing, do not default it.** compose uses `${VAR:?message}` so a
  stack that cannot name these values cannot start. The workflow gets the same posture: a missing
  key is a red job, never a silent fallback.
- **This is a new workflow file, not a job in `ci.yml`.** Image publishing must never gate a pull
  request; `ci.yml`'s five jobs (`static`, `build`, `unit`, `acceptance`, `audit`) stay as they
  are.
- **Tag with the full commit sha, and also `latest` on `master`.** The sha is what makes P06's and
  P08's tables comparable; `latest` is a convenience that no measurement run may use.
- **No `Dockerfile` edits.** If an image cannot be built by this workflow as it stands, that is a
  finding for `## Notes`, not a licence to change the build.

## Context (anchors)
- `backend/Dockerfile` — `EXPOSE 4000`, `CMD ["node","backend/dist/src/index.js"]`. Build context
  is the **repo root** (`compose.yaml` sets `context: .`), not `backend/`.
- `worker/Dockerfile` — `CMD ["node","worker/dist/index.js"]`. Same root context.
- `frontend/Dockerfile` — `EXPOSE 3000`, `CMD ["node","frontend/server.js"]`. Next standalone
  output; the comment at the head explains why the entry point path looks the way it does.
- `compose.yaml` → `web.build.args` — the three `NEXT_PUBLIC_*` values and the `:?` posture, with
  the reasoning. Copy the intent, not the syntax.
- `package.json` → `prepare` — `husky || true`, present because `npm ci --omit=dev` runs it with
  husky already uninstalled. Nothing to do here; do not "fix" it when a build log mentions it.
- `.github/workflows/ci.yml` — the existing job set, for style and for the runner version.
- `.dockerignore` — already exists; check what it excludes before wondering why a file is absent.

## Steps
- [ ] Write `.github/workflows/images.yml`: trigger on push to `master` and on
      `workflow_dispatch`, permissions `contents: read` + `packages: write`, log in to
      `ghcr.io` with `GITHUB_TOKEN`.
- [ ] Three build-and-push steps (or a matrix) for `api`, `worker`, `web` → 
      `ghcr.io/obss-ai-summer-internship-2026/interviewly-{api,worker,web}`, context `.`, tags
      `${{ github.sha }}` and `latest`.
- [ ] Pass the three `NEXT_PUBLIC_*` values to the `web` build as `build-args`, sourced from repo
      variables, and add an explicit preceding step that fails the job with a named message if any
      is empty.
- [ ] Enable GitHub Actions layer caching (`cache-from`/`cache-to: type=gha`) — three Node images
      built from scratch on every push is a slow default, not a correct one.
- [ ] Run it once via `workflow_dispatch` and confirm three packages appear under the org.
- [ ] Record in `## Notes`: the pushed sha, the three image references, and whether the packages
      defaulted to private (P07 side-loads locally, but P05's Fly pull needs them readable).

## Definition of done
- Three images exist in GHCR at the same commit sha, and `docker pull` of each succeeds from a
  clean machine given credentials.
- `docker run` of the `web` image serves a page whose asset URLs use the configured
  `NEXT_PUBLIC_ASSETS_PREFIX`, not the source fallback.
- `.github/workflows/ci.yml` is byte-for-byte unchanged.

## Verification
`gh run list --workflow=images.yml --limit 1` shows a successful run, then:

```bash
SHA=$(git rev-parse HEAD)
for i in api worker web; do
  docker pull ghcr.io/obss-ai-summer-internship-2026/interviewly-$i:$SHA
done
docker run --rm -d -p 3099:3000 --name p01check \
  ghcr.io/obss-ai-summer-internship-2026/interviewly-web:$SHA
sleep 5 && curl -sf localhost:3099 | grep -o '/assets/[^"]*' | head -3
docker rm -f p01check
```

Expect: three pulls succeed, and the `grep` prints asset paths carrying the configured prefix. An
empty `grep` result means the page did not render, not that the prefix is absent — check the
container logs before concluding either way.

## Notes
