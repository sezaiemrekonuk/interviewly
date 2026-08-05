'use client';

import { useId, type ReactNode } from 'react';

import styles from './ui.module.css';

/** What the field hands its control so the label, hint and error are actually wired. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: 'true';
}

export interface FieldProps {
  label: ReactNode;
  /** Quiet guidance under the control (13px, `--text-muted`). */
  hint?: ReactNode;
  /** A resolved message, never an error code — the caller looks the code up. */
  error?: ReactNode;
  required?: boolean;
  /** Override the generated id when the control needs a stable one (autofill, tests). */
  id?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label + control + hint + error, with `htmlFor`/`aria-describedby`/`aria-invalid` wired
 * from one place. A render prop rather than `cloneElement`: the control keeps its own
 * props (`register()` spreads, refs) and the wiring is visible at the call site.
 */
export function Field({ label, hint, error, required, id: idProp, children }: FieldProps) {
  const generated = useId();
  const id = idProp ?? generated;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? 'true' : undefined,
      })}

      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
