/**
 * Is this a real deployment, or a laptop / CI runner?
 *
 * Issue #118 was `.env.example` shipped verbatim, and `NODE_ENV=development` is one of the
 * lines that would ride along with everything else — so `NODE_ENV` alone cannot be the
 * question, or the guard misses precisely the accident it was written for.
 *
 * `PUBLIC_ORIGIN` is the one key a deployment cannot leave at the template value and still
 * function: it is the URL the product is served from, and the mail links, the cookie and
 * `requirePublicOrigin` all read it. A box answering on `http://localhost` is not serving
 * anyone; anything else is, whoever set `NODE_ENV`.
 *
 * Both inputs are arguments rather than reads, so this stays importable by `prisma/seed.ts` —
 * an ops tool that deliberately does not go through `env.ts` — without either file learning
 * about the other's environment.
 */

/** Loopback in the forms `PUBLIC_ORIGIN` is actually written in, with or without a port. */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i;

export function isLocalOrigin(publicOrigin: string | undefined): boolean {
  return publicOrigin !== undefined && LOOPBACK_ORIGIN.test(publicOrigin.trim());
}

/**
 * `NODE_ENV=production` is taken at its word. Otherwise the origin decides — and an origin
 * that is absent or unparseable is treated as local, because a deployment with no
 * `PUBLIC_ORIGIN` fails validation on that key anyway and a second failure naming a different
 * key would only obscure it.
 */
export function isDeployed(
  nodeEnv: string | undefined,
  publicOrigin: string | undefined,
): boolean {
  if (nodeEnv === 'production') return true;
  if (publicOrigin === undefined || publicOrigin.trim() === '') return false;
  return !isLocalOrigin(publicOrigin);
}
