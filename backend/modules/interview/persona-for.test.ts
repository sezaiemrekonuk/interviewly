/**
 * Issue 257 — which persona conducts an interview.
 *
 * The old rule was "the lowest-sorting active persona of this role", which reads as neutral
 * and is not: the seed's ids are `seed-persona-*` and every test fixture's is a cuid, so `c`
 * beat `s` and the product ran its interviews with whatever the integration suite had left in
 * the table. On a shared database that meant a persona named `R02 persona <uuid>`, a system
 * prompt of the literal string `stub`, and a `voice_id` no TTS provider has heard of — a 400
 * per question and a silent downgrade out of voice.
 *
 * So the assertion is not "a persona is returned". It is *which* one, against a table that
 * still contains the thing that used to win.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface PersonaRow {
  id: string;
  role: string;
  active: boolean;
}

/** The table, and a `findFirst` faithful enough to the two queries under test. */
let rows: PersonaRow[] = [];

const findFirst = vi.fn(
  async ({ where, orderBy }: { where: Partial<PersonaRow>; orderBy?: { id: 'asc' } }) => {
    const matched = rows.filter((row) =>
      Object.entries(where).every(([key, value]) => row[key as keyof PersonaRow] === value),
    );
    if (orderBy) matched.sort((a, b) => a.id.localeCompare(b.id));
    return matched[0] ?? null;
  },
);

vi.mock('../../src/lib/db', () => ({ prisma: { persona: { findFirst } } }));
// Both are imported by the module under test and both open a connection at import: `../ai`
// reads the validated env, `./sse` reaches Redis through the queue. Neither is on this path.
vi.mock('../ai', () => ({ aiClient: vi.fn() }));
vi.mock('./sse', () => ({ QUESTIONS_READY: 'INTERVIEW_QUESTIONS_READY', publishQuestionsReady: vi.fn() }));
vi.mock('./machine', () => ({ applyTransition: vi.fn(), canTransition: vi.fn(() => false) }));

const { personaFor } = await import('./generation');

/** What one integration run leaves behind: a cuid, active, sorting before `seed-`. */
const FIXTURE: PersonaRow = { id: 'cmskk4tq7000coy1l76qp97rk', role: 'hr', active: true };
const SEEDED_HR: PersonaRow = { id: 'seed-persona-hr', role: 'hr', active: true };
const SEEDED_TECH: PersonaRow = { id: 'seed-persona-tech', role: 'tech', active: true };

beforeEach(() => {
  findFirst.mockClear();
  rows = [];
});

describe('personaFor', () => {
  it('takes the seeded persona even when a fixture sorts ahead of it', async () => {
    rows = [FIXTURE, SEEDED_HR];

    await expect(personaFor('hr')).resolves.toBe('seed-persona-hr');
  });

  it('takes the seeded persona of the round asked for, not of the other round', async () => {
    rows = [FIXTURE, SEEDED_HR, SEEDED_TECH];

    await expect(personaFor('tech')).resolves.toBe('seed-persona-tech');
  });

  // A deployment that has genuinely replaced its personas has no `seed-persona-*` row, and the
  // rule must not turn "custom personas" into "no interviews".
  it('falls back to an active persona of the role when nothing is seeded', async () => {
    rows = [{ id: 'custom-hr', role: 'hr', active: true }];

    await expect(personaFor('hr')).resolves.toBe('custom-hr');
  });

  it('ignores a seeded row that has been deactivated', async () => {
    rows = [{ ...SEEDED_HR, active: false }, { id: 'custom-hr', role: 'hr', active: true }];

    await expect(personaFor('hr')).resolves.toBe('custom-hr');
  });

  // A broken deployment, not a bad request — `app.ts` turns this into an opaque 500.
  it('raises when the role has no active persona at all', async () => {
    rows = [{ ...SEEDED_HR, active: false }];

    await expect(personaFor('hr')).rejects.toThrow(/no active persona seeded for round type hr/);
  });
});
