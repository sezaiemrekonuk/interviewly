import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  compileQuery,
  compileSort,
  decodeListCursor,
  encodeListCursor,
  parseTerm,
  tokenize,
} from './query-language';
import { AUDIT_SPEC, CALL_SPEC, INTERVIEW_SPEC, SESSION_SPEC, USER_SPEC } from './specs';

const CUID = 'cmsdaraqs00dyrqxsrwctae2r';

describe('tokenize', () => {
  it('splits on whitespace and keeps a quoted phrase whole', () => {
    expect(tokenize('ada "senior backend" state:completed')).toEqual([
      'ada',
      'senior backend',
      'state:completed',
    ]);
  });

  it('treats an unclosed quote as the rest of the line, not an error', () => {
    // Half a phrase is the normal state of a search box being typed into.
    expect(tokenize('ada "senior back')).toEqual(['ada', 'senior back']);
  });

  it('collapses runs of whitespace rather than emitting empty terms', () => {
    expect(tokenize('  ada   backend  ')).toEqual(['ada', 'backend']);
  });
});

describe('parseTerm', () => {
  it('reads the four comparison operators, longest first', () => {
    // `>=` must win over `>`, or `cost>=1` parses as the value `=1` and is silently ignored.
    expect(parseTerm('cost>=0.10')).toMatchObject({ field: 'cost', op: '>=', value: '0.10' });
    expect(parseTerm('cost<=0.10')).toMatchObject({ field: 'cost', op: '<=', value: '0.10' });
    expect(parseTerm('cost>0.10')).toMatchObject({ field: 'cost', op: '>', value: '0.10' });
    expect(parseTerm('cost<0.10')).toMatchObject({ field: 'cost', op: '<', value: '0.10' });
  });

  it('leaves an email alone instead of reading it as a field lookup', () => {
    // The regex would happily call `ada` a field and `example.com` a value. An `@` before the
    // separator is what says this is a word, not a term.
    expect(parseTerm('ada@example.com').field).toBeNull();
  });

  it('treats a field with no value as a bare word', () => {
    expect(parseTerm('state:').field).toBeNull();
  });
});

