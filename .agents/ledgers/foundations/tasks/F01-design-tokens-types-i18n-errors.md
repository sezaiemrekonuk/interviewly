# F01 — Creating design tokens, next-intl scaffold, error-code registry, and @interviewly/types package
REPO: (this repo) · Depends: — · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — token/i18n scaffold is deterministic from the spec table; moderate reasoning sufficient.

## Goal
Owner's ask:

> "Design tokens (§4.2), `next-intl` scaffold, the error-code registry file (§4.5),
> shared TS types package. Blocks all UI work."
> — IDEA.md §5.2 F-a

This task creates the three artefacts every feature ledger's UI layer depends on:
1. The CSS custom-property token registry that every screen uses (§4.2, `ui` spec).
2. The `next-intl` locale scaffold with English and Turkish message files (§4.5).
3. The shared error-code registry and `@interviewly/types` package (§4.5, ADR-F01).

No other task owns these; F02 (schema) and F03 (compose/CI) are fully independent — they
touch no token file, no locale file, and no `packages/types/`.

## Non-negotiables
- The token registry is the **single source** of every colour, radius, shadow, font,
  type size, spacing, and motion value. A literal hex or off-scale `px` anywhere else in
  the codebase is a defect (`ui` spec Behaviour §1).
- The error-code registry is **append-only** after this task. Feature ledgers add codes;
  they never rename or remove the ones seeded here. The codes seeded below are every
  `SCREAMING_SNAKE_CASE` code named in any approved spec's Failure modes or Contracts
  table.
- No CSS is authored in this task beyond the `:root` token block and the `next/font`
  import setup. Screens are the feature ledgers' job.
- `packages/types/` must build (`tsc`) with zero errors before the task is done.
- No display strings in `error-codes.ts` — only the code key and metadata.

## Context (anchors)
- `frontend/styles/tokens.css` — will be created; the `:root` CSS custom-property block
  (§4.2 table verbatim). Consumed by every component in the frontend.
- `frontend/src/i18n.ts` — `next-intl` routing config. Sets up the locales (`en`, `tr`)
  and the request config path.
- `frontend/src/i18n/request.ts` — per-request locale resolution (cookie → header →
  default). Used by `next-intl`'s `getRequestConfig`.
- `frontend/src/middleware.ts` — Next.js middleware that runs `next-intl`'s
  `createMiddleware`. Must match all non-API, non-asset routes.
- `frontend/messages/en.json` — English locale strings. Keys mirror error-code names
  (e.g. `"errors.EMAIL_TAKEN": "An account with this email already exists."`) plus UI
  surface keys added incrementally by feature ledgers.
- `frontend/messages/tr.json` — Turkish locale strings, same key set as `en.json`.
- `packages/types/package.json` — workspace package `@interviewly/types`, with `main`,
  `types` and `scripts.build` pointing at `tsc`.
- `packages/types/tsconfig.json` — strict TypeScript config, outputs to `dist/`.
- `packages/types/src/index.ts` — barrel: exports `ErrorCode` type union, `AvatarState`
  type, `ERROR_CODES` const (re-exported from the backend lib path after F01), and any
  shared API types that both backend and frontend bind to.
- `backend/src/lib/error-codes.ts` — the registry itself. Created here; feature ledgers
  append to it. See Steps for the exact shape.
- `package.json` (root) — must declare the `packages/types` workspace. F03 creates the
  authoritative root `package.json`; if F03 has not landed yet, F01 creates a minimal
  one that F03 will extend. Coordinate with whoever owns F03.

  **The trap:** if F03 has landed before F01, the root `package.json` already exists —
  do not overwrite it. Run `npm pkg set workspaces.0="packages/types"` or manually add
  the entry. If F01 lands first, create a minimal root `package.json` with workspaces.

## Steps
- [ ] **1. Root package.json (coordinate with F03)**
  - If `package.json` does not exist at root: create it with `name: "interviewly"`,
    `private: true`, `workspaces: ["packages/*", "frontend", "backend", "worker"]`.
  - If it already exists: ensure `packages/*` is in the `workspaces` array.

- [ ] **2. Create `packages/types/`**
  ```
  packages/types/
    package.json      name: "@interviewly/types", version: "0.0.1", main: "dist/index.js",
                      types: "dist/index.d.ts", scripts: { build: "tsc", typecheck: "tsc --noEmit" }
    tsconfig.json     extends root (or standalone strict), outDir: "dist", declaration: true
    src/
      index.ts        see Step 4
  ```

