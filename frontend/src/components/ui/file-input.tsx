'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import styles from './ui.module.css';

/**
 * Mirrors `MAX_BYTES` in `backend/modules/interview/uploads.ts`. A courtesy, not the boundary:
 * the server still checks Content-Length, multer's limit and the parsed size, and this number
 * being stale can only ever cost a round trip the server then refuses correctly.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface FileInputProps {
  id?: string;
  name?: string;
  /** MIME filter passed to the native picker. Server-side validation still owns the truth. */
  accept?: string;
  disabled?: boolean;
  /** The upload failed or the field is required and empty: `--danger` border + `aria-invalid`. */
  invalid?: boolean;
  /** Called with the picked file, or `null` when the selection is cleared. */
  onFile: (file: File | null) => void;
  /** Refuse a bigger pick before any request goes out. */
  maxBytes?: number;
  /** A pick refused locally, as an error code — the caller renders it where its errors go. */
  onReject?: (code: 'UPLOAD_TOO_LARGE') => void;
  /** Overrides the default "Choose a PDF" call to action. */
  action?: string;
  /** Shown in place of the filename while nothing is selected. */
  emptyHint?: string;
  'aria-describedby'?: string;
}

/**
 * Replaces the browser's "Choose File" button with a sunken drop-target label. The real
 * `<input type="file">` is still there and still focusable — only visually hidden — so the
 * control stays keyboard- and screen-reader-native; the ring is drawn on the wrapper.
 */
export function FileInput({
  id,
  name,
  accept = 'application/pdf',
  disabled = false,
  invalid = false,
  onFile,
  maxBytes = MAX_UPLOAD_BYTES,
  onReject,
  action,
  emptyHint,
  'aria-describedby': describedBy,
}: FileInputProps) {
  const t = useTranslations('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function clear() {
    if (inputRef.current) inputRef.current.value = '';
    setFileName(null);
    onFile(null);
    inputRef.current?.focus();
  }

  const targetClasses = [
    styles.fileTarget,
    disabled ? styles.fileDisabled : null,
    invalid ? styles.fileInvalid : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={targetClasses}>
      <label className={styles.fileLabel}>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          accept={accept}
          disabled={disabled}
          className={styles.fileInput}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;

            // Refused at pick time, so a 40 MB PDF on a phone is not streamed in full only to
            // be told it was too big. `onFile(null)` before `onReject`: the call sites reset
            // their error on a cleared pick, and the refusal has to be what survives.
            if (file && file.size > maxBytes) {
              event.currentTarget.value = '';
              setFileName(null);
              onFile(null);
              onReject?.('UPLOAD_TOO_LARGE');
              return;
            }

            setFileName(file?.name ?? null);
            onFile(file);
          }}
        />
        <svg
          className={styles.fileGlyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 15V4" />
          <path d="M7.5 8.5 12 4l4.5 4.5" />
          <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
        </svg>
        <span className={styles.fileText}>
          <span className={styles.fileAction}>{action ?? t('chooseFile')}</span>
          <span className={styles.fileName}>{fileName ?? emptyHint ?? t('noFileChosen')}</span>
        </span>
      </label>

      {fileName ? (
        <button type="button" className={styles.fileClear} onClick={clear} disabled={disabled}>
          {t('clearFile')}
        </button>
      ) : null}
    </div>
  );
}
