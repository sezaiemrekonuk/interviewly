/**
 * KVKK / GDPR Art. 13 consent, recorded at account creation (issue 009).
 *
 * The version is the server's, never the client's: a browser that posts `consent: true`
 * is asserting "I ticked the box", not "I accepted revision X". Bump this whenever the
 * `legal` copy in `frontend/messages/{en,tr}.json` changes materially — `users.consent_version`
 * is then a per-account record of which text was on screen when the box was ticked.
 */
export const CONSENT_VERSION = '2026-08-06';

/** The two columns every account-creating path writes, so neither can be forgotten alone. */
export const consentFields = () => ({
  consent_version: CONSENT_VERSION,
  consented_at: new Date(),
});