- [ ] **3. Create `backend/src/lib/error-codes.ts`**

  Shape:
  ```ts
  export type ErrorKind = 'api' | 'log' | 'boot';

  export const ERROR_CODES = {
    // --- Auth ---
    PASSWORD_TOO_SHORT:              { kind: 'api' as ErrorKind, http: 422, owner: 'backend' },
    EMAIL_TAKEN:                     { kind: 'api' as ErrorKind, http: 409, owner: 'backend' },
    VALIDATION_ERROR:                { kind: 'api' as ErrorKind, http: 422, owner: 'backend' },
    RATE_LIMITED:                    { kind: 'api' as ErrorKind, http: 429, owner: 'backend' },
    INVALID_CREDENTIALS:             { kind: 'api' as ErrorKind, http: 401, owner: 'backend' },
    UNAUTHENTICATED:                 { kind: 'api' as ErrorKind, http: 401, owner: 'backend' },
    ADMIN_MUST_USE_PASSWORD:         { kind: 'api' as ErrorKind, http: 403, owner: 'backend' },
    ACCOUNT_LINK_REQUIRES_PASSWORD:  { kind: 'api' as ErrorKind, http: 403, owner: 'backend' },
    OAUTH_STATE_MISMATCH:            { kind: 'api' as ErrorKind, http: 400, owner: 'backend' },
    FORBIDDEN:                       { kind: 'api' as ErrorKind, http: 403, owner: 'backend' },
    // --- Interview lifecycle ---
    INTERVIEW_NOT_FOUND:             { kind: 'api' as ErrorKind, http: 404, owner: 'backend' },
    QUESTION_NOT_CURRENT:            { kind: 'api' as ErrorKind, http: 409, owner: 'backend' },
    INVALID_STATE_TRANSITION:        { kind: 'api' as ErrorKind, http: 409, owner: 'backend' },
    BUDGET_EXCEEDED:                 { kind: 'api' as ErrorKind, http: 402, owner: 'backend' },
    DAILY_INTERVIEW_LIMIT:           { kind: 'api' as ErrorKind, http: 429, owner: 'backend' },
    LISTING_REQUIRED:                { kind: 'api' as ErrorKind, http: 422, owner: 'backend' },
    CSRF_ORIGIN_MISMATCH:            { kind: 'api' as ErrorKind, http: 403, owner: 'backend' },
    NOT_READY:                       { kind: 'api' as ErrorKind, http: 503, owner: 'backend' },
    // --- Upload ---
    UPLOAD_TOO_LARGE:                { kind: 'api' as ErrorKind, http: 413, owner: 'backend' },
    UNSUPPORTED_MEDIA_TYPE:          { kind: 'api' as ErrorKind, http: 415, owner: 'backend' },
    UPLOAD_TOO_MANY_PAGES:           { kind: 'api' as ErrorKind, http: 422, owner: 'backend' },
    PDF_TEXT_TOO_SHORT:              { kind: 'api' as ErrorKind, http: 422, owner: 'backend' },
    // --- AI ---
    PROVIDER_KEY_MISSING:            { kind: 'boot' as ErrorKind, http: undefined, owner: 'ai' },
    AI_PROMPT_BUILD_FAILED:          { kind: 'api' as ErrorKind, http: 500, owner: 'ai' },
    AI_PROVIDER_UNAVAILABLE:         { kind: 'api' as ErrorKind, http: 503, owner: 'ai' },
    AI_OUTPUT_INVALID:               { kind: 'api' as ErrorKind, http: 500, owner: 'ai' },
    LISTING_TRUNCATED:               { kind: 'log' as ErrorKind, http: undefined, owner: 'ai' },
    LLM_FALLBACK_TRIGGERED:          { kind: 'log' as ErrorKind, http: undefined, owner: 'ai' },
    PRICE_MISSING:                   { kind: 'log' as ErrorKind, http: undefined, owner: 'ai' },
    AI_DISABLED_STUB_MODE:           { kind: 'log' as ErrorKind, http: undefined, owner: 'ai' },
    SECURITY_PROMPT_INJECTION_SUSPECTED: { kind: 'log' as ErrorKind, http: undefined, owner: 'ai' },
    // --- Infra / boot ---
    ENV_VALIDATION_FAILED:           { kind: 'boot' as ErrorKind, http: undefined, owner: 'infra' },
    // --- Voice ---
    VOICE_UNAVAILABLE:               { kind: 'api' as ErrorKind, http: 503, owner: 'voice' },
    WEBHOOK_SIGNATURE_INVALID:       { kind: 'api' as ErrorKind, http: 401, owner: 'voice' },
    WEBHOOK_REPLAY_REJECTED:         { kind: 'api' as ErrorKind, http: 401, owner: 'voice' },
    VOICE_SESSION_INVALID:           { kind: 'api' as ErrorKind, http: 403, owner: 'voice' },
    VOICE_SESSION_EXPIRED:           { kind: 'api' as ErrorKind, http: 403, owner: 'voice' },
    // --- UI / assets ---
    AVATAR_STATE_INCOMPLETE:         { kind: 'boot' as ErrorKind, http: undefined, owner: 'ui' },
    AVATAR_KEY_MISMATCH:             { kind: 'boot' as ErrorKind, http: undefined, owner: 'ui' },
  } as const;

  export type ErrorCode = keyof typeof ERROR_CODES;
  ```

  39 codes total. Log-kind codes (`kind: 'log'`) are internal observability signals —
  they never appear in an API response body, but the frontend may need to handle them if
  they surface through a server error in a future edge case. Boot-kind codes cause process
  exit before serving.

