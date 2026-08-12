'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { parseQuery, serialiseQuery, type Op, type Term } from '../../lib/row-query';
import { Field, Input, Select } from '../ui';

import styles from './filter-builder.module.css';

/** A field the table declares, straight from the response envelope's `query.fields`. */
export interface FilterField {
  name: string;
  kind: 'text' | 'exact' | 'enum' | 'number' | 'decimal' | 'date' | 'presence' | 'computed';
  values?: string[];
}

/**
 * The condition an operator picks, which is not the same thing as the operator the grammar
 * writes. `over` and `after` are both `>` — one reads right beside a price and the other
 * beside a date — and `startsWith` is `:` with a `*` glued to the value.
 */
type OpKey =
  | 'contains'
  | 'startsWith'
  | 'is'
  | 'over'
  | 'atLeast'
  | 'under'
  | 'atMost'
  | 'on'
  | 'after'
  | 'onAfter'
  | 'before'
  | 'onBefore';

const OP_SYMBOL: Record<OpKey, Op> = {
  contains: ':',
  startsWith: ':',
  is: ':',
  over: '>',
  atLeast: '>=',
  under: '<',
  atMost: '<=',
  on: ':',
  after: '>',
  onAfter: '>=',
  before: '<',
  onBefore: '<=',
};

/** Which conditions each kind offers, first one being that kind's default. */
const OPS: Record<FilterField['kind'], OpKey[]> = {
  text: ['contains', 'startsWith'],
  exact: ['is'],
  enum: ['is'],
  presence: ['is'],
  computed: ['is'],
  number: ['is', 'over', 'atLeast', 'under', 'atMost'],
  decimal: ['is', 'over', 'atLeast', 'under', 'atMost'],
  date: ['on', 'after', 'onAfter', 'before', 'onBefore'],
};

/** The reverse: a term already in the query, read back as the condition that would have made it. */
function opKeyOf(term: Term, kind: FilterField['kind'] | undefined): OpKey {
  if (term.op === ':') {
    // A trailing `*` is the grammar's prefix match, whatever the field turns out to be.
    if (term.value.endsWith('*')) return 'startsWith';
    if (kind === 'date') return 'on';
    return kind === 'text' ? 'contains' : 'is';
  }
  const dated = kind === 'date';
  switch (term.op) {
    case '>':
      return dated ? 'after' : 'over';
    case '>=':
      return dated ? 'onAfter' : 'atLeast';
    case '<':
      return dated ? 'before' : 'under';
    default:
      return dated ? 'onBefore' : 'atMost';
  }
}

/** The kinds whose value is a choice, not a typed string. `null` means "type it". */
function choicesFor(field: FilterField): string[] | null {
  if (field.kind === 'presence') return ['true', 'false'];
  if (field.kind === 'enum' || field.kind === 'computed') {
    return field.values && field.values.length > 0 ? field.values : null;
  }
  return null;
}

/** Whitespace normalised the way `serialiseQuery` normalises it, for the self-echo check. */
const settle = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The words half of a query, in the exact spelling `serialiseQuery` would give it back. */
const wordsOf = (query: string) => serialiseQuery(parseQuery(query).words, []);

/**
 * The console's filter builder — the point-and-click front for
 * `backend/modules/admin/query-language.ts`.
 *
 * It composes the same query string an operator used to type, so the server, the URL and a
 * shared link are all unchanged: what goes away is having to learn the syntax. The string is
 * the single source of truth — the chips and the search box are two views of it, not two
 * pieces of state that can disagree — so a query restored from a link arrives as chips rather
 * than as syntax the operator then has to read.
 *
 * Controlled from outside like the bar it replaces, so the caller can keep `value` in the URL
 * and this reflects a back button without being told.
 */
