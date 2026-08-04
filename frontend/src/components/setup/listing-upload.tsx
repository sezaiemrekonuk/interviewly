'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { apiUpload } from '../../lib/api';
import { useErrorMessage } from '../../lib/use-error-message';

// I11: kind=listing, magic-byte/size checked server-side — client only filters accept types.
const ACCEPT = 'application/pdf';

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

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    const result = await apiUpload<{ uploadId: string }>('listing', file);
    setUploading(false);
    if (!result.ok) {
      setError(errorMessage(result.code ?? 'UNKNOWN'));
      onUploaded(null);
      return;
    }
    onUploaded(result.data!.uploadId);
  }

  return (
    <div>
      <textarea
        aria-label={t('listingPaste')}
        style={{ font: 'inherit' }}
        onChange={(e) => onJobText(e.target.value)}
        disabled={uploading || disabled}
      />
      <input
        type="file"
        accept={ACCEPT}
        aria-label={t('listingUpload')}
        disabled={uploading || disabled}
        onChange={(e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          input.value = '';
          if (file) void handleFile(file);
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
