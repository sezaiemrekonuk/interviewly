/**
 * `PATCH /me/locale` — the writer `users.locale` never had (issue 76).
 *
 * The switcher only ever wrote a `NEXT_LOCALE` cookie, which next-intl reads for UI copy and
 * nothing else reads at all. `users.locale` is the column the two surfaces that are *not*
 * rendered by the browser take their language from: the verification/reset mail
 * (`auth/mail-queue.ts`) and the interview itself (`interview/setup.ts`). Without this route
 * both are English for every account, whatever the pill says.
 *
 * Its own route rather than a fourth `PATCH /me/profile` card: `locale` is a column, not a key
 * inside the `users.profile` JSON, so it shares neither the merge semantics nor the
 * clear-with-`''` vocabulary that `mergeCard` exists for.
 */
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

/** The two locales `frontend/src/lib/locales.ts` offers. An unlisted one has no messages file. */
export const localeSchema = z.enum(['en', 'tr']);

const schema = z.object({ locale: localeSchema });

export const patchMyLocale: RequestHandler = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { locale: parsed.data.locale },
  });

  logger.info(
    { userId: req.user!.id, traceId: req.traceId, locale: parsed.data.locale },
    'LOCALE_SAVED',
  );
  res.status(200).json({ locale: parsed.data.locale });
};
