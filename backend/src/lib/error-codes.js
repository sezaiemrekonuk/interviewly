"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_CODES = void 0;
exports.ERROR_CODES = {
    // --- Auth ---
    PASSWORD_TOO_SHORT: { kind: 'api', http: 422, owner: 'backend' },
    EMAIL_TAKEN: { kind: 'api', http: 409, owner: 'backend' },
    VALIDATION_ERROR: { kind: 'api', http: 422, owner: 'backend' },
    RATE_LIMITED: { kind: 'api', http: 429, owner: 'backend' },
    INVALID_CREDENTIALS: { kind: 'api', http: 401, owner: 'backend' },
    UNAUTHENTICATED: { kind: 'api', http: 401, owner: 'backend' },
    ADMIN_MUST_USE_PASSWORD: { kind: 'api', http: 403, owner: 'backend' },
    ACCOUNT_LINK_REQUIRES_PASSWORD: { kind: 'api', http: 403, owner: 'backend' },
    OAUTH_STATE_MISMATCH: { kind: 'api', http: 400, owner: 'backend' },
    FORBIDDEN: { kind: 'api', http: 403, owner: 'backend' },
    // --- Interview lifecycle ---
    INTERVIEW_NOT_FOUND: { kind: 'api', http: 404, owner: 'backend' },
    QUESTION_NOT_CURRENT: { kind: 'api', http: 409, owner: 'backend' },
    INVALID_STATE_TRANSITION: { kind: 'api', http: 409, owner: 'backend' },
    BUDGET_EXCEEDED: { kind: 'api', http: 402, owner: 'backend' },
    DAILY_INTERVIEW_LIMIT: { kind: 'api', http: 429, owner: 'backend' },
    LISTING_REQUIRED: { kind: 'api', http: 422, owner: 'backend' },
    CSRF_ORIGIN_MISMATCH: { kind: 'api', http: 403, owner: 'backend' },
    NOT_READY: { kind: 'api', http: 503, owner: 'backend' },
    // --- Upload ---
    UPLOAD_TOO_LARGE: { kind: 'api', http: 413, owner: 'backend' },
    UNSUPPORTED_MEDIA_TYPE: { kind: 'api', http: 415, owner: 'backend' },
    UPLOAD_TOO_MANY_PAGES: { kind: 'api', http: 422, owner: 'backend' },
    PDF_TEXT_TOO_SHORT: { kind: 'api', http: 422, owner: 'backend' },
    // --- AI ---
    PROVIDER_KEY_MISSING: { kind: 'boot', http: undefined, owner: 'ai' },
    AI_PROMPT_BUILD_FAILED: { kind: 'api', http: 500, owner: 'ai' },
    AI_PROVIDER_UNAVAILABLE: { kind: 'api', http: 503, owner: 'ai' },
    AI_OUTPUT_INVALID: { kind: 'api', http: 500, owner: 'ai' },
    LISTING_TRUNCATED: { kind: 'log', http: undefined, owner: 'ai' },
    LLM_FALLBACK_TRIGGERED: { kind: 'log', http: undefined, owner: 'ai' },
    PRICE_MISSING: { kind: 'log', http: undefined, owner: 'ai' },
    AI_DISABLED_STUB_MODE: { kind: 'log', http: undefined, owner: 'ai' },
    SECURITY_PROMPT_INJECTION_SUSPECTED: { kind: 'log', http: undefined, owner: 'ai' },
    // --- Infra / boot ---
    ENV_VALIDATION_FAILED: { kind: 'boot', http: undefined, owner: 'infra' },
    // --- Voice ---
    VOICE_UNAVAILABLE: { kind: 'api', http: 503, owner: 'voice' },
    WEBHOOK_SIGNATURE_INVALID: { kind: 'api', http: 401, owner: 'voice' },
    WEBHOOK_REPLAY_REJECTED: { kind: 'api', http: 401, owner: 'voice' },
    VOICE_SESSION_INVALID: { kind: 'api', http: 403, owner: 'voice' },
    VOICE_SESSION_EXPIRED: { kind: 'api', http: 403, owner: 'voice' },
    // --- UI / assets ---
    AVATAR_STATE_INCOMPLETE: { kind: 'boot', http: undefined, owner: 'ui' },
    AVATAR_KEY_MISMATCH: { kind: 'boot', http: undefined, owner: 'ui' },
    MASCOT_POSE_INCOMPLETE: { kind: 'boot', http: undefined, owner: 'ui' },
    // --- Account lifecycle (K8.6) ---
    EMAIL_NOT_VERIFIED: { kind: 'api', http: 403, owner: 'backend' },
    EMAIL_TOKEN_INVALID: { kind: 'api', http: 400, owner: 'backend' },
    EMAIL_TOKEN_EXPIRED: { kind: 'api', http: 400, owner: 'backend' },
    EMAIL_RESEND_COOLDOWN: { kind: 'api', http: 429, owner: 'backend' },
    // --- Profile / CV (K8.7, §3.3) ---
    CV_TRUNCATED: { kind: 'log', http: undefined, owner: 'backend' },
    PROFILE_DOB_STRIPPED: { kind: 'log', http: undefined, owner: 'ai' },
};
