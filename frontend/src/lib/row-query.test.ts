import { describe, expect, it } from 'vitest';

import {
  filterRows,
  parseQuery,
  serialiseQuery,
  sortRows,
  tokenize,
  type RowSpec,
} from './row-query';

/**
 * The in-memory half of the console's search grammar. These cases mirror the ones in
 * `backend/modules/admin/query-language.test.ts` on purpose: the two implementations are
 * deliberately separate, and matching tests are what stops them drifting apart in behaviour.
 */
interface Call {
  id: string;
  provider: string;
  model: string;
  costUsd: string;
  latencyMs: number;
  createdAt: string;
  fellBackFrom: string | null;
}

const SPEC: RowSpec<Call> = {
  fields: {
    id: { get: (r) => r.id, kind: 'text' },
    provider: { get: (r) => r.provider, kind: 'text' },
    model: { get: (r) => r.model, kind: 'text' },
    cost: { get: (r) => r.costUsd, kind: 'number' },
    latency: { get: (r) => r.latencyMs, kind: 'number' },
    created: { get: (r) => r.createdAt, kind: 'date' },
    fellback: { get: (r) => r.fellBackFrom, kind: 'text' },
  },
  freeText: ['id', 'provider', 'model'],
  sortable: ['created', 'cost', 'latency', 'provider'],
  defaultSort: 'created',
};

const call = (over: Partial<Call> = {}): Call => ({
  id: 'c1',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  costUsd: '0.041200',
  latencyMs: 900,
  createdAt: '2026-08-11T09:00:00.000Z',
  fellBackFrom: null,
  ...over,
});

const ROWS = [
  call(),
  call({ id: 'c2', provider: 'google', model: 'gemini-2.5-flash', costUsd: '0.500000', latencyMs: 2400 }),
  call({ id: 'c3', model: 'gpt-4.1', costUsd: '0.000400', latencyMs: 120, createdAt: '2026-08-01T09:00:00.000Z' }),
];

describe('tokenize', () => {
  it('keeps a quoted phrase whole and drops empty runs', () => {
    expect(tokenize('  gpt "gemini 2.5"  ')).toEqual(['gpt', 'gemini 2.5']);
  });
});

describe('filterRows', () => {
  it('returns everything for an empty query', () => {
    expect(filterRows(ROWS, '', SPEC).rows).toHaveLength(3);
  });

  it('matches a bare word against the free-text fields only', () => {
    expect(filterRows(ROWS, 'gemini', SPEC).rows.map((r) => r.id)).toEqual(['c2']);
    // `900` is a latency, not a free-text field — a bare word must not reach it.
    expect(filterRows(ROWS, '900', SPEC).rows).toHaveLength(0);
  });

  it('narrows on a second term rather than widening', () => {
    expect(filterRows(ROWS, 'gpt', SPEC).rows).toHaveLength(2);
    expect(filterRows(ROWS, 'gpt provider:openai model:4.1-mini', SPEC).rows.map((r) => r.id)).toEqual([
      'c1',
    ]);
  });

  it('compares money held as a six-decimal string, not as text', () => {
    // '0.500000' > '0.041200' is true as text by accident; '0.041200' > '0.000400' is not.
    expect(filterRows(ROWS, 'cost>0.010000', SPEC).rows.map((r) => r.id)).toEqual(['c1', 'c2']);
  });

  it('compares dates as instants', () => {
    expect(filterRows(ROWS, 'created>2026-08-05', SPEC).rows.map((r) => r.id)).toEqual(['c1', 'c2']);
  });

  it('prefix-matches on a trailing star', () => {
    expect(filterRows(ROWS, 'model:gpt-4.1*', SPEC).rows.map((r) => r.id)).toEqual(['c1', 'c3']);
  });

  it('reports an unknown field instead of narrowing by it', () => {
    const { rows, ignored } = filterRows(ROWS, 'nonsense:x provider:openai', SPEC);
    expect(ignored).toEqual(['nonsense:x']);
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c3']);
  });

  it('reports a comparison it cannot evaluate rather than emptying the table', () => {
    // The dangerous failure is the opposite: a term that quietly matched nothing would read as
    // "there are no such rows" rather than "that was not a number".
    const { rows, ignored } = filterRows(ROWS, 'latency>abc', SPEC);
    expect(ignored).toEqual(['latency>abc']);
    expect(rows).toHaveLength(3);
  });

  it('reports an unknown field even when there are no rows to probe', () => {
    expect(filterRows([], 'nonsense:x', SPEC).ignored).toEqual(['nonsense:x']);
  });

  it('treats a null column as empty rather than throwing', () => {
    expect(() => filterRows(ROWS, 'fellback:openai', SPEC)).not.toThrow();
    expect(filterRows(ROWS, 'fellback:openai', SPEC).rows).toHaveLength(0);
  });
});

