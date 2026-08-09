/**
 * `AUTH_LOGIN_FAILED` is the one log line whose fields an unauthenticated caller chooses, and
 * its failure branch fires for addresses that have no account — so what it may carry is pinned
 * here (issue 115): the account id when there is one, and never the address.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/lib/api-error';

type User = { id: string; password_hash: string | null };

const findUnique = vi.fn(async (_args: unknown): Promise<User | null> => null);
const info = vi.fn();
const verify = vi.fn(async (): Promise<boolean> => false);

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    user = { findUnique };
  },
}));
vi.mock('@node-rs/argon2', () => ({ verify }));
vi.mock('../../src/lib/logger', () => ({ logger: { info } }));

const { login } = await import('./login');

const req = { body: { email: 'Someone@Example.com', password: 'wrong-password' }, traceId: 't1' };
const res = {} as never;

/** The fields of the single `AUTH_LOGIN_FAILED` line the call under test produced. */
async function failedLoginFields(): Promise<Record<string, unknown>> {
  await expect(login(req as never, res, vi.fn())).rejects.toBeInstanceOf(ApiError);
  expect(info).toHaveBeenCalledTimes(1);
  const [fields, event] = info.mock.calls[0] as [Record<string, unknown>, string];
  expect(event).toBe('AUTH_LOGIN_FAILED');
  return fields;
}

describe('login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names no address when the email has no account', async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await failedLoginFields()).toEqual({ userId: null, traceId: 't1' });
  });

  it('names the account rather than the address on a wrong password', async () => {
    findUnique.mockResolvedValueOnce({ id: 'usr_1', password_hash: 'argon2-hash' });
    verify.mockResolvedValueOnce(false);
    expect(await failedLoginFields()).toEqual({ userId: 'usr_1', traceId: 't1' });
  });
});
