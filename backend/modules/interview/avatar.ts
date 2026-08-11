/**
 * The `change_avatar` tool surface (additionals ledger, see `.agents/ledgers/additionals/`).
 *
 * An "expression" is presentational only — no report or score ever reads it — so it lives in
 * Redis, not Postgres: a lost key just means the tile falls back to expression 1, never a
 * broken interview. Keyed per (interview, persona) because a room shows two tiles and only the
 * live one is ever asked to change; the other simply keeps whatever it last had.
 */
import { redis } from '../auth/rate-limit';
import { AVATAR_CHANGED, eventChannel } from './sse';

/** 3 expressions per persona — Ada and Turing are each seeded with exactly three. */
export const AVATAR_COUNT = 3;
/** Outlives any single interview session; a stale key is harmless, just expires. */
const TTL_SECONDS = 24 * 60 * 60;

function avatarKey(interviewId: string, personaId: string): string {
  return `avatar:${interviewId}:${personaId}`;
}

function clampAvatar(n: number): number {
  return Number.isInteger(n) && n >= 1 && n <= AVATAR_COUNT ? n : 1;
}

/** The expression a persona's tile is showing right now. Defaults to 1 — never asked yet. */
export async function currentAvatar(interviewId: string, personaId: string): Promise<number> {
  const raw = await redis.get(avatarKey(interviewId, personaId));
  return raw ? clampAvatar(Number(raw)) : 1;
}

/**
 * Applies the conductor's requested expression, if it is both valid and an actual change.
 * "if current avatar is 1, no changes made" is the contract: a repeat of the live expression
 * costs neither a write nor an SSE nudge — just the one Redis read every turn already needs
 * for the diff.
 */
export async function applyAvatarChange(
  interviewId: string,
  personaId: string,
  requested: number,
): Promise<void> {
  if (!Number.isInteger(requested) || requested < 1 || requested > AVATAR_COUNT) return;
  const current = await currentAvatar(interviewId, personaId);
  if (current === requested) return;

  await redis.set(avatarKey(interviewId, personaId), String(requested), 'EX', TTL_SECONDS);
  // Swallows its own failure like `publishQuestionsReady`: the expression is already written,
  // and a missed nudge just means the tile catches up on the room's next ordinary refetch.
  await redis
    .publish(
      eventChannel(interviewId),
      JSON.stringify({ type: AVATAR_CHANGED, interviewId, personaId, avatar: requested }),
    )
    .catch(() => undefined);
}
