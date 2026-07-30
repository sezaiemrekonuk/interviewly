export type ErrorKind = 'api' | 'log' | 'boot';
export declare const ERROR_CODES: {
    readonly PASSWORD_TOO_SHORT: {
        readonly kind: ErrorKind;
        readonly http: 422;
        readonly owner: "backend";
    };
    readonly EMAIL_TAKEN: {
        readonly kind: ErrorKind;
        readonly http: 409;
        readonly owner: "backend";
    };
    readonly VALIDATION_ERROR: {
        readonly kind: ErrorKind;
        readonly http: 422;
        readonly owner: "backend";
    };
    readonly RATE_LIMITED: {
        readonly kind: ErrorKind;
        readonly http: 429;
        readonly owner: "backend";
    };
    readonly INVALID_CREDENTIALS: {
        readonly kind: ErrorKind;
        readonly http: 401;
        readonly owner: "backend";
    };
    readonly UNAUTHENTICATED: {
        readonly kind: ErrorKind;
        readonly http: 401;
        readonly owner: "backend";
    };
    readonly ADMIN_MUST_USE_PASSWORD: {
        readonly kind: ErrorKind;
        readonly http: 403;
        readonly owner: "backend";
    };
    readonly ACCOUNT_LINK_REQUIRES_PASSWORD: {
        readonly kind: ErrorKind;
        readonly http: 403;
        readonly owner: "backend";
    };
    readonly OAUTH_STATE_MISMATCH: {
        readonly kind: ErrorKind;
        readonly http: 400;
        readonly owner: "backend";
    };
    readonly FORBIDDEN: {
        readonly kind: ErrorKind;
        readonly http: 403;
        readonly owner: "backend";
    };
    readonly INTERVIEW_NOT_FOUND: {
        readonly kind: ErrorKind;
        readonly http: 404;
        readonly owner: "backend";
    };
    readonly QUESTION_NOT_CURRENT: {
        readonly kind: ErrorKind;
        readonly http: 409;
        readonly owner: "backend";
    };
    readonly INVALID_STATE_TRANSITION: {
        readonly kind: ErrorKind;
        readonly http: 409;
        readonly owner: "backend";
    };
    readonly BUDGET_EXCEEDED: {
        readonly kind: ErrorKind;
        readonly http: 402;
        readonly owner: "backend";
    };
    readonly DAILY_INTERVIEW_LIMIT: {
        readonly kind: ErrorKind;
        readonly http: 429;
        readonly owner: "backend";
    };
    readonly LISTING_REQUIRED: {
        readonly kind: ErrorKind;
        readonly http: 422;
        readonly owner: "backend";
    };
    readonly CSRF_ORIGIN_MISMATCH: {
        readonly kind: ErrorKind;
        readonly http: 403;
        readonly owner: "backend";
    };
    readonly NOT_READY: {
        readonly kind: ErrorKind;
        readonly http: 503;
        readonly owner: "backend";
    };
    readonly UPLOAD_TOO_LARGE: {
        readonly kind: ErrorKind;
        readonly http: 413;
        readonly owner: "backend";
    };
    readonly UNSUPPORTED_MEDIA_TYPE: {
        readonly kind: ErrorKind;
        readonly http: 415;
        readonly owner: "backend";
    };
    readonly UPLOAD_TOO_MANY_PAGES: {
        readonly kind: ErrorKind;
        readonly http: 422;
        readonly owner: "backend";
    };
    readonly PDF_TEXT_TOO_SHORT: {
        readonly kind: ErrorKind;
        readonly http: 422;
        readonly owner: "backend";
    };
    readonly PROVIDER_KEY_MISSING: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ai";
    };
    readonly AI_PROMPT_BUILD_FAILED: {
        readonly kind: ErrorKind;
        readonly http: 500;
        readonly owner: "ai";
    };
    readonly AI_PROVIDER_UNAVAILABLE: {
        readonly kind: ErrorKind;
        readonly http: 503;
        readonly owner: "ai";
    };
    readonly AI_OUTPUT_INVALID: {
        readonly kind: ErrorKind;
        readonly http: 500;
        readonly owner: "ai";
    };
    readonly LISTING_TRUNCATED: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ai";
    };
    readonly LLM_FALLBACK_TRIGGERED: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ai";
    };
    readonly PRICE_MISSING: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ai";
    };
    readonly AI_DISABLED_STUB_MODE: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ai";
    };
    readonly SECURITY_PROMPT_INJECTION_SUSPECTED: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ai";
    };
    readonly ENV_VALIDATION_FAILED: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "infra";
    };
    readonly VOICE_UNAVAILABLE: {
        readonly kind: ErrorKind;
        readonly http: 503;
        readonly owner: "voice";
    };
    readonly WEBHOOK_SIGNATURE_INVALID: {
        readonly kind: ErrorKind;
        readonly http: 401;
        readonly owner: "voice";
    };
    readonly WEBHOOK_REPLAY_REJECTED: {
        readonly kind: ErrorKind;
        readonly http: 401;
        readonly owner: "voice";
    };
    readonly VOICE_SESSION_INVALID: {
        readonly kind: ErrorKind;
        readonly http: 403;
        readonly owner: "voice";
    };
    readonly VOICE_SESSION_EXPIRED: {
        readonly kind: ErrorKind;
        readonly http: 403;
        readonly owner: "voice";
    };
    readonly AVATAR_STATE_INCOMPLETE: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ui";
    };
    readonly AVATAR_KEY_MISMATCH: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ui";
    };
    readonly MASCOT_POSE_INCOMPLETE: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ui";
    };
    readonly EMAIL_NOT_VERIFIED: {
        readonly kind: ErrorKind;
        readonly http: 403;
        readonly owner: "backend";
    };
    readonly EMAIL_TOKEN_INVALID: {
        readonly kind: ErrorKind;
        readonly http: 400;
        readonly owner: "backend";
    };
    readonly EMAIL_TOKEN_EXPIRED: {
        readonly kind: ErrorKind;
        readonly http: 400;
        readonly owner: "backend";
    };
    readonly EMAIL_RESEND_COOLDOWN: {
        readonly kind: ErrorKind;
        readonly http: 429;
        readonly owner: "backend";
    };
    readonly CV_TRUNCATED: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "backend";
    };
    readonly PROFILE_DOB_STRIPPED: {
        readonly kind: ErrorKind;
        readonly http: undefined;
        readonly owner: "ai";
    };
};
export type ErrorCode = keyof typeof ERROR_CODES;
