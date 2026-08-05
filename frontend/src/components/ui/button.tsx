import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './ui.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Work is in flight: the label holds its width, a spinner takes its place. */
  loading?: boolean;
  children: ReactNode;
}

/**
 * The one CTA shape (ui §4.1): pill radius, `--primary` filled for the single primary
 * action on a surface, `secondary`/`ghost` for everything beside it. `--accent` is
 * informational and is never a button background here.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      // A loading button is not disabled-looking, but it must not fire twice.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      <span className={styles.buttonLabel}>{children}</span>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
    </button>
  );
}
