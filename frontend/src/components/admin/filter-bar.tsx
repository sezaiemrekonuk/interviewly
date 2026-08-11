'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Field, Input, Select } from '../ui';

import styles from './filter-bar.module.css';

/**
 * One control in the bar. `label` is already-translated text — the bar owns only the four
 * strings that are the same on every admin section (`filters.{all,clear,applied,heading}`),
 * so a section adding a filter adds a key to its own namespace and passes it in.
 */
export type FilterControl =
  | { kind: 'select'; name: string; label: string; options: { value: string; label: string }[] }
  | { kind: 'text'; name: string; label: string }
  | { kind: 'toggle'; name: string; label: string };

/**
 * The console's filter bar. Fully controlled: it holds no filter state of its own (the text
 * box's in-flight keystrokes are not filter state), so the caller is free to keep `value` in
 * the URL and the bar reflects a back button without being told.
 *
 * Native controls throughout, through `components/ui` so the 44px target and the app-wide
 * `--accent` focus ring come from the same place every other control gets them.
 */
export function FilterBar({
  controls,
  value,
  onChange,
}: {
  controls: FilterControl[];
  /** A key is present only while its filter is set — an unset filter is an absent key. */
  value: Record<string, string | undefined>;
  onChange: (next: Record<string, string | undefined>) => void;
}) {
  const t = useTranslations('admin');

  // The debounced text commit fires up to 300ms after the keystroke, by which time a select
  // may already have written a newer `value`. Merging onto the props captured at keystroke
  // time would silently undo that select, so the merge reads the latest props instead.
  const latest = useRef({ value, onChange });
  // In an effect rather than assigned during render: writing a ref while rendering is what
  // `react-hooks/refs` refuses, and it is refused for a real reason — under a concurrent
  // re-render that is thrown away, the ref keeps the discarded render's props.
  useEffect(() => {
    latest.current = { value, onChange };
  });

  const set = (name: string, next: string | undefined) => {
    const merged = { ...latest.current.value };
    // Deleted, not set to undefined: callers turn this object into query params, and a key
    // whose value is undefined is a key they have to remember to skip.
    if (next) merged[name] = next;
    else delete merged[name];
    latest.current.onChange(merged);
  };

  const applied = Object.values(value).filter(Boolean).length;

  return (
    // <search> rather than <form>: there is nothing to submit — every control applies on
    // change — and a form would answer Enter in the text box with a page navigation.
    <search className={styles.bar} aria-label={t('filters.heading')} data-testid="admin-filter-bar">
      <div className={styles.controls}>
        {controls.map((control) => {
          if (control.kind === 'text') {
            return (
              <div className={styles.control} key={control.name}>
                <TextFilter
                  name={control.name}
                  label={control.label}
                  value={value[control.name]}
                  commit={set}
                />
              </div>
            );
          }

          if (control.kind === 'toggle') {
            return (
              <div className={styles.control} key={control.name}>
                {/* The label wraps the box, so the text is the hit target and there is no id
                    to keep in sync. */}
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    data-testid={`admin-filter-${control.name}`}
                    checked={value[control.name] === 'true'}
                    onChange={(event) => set(control.name, event.target.checked ? 'true' : undefined)}
                  />
                  <span className={styles.toggleLabel}>{control.label}</span>
                </label>
              </div>
            );
          }

          return (
            <div className={styles.control} key={control.name}>
              <Field label={<span className={styles.eyebrow}>{control.label}</span>}>
                {(field) => (
                  <Select
                    {...field}
                    data-testid={`admin-filter-${control.name}`}
                    value={value[control.name] ?? ''}
                    onChange={(event) => set(control.name, event.target.value || undefined)}
                  >
                    {/* Prepended here so no caller can forget the escape hatch, and so
                        "unfiltered" is spelled the same way on every section. */}
                    <option value="">{t('filters.all')}</option>
                    {control.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          );
        })}
      </div>

      <div className={styles.status}>
        <p className={styles.count}>{t('filters.applied', { count: applied })}</p>
        {/* Hidden at zero rather than disabled: a control that can never do anything from
            here is chrome, and the count already says there is nothing to clear. */}
        {applied > 0 ? (
          <button type="button" className={styles.clear} onClick={() => onChange({})}>
            {t('filters.clear')}
          </button>
        ) : null}
      </div>
    </search>
  );
}

/**
 * Its own component because it is the one control with local state: the box holds the
 * keystrokes and the bar hears about them 300ms after the typing stops.
 */
function TextFilter({
  name,
  label,
  value,
  commit,
}: {
  name: string;
  label: string;
  value: string | undefined;
  commit: (name: string, next: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What this box last put into `value`. Without it the echo of our own commit arrives
  // mid-word and resets the box to the prefix the user has already typed past.
  const committed = useRef(value ?? '');

  useEffect(() => {
    const incoming = value ?? '';
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
      committed.current = next.trim();
      commit(name, next.trim() || undefined);
    }, 300);
  };

  return (
    <Field label={<span className={styles.eyebrow}>{label}</span>}>
      {(field) => (
        <Input
          {...field}
          type="search"
          data-testid={`admin-filter-${name}`}
          value={draft}
          onChange={(event) => type(event.target.value)}
        />
      )}
    </Field>
  );
}
