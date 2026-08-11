/**
 * The same search grammar, over rows already in memory.
 *
 * Three console tables are not endpoints: the drill-down's calls and events arrive whole inside
 * `GET /admin/interviews/:id`, and the dead letter arrives inside `GET /admin/queue`. They are
 * bounded by construction — 500, 200 and 20 rows — so filtering them is a predicate over an
 * array, not a round trip.
 *
 * **`backend/modules/admin/query-language.ts` is the authority on this grammar.** This is a
 * deliberate second implementation, not a shared module: the backend compiles to a Prisma
 * `where` and this compiles to a predicate, so the only thing they could share is the ~25-line
 * tokenizer, and hoisting that into a cross-package runtime import to save 25 lines would put a
 * new build-graph edge between `frontend` and `packages` for no behavioural gain. What keeps
 * the two honest is that both sides pin the grammar in their own tests — change one rule and a
 * test on each side has to change with it.
 *
 * The subset is deliberate too. No enum validation and no prefix `*` on comparisons: those
 * exist server-side to refuse a query the database would answer wrongly, and here every value
 * is already a rendered string.
 */

export type RowFieldKind = 'text' | 'number' | 'date';

export interface RowField<T> {
  get: (row: T) => unknown;
  kind: RowFieldKind;
}

export interface RowSpec<T> {
  fields: Record<string, RowField<T>>;
  /** The fields a bare word searches. */
  freeText: string[];
  sortable: string[];
  defaultSort: string;
}

/** Splits on whitespace, keeping a double-quoted run together. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

export type Op = ':' | '>' | '<' | '>=' | '<=';

export interface Term {
  field: string | null;
  op: Op;
  value: string;
  raw: string;
}

function parseTerm(token: string): Term {
  const match = /^([a-zA-Z][a-zA-Z0-9_]*)(>=|<=|:|>|<)(.*)$/.exec(token);
  if (!match || match[3] === '') return { field: null, op: ':', value: token, raw: token };
  return { field: match[1], op: match[2] as Op, value: match[3], raw: token };
}

/** Everything reads as a string for a bare-word hunt; `null`/`undefined` is the empty string. */
const asText = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** A comparable number: a real number, a numeric string (money arrives as `"0.041200"`), or a date. */
function asNumber(value: unknown, kind: RowFieldKind): number | null {
  if (kind === 'date') {
    const at = new Date(asText(value));
    return Number.isNaN(at.getTime()) ? null : at.getTime();
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a term can be honoured at all, decided WITHOUT looking at a row — an unknown field
 * is unknown for every row, and an uncomparable value is uncomparable against every row.
 *
 * Keeping this row-independent is the whole point. Sampling a row to decide would make the
 * answer depend on which row was sampled, and would confuse "this term is meaningless" with
 * "this row happens not to have a value for it" — the second must narrow, the first must not.
 */
function expressible<T>(term: Term, spec: RowSpec<T>): boolean {
  if (term.field === null) return true;
  const field = spec.fields[term.field];
  if (!field) return false;
  return term.op === ':' || asNumber(term.value, field.kind) !== null;
}

function matches<T>(row: T, term: Term, spec: RowSpec<T>): boolean {
  if (term.field === null) {
    const needle = term.value.toLowerCase();
    return spec.freeText.some((name) => {
      const field = spec.fields[name];
      return field ? asText(field.get(row)).toLowerCase().includes(needle) : false;
    });
  }

  const field = spec.fields[term.field];
  if (!field) return false;

  if (term.op === ':') {
    const value = asText(field.get(row)).toLowerCase();
    const needle = term.value.toLowerCase();
    // A trailing `*` is a prefix match, the same as server-side.
    return needle.endsWith('*') ? value.startsWith(needle.slice(0, -1)) : value.includes(needle);
  }

  const left = asNumber(field.get(row), field.kind);
  const right = asNumber(term.value, field.kind);
  // A row whose own value will not parse simply does not match — it is not a reason to
  // discard the term for every other row.
  if (left === null || right === null) return false;

  switch (term.op) {
    case '>':
      return left > right;
    case '<':
      return left < right;
    case '>=':
      return left >= right;
    default:
      return left <= right;
  }
}

export interface FilteredRows<T> {
  rows: T[];
  /** Terms that could not be honoured. Shown, never silently dropped. */
  ignored: string[];
}

/**
 * Terms AND together, so every extra term narrows. A term that cannot be honoured is reported
 * and does NOT narrow — the alternative is a list that looks filtered and is not.
 */
export function filterRows<T>(rows: T[], query: string, spec: RowSpec<T>): FilteredRows<T> {
  const terms = tokenize(query).map(parseTerm);
  if (terms.length === 0) return { rows, ignored: [] };

  const usable = terms.filter((term) => expressible(term, spec));
  const ignored = terms.filter((term) => !expressible(term, spec)).map((term) => term.raw);

  return {
    rows: rows.filter((row) => usable.every((term) => matches(row, term, spec))),
    ignored,
  };
}

/**
 * A stable sort on one field, with no tie-break needed: this is an array in hand, not a cursor
 * over a table, and `Array.prototype.sort` has been required to be stable since ES2019.
 */
export function sortRows<T>(
  rows: T[],
  field: string,
  dir: 'asc' | 'desc',
  spec: RowSpec<T>,
): T[] {
  const column = spec.fields[spec.sortable.includes(field) ? field : spec.defaultSort];
  if (!column) return rows;

  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (column.kind === 'text') {
      return sign * asText(column.get(a)).localeCompare(asText(column.get(b)));
    }
    const left = asNumber(column.get(a), column.kind);
    const right = asNumber(column.get(b), column.kind);
    // An unparseable value sorts last in both directions rather than jumping to the top when
    // the arrow flips — a row with no value has no place in the order, in either.
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return sign * (left - right);
  });
}


/**
 * A `RowSpec` described the way the filter builder wants it.
 *
 * The three in-memory tables declare their fields as accessors, and the builder needs names and
 * kinds — this is the one translation between them, so neither has to know the other's shape.
 * `RowFieldKind` is a strict subset of the server's, so the descriptors drop straight in.
 */
export function fieldDescriptors<T>(spec: RowSpec<T>): { name: string; kind: RowFieldKind }[] {
  return Object.entries(spec.fields).map(([name, field]) => ({ name, kind: field.kind }));
}

/**
 * The query string, taken apart into the two things the filter builder shows: the words typed
 * into the search box, and the filters sitting above it as chips.
 *
 * The builder holds no state of its own beyond this — one string is the single source of truth,
 * so a chip removed and a word deleted cannot disagree about what is being asked. It also means
 * a query typed by hand, or restored from a link, arrives as chips rather than as raw syntax
 * the operator then has to read.
 */
export function parseQuery(query: string): { words: string[]; filters: Term[] } {
  const terms = tokenize(query).map(parseTerm);
  return {
    words: terms.filter((term) => term.field === null).map((term) => term.value),
    filters: terms.filter((term) => term.field !== null),
  };
}

/** A value with whitespace has to survive the tokenizer, which splits on it unless quoted. */
const quoteIfNeeded = (value: string): string => (/\s/.test(value) ? `"${value}"` : value);

/** The inverse of `parseQuery`. Words first, so the string reads the way it was typed. */
export function serialiseQuery(words: string[], filters: Term[]): string {
  return [
    ...words.map(quoteIfNeeded),
    ...filters.map((term) => `${term.field}${term.op}${quoteIfNeeded(term.value)}`),
  ]
    .join(' ')
    .trim();
}