- [ ] **4. Create `packages/types/src/index.ts`**
  ```ts
  export type { ErrorCode, ErrorKind } from '../../backend/src/lib/error-codes';
  export { ERROR_CODES } from '../../backend/src/lib/error-codes';

  export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'acknowledging';

  // Shared API response envelope — used by both backend and frontend
  export interface ApiError { error: { code: ErrorCode; message?: string } }
  ```

  Add any additional shared types (e.g. `UserRole`, pagination shapes) that both
  `backend` and `frontend` import. Keep it minimal — only what is genuinely shared.

- [ ] **5. Create `frontend/styles/tokens.css`** with the exact §4.2 values:
  ```css
  :root {
    /* Colours */
    --bg:              #FBF9F6;
    --surface:         #FFFFFF;
    --surface-sunken:  #F4F2EE;
    --text:            #111436;
    --text-muted:      #6B6F8D;
    --primary:         #FF6100;
    --primary-soft:    #FFF1E8;
    --accent:          #6F76F1;
    --success:         #10B981;
    --warning:         #F59E0B;
    --danger:          #EF4444;
    --border:          #E8E4DE;

    /* Radius */
    --radius-card:     12px;
    --radius-input:    10px;
    --radius-button:   999px;

    /* Shadow */
    --shadow-sm:       0 1px 2px rgba(0,0,0,.08);

    /* Motion */
    --duration-default: 200ms;
    --easing-default:   ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    :root {
      --duration-default: 0ms;
    }
  }
  ```

- [ ] **6. Install and configure `next-intl`**
  - Add `next-intl` to `frontend/package.json` dependencies.
  - Create `frontend/src/i18n.ts`:
    ```ts
    import { notFound } from 'next/navigation';
    import { getRequestConfig } from 'next-intl/server';

    const locales = ['en', 'tr'] as const;
    export type Locale = typeof locales[number];

    export default getRequestConfig(async ({ requestLocale }) => {
      const locale = (await requestLocale) ?? process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en';
      if (!locales.includes(locale as Locale)) notFound();
      return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
      };
    });
    ```
  - Create `frontend/src/i18n/request.ts` as the `next-intl` server-side request config
    (delegates to `i18n.ts`).
  - Create `frontend/src/middleware.ts` using `createMiddleware` from `next-intl/middleware`
    with `locales: ['en', 'tr']`, `defaultLocale: 'en'`, and cookie-based detection.
    Matcher: all routes except `/api/*`, `/_next/*`, `/assets/*`, `.*\\..*` (static files).
  - Add `next-intl` plugin to `frontend/next.config.ts` (or `.js`).

