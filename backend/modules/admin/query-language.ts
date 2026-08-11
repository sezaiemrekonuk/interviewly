/**
 * The console's filter query language, and the sort whitelist that travels with it.
 *
 * One grammar for every admin list, because five tables with five ad-hoc search boxes is five
 * chances to disagree about what `created>2026-08-01` means. A term is one of:
 *
 *   ada@example.com          a bare word — matched against the table's declared text columns
 *   "senior backend"         a quoted phrase — the same, but spaces survive
 *   state:completed          field:value — exact, enum-checked, or contains, per the field
 *   action:security.*        a trailing `*` on a text field makes it a prefix match
 *   fellback:true            presence — the column is (or is not) null
 *   cost>0.10                a comparison on a number, a decimal or a date
 *
 * Terms AND together. There is no `OR` and no parenthesis: nobody asked for one, and a grammar
 * with precedence is a grammar with a precedence bug.
 *
 * **An unknown field is never an error.** It comes back in `ignored` and the console says so.
 * A 422 would make a mistyped field name a failed page, and silently dropping it would make a
 * mistyped field name look like a filter that matched everything — which is the dangerous one,
 * because the operator believes the list in front of them is narrowed when it is not.
 */
import { Prisma } from '@prisma/client';

export type FieldKind =
  | 'text' // contains, case-insensitive; a trailing `*` makes it startsWith
  | 'exact' // equals, verbatim — ids
  | 'enum' // equals, checked against `values`
  | 'number' // Int column
  | 'decimal' // Decimal(12,6) column — money
  | 'date' // DateTime column
  | 'presence' // `true` → NOT NULL, `false` → NULL
  | 'computed'; // built by the spec's own `build`, from a value the schema does not hold

export interface FieldSpec {
  /**
   * The Prisma path, dotted for a relation: `user.email_lower` becomes
   * `{ user: { email_lower: … } }`. Dotted rather than nested-object so a spec reads as a
   * table of columns rather than a tree.
   */
  path: string;
  kind: FieldKind;
  /** `enum` only. A value outside this set makes the term ignored, not empty-matching. */
  values?: readonly string[];
  /**
   * `computed` only. Produces the whole condition — `path` is unused — for a question the
   * schema cannot answer with one column. Returns `null` to have the term ignored.
   *
   * Exists for exactly one field: a session is "active" when it is neither revoked nor past
   * its expiry, which is two columns and the server's clock. Without this it would have had to
   * stay a separate query parameter and a separate toggle in the UI, beside a filter control
   * that claims to cover every field.
   */
  build?: (value: string, now: Date) => Record<string, unknown> | null;
}

export interface TableSpec {
  /** Field name (what the operator types) → column. */
  fields: Record<string, FieldSpec>;
  /** The fields a bare word searches, OR'd together. */
  freeText: string[];
  /** Field names that may be sorted on, plus the default. */
  sortable: string[];
  defaultSort: string;
  /**
   * A sortable name whose ordering is not one of `fields`. Only a relation count so far
   * (`orderBy: { interviews: { _count } }`), which is a thing Prisma can order by and cannot
   * filter on — hence a sort-side escape hatch rather than a field.
   */
  sortOverrides?: Record<string, (dir: 'asc' | 'desc') => Record<string, unknown>>;
}

export type Op = ':' | '>' | '<' | '>=' | '<=';

export interface ParsedTerm {
  field: string | null;
  op: Op;
  value: string;
  /** The term exactly as it was typed, for echoing back an ignored one. */
  raw: string;
}

/**
 * Splits on whitespace, but keeps a double-quoted run together. Written as a scan rather than
 * a regex with a lookbehind: an unclosed quote has to degrade into "the rest of the line",
 * because an operator half-way through typing a phrase is the normal state of a search box,
 * not an error.
 */
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

