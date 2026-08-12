import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { assertDisposableStores } from './backend/features/fixtures/disposable-stores';

const SCHEMA = fileURLToPath(new URL('./backend/prisma/schema.prisma', import.meta.url));

const REFERENCE_PERSONAS = [
  {
    id: 'seed-persona-hr',
    role: 'hr',
    name: 'Ada',
    voice_id: 'none',
    system_prompt: 'You are the HR interviewer.',
  },
  {
    id: 'seed-persona-tech',
    role: 'tech',
    name: 'Turing',
    voice_id: 'none',
    system_prompt: 'You are the technical interviewer.',
  },
];

export default async function setup(): Promise<void> {
  assertDisposableStores();
  execSync(`npx prisma migrate deploy --schema "${SCHEMA}"`, { stdio: 'ignore' });

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    for (const persona of REFERENCE_PERSONAS) {
      const data = { ...persona, avatar_set: {}, active: true };
      await prisma.persona.upsert({ where: { id: persona.id }, update: data, create: data });
    }
  } finally {
    await prisma.$disconnect();
  }
}
