/**
 * `DELETE /me` — KVKK Art. 7 / GDPR Art. 17 erasure (issue 009).
 *
 * Deliberately NOT a row removal. Every foreign key in the schema is `ON DELETE RESTRICT`
 * (db spec §1, K13) and the rows hanging off an account are not all the account's to take
 * with it: `llm_calls` and `interviews.spent_usd` are the operator's own cost ledger, which
 * K11 reads with deleted interviews included. So erasure is **anonymise in place**, using
 * the soft delete the schema already models:
 *
 *   - every interview is soft-deleted, which is what takes the transcripts, answers and
 *     reports out of `userInterviews`/`activeInterview` and therefore out of every
 *     user-facing read (`db.ts` bakes the filter in; the API has no other door);
 *   - `users.profile` — name, date of birth, education, hobbies, interests, cached CV text —
 *     is dropped, and with it `cv_upload_id`;
 *   - the CV file loses its row and its bytes, unless those exact bytes are still someone
 *     else's (uploads dedupe on `sha256`, so one row can have two owners);
 *   - report PDFs lose their bytes and their key;
 *   - `email_lower` is overwritten with a tombstone and both credentials are nulled, so the
 *     address can neither sign in nor be recovered — and it is free to register again;
 *   - every session is revoked, so the browser that asked is signed out on its next request.
 *
 * `users.deleted_at` is the proof it happened and the handle a later retention job would
 * remove the anonymous shell by. It is not a login gate: nothing can resolve the row any
 * more, so `login.ts`, `google.ts` and `requireAuth` need no new branch.
 */
import { Prisma } from '@prisma/client';
import type { RequestHandler } from 'express';

import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { revokeCookie } from '../../src/lib/session';
import { storage } from '../../src/lib/storage';

/** Unresolvable on purpose: `.invalid` is reserved (RFC 2606) and can never be a real inbox. */
const tombstoneEmail = (userId: string) => `deleted-${userId}@erased.invalid`;

export const deleteMe: RequestHandler = async (req, res) => {
  const user = req.user!;
  const now = new Date();

  const cv = user.cv_upload_id
    ? await prisma.upload.findUnique({ where: { id: user.cv_upload_id } })
    : null;
  const reports = await prisma.report.findMany({
    where: { interview: { user_id: user.id }, pdf_key: { not: null } },
    select: { id: true, pdf_key: true },
  });

  const erased = await prisma.$transaction(async (tx) => {
    const interviews = await tx.interview.updateMany({
      where: { user_id: user.id, deleted_at: null },
      data: { deleted_at: now },
    });
    await tx.session.updateMany({
      where: { user_id: user.id, revoked_at: null },
      data: { revoked_at: now },
    });
    // Nothing references an email token, and a consumed one is only retained for an audit
    // of an account that is about to stop existing.
    await tx.emailToken.deleteMany({ where: { user_id: user.id } });

    await tx.user.update({
      where: { id: user.id },
      data: {
        email_lower: tombstoneEmail(user.id),
        password_hash: null,
        google_sub: null,
        profile: Prisma.DbNull,
        cv_upload_id: null,
        deleted_at: now,
      },
    });

    const keys: string[] = [];

    // The pointer above is now cleared, so the CV row is unreferenced *by this account*. It
    // can still be referenced by an interview created from the same file as its listing, which
    // would make the DELETE a RESTRICT violation and means the bytes are not this user's alone
    // to erase.
    //
    // Deleting the row and erasing the object are two decisions, not one. `uploads` is unique
    // per (owner, bytes), so another account that uploaded a byte-identical file has its own
    // row over the *same* content-addressed `storage_key` — erasing the object on this row's
    // delete would empty a stranger's CV.
    if (cv) {
      const stillOwned = (await tx.interview.count({ where: { upload_id: cv.id } })) > 0;
      if (!stillOwned) {
        await tx.upload.delete({ where: { id: cv.id } });
        const shared =
          (await tx.upload.count({ where: { storage_key: cv.storage_key } })) > 0;
        if (!shared) keys.push(cv.storage_key);
      }
    }

    if (reports.length > 0) {
      await tx.report.updateMany({
        where: { id: { in: reports.map((r) => r.id) } },
        data: { pdf_key: null },
      });
      keys.push(...reports.map((r) => r.pdf_key!));
    }

    return { keys, interviews: interviews.count };
  });

  // Object storage is not transactional and must not be able to roll the erasure back. The
  // rows no longer point at these keys either way, so a failure here leaves unreachable
  // bytes to sweep, not a dangling reference — logged so the sweep has something to read.
  for (const key of erased.keys) {
    await storage.remove(key).catch(() => {
      logger.warn({ userId: user.id, traceId: req.traceId, key }, 'ACCOUNT_ERASURE_OBJECT_LEFT');
    });
  }

  revokeCookie(res);
  logger.info(
    { userId: user.id, traceId: req.traceId, interviews: erased.interviews },
    'ACCOUNT_DELETED',
  );
  res.status(204).end();
};

export default deleteMe;
