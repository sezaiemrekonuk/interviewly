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
  /**
   * A pick refused locally, as an error code — the caller renders it where its errors go.
   * Both codes are the registry's own, so the sentence is the one the server would have sent
   * had the file been allowed to travel.
   */
  onReject?: (code: 'UPLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE') => void;
  /** Overrides the default "Choose a PDF" call to action. */
  action?: string;
  /** Shown in place of the filename while nothing is selected. */
  emptyHint?: string;
  'aria-describedby'?: string;
}

/**
 * Does the file match what the picker would have offered? `accept` is the same
 * comma-separated list the native input takes: MIME types, `type/*` wildcards, or extensions.
 *
 * Only the drop path needs this. The picker filters by `accept` itself, but a drag bypasses
 * it entirely — and letting a `.docx` through to the upload would spend a round trip to be
 * told by the server what the browser already knew.
 */
function matchesAccept(file: File, accept: string): boolean {
  const patterns = accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return true;

  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  // The browser could not resolve a media type — which happens for real files on systems whose
  // registry has no entry for the extension. "I don't know" is not "wrong": refusing here would
  // block a genuine PDF, and the server reads the magic bytes anyway.
  if (!type && !patterns.some((pattern) => pattern.startsWith('.'))) return true;

  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

/**
 * Replaces the browser's "Choose File" button with a sunken drop-target label. The real
 * `<input type="file">` is still there and still focusable — only visually hidden — so the
 * control stays keyboard- and screen-reader-native; the ring is drawn on the wrapper.
 *
 * It also takes a dropped file, which is what the box has looked like it does since it was
 * drawn. Dragging is a pointer gesture and cannot be the only way in — the input underneath
 * is still the keyboard's and the screen reader's, and everything a drop does goes through
 * the same two guards a pick does.
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
  const [dragging, setDragging] = useState(false);
  // `dragenter`/`dragleave` fire for every child the pointer crosses, so a boolean flickers as
  // the cursor moves from the box onto its own icon. Counting entries is what makes the
  // highlight hold until the pointer has genuinely left the target.
  const depth = useRef(0);

  function clear() {
    if (inputRef.current) inputRef.current.value = '';
    setFileName(null);
    onFile(null);
    inputRef.current?.focus();
  }

  /**
   * The one path a file takes, whichever way it arrived. `onFile(null)` before `onReject`:
   * the call sites reset their error on a cleared pick, and the refusal has to be what
   * survives.
   */
  function take(file: File | null): void {
    if (file && !matchesAccept(file, accept)) {
      reset();
      onReject?.('UNSUPPORTED_MEDIA_TYPE');
      return;
    }
    // Refused at pick time, so a 40 MB PDF on a phone is not streamed in full only to be told
    // it was too big.
    if (file && file.size > maxBytes) {
      reset();
      onReject?.('UPLOAD_TOO_LARGE');
      return;
    }

    setFileName(file?.name ?? null);
    onFile(file);
  }

  function reset(): void {
    if (inputRef.current) inputRef.current.value = '';
    setFileName(null);
    onFile(null);
  }

  const targetClasses = [
    styles.fileTarget,
    disabled ? styles.fileDisabled : null,
    invalid ? styles.fileInvalid : null,
    dragging ? styles.fileDragging : null,
  ]
    .filter(Boolean)
    .join(' ');

  /** A drag carrying files, as opposed to one carrying selected text or a link. */
  const carriesFiles = (event: React.DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  return (
    <div
      className={targetClasses}
      data-dragging={dragging || undefined}
      onDragEnter={(event) => {
        if (disabled || !carriesFiles(event)) return;
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        // Without this the browser keeps its own default — open the file in the tab — and no
        // `drop` is ever delivered here.
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (disabled) return;
        // One file, like the picker: `multiple` is not offered and taking the rest silently
        // would be a decision nobody made.
        const file = event.dataTransfer.files?.[0] ?? null;
        if (!file) return;

        // Push it into the real input too, so `clear()` empties the same thing the pick path
        // empties and a form reading `input.files` sees what the label is showing. Guarded:
        // `DataTransfer` is constructible in browsers and not everywhere else.
        if (inputRef.current && typeof DataTransfer !== 'undefined') {
          try {
            const carrier = new DataTransfer();
            carrier.items.add(file);
            inputRef.current.files = carrier.files;
          } catch {
            // Environment does not allow constructing/assigning `DataTransfer`.
          }
        }
        take(file);
      }}
    >
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
          onChange={(event) => take(event.currentTarget.files?.[0] ?? null)}
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
