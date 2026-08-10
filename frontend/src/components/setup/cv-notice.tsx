'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useProfile, useUploadCv } from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';
import { CvField } from '../profile/profile-fields';

import styles from './setup.module.css';

/**
 * What the interview about to be created knows about the candidate.
 *
 * Not a warning, deliberately. A missing CV is not a failure — the interview runs without one,
 * and painting it in an alarm colour spends the meaning of that colour on a screen where the
 * only real problem is a refused create. It is a statement of fact with the fix beside it,
 * which is the shape DESIGN.md §4 asks for.
 *
 * The claim it makes is true and worth checking before the copy is edited: `profileVariables`
 * (`backend/modules/interview/generation.ts`) lifts the stored CV text out of the interview's
 * profile snapshot and hands it to the model as `candidateCv` — for question generation and,
 * through I09/K15, for scoring the answers too. Without one both prompts get nothing.
 *
 * `POST /uploads` is itself the write: it repoints `users.cv_upload_id` and stores the parsed
 * text. So there is no Save here, nothing to thread into the create, and a CV added on this
 * screen is on the account before Start is pressed.
 */
export function CvNotice({ disabled = false }: { disabled?: boolean }) {
  const t = useTranslations('setup');
  const tFields = useTranslations('fields');
  const format = useFormatter();
  const errorMessage = useErrorMessage();

  const { data, isPending } = useProfile();
  const upload = useUploadCv();
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  const cv = data?.cv ?? null;

  async function attach(file: File) {
    setError(null);
    try {
      await upload.mutateAsync(file);
      // The mutation invalidates the profile, so the line below re-renders from the server's
      // copy rather than from this answer — the same rule the onboarding card learned (#62).
      setReplacing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'UNKNOWN');
    }
  }

  const field = (
    <CvField
      cv={cv}
      uploading={upload.isPending || disabled}
      error={error ? `${tFields('cvFailed')} ${errorMessage(error)}` : null}
      onFile={(file) => void attach(file)}
      onReject={setError}
      // The block above already says what is on the account, in its own words. Both lines made
      // the same claim twice, and in Turkish with two different words for the document.
      showState={false}
    />
  );

  // Nothing until the profile has answered. "No CV attached" retracted a second later is worse
  // than a beat of silence, and this block is the first thing on the screen.
  if (isPending || !data) return null;

  if (cv) {
    // Which CV is in play, which is the fact worth carrying for anyone who has uploaded more
    // than one — and quiet, because there is nothing to do about it.
    return (
      <div className={styles.cvLine} data-testid="cv-attached">
        {replacing ? (
          field
        ) : (
          <p className={styles.note}>
            {t('cvAttached', {
              name: cv.filename ?? tFields('cvUnnamed'),
              date: format.dateTime(new Date(cv.uploadedAt), { dateStyle: 'medium' }),
            })}
          </p>
        )}
        <button
          type="button"
          className={styles.cvChange}
          onClick={() => setReplacing((open) => !open)}
          disabled={disabled}
        >
          {replacing ? t('cvKeep') : t('cvChange')}
        </button>
      </div>
    );
  }

  return (
    <section className={styles.cvNotice} data-testid="cv-notice">
      <h2 className={styles.cvNoticeTitle}>{t('cvTitle')}</h2>
      <p className={styles.note}>{t('cvBody')}</p>
      {field}
    </section>
  );
}