/** `cost>=0.10` → `{ field: 'cost', op: '>=', value: '0.10' }`. A bare word has a null field. */
export function parseTerm(token: string): ParsedTerm {
  const match = /^([a-zA-Z][a-zA-Z0-9_]*)(>=|<=|:|>|<)(.*)$/.exec(token);
  // A bare word keeps its colons — an email is not a field lookup, and `ada@example.com`
  // must not be read as the field `ada@example`.
  if (!match || match[3] === '') return { field: null, op: ':', value: token, raw: token };
  return { field: match[1], op: match[2] as Op, value: match[3], raw: token };
}

/** `user.email_lower` + a leaf condition → `{ user: { email_lower: <leaf> } }`. */
function nest(path: string, leaf: unknown): Record<string, unknown> {
  return path
    .split('.')
    .reverse()
    .reduce<unknown>((inner, key) => ({ [key]: inner }), leaf) as Record<string, unknown>;
}

const COMPARATORS: Record<Exclude<Op, ':'>, 'gt' | 'lt' | 'gte' | 'lte'> = {
  '>': 'gt',
  '<': 'lt',
  '>=': 'gte',
  '<=': 'lte',
};

/**
 * One term → one Prisma leaf, or `null` when the term cannot be honoured (unknown field,
 * an enum value that is not one of the enum's, a date that is not a date). `null` is what puts
 * the term in `ignored`.
 */
function leafFor(spec: FieldSpec, term: ParsedTerm): unknown | null {
  const { op, value } = term;

  // Handled by `compileQuery`, which owns the clock — a leaf cannot express two columns.
  if (spec.kind === 'computed') return null;

  if (op !== ':') {
    const comparator = COMPARATORS[op];
    if (spec.kind === 'number') {
      const n = Number(value);
      return Number.isFinite(n) ? { [comparator]: Math.trunc(n) } : null;
    }
    if (spec.kind === 'decimal') {
      // `Decimal` throws on garbage rather than yielding NaN, and a thrown parse would 500 a
      // page on a string the operator is still typing.
      try {
        return { [comparator]: new Prisma.Decimal(value) };
      } catch {
        return null;
      }
    }
    if (spec.kind === 'date') {
      const at = new Date(value);
      return Number.isNaN(at.getTime()) ? null : { [comparator]: at };
    }
    // `state>completed` is not a question. Comparison is for ordered kinds only.
    return null;
  }

  switch (spec.kind) {
    case 'presence':
      if (value === 'true') return { not: null };
      if (value === 'false') return null_();
      return null;
    case 'enum':
      return spec.values?.includes(value) ? value : null;
    case 'exact':
      return value;
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'decimal':
      try {
        return new Prisma.Decimal(value);
      } catch {
        return null;
      }
    case 'date': {
      // `created:2026-08-11` is the DAY, not the instant midnight — an equality against a
      // timestamp would match nothing, which reads as "no such interviews" rather than
      // "you asked the wrong question".
      const from = new Date(value);
      if (Number.isNaN(from.getTime())) return null;
      const to = new Date(from);
      to.setUTCDate(to.getUTCDate() + 1);
      return { gte: from, lt: to };
    }
    default:
      return value.endsWith('*')
        ? { startsWith: value.slice(0, -1), mode: 'insensitive' }
        : { contains: value, mode: 'insensitive' };
  }
}

/** `{ equals: null }` rather than a bare `null`, which Prisma reads as "no filter". */
const null_ = () => ({ equals: null });

export interface CompiledQuery {
  /** ANDed conditions. Empty when nothing was understood. */
  where: Record<string, unknown>;
  /** Terms that were understood, for the console to show as applied chips. */
  applied: string[];
  /** Terms that were not, verbatim. The console shows these; the list is not narrowed by them. */
  ignored: string[];
}

/**
 * Compiles a search string against one table's spec.
 *
 * Every condition lands under a single `AND`, including the bare-word `OR`s, so a second bare
 * word narrows rather than widens: `ada backend` means both, which is what a search box is
 * expected to mean.
 */
