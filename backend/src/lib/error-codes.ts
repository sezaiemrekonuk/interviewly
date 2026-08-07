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
  // --- Report ledger recovery (issue 081) ---
  // Both are refusals of POST /admin/interviews/:id/report/requeue, and both are 409 because
  // the request is well-formed and the interview exists — only the moment is wrong.
  REPORT_ALREADY_EXISTS:           { kind: 'api' as ErrorKind, http: 409, owner: 'backend' },
  REPORT_JOB_RUNNING:              { kind: 'api' as ErrorKind, http: 409, owner: 'backend' },
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
  // S05 removed WEBHOOK_SIGNATURE_INVALID, WEBHOOK_REPLAY_REJECTED and VOICE_SESSION_INVALID
  // with their only producer (ADR-S03). VOICE_SESSION_EXPIRED stays: the ceiling still needs it.
  VOICE_SESSION_EXPIRED:           { kind: 'api' as ErrorKind, http: 403, owner: 'voice' },
  SPEECH_AUDIO_INVALID:            { kind: 'api' as ErrorKind, http: 400, owner: 'voice' },
  SPEECH_TRANSCRIPTION_FAILED:     { kind: 'api' as ErrorKind, http: 502, owner: 'voice' },
  // --- UI / assets ---
  AVATAR_STATE_INCOMPLETE:         { kind: 'boot' as ErrorKind, http: undefined, owner: 'ui' },
  AVATAR_KEY_MISMATCH:             { kind: 'boot' as ErrorKind, http: undefined, owner: 'ui' },
  MASCOT_POSE_INCOMPLETE:          { kind: 'boot' as ErrorKind, http: undefined, owner: 'ui' },
  // --- Account lifecycle (K8.6) ---
  EMAIL_NOT_VERIFIED:              { kind: 'api' as ErrorKind, http: 403, owner: 'backend' },
  EMAIL_TOKEN_INVALID:             { kind: 'api' as ErrorKind, http: 400, owner: 'backend' },
  EMAIL_TOKEN_EXPIRED:             { kind: 'api' as ErrorKind, http: 400, owner: 'backend' },
  EMAIL_RESEND_COOLDOWN:           { kind: 'api' as ErrorKind, http: 429, owner: 'backend' },
  // --- Consent (KVKK / GDPR, issue 009) ---
  CONSENT_REQUIRED:                { kind: 'api' as ErrorKind, http: 422, owner: 'backend' },
  // --- Profile / CV (K8.7, §3.3) ---
  CV_TRUNCATED:                    { kind: 'log' as ErrorKind, http: undefined, owner: 'backend' },
  PROFILE_DOB_STRIPPED:            { kind: 'log' as ErrorKind, http: undefined, owner: 'ai' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
