'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Field, FileInput, Textarea } from '../ui';
import { apiUpload } from '../../lib/api';
import { useErrorMessage } from '../../lib/use-error-message';

import styles from './setup.module.css';

/**
 * The listing is the setup screen's subject: a labelled textarea that leads the form, with the
 * PDF offered underneath as a clearly separate alternative — never docked against the input as
 * a bare "Choose File".
 *
 * The two are one value, not two. `POST /uploads` answers a listing with the text it parsed out
 * of the PDF, and that text lands in the textarea, where it is editable like anything pasted.
 * The candidate never transcribes a file the server has already read.
 */
export function ListingUpload({
  value,
  onUploaded,
  onJobText,
  disabled = false,
}: {
  value: string;
  onUploaded: (uploadId: string | null) => void;
  onJobText: (text: string) => void;
  /** The create is in flight — the whole form locks, this control included. */
  disabled?: boolean;
}) {
  const t = useTranslations('setup');
  const errorMessage = useErrorMessage();
  const [uploading, setUploading] = useState(false);
  const [extracted, setExtracted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    setError(null);
    setExtracted(null);
    if (!file) {
      onUploaded(null);
      return;
    }
    setUploading(true);
    // I11: kind=listing, magic-byte/size checked server-side — the client never parses the PDF.
    const result = await apiUpload<{ uploadId: string; text?: string }>('listing', file);
    setUploading(false);
    if (!result.ok) {
      setError(errorMessage(result.code ?? 'UNKNOWN'));
      onUploaded(null);
      return;
    }
    onUploaded(result.data!.uploadId);
    const text = result.data!.text?.trim();
    if (text) {
      onJobText(text);
      setExtracted(file.name);
    }
  }

  const locked = uploading || disabled;

  return (
    <div className={styles.listing}>
      {/* No `required` asterisk: the hint says what the text is for and the submit guard
          names the miss (`LISTING_REQUIRED`) where the failure happens. */}
      <Field label={t('listingPaste')} hint={t('listingHint')}>
        {(control) => (
          <Textarea
            {...control}
            className={styles.textarea}
            rows={7}
            value={value}
            disabled={locked}
            onChange={(event) => onJobText(event.target.value)}
          />
        )}
      </Field>

      <div className={styles.alt}>
        <hr className={styles.rule} />
        <Field id="listing-pdf" label={t('listingUpload')} hint={t('listingUploadHint')}>
          {(control) => (
            <FileInput
              id={control.id}
              aria-describedby={control['aria-describedby']}
              disabled={locked}
              invalid={error !== null}
              onFile={handleFile}
            />
          )}
        </Field>
        {/* `status`, not `alert`: the text arriving is the expected outcome, and the textarea
            above already shows it. Screen readers get the confirmation without an interrupt. */}
        {extracted ? (
          <p role="status" className={styles.extracted}>
            {t('listingExtracted', { filename: extracted })}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
