/**
 * ADR-ADD03 — the interviewer's own `set_interview_language`, which writes the column the
 * heuristic streak also writes. The guard is the point: "the model asked for it" is not a
 * reason to store a language no prompt, no UI locale and no report renders.
 */
import type { Interview } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn(async () => ({}));

vi.mock('../../src/lib/db', () => ({ prisma: { interview: { update } } }));
vi.mock('../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../ai', () => ({ aiClient: () => ({ detectLanguage: () => ({ language: 'en', ambiguous: false }) }) }));

const { setInterviewLanguage } = await import('./language');

const interview = { id: 'itw_1', language: 'en' } as Interview;
const OPTS = { traceId: 'trc_1' };

describe('setInterviewLanguage', () => {
  beforeEach(() => update.mockClear());

  it('moves the interview to a supported language', async () => {
    expect(await setInterviewLanguage(interview, 'tr', OPTS)).toBe('tr');
    expect(update).toHaveBeenCalledWith({ where: { id: 'itw_1' }, data: { language: 'tr' } });
  });

  it('writes nothing for the language it is already in', async () => {
    expect(await setInterviewLanguage(interview, 'en', OPTS)).toBe('en');
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a language the product does not run in', async () => {
    expect(await setInterviewLanguage(interview, 'ru', OPTS)).toBe('en');
    expect(update).not.toHaveBeenCalled();
  });
});