describe('sortRows', () => {
  it('orders numbers numerically in both directions', () => {
    expect(sortRows(ROWS, 'latency', 'asc', SPEC).map((r) => r.latencyMs)).toEqual([120, 900, 2400]);
    expect(sortRows(ROWS, 'latency', 'desc', SPEC).map((r) => r.latencyMs)).toEqual([2400, 900, 120]);
  });

  it('orders money by value, not by string', () => {
    expect(sortRows(ROWS, 'cost', 'asc', SPEC).map((r) => r.id)).toEqual(['c3', 'c1', 'c2']);
  });

  it('falls back to the default when the field is not sortable', () => {
    expect(sortRows(ROWS, 'fellback', 'desc', SPEC).map((r) => r.id)).toEqual(
      sortRows(ROWS, 'created', 'desc', SPEC).map((r) => r.id),
    );
  });

  it('does not mutate the array it was given', () => {
    const before = ROWS.map((r) => r.id);
    sortRows(ROWS, 'cost', 'asc', SPEC);
    expect(ROWS.map((r) => r.id)).toEqual(before);
  });

  it('sorts an unparseable value last in both directions', () => {
    // Flipping the arrow must not promote a row that has no value to the top.
    const rows = [...ROWS, call({ id: 'c4', latencyMs: Number.NaN })];
    expect(sortRows(rows, 'latency', 'asc', SPEC).at(-1)?.id).toBe('c4');
    expect(sortRows(rows, 'latency', 'desc', SPEC).at(-1)?.id).toBe('c4');
  });
});


/**
 * The round-trip the filter builder is built on. One query string is the single source of
 * truth for both the search words and the chips, so a chip removed and a word deleted cannot
 * disagree about what is being asked — but only if these two are exact inverses.
 */
describe('parseQuery / serialiseQuery', () => {
  it('splits a query into its words and its filters', () => {
    const { words, filters } = parseQuery('ada backend state:completed cost>0.10');
    expect(words).toEqual(['ada', 'backend']);
    expect(filters.map((f) => [f.field, f.op, f.value])).toEqual([
      ['state', ':', 'completed'],
      ['cost', '>', '0.10'],
    ]);
  });

  it('round-trips a query unchanged', () => {
    const query = 'ada state:completed cost>0.10';
    const { words, filters } = parseQuery(query);
    expect(serialiseQuery(words, filters)).toBe(query);
  });

  it('round-trips a value with spaces through its quotes', () => {
    const { words, filters } = parseQuery('occupation:"senior backend engineer"');
    expect(filters[0].value).toBe('senior backend engineer');
    expect(serialiseQuery(words, filters)).toBe('occupation:"senior backend engineer"');
  });

  it('round-trips a quoted search phrase', () => {
    const { words, filters } = parseQuery('"senior backend"');
    expect(words).toEqual(['senior backend']);
    expect(serialiseQuery(words, filters)).toBe('"senior backend"');
  });

  it('keeps the prefix star, which is what the grammar means by starts-with', () => {
    const { words, filters } = parseQuery('action:security.*');
    expect(serialiseQuery(words, filters)).toBe('action:security.*');
  });

  it('is empty on an empty query, and emits no stray whitespace', () => {
    expect(parseQuery('')).toEqual({ words: [], filters: [] });
    expect(serialiseQuery([], [])).toBe('');
  });

  it('drops a filter without disturbing the words, and the reverse', () => {
    const { words, filters } = parseQuery('ada state:completed cost>0.10');
    expect(serialiseQuery(words, filters.filter((f) => f.field !== 'state'))).toBe(
      'ada cost>0.10',
    );
    expect(serialiseQuery([], filters)).toBe('state:completed cost>0.10');
  });
});
