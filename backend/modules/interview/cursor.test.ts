/**
 * Both lists page through these, and a cursor that survives a round trip but decodes to a
 * different id silently skips a page of someone's interviews.
 */
import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor, pageLimit } from './cursor';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a cuid', () => {
    const id = 'cmsd33kvl0005oy0zn7j28sq1';
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });

  it('is opaque — the raw id is not the cursor', () => {
    expect(encodeCursor('cmsd33kvl0005oy0zn7j28sq1')).not.toBe('cmsd33kvl0005oy0zn7j28sq1');
  });

  it('treats a missing or empty cursor as no cursor', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
    // Express gives an array when `?cursor=` is repeated.
    expect(decodeCursor(['a', 'b'])).toBeUndefined();
  });

  // Otherwise these reach Prisma's `cursor` and 500 off a query string.
  it('rejects a hand-made cursor that is not cuid-shaped', () => {
    expect(decodeCursor('!!!not-base64!!!')).toBeUndefined();
    expect(decodeCursor(encodeCursor('short'))).toBeUndefined();
    expect(decodeCursor(encodeCursor("'; DROP TABLE interviews; --"))).toBeUndefined();
  });
});

describe('pageLimit', () => {
  it('defaults when absent or unparseable', () => {
    expect(pageLimit(undefined)).toBe(20);
    expect(pageLimit('not-a-number')).toBe(20);
  });

  it('clamps rather than rejecting', () => {
    expect(pageLimit('0')).toBe(20);
    expect(pageLimit('-5')).toBe(20);
    expect(pageLimit('5000')).toBe(100);
    expect(pageLimit('7.9')).toBe(7);
  });

  it('passes a sane limit through', () => {
    expect(pageLimit('50')).toBe(50);
  });
});