- [ ] **7. Create locale message files**
  - `frontend/messages/en.json` — seed the error-code keys:
    ```json
    {
      "errors": {
        "PASSWORD_TOO_SHORT": "Password must be at least 10 characters.",
        "EMAIL_TAKEN": "An account with this email already exists.",
        "VALIDATION_ERROR": "The request is invalid. Please check your input.",
        "RATE_LIMITED": "Too many requests. Please try again shortly.",
        "INVALID_CREDENTIALS": "Email or password is incorrect.",
        "UNAUTHENTICATED": "Please sign in to continue.",
        "ADMIN_MUST_USE_PASSWORD": "Admin accounts must sign in with email and password.",
        "ACCOUNT_LINK_REQUIRES_PASSWORD": "Please sign in with your password first to link this account.",
        "OAUTH_STATE_MISMATCH": "Sign-in session expired. Please try again.",
        "FORBIDDEN": "You do not have permission to access this.",
        "INTERVIEW_NOT_FOUND": "Interview not found.",
        "QUESTION_NOT_CURRENT": "This question is no longer current. Refreshing…",
        "INVALID_STATE_TRANSITION": "This action is not available right now. Refreshing…",
        "BUDGET_EXCEEDED": "Interview budget reached. Your report is being prepared.",
        "DAILY_INTERVIEW_LIMIT": "You have reached the daily interview limit. Please try again tomorrow.",
        "LISTING_REQUIRED": "Please provide a job listing to start an interview.",
        "CSRF_ORIGIN_MISMATCH": "Request blocked. Please use the application normally.",
        "NOT_READY": "Service is not ready. Please try again in a moment.",
        "UPLOAD_TOO_LARGE": "File must be under 10 MB.",
        "UNSUPPORTED_MEDIA_TYPE": "Only PDF files are accepted.",
        "UPLOAD_TOO_MANY_PAGES": "PDF must be 30 pages or fewer.",
        "PDF_TEXT_TOO_SHORT": "Could not extract text from this PDF. Please paste the listing text instead.",
        "PROVIDER_KEY_MISSING": "A required API key is missing. Please check your configuration.",
        "AI_PROMPT_BUILD_FAILED": "An internal error occurred preparing your request.",
        "AI_PROVIDER_UNAVAILABLE": "AI service is temporarily unavailable. Your interview is paused.",
        "AI_OUTPUT_INVALID": "An internal error occurred processing the AI response.",
        "ENV_VALIDATION_FAILED": "Server configuration is incomplete.",
        "VOICE_UNAVAILABLE": "Voice mode is not available for this interview.",
        "WEBHOOK_SIGNATURE_INVALID": "Webhook rejected: invalid signature.",
        "WEBHOOK_REPLAY_REJECTED": "Webhook rejected: replayed request.",
        "VOICE_SESSION_INVALID": "Voice session is invalid.",
        "VOICE_SESSION_EXPIRED": "Voice session has expired.",
        "AVATAR_STATE_INCOMPLETE": "Persona avatar set is incomplete.",
        "AVATAR_KEY_MISMATCH": "Persona avatar key does not match content.",
        "UNKNOWN": "An unexpected error occurred."
      }
    }
    ```
  - `frontend/messages/tr.json` — Turkish translations of every key above. Provide
    accurate Turkish strings; do not leave any key untranslated.

- [ ] **8. Verify token contrast pairs (informational check)**
  Compute contrast ratios for the pinned pairs from `ui` spec Behaviour §3:
  `--text` (#111436) / `--bg` (#FBF9F6), `--text` / `--surface` (#FFF), `--text` /
  `--surface-sunken` (#F4F2EE), `--text-muted` (#6B6F8D) / `--bg`, `--text-muted` /
  `--surface`, white (#FFF) / `--primary` (#FF6100). All must be ≥ 4.5:1. Document
  the computed ratios in `## Notes`. If any pair fails, adjust the token value and
  record the change in `## Notes` — the §4.2 values are the target, but contrast is the
  hard floor.

- [ ] **9. Build `@interviewly/types`**
  ```bash
  npm install  # from repo root, to link workspaces
  npm run -w @interviewly/types build
  ```
  Zero TypeScript errors required. Fix any type errors before proceeding.

- [ ] **10. Update root `tsconfig.json` (if it exists) or create it**
  Add path alias `"@interviewly/types": ["packages/types/src/index.ts"]` so `tsc` from
  the root resolves the package during typecheck without requiring a build step.

## Definition of done
- `packages/types/` builds (`npm run -w @interviewly/types build`) with zero errors.
- `frontend/styles/tokens.css` contains all 12 colour tokens and the non-colour tokens
  from §4.2 as `:root` custom properties with exact values.
- `frontend/messages/en.json` contains all 39 error codes under `"errors"` key, plus
  at least one non-error UI key (e.g. `"common.loading": "Loading…"`).
- `frontend/messages/tr.json` has the same key set as `en.json`, all translated.
- `backend/src/lib/error-codes.ts` has exactly 39 codes as defined in Step 3.
- `packages/types/src/index.ts` re-exports `ErrorCode`, `ERROR_CODES`, and `AvatarState`.
- `frontend/src/middleware.ts` exists and uses `createMiddleware` from `next-intl`.
- No literal hex colour, off-scale type size (`px` not in `13/14/16/20/28/40`), or
  spacing not a multiple of 4 appears outside `tokens.css`.

## Verification
```bash
npm run -w @interviewly/types build
```

The build must exit 0. Then confirm:

```bash
# Count error codes — should print 39
node -e "const ec = require('./backend/src/lib/error-codes'); console.log(Object.keys(ec.ERROR_CODES).length)"

# Confirm token file has all 12 colour vars
grep -c "^  --" frontend/styles/tokens.css
```

Expected: `build` exits 0; error-code count ≥ 39; token var count ≥ 16 (12 colours + 4+
non-colour tokens).

## Notes

(Empty until the task is done. Fill with: what actually happened, every deviation from
the plan, the `build` output verbatim, the computed contrast ratios for the 6 pinned
pairs, what was deliberately NOT done and why, and a "For feature ledgers" hand-off
paragraph noting where to append new error codes and locale keys.)
