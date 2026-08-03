/**
 * `GET/PATCH /me/profile`, `POST /me/profile/complete` — the §3.3 layer-1 account profile
 * (K8.7). Three independently-saved cards; a card save merges into `users.profile`, it never
 * replaces it, so card 2 landing does not erase card 1 (A06 non-negotiable).
 *
 * `date_of_birth` is stored here (it is part of the account profile) but never leaves toward
 * `ai` — `interview/profile.ts`'s `mergeProfile` strips it when building the interview snapshot.
 */
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

const card1Schema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  jobTitle: z.string().trim().min(1).max(200).optional(),
  dateOfBirth: z.string().trim().min(1).max(32).optional(),
});

const educationRowSchema = z.object({
  school: z.string().trim().min(1).max(200),
  degree: z.string().trim().min(1).max(200),
  field: z.string().trim().min(1).max(200),
  graduationYear: z.coerce.number().int().min(1900).max(2100),
});

// Capped at 5 (A06 non-negotiable): a card-2 body with a 6th row is rejected whole, the
// stored 5 are left untouched because the update never runs.
const card2Schema = z.object({
  education: z.array(educationRowSchema).max(5),
});

const card3Schema = z.object({
  hobbies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  interestsText: z.string().trim().max(2_000).optional(),
});

const patchSchema = z.union([
  z.object({ step: z.literal(1), fields: card1Schema }),
  z.object({ step: z.literal(2), fields: card2Schema }),
  z.object({ step: z.literal(3), fields: card3Schema }),
]);

export const getMyProfile: RequestHandler = async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { profile: true, onboarding_completed_at: true, cv_upload_id: true },
  });
  res.status(200).json({
    profile: user.profile ?? {},
    onboardingCompletedAt: user.onboarding_completed_at,
    cvUploadId: user.cv_upload_id,
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
  const merged = { ...current, ...parsed.data.fields };

  await prisma.user.update({ where: { id: req.user!.id }, data: { profile: merged } });

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
