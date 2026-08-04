'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Mascot } from '../../../components/mascot';
import { ListingUpload } from '../../../components/setup/listing-upload';
import { useCreateInterview } from '../../../lib/query';
import { useErrorMessage } from '../../../lib/use-error-message';
import { useRequireAuth } from '../../../lib/use-require-auth';

import styles from './setup.module.css';

// I03's body has no round-shape enum, only `targetQuestionCount`. These are the offered shapes.
const ROUND_SHAPES = [6, 8, 10] as const;

// Mirrors I03's deterministic split so the shape is visible *before* the create. The 201
// returns the same two counts, but setup navigates away on success, so the response copy is
// never on screen — this preview is the only place the split can be read (see task Notes).
function splitRounds(target: number): { hrCount: number; techCount: number } {
  const hrCount = Math.max(2, Math.round(target * 0.4));
  return { hrCount, techCount: target - hrCount };
}

export default function InterviewSetupPage() {
  const { user, loading } = useRequireAuth();
  const router = useRouter();
  const t = useTranslations('setup');
  const errorMessage = useErrorMessage();
  const create = useCreateInterview();

  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [occupation, setOccupation] = useState('');
  const [language, setLanguage] = useState('en');
  const [targetQuestionCount, setTargetQuestionCount] = useState<number>(8);
  const [jobText, setJobText] = useState('');
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  if (loading || !user) return null;

  const { hrCount, techCount } = splitRounds(targetQuestionCount);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Pasted text is required even with an uploadId: I03 rejects an upload-only body as
    // VALIDATION_ERROR until I11 hands the extracted text back. Sending it would spend a
    // round trip to earn a message that does not name the actual problem.
    if (!jobText.trim()) {
      setFormError(errorMessage('LISTING_REQUIRED'));
      return;
    }

    try {
      const result = await create.mutateAsync({
        mode,
        jobText: jobText.trim(),
        uploadId: uploadId ?? undefined,
        targetQuestionCount,
      });
      // Never optimistic: the room is entered only once the create has resolved an id.
      router.push(
        mode === 'voice'
          ? `/interviews/${result.interviewId}/pre-join`
          : `/interviews/${result.interviewId}/room`,
      );
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN';
      setFormError(errorMessage(code));
    }
  }

  return (
    <main className={styles.ground}>
      <section className={styles.card}>
        <Mascot pose="point" size={96} alt="" className={styles.mascot} />
        <h1 className={styles.title}>{t('title')}</h1>

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* Client-side only. `POST /interviews` takes neither field: I03 classifies the
              occupation from the listing text and reads the language off the session. */}
          <label className={styles.field}>
            {t('occupation')}
            <input
              value={occupation}
              onChange={(e) => setOccupation(e.target.value)}
              disabled={create.isPending}
            />
          </label>

          <label className={styles.field}>
            {t('language')}
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={create.isPending}
            >
              <option value="en">EN</option>
              <option value="tr">TR</option>
            </select>
          </label>

          <p className={styles.pending}>{t('choiceNotSent')}</p>

          <label className={styles.field}>
            {t('mode')}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'text' | 'voice')}
              disabled={create.isPending}
            >
              <option value="text">{t('modeText')}</option>
              <option value="voice">{t('modeVoice')}</option>
            </select>
          </label>

          <label className={styles.field}>
            {t('roundShape')}
            <select
              value={targetQuestionCount}
              onChange={(e) => setTargetQuestionCount(Number(e.target.value))}
              disabled={create.isPending}
            >
              {ROUND_SHAPES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <p className={styles.split}>{t('roundSplit', { hrCount, techCount })}</p>
          <p className={styles.pending}>{t('detectedSummaryPending')}</p>

          <ListingUpload
            onJobText={setJobText}
            onUploaded={setUploadId}
            disabled={create.isPending}
          />

          {formError ? (
            <p role="alert" className={styles.error}>
              {formError}
            </p>
          ) : null}

          <button type="submit" className={styles.cta} disabled={create.isPending}>
            {create.isPending ? t('starting') : t('start')}
          </button>
        </form>
      </section>
    </main>
  );
}
