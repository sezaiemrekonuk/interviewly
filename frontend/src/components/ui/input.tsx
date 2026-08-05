import type { InputHTMLAttributes } from 'react';

import styles from './ui.module.css';

/**
 * The house text input. React 19 passes `ref` as an ordinary prop, so `register()` from
 * react-hook-form spreads straight through with no `forwardRef` wrapper.
 */
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={[styles.control, className].filter(Boolean).join(' ')} />;
}