export function FilterBuilder({
  value,
  onChange,
  fields,
}: {
  /** The whole query string — the single source of truth. Chips and words both live in it. */
  value: string;
  /** Debounced for typing, immediate for a chip added or removed. */
  onChange: (next: string) => void;
  /** The table's fields, straight from the response envelope. */
  fields: FilterField[];
}) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const rowId = useId();

  const { filters } = parseQuery(value);
  // An older api container answers these lists with a bare `string[]` of field names and no
  // kinds. A filter control that throws over that takes the whole console down with it, so a
  // malformed entry is dropped: the search box and the chips still work, and the builder row
  // simply has nothing to offer.
  const known = fields.filter((field) => typeof field?.name === 'string');
  const byName = new Map(known.map((field) => [field.name, field]));

  // --- translation ---------------------------------------------------------------------

  /** `t` refuses an unknown key at runtime, so every dynamic key is asked about first. */
  const maybe = (key: string, fallback: string) => {
    const typed = key as Parameters<typeof t.has>[0];
    return t.has(typed) ? t(typed) : fallback;
  };

  // The raw name is the fallback rather than an error: the envelope is the server's whitelist
  // and may name a field this build has no string for yet. A field the operator cannot see is
  // worse than one labelled in English.
  const fieldLabel = (name: string) => maybe(`field.${name}`, name);

  const valueLabel = (field: FilterField | undefined, raw: string) => {
    if (field?.kind === 'enum' || field?.kind === 'computed') {
      // Four namespaces because the same value string is a state on one table, an ended
      // reason on another and a role on a third; first hit wins, raw if none of them do.
      for (const key of [`state.${raw}`, `endedReason.${raw}`, `users.role.${raw}`, `value.${raw}`]) {
        const typed = key as Parameters<typeof t.has>[0];
        if (t.has(typed)) return t(typed);
      }
    }
    if (field?.kind === 'presence' || field?.kind === 'computed') {
      if (raw === 'true') return t('filter.yes');
      if (raw === 'false') return t('filter.no');
    }
    return raw;
  };

  // --- the search box ------------------------------------------------------------------

  const [draft, setDraft] = useState(() => wordsOf(value));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The debounced commit fires up to 300ms after the keystroke, by which time a chip may
  // already have written a newer `value`. Merging onto the props captured at keystroke time
  // would silently undo that chip, so the merge reads the latest props instead.
  const latest = useRef({ value, onChange });
  // In an effect rather than assigned during render: writing a ref while rendering is what
  // `react-hooks/refs` refuses, and under a concurrent re-render that is thrown away the ref
  // would otherwise keep the discarded render's props.
  useEffect(() => {
    latest.current = { value, onChange };
  });

  // What this box last put into the words half. Without it the echo of our own commit arrives
  // mid-word and resets the box to the prefix the user has already typed past.
  const committed = useRef(settle(wordsOf(value)));

  useEffect(() => {
    const incoming = wordsOf(value);
    if (incoming === committed.current) return;
    committed.current = incoming;
    setDraft(incoming);
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const type = (next: string) => {
    setDraft(next);
    clearTimeout(timer.current);
    // One request per pause, not one per keystroke.
    timer.current = setTimeout(() => {
      committed.current = settle(next);
      // Only the words are replaced — typing must never disturb a chip, so the filters come
      // from the latest props and not from anything this box holds. A term typed in here
      // anyway (`state:completed`, pasted from an old link) is promoted to a chip rather than
      // dropped: the string is the source of truth, and those keystrokes just moved views.
      const current = parseQuery(latest.current.value);
      const drafted = parseQuery(next);
      latest.current.onChange(
        serialiseQuery(drafted.words, [...current.filters, ...drafted.filters]),
      );
    }, 300);
  };

  // --- chips ---------------------------------------------------------------------------

  const addRef = useRef<HTMLButtonElement>(null);

  const write = (next: Term[]) => {
    clearTimeout(timer.current);
    // The words come from the BOX, not from `value`. A chip applied inside the 300ms debounce
    // window would otherwise serialise the last committed words and throw away whatever is
    // sitting in the input — type a word, reach for Add filter, lose the word. Cancelling the
    // timer above is what makes this the last write rather than a race with it.
    const drafted = parseQuery(draft);
    committed.current = settle(draft);
    // Immediate, not debounced: a press is already the pause the debounce waits for.
    onChange(serialiseQuery(drafted.words, [...next, ...drafted.filters]));
  };

  const remove = (index: number) => {
    write(filters.filter((_, at) => at !== index));
    // The button that was focused is about to leave the DOM; without this the focus ring
    // falls back to <body> and a keyboard operator restarts from the top of the page.
    addRef.current?.focus();
  };

  // --- the builder row -----------------------------------------------------------------

  const [open, setOpen] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [opKey, setOpKey] = useState<OpKey>('is');
  const [typed, setTyped] = useState('');

  // Sorted by the *translated* label, so the list reads alphabetically in both locales rather
  // than in the order of identifiers only the server cares about.
  const sorted = [...known].sort((a, b) =>
    fieldLabel(a.name).localeCompare(fieldLabel(b.name), locale),
  );

  // Derived rather than synced by an effect: the selection is only ever "the one chosen, or
  // the first", and an effect that repaired it would render one frame of the wrong row.
  const selected = sorted.find((field) => field.name === fieldName) ?? sorted[0];
  const allowed = selected ? OPS[selected.kind] : [];
  const op = allowed.includes(opKey) ? opKey : (allowed[0] ?? 'is');
  const choices = selected ? choicesFor(selected) : null;
  // A select always has something selected, so its value is never empty and Apply is never
  // disabled for a kind that offers one.
  const chosen = choices ? (choices.includes(typed) ? typed : choices[0]) : typed;

  const reset = () => {
    setOpen(false);
    setFieldName('');
    setOpKey('is');
    setTyped('');
  };

  const apply = () => {
    if (!selected || !chosen.trim()) return;
    const symbol = OP_SYMBOL[op];
    // The grammar's prefix match: the star is part of the value, not part of the operator.
    const composed = op === 'startsWith' ? `${chosen.trim()}*` : chosen.trim();
    write([
      ...filters,
      { field: selected.name, op: symbol, value: composed, raw: `${selected.name}${symbol}${composed}` },
    ]);
    reset();
    addRef.current?.focus();
  };

  return (
    // <search> and not <form>: nothing is submitted — every change applies on settle or on
    // press — and a form would answer Enter in the box with a page navigation.
    <search
      className={styles.builder}
      aria-label={t('filter.heading')}
      data-testid="admin-filter-builder"
    >
      <div className={styles.search}>
        <Field label={<span className={styles.eyebrow}>{t('search.label')}</span>}>
          {(control) => (
            <Input
              {...control}
              type="search"
              data-testid="admin-search"
              placeholder={t('search.placeholder')}
              value={draft}
              onChange={(event) => type(event.target.value)}
            />
          )}
        </Field>
      </div>

      <div className={styles.applied}>
        {filters.length === 0 ? (
          <p className={styles.none}>{t('filter.none')}</p>
        ) : (
          <ul className={styles.chips}>
            {filters.map((term, index) => {
              const field = term.field ? byName.get(term.field) : undefined;
              const key = opKeyOf(term, field?.kind);
              const shown = key === 'startsWith' ? term.value.slice(0, -1) : term.value;
              return (
                <li className={styles.chip} key={`${term.raw}-${index}`} data-testid="admin-filter-chip">
                  <span className={styles.chipText}>
                    {t('filter.chip', {
                      field: fieldLabel(term.field ?? ''),
                      op: t(`op.${key}`),
                      value: valueLabel(field, shown),
                    })}
                  </span>
                  <button
                    type="button"
                    className={styles.remove}
                    data-testid="admin-filter-remove"
                    aria-label={t('filter.remove')}
                    onClick={() => remove(index)}
                  >
                    <span aria-hidden="true">&times;</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Only past one filter: with a single chip its own remove button already is
            "clear all", and two controls for one action is one too many. */}
        {filters.length > 1 ? (
          <button type="button" className={styles.button} onClick={() => write([])}>
            {t('filter.clearAll')}
          </button>
        ) : null}
      </div>

      {selected ? (
        <>
          <div className={styles.actions}>
            <button
              type="button"
              ref={addRef}
              className={styles.button}
              data-testid="admin-filter-add"
              aria-expanded={open}
              aria-controls={rowId}
              onClick={() => (open ? reset() : setOpen(true))}
            >
              {t('filter.add')}
            </button>
          </div>

          {/* Inline and not a dialog: it is three controls belonging to the bar they sit in,
              and a modal over a table hides the thing being filtered. */}
          {open ? (
            <div className={styles.row} id={rowId}>
              <div className={styles.control}>
                <Field label={<span className={styles.eyebrow}>{t('filter.fieldLabel')}</span>}>
                  {(control) => (
                    <Select
                      {...control}
                      data-testid="admin-filter-field"
                      value={selected.name}
                      onChange={(event) => {
                        const next = sorted.find((field) => field.name === event.target.value);
                        setFieldName(event.target.value);
                        // The old condition and the old value belong to the old kind: `over`
                        // on a date, or `completed` on a cost, would both be nonsense.
                        setOpKey(next ? OPS[next.kind][0] : 'is');
                        setTyped('');
                      }}
                    >
                      {sorted.map((field) => (
                        <option key={field.name} value={field.name}>
                          {fieldLabel(field.name)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>

              <div className={styles.control}>
                <Field label={<span className={styles.eyebrow}>{t('filter.opLabel')}</span>}>
                  {(control) => (
                    // Disabled rather than hidden when a kind offers one condition: a row
                    // that changes shape as you use it is harder to learn than one that does
                    // not, and the word is still the sentence's verb.
                    <Select
                      {...control}
                      data-testid="admin-filter-op"
                      disabled={allowed.length < 2}
                      value={op}
                      onChange={(event) => setOpKey(event.target.value as OpKey)}
                    >
                      {allowed.map((key) => (
                        <option key={key} value={key}>
                          {t(`op.${key}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>

              <div className={styles.control}>
                <Field label={<span className={styles.eyebrow}>{t('filter.valueLabel')}</span>}>
                  {(control) =>
                    choices ? (
                      <Select
                        {...control}
                        data-testid="admin-filter-value"
                        value={chosen}
                        onChange={(event) => setTyped(event.target.value)}
                      >
                        {choices.map((choice) => (
                          <option key={choice} value={choice}>
                            {valueLabel(selected, choice)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      // Native `type="date"` and `type="number"`: the platform already ships
                      // the picker, the locale's date order and the mobile keyboard.
                      <Input
                        {...control}
                        data-testid="admin-filter-value"
                        type={
                          selected.kind === 'date'
                            ? 'date'
                            : selected.kind === 'number' || selected.kind === 'decimal'
                              ? 'number'
                              : 'text'
                        }
                        step={
                          selected.kind === 'number'
                            ? '1'
                            : selected.kind === 'decimal'
                              ? // Decimal(12,6) server-side — money, so six places.
                                '0.000001'
                              : undefined
                        }
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                      />
                    )
                  }
                </Field>
              </div>

              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.button}
                  data-testid="admin-filter-apply"
                  disabled={!chosen.trim()}
                  onClick={apply}
                >
                  {t('filter.apply')}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => {
                    reset();
                    addRef.current?.focus();
                  }}
                >
                  {t('filter.cancel')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </search>
  );
}
