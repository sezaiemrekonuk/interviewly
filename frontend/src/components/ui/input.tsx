'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';

import styles from './ui.module.css';

/**
 * The house text input. React 19 passes `ref` as an ordinary prop, so `register()` from
 * react-hook-form spreads straight through with no `forwardRef` wrapper.
 *
 * `reveal` turns a password field into one with a show/hide control (issue 145). It lives
 * here rather than at the auth call site so the 44px target and the app-wide focus ring come
 * from the same place every other control gets them, and so the next password field inherits
 * it instead of re-implementing it.
 */
export function Input({
  className,
  reveal = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  /** Offer a show/hide toggle. Only meaningful with `type="password"`. */
  reveal?: boolean;
}) {
  const t = useTranslations('common');
  const [shown, setShown] = useState(false);
  // The label has to name the *result* of pressing, and it changes with the state, so the
  // control needs its own id for nothing — the accessible name is the text itself.
  const generated = useId();

  const canReveal = reveal && rest.type === 'password';

  const control = (
    <input
      {...rest}
      type={canReveal && shown ? 'text' : rest.type}
      className={[styles.control, canReveal ? styles.controlWithAction : null, className]
        .filter(Boolean)
        .join(' ')}
    />
  );

  if (!canReveal) return control;

  return (
    <div className={styles.inputWrap}>
      {control}
      <button
        type="button"
        key={generated}
        className={styles.inputAction}
        // Not `aria-pressed`: the name already says what the next press does, and a toggle
        // that announces both state and action reads as two contradictory facts.
        onClick={() => setShown((on) => !on)}
        disabled={rest.disabled}
        tabIndex={rest.disabled ? -1 : undefined}
      >
        {shown ? t('hidePassword') : t('showPassword')}
      </button>
    </div>
  );
}
