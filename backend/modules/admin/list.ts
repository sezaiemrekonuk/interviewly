/**
 * The paging, searching and sorting every console list does identically.
 *
 * Five handlers were already repeating the `take: limit + 1` / `slice` / `nextCursor` dance,
 * and adding a query language and a sort to each of them would have been five chances to get
 * the cursor's order-sensitivity wrong in a different way. The read itself stays in each
 * handler — the `where` shape, the includes and the projection are genuinely per-table.
 */
import type { Request } from 'express';

import { pageLimit } from '../interview/cursor';

import {
  compileQuery,
  compileSort,
  decodeListCursor,
  encodeListCursor,
  type CompiledQuery,
  type CompiledSort,
  type FieldKind,
  type TableSpec,
} from './query-language';

export interface ListParams {
  limit: number;
  /** ANDed onto whatever discrete filters the endpoint already applies. */
  search: CompiledQuery;
  sort: CompiledSort;
  /** The row to page from, already validated against the current order. */
  cursorId: string | undefined;
  /**
   * The fields this table accepts, with the kind and the enum values that go with each.
   *
   * Echoed rather than duplicated in the client because the console builds its filter controls
   * from this: a `state` field arrives knowing it is an enum and knowing its nine values, so
   * the operator picks from a list instead of being told to type one. A client-side copy of the
   * whitelist would drift the first time a field was renamed, and drift into a dropdown whose
   * options the server no longer accepts.
   */
  fields: FieldDescriptor[];
  sortable: string[];
}

export interface FieldDescriptor {
  name: string;
  kind: FieldKind;
  /** `enum` only — the exact set the control offers. */
  values?: string[];
}

export function listParams(query: Request['query'], spec: TableSpec, now?: Date): ListParams {
  const sort = compileSort(query.sort, query.dir, spec);
  return {
    limit: pageLimit(query.limit),
    // `now` is the caller's, not `new Date()`: the acceptance ring moves a fixed clock, and a
    // real-clock comparison inside the compiler would never see it move.
    search: compileQuery(query.q, spec, now),
    sort,
    fields: Object.entries(spec.fields).map(([name, field]) => ({
      name,
      kind: field.kind,
      ...(field.values ? { values: [...field.values] } : {}),
    })),
    sortable: spec.sortable,
    // Decoded against THIS request's order, so a cursor from a different sort is dropped and
    // the caller lands on page one rather than in the middle of a list they never asked for.
    cursorId: decodeListCursor(query.cursor, sort),
  };
}

/**
 * The `findMany` arguments that are the same on every list. Spread over the per-table `where`,
 * `include` and `select`.
 *
 * `take: limit + 1` is the whole next-page mechanism: the extra row is never returned, it only
 * answers whether one exists. A handler that took exactly `limit` would report `nextCursor:
 * null` on a full page and lose everything after it.
 */
export function findManyArgs(params: ListParams, cursorExists: boolean) {
  return {
    orderBy: params.sort.orderBy,
    take: params.limit + 1,
    ...(cursorExists && params.cursorId
      ? { cursor: { id: params.cursorId }, skip: 1 }
      : {}),
  };
}

export interface ListEnvelope<T> {
  items: T[];
  nextCursor: string | null;
  /** Echoed so the console can show which terms bit and which it should warn about. */
  query: { applied: string[]; ignored: string[]; fields: FieldDescriptor[] };
  sort: { field: string; dir: 'asc' | 'desc'; sortable: string[] };
}

/**
 * Trims the lookahead row, mints the next cursor, and echoes what the search actually did.
 *
 * `ignored` is not decoration. A mistyped field that vanished silently would leave an operator
 * reading an unnarrowed list as though it were narrowed — the one failure mode a search box
 * must not have.
 */
export function listEnvelope<Row, Item>(
  rows: Row[],
  params: ListParams,
  project: (row: Row) => Item,
  idOf: (row: Row) => string,
): ListEnvelope<Item> {
  const page = rows.slice(0, params.limit);
  const more = rows.length > params.limit;

  return {
    items: page.map(project),
    nextCursor:
      more && page.length > 0
        ? encodeListCursor(idOf(page[page.length - 1]), params.sort)
        : null,
    query: {
      applied: params.search.applied,
      ignored: params.search.ignored,
      fields: params.fields,
    },
    sort: { field: params.sort.field, dir: params.sort.dir, sortable: params.sortable },
  };
}