export function compileQuery(input: unknown, spec: TableSpec, now = new Date()): CompiledQuery {
  const applied: string[] = [];
  const ignored: string[] = [];
  const and: Record<string, unknown>[] = [];

  if (typeof input !== 'string' || input.trim() === '') return { where: {}, applied, ignored };

  for (const token of tokenize(input)) {
    const term = parseTerm(token);

    if (term.field === null) {
      const or = spec.freeText
        .map((name) => {
          const field = spec.fields[name];
          if (!field) return null;
          // A bare word is a substring hunt, whatever the column's declared kind — an id
          // column is `exact` for `id:…` and still worth a partial match when typed loose.
          return nest(field.path, { contains: term.value, mode: 'insensitive' });
        })
        .filter((clause): clause is Record<string, unknown> => clause !== null);

      if (or.length === 0) ignored.push(term.raw);
      else {
        and.push({ OR: or });
        applied.push(term.raw);
      }
      continue;
    }

    const field = spec.fields[term.field];
    if (!field) {
      ignored.push(term.raw);
      continue;
    }

    // A computed field builds its own whole condition; everything else nests one leaf.
    const condition =
      field.kind === 'computed'
        ? term.op === ':'
          ? (field.build?.(term.value, now) ?? null)
          : null
        : (() => {
            const leaf = leafFor(field, term);
            return leaf === null ? null : nest(field.path, leaf);
          })();

    if (condition === null) {
      ignored.push(term.raw);
      continue;
    }

    and.push(condition);
    applied.push(term.raw);
  }

  return { where: and.length > 0 ? { AND: and } : {}, applied, ignored };
}

export interface CompiledSort {
  field: string;
  dir: 'asc' | 'desc';
  /** Always ends with `id`, so the order is total and a cursor cannot repeat or skip a row. */
  orderBy: Record<string, unknown>[];
}

/**
 * The sort, validated against the whitelist and always made total.
 *
 * The `id` tie-break is not optional. Prisma resolves a cursor by seeking to the cursor row's
 * position **in the given order**, so an order with ties has no single position to seek to —
 * two rows sharing a `created_at` can land on both pages or on neither. Appending `id` gives
 * every row a distinct position; it is the same reason the unsorted lists already order on
 * `[created_at, id]`.
 */
export function compileSort(
  field: unknown,
  dir: unknown,
  spec: TableSpec,
): CompiledSort {
  const name = typeof field === 'string' && spec.sortable.includes(field) ? field : spec.defaultSort;
  const direction = dir === 'asc' ? 'asc' : 'desc';
  const override = spec.sortOverrides?.[name];
  const column = spec.fields[name];
  const primary = override ? override(direction) : column ? nest(column.path, direction) : null;

  return {
    field: name,
    dir: direction,
    orderBy: [...(primary ? [primary] : []), { id: direction }],
  };
}

/**
 * A cursor that carries the order it was minted under.
 *
 * `base64url(sort:dir:id)`, replacing the plain `base64url(id)` the admin lists used. A cursor
 * is only meaningful inside one ordering: hand a `created`-desc cursor to a `cost`-asc query
 * and Prisma will seek to that row's position in the NEW order, which is a real position and
 * an arbitrary one — the operator gets a page from the middle of a list they never asked for,
 * with no error. Re-sorting therefore drops the cursor and returns to page one, which is what
 * clicking a column header means anyway.
 */
export function encodeListCursor(id: string, sort: CompiledSort): string {
  return Buffer.from(`${sort.field}:${sort.dir}:${id}`).toString('base64url');
}

const CUID = /^[a-z0-9]{20,32}$/;

/** `undefined` when the cursor is absent, malformed, or was minted under a different order. */
export function decodeListCursor(value: unknown, sort: CompiledSort): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;

  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const [field, dir, id] = decoded.split(':');
  if (field !== sort.field || dir !== sort.dir) return undefined;
  return id && CUID.test(id) ? id : undefined;
}
