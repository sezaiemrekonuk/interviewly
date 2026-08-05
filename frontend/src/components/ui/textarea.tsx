import type { TextareaHTMLAttributes } from 'react';

import styles from './ui.module.css';

/** Same skin as `<Input>`, taller and vertically resizable only. */
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={[styles.control, styles.textarea, className].filter(Boolean).join(' ')}
    />
  );
}
