/**
 * `GET/PATCH /me/profile`, `POST /me/profile/complete` — the §3.3 layer-1 account profile
 * (K8.7). Three independently-saved cards; a card save merges into `users.profile`, it never
 * replaces it, so card 2 landing does not erase card 1 (A06 non-negotiable).
 *
 * `date_of_birth` is stored here (it is part of the account profile) but never leaves toward
 * `ai` — `interview/profile.ts`'s `mergeProfile` strips it when building the interview snapshot.
 */
import type { Prisma } from '@prisma/client';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

/**
 * Onboarding only ever added; `/profile` (issue 75) also has to take a value back off, and a
 * merge patch has no other vocabulary for that. So every scalar accepts `''` — meaning
 * "clear this" — and `patchMyProfile` drops the key instead of storing a blank that would
 * read as a filled field everywhere downstream.
 */
const clearable = (max: number, shape?: RegExp) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .refine((value) => !value || !shape || shape.test(value), { message: 'malformed' });

// Deliberately permissive: an international number is punctuation plus digits, and a stricter
// pattern rejects real numbers far more often than it catches a typo.
const PHONE = /^\+?[0-9][0-9 ().\-/]{3,}$/;
// `<input type="date">` submits exactly this; the value is never parsed here (it is stored and
// shown back, never compared), so the shape is the whole validation.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const card1Schema = z.object({
  fullName: clearable(200),
  jobTitle: clearable(200),
  phone: clearable(40, PHONE),
  dateOfBirth: clearable(32, ISO_DATE),
});

const YEAR = z.coerce.number().int().min(1900).max(2100);

/**
 * One education entry. Only the school is required — the same rule the profile screen's entry
 * form enforces, and the same one every mainstream profile product settles on: a candidate who
 * knows where they studied but not which of the two years to call the end should be able to
 * record it rather than be refused.
 *
 * `graduationYear` is the pre-`startYear`/`endYear` shape. It is still accepted so a stored row
 * can be re-sent untouched; nothing writes it any more, and the client reads it as `endYear`.
 */
const educationRowSchema = z.object({
  school: z.string().trim().min(1).max(200),
  degree: z.string().trim().max(200).optional(),
  field: z.string().trim().max(200).optional(),
  startYear: YEAR.optional(),
  endYear: YEAR.optional(),
  grade: z.string().trim().max(100).optional(),
  /** LinkedIn's "activities and societies" — free text, one paragraph's worth. */
  description: z.string().trim().max(1_000).optional(),
  graduationYear: YEAR.optional(),
});

// Capped at 5 (A06 non-negotiable): a card-2 body with a 6th row is rejected whole, the
// stored 5 are left untouched because the update never runs.
const card2Schema = z.object({
  education: z.array(educationRowSchema).max(5),
});

const card3Schema = z.object({
  // A blank chip is never a hobby, so the elements keep `min(1)`; the empty *array* is the
  // clear, exactly as `''` is for a scalar.
  hobbies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  interestsText: clearable(2_000),
});

const patchSchema = z.union([
  z.object({ step: z.literal(1), fields: card1Schema }),
  z.object({ step: z.literal(2), fields: card2Schema }),
  z.object({ step: z.literal(3), fields: card3Schema }),
]);

/**
 * One card's fields over the stored profile. Merge, never replace (A06 non-negotiable), so a
 * card-2 save cannot erase card 1 — and a cleared field leaves rather than lands as a blank:
 * `{ fullName: '' }` removes the key, so `profile.fullName` stays the single "is this filled
 * in?" test for the greeting, the completeness meter and the interview snapshot alike.
 *
 * Pure and exported so the invariant is testable without a database.
 */
export function mergeCard(
  current: Record<string, unknown>,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current, ...fields };
  for (const [key, value] of Object.entries(fields)) {
    if (value === '' || (Array.isArray(value) && value.length === 0)) delete merged[key];
  }
  return merged;
}

export const getMyProfile: RequestHandler = async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: {
      profile: true,
      onboarding_completed_at: true,
      cv_upload_id: true,
      cv_upload: {
        select: { mime: true, size_bytes: true, created_at: true, filename: true },
      },
    },
  });
  res.status(200).json({
    profile: user.profile ?? {},
    onboardingCompletedAt: user.onboarding_completed_at,
    cvUploadId: user.cv_upload_id,
    cv: user.cv_upload
      ? {
          id: user.cv_upload_id,
          // Null for anything uploaded before the column existed; the screen falls back to
          // describing the file by its size and date.
          filename: user.cv_upload.filename,
          mime: user.cv_upload.mime,
          sizeBytes: user.cv_upload.size_bytes,
          uploadedAt: user.cv_upload.created_at,
        }
      : null,
  });
};

export const patchMyProfile: RequestHandler = async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  const existing = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { profile: true },
  });
  const current = (existing.profile as Record<string, unknown> | null) ?? {};
  const merged = mergeCard(current, parsed.data.fields);

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { profile: merged as Prisma.InputJsonObject },
  });

  // Step only — never a field value (A06 non-negotiable: no profile field in a log line).
  logger.info({ userId: req.user!.id, traceId: req.traceId, step: parsed.data.step }, 'PROFILE_CARD_SAVED');
  res.status(200).json({ profile: merged });
};

export const completeOnboarding: RequestHandler = async (req, res) => {
  const existing = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { onboarding_completed_at: true },
  });

  // Idempotent: a second call keeps the first completion timestamp rather than moving it,
  // and does not emit a second ONBOARDING_COMPLETED line.
  if (existing.onboarding_completed_at) {
    res.status(200).json({ onboardingCompletedAt: existing.onboarding_completed_at });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data: { onboarding_completed_at: new Date() },
    select: { onboarding_completed_at: true },
  });

  logger.info({ userId: req.user!.id, traceId: req.traceId }, 'ONBOARDING_COMPLETED');
  res.status(200).json({ onboardingCompletedAt: updated.onboarding_completed_at });
};