describe('compileQuery', () => {
  it('is inert on an empty search', () => {
    expect(compileQuery('', INTERVIEW_SPEC)).toEqual({ where: {}, applied: [], ignored: [] });
    expect(compileQuery(undefined, INTERVIEW_SPEC).where).toEqual({});
  });

  it('ANDs a bare word with a field term', () => {
    const { where, applied, ignored } = compileQuery('ada state:completed', INTERVIEW_SPEC);

    expect(ignored).toEqual([]);
    expect(applied).toEqual(['ada', 'state:completed']);
    expect(where).toEqual({
      AND: [
        {
          OR: [
            { id: { contains: 'ada', mode: 'insensitive' } },
            { user: { email_lower: { contains: 'ada', mode: 'insensitive' } } },
            { occupation: { contains: 'ada', mode: 'insensitive' } },
          ],
        },
        { state: 'completed' },
      ],
    });
  });

  it('narrows on a second bare word rather than widening', () => {
    // Two words under one AND. An operator adding a word expects fewer rows, not more.
    const { where } = compileQuery('ada backend', INTERVIEW_SPEC);
    expect((where.AND as unknown[]).length).toBe(2);
  });

  it('nests a relation path', () => {
    expect(compileQuery('account:ada', INTERVIEW_SPEC).where).toEqual({
      AND: [{ user: { email_lower: { contains: 'ada', mode: 'insensitive' } } }],
    });
  });

  it('compares money as a Decimal, never as a float', () => {
    const { where } = compileQuery('cost>0.10', INTERVIEW_SPEC);
    const leaf = (where.AND as { spent_usd: { gt: Prisma.Decimal } }[])[0].spent_usd.gt;
    expect(leaf).toBeInstanceOf(Prisma.Decimal);
    expect(leaf.toString()).toBe('0.1');
  });

  it('reads a bare date as the whole day, not the instant midnight', () => {
    // `created:2026-08-11` against a TIMESTAMP(3) equality would match nothing, and nothing
    // reads as "no such rows" rather than "you asked the wrong question".
    const { where } = compileQuery('created:2026-08-11', INTERVIEW_SPEC);
    const leaf = (where.AND as { created_at: { gte: Date; lt: Date } }[])[0].created_at;
    expect(leaf.gte.toISOString()).toBe('2026-08-11T00:00:00.000Z');
    expect(leaf.lt.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('turns a trailing star into a prefix match', () => {
    expect(compileQuery('action:security.*', AUDIT_SPEC).where).toEqual({
      AND: [{ action: { startsWith: 'security.', mode: 'insensitive' } }],
    });
  });

  it('reads presence both ways, and `{ equals: null }` rather than a bare null', () => {
    // A bare `null` is "no filter" to Prisma, so `deleted:false` would quietly match everything.
    expect(compileQuery('deleted:false', INTERVIEW_SPEC).where).toEqual({
      AND: [{ deleted_at: { equals: null } }],
    });
    expect(compileQuery('fellback:true', CALL_SPEC).where).toEqual({
      AND: [{ fell_back_from: { not: null } }],
    });
  });

  it('ignores an unknown field instead of matching everything with it', () => {
    const { where, applied, ignored } = compileQuery('nonsense:x state:completed', INTERVIEW_SPEC);
    expect(ignored).toEqual(['nonsense:x']);
    expect(applied).toEqual(['state:completed']);
    expect(where).toEqual({ AND: [{ state: 'completed' }] });
  });

  it('ignores a value outside an enum rather than querying for it', () => {
    expect(compileQuery('state:nonsense', INTERVIEW_SPEC).ignored).toEqual(['state:nonsense']);
  });

  it('ignores a comparison on a kind that has no order', () => {
    expect(compileQuery('state>completed', INTERVIEW_SPEC).ignored).toEqual(['state>completed']);
  });

  it('ignores unparseable numbers, decimals and dates rather than throwing', () => {
    // Every one of these is a string an operator passes through while typing.
    for (const [term, spec] of [
      ['latency>abc', CALL_SPEC],
      ['cost>not-a-number', INTERVIEW_SPEC],
      ['created>13th-of-never', INTERVIEW_SPEC],
      ['created:13th-of-never', INTERVIEW_SPEC],
    ] as const) {
      expect(() => compileQuery(term, spec)).not.toThrow();
      expect(compileQuery(term, spec).ignored).toEqual([term]);
    }
  });

  it('never reaches a column the spec did not name', () => {
    // The whitelist is the security boundary: reflection over the model would have answered
    // this one, and answered it about a password hash.
    const { where, ignored } = compileQuery('password_hash:* google_sub:x', USER_SPEC);
    expect(where).toEqual({});
    expect(ignored).toEqual(['password_hash:*', 'google_sub:x']);
  });

  it('accepts every field each spec declares, so a rename cannot half-land', () => {
    for (const spec of [INTERVIEW_SPEC, CALL_SPEC, USER_SPEC, SESSION_SPEC, AUDIT_SPEC]) {
      for (const [name, field] of Object.entries(spec.fields)) {
        const value =
          // `values` is the authority wherever it is declared — `enum` and `computed` both
          // carry one, and a kind-only branch silently fed `computed` a value it refuses.
          field.values
            ? field.values[0]
            : field.kind === 'presence'
              ? 'true'
              : field.kind === 'date'
                ? '2026-08-11'
                : field.kind === 'number' || field.kind === 'decimal'
                  ? '1'
                  : 'x';
        expect(compileQuery(`${name}:${value}`, spec).ignored).toEqual([]);
      }
      // And every free-text name is a real field, or a bare word silently matches nothing.
      for (const name of spec.freeText) expect(spec.fields[name]).toBeDefined();
      // And every sortable name resolves, through a field or an override.
      for (const name of spec.sortable)
        expect(spec.fields[name] ?? spec.sortOverrides?.[name]).toBeDefined();
    }
  });
});

describe('computed fields', () => {
  const NOW = new Date('2026-08-11T09:00:00.000Z');

  it('reads an active session as neither revoked nor expired, against the given clock', () => {
    expect(compileQuery('active:true', SESSION_SPEC, NOW).where).toEqual({
      AND: [{ revoked_at: null, expires_at: { gt: NOW } }],
    });
  });

  it('reads an inactive session as revoked OR expired, not as the negation of one column', () => {
    expect(compileQuery('active:false', SESSION_SPEC, NOW).where).toEqual({
      AND: [{ OR: [{ revoked_at: { not: null } }, { expires_at: { lte: NOW } }] }],
    });
  });

  it('ignores a value it cannot build and a comparison it has no order for', () => {
    expect(compileQuery('active:maybe', SESSION_SPEC, NOW).ignored).toEqual(['active:maybe']);
    expect(compileQuery('active>true', SESSION_SPEC, NOW).ignored).toEqual(['active>true']);
  });

  it('ANDs with an ordinary field rather than replacing it', () => {
    const { where } = compileQuery('active:true email:ada', SESSION_SPEC, NOW);
    expect((where.AND as unknown[]).length).toBe(2);
  });
});

describe('compileSort', () => {
  it('falls back to the default when the field is not sortable', () => {
    expect(compileSort('password_hash', 'asc', INTERVIEW_SPEC)).toMatchObject({
      field: 'created',
      dir: 'asc',
    });
  });

  it('always ends the order on id, so the order is total', () => {
    // Without the tie-break, two rows sharing a `created_at` have no single position for a
    // cursor to seek to — they land on both pages or on neither.
    for (const spec of [INTERVIEW_SPEC, CALL_SPEC, USER_SPEC, SESSION_SPEC, AUDIT_SPEC]) {
      for (const field of spec.sortable) {
        const { orderBy } = compileSort(field, 'desc', spec);
        expect(orderBy[orderBy.length - 1]).toEqual({ id: 'desc' });
        expect(orderBy.length).toBe(2);
      }
    }
  });

  it('sorts through a relation path and through a relation count', () => {
    expect(compileSort('account', 'asc', INTERVIEW_SPEC).orderBy[0]).toEqual({
      user: { email_lower: 'asc' },
    });
    expect(compileSort('interviews', 'desc', USER_SPEC).orderBy[0]).toEqual({
      interviews: { _count: 'desc' },
    });
  });

  it('treats any direction but `asc` as descending', () => {
    expect(compileSort('created', 'nonsense', AUDIT_SPEC).dir).toBe('desc');
  });
});

describe('list cursor', () => {
  const byCost = compileSort('cost', 'asc', INTERVIEW_SPEC);
  const byCreated = compileSort('created', 'desc', INTERVIEW_SPEC);

  it('round-trips inside the order it was minted under', () => {
    expect(decodeListCursor(encodeListCursor(CUID, byCost), byCost)).toBe(CUID);
  });

  it('refuses a cursor minted under a different order', () => {
    // Prisma seeks to the cursor row's position in the NEW order — a real position, and an
    // arbitrary one. Dropping the cursor returns to page one, which is what re-sorting means.
    expect(decodeListCursor(encodeListCursor(CUID, byCost), byCreated)).toBeUndefined();
  });

  it('refuses a cursor whose direction flipped', () => {
    const flipped = compileSort('cost', 'desc', INTERVIEW_SPEC);
    expect(decodeListCursor(encodeListCursor(CUID, byCost), flipped)).toBeUndefined();
  });

  it('refuses garbage, an empty string and a non-string without throwing', () => {
    for (const value of ['', 'not-base64', Buffer.from('a:b:c').toString('base64url'), 42, null])
      expect(decodeListCursor(value, byCost)).toBeUndefined();
  });

  it('refuses an id that is not cuid-shaped', () => {
    // The cursor is not an access boundary — the `where` is — but a shape check skips a
    // pointless query on a hand-edited token.
    expect(decodeListCursor(encodeListCursor('short', byCost), byCost)).toBeUndefined();
  });
});
