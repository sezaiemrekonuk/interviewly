// W01 AC-6/AC-7/AC-10 — AvatarState/MascotPose membership, the content-addressed key shape,
// seed coverage, and the size-budget ceilings.
//
// Every expectation is read out of a real source (the types package, the Prisma enums, the
// seed), never re-declared here: a literal copied into the test asserts the copy, not the
// contract — a sixth pose added to the seed sailed through the first version of this file.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..');
const read = (...parts: string[]) => readFileSync(join(REPO, ...parts), 'utf8');

const TYPES_SOURCE = read('packages', 'types', 'src', 'index.ts');
const SCHEMA = read('backend', 'prisma', 'schema.prisma');
const SEED_SOURCE = read('backend', 'prisma', 'seed.ts');

/**
 * `@interviewly/types` is read from source, not through the package entry: it ships
 * `main: dist/…` and no task has built it yet. Swap for a real import once one does — the
 * assertions below do not change.
 */
function unionMembers(name: string): string[] {
  const match = TYPES_SOURCE.match(new RegExp(`export type ${name}\\s*=\\s*([^;]+);`));
  if (!match) throw new Error(`type ${name} not found in packages/types/src/index.ts`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function enumMembers(name: string): string[] {
  const match = SCHEMA.match(new RegExp(`enum ${name}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`enum ${name} not found in schema.prisma`);
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'));
}

function seedArray(name: string): string[] {
  const match = SEED_SOURCE.match(new RegExp(`const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`${name} not found in seed.ts`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The bytes the seed actually PUTs, decoded from its own base64 literal. */
function placeholderBytes(): Buffer {
  const match = SEED_SOURCE.match(/const PLACEHOLDER_WEBP = Buffer\.from\(\s*'([^']+)'/);
  if (!match) throw new Error('PLACEHOLDER_WEBP not found in seed.ts');
  return Buffer.from(match[1], 'base64');
}

const AVATAR_KEY_RE =
  /^personas\/[^/]+\/(idle|listening|thinking|speaking|acknowledging)-[0-9a-f]{64}\.webp$/;
const MASCOT_KEY_RE = /^mascot\/(wave|point|think|cheer|shrug)-[0-9a-f]{64}\.webp$/;

const AVATAR_BUDGET = { perImage: 60 * 1024, perSet: 350 * 1024 };
const MASCOT_BUDGET = { perImage: 40 * 1024, perSet: 200 * 1024 };

const avatarStates = unionMembers('AvatarState');
const mascotPoses = unionMembers('MascotPose');

describe('AvatarState (ui AC-6)', () => {
  it('is exactly the five members', () => {
    expect([...avatarStates].sort()).toEqual([
      'acknowledging',
      'idle',
      'listening',
      'speaking',
      'thinking',
    ]);
  });

  it('the Prisma enum and the union agree', () => {
    expect([...enumMembers('AvatarState')].sort()).toEqual([...avatarStates].sort());
  });

  it('the seed AVATAR_STATES is exactly the union — no gap, no extra', () => {
    expect([...seedArray('AVATAR_STATES')].sort()).toEqual([...avatarStates].sort());
  });
});

describe('MascotPose (ui AC-6)', () => {
  it('is exactly the five members', () => {
    expect([...mascotPoses].sort()).toEqual(['cheer', 'point', 'shrug', 'think', 'wave']);
  });

  it('the Prisma enum and the union agree', () => {
    expect([...enumMembers('MascotPose')].sort()).toEqual([...mascotPoses].sort());
  });

  it('the seed MASCOT_POSES is exactly the union — no gap, no extra', () => {
    expect([...seedArray('MASCOT_POSES')].sort()).toEqual([...mascotPoses].sort());
  });
});

describe('content-addressed key shape (ui AC-7)', () => {
  // The key under test is rendered from the seed's own template and its own hash, not one
  // this file made up.
  const sha256 = createHash('sha256').update(placeholderBytes()).digest('hex');

  it('the seed writes avatar keys as personas/{personaId}/{state}-{sha256}.webp', () => {
    expect(SEED_SOURCE).toContain('`personas/${persona.id}/${state}-${PLACEHOLDER_SHA256}.webp`');
    for (const state of avatarStates) {
      expect(`personas/seed-persona-hr/${state}-${sha256}.webp`).toMatch(AVATAR_KEY_RE);
    }
  });

  it('the seed writes mascot keys as mascot/{pose}-{sha256}.webp', () => {
    expect(SEED_SOURCE).toContain('`mascot/${pose}-${PLACEHOLDER_SHA256}.webp`');
    for (const pose of mascotPoses) {
      expect(`mascot/${pose}-${sha256}.webp`).toMatch(MASCOT_KEY_RE);
    }
  });

  it('rejects a key that is not content-addressed', () => {
    expect('mascot/wave.webp').not.toMatch(MASCOT_KEY_RE);
    expect(`mascot/wave-${sha256}.png`).not.toMatch(MASCOT_KEY_RE);
    expect(`personas/p/idle-${sha256.slice(0, 32)}.webp`).not.toMatch(AVATAR_KEY_RE);
  });
});

describe('size budgets (ui AC-7/§3.6, §4.2.1)', () => {
  // The seeded object is a 34-byte placeholder, so this clears trivially today. The ceiling
  // is what a real-artwork swap at the same keys must still meet.
  const bytes = placeholderBytes().length;

  it('avatar image and set ceilings hold for the seeded objects', () => {
    expect(bytes).toBeLessThanOrEqual(AVATAR_BUDGET.perImage);
    expect(bytes * avatarStates.length).toBeLessThanOrEqual(AVATAR_BUDGET.perSet);
  });

  it('mascot image and set ceilings hold for the seeded objects', () => {
    expect(bytes).toBeLessThanOrEqual(MASCOT_BUDGET.perImage);
    expect(bytes * mascotPoses.length).toBeLessThanOrEqual(MASCOT_BUDGET.perSet);
  });
});
