'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Field, FileInput, Textarea } from '../ui';
import { apiUpload } from '../../lib/api';
import { useErrorMessage } from '../../lib/use-error-message';

import styles from './setup.module.css';

/**
 * The listing is the setup screen's subject: a labelled textarea in its own glowing block,
 * with the PDF offered underneath as a clearly separate alternative — never docked against
 * the input as a bare "Choose File".
 */
export function ListingUpload({
  onUploaded,
  onJobText,
  disabled = false,
}: {
  onUploaded: (uploadId: string | null) => void;
  onJobText: (text: string) => void;
  /** The create is in flight — the whole form locks, this control included. */
  disabled?: boolean;
}) {
  const t = useTranslations('setup');
  const errorMessage = useErrorMessage();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    setError(null);
    if (!file) {
      onUploaded(null);
      return;
    }
    setUploading(true);
    // I11: kind=listing, magic-byte/size checked server-side — the client never parses the PDF.
    const result = await apiUpload<{ uploadId: string }>('listing', file);
    setUploading(false);
    if (!result.ok) {
      setError(errorMessage(result.code ?? 'UNKNOWN'));
      onUploaded(null);
      return;
    }
    onUploaded(result.data!.uploadId);
  }

  const locked = uploading || disabled;

  return (
    <div className={styles.listing}>
      <div className={styles.glow}>
        {/* No `required` asterisk: the hint says what the text is for and the submit guard
            names the miss (`LISTING_REQUIRED`) where the failure happens. */}
        <Field label={t('listingPaste')} hint={t('listingHint')}>
          {(control) => (
            <Textarea
              {...control}
              className={styles.textarea}
              rows={7}
              disabled={locked}
              onChange={(event) => onJobText(event.target.value)}
            />
          )}
        </Field>
      </div>

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
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
