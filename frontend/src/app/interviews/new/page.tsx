'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ListingUpload } from '../../../components/setup/listing-upload';
import {
  RailBlock,
  RailFoot,
  RailMark,
  SplitShell,
  WorkBody,
  WorkTop,
} from '../../../components/shell/split-shell';
import { Button, Field, Input, Select } from '../../../components/ui';
import { DEFAULT_LANDING_PATH } from '../../../lib/auth-redirect';
import { useCreateInterview, useSubmitProfile } from '../../../lib/query';
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
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateInterview();
  const submitProfile = useSubmitProfile();

  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [occupation, setOccupation] = useState('');
  const [language, setLanguage] = useState('en');
  const [targetQuestionCount, setTargetQuestionCount] = useState<number>(8);
  const [jobText, setJobText] = useState('');
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  if (loading || !user) return null;

  // The form is locked for the whole create→profile chain: `create.isPending` alone would
  // re-enable the CTA during the profile call and let a second submit fire mid-flow.
  const busy = create.isPending || submitProfile.isPending;

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
      // `profiling → hr_round` is the only exit from the born-parked state, and setup is its
      // only caller (issue 53). Skip the pre-question form for now: the room enters on
      // `hr_round` with a real question, never on `profiling`.
      await submitProfile.mutateAsync({ interviewId: result.interviewId, body: { skip: true } });
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

  // The context column says what is about to happen; the working surface holds the one form.
  // Nothing here repeats a value the form already shows — the round split is the hint on the
  // control that decides it, and it stays there.
  const rail = (
    <>
      <RailMark />
      <p className={styles.railLead}>{t('subtitle')}</p>

      <RailBlock label={t('railNextLabel')}>
        <ol className={styles.steps}>
          <li>{t('railStep1')}</li>
          <li>{t('railStep2')}</li>
          <li>{t('railStep3')}</li>
        </ol>
      </RailBlock>

      {/* The shell is the chrome now, so this screen carries its own way out. */}
      <RailFoot>
        <Link className={styles.back} href={DEFAULT_LANDING_PATH}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <path
              d="M9.5 3 4.5 8l5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('back')}
        </Link>
      </RailFoot>
    </>
  );

  return (
    <SplitShell rail={rail} width="wide">
      <WorkTop title={t('title')} />

      <WorkBody className={styles.body}>
        <form onSubmit={handleSubmit} className={styles.form}>
          {/* The listing is the subject of this screen, so it leads the form. */}
          <ListingUpload onJobText={setJobText} onUploaded={setUploadId} disabled={busy} />

          {/* Client-side only. `POST /interviews` takes neither field: I03 classifies the
              occupation from the listing text and reads the language off the session. */}
          <div className={styles.row}>
            <Field label={t('occupation')}>
              {(control) => (
                <Input
                  {...control}
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                  disabled={busy}
                />
              )}
            </Field>

            <Field label={t('language')}>
              {(control) => (
                <Select
                  {...control}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={busy}
                >
                  <option value="en">{tc('localeEnglish')}</option>
                  <option value="tr">{tc('localeTurkish')}</option>
                </Select>
              )}
            </Field>
          </div>

          <p className={styles.note}>{t('choiceNotSent')}</p>

          <div className={styles.row}>
            <Field label={t('mode')}>
              {(control) => (
                <Select
                  {...control}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'text' | 'voice')}
                  disabled={busy}
                >
                  <option value="text">{t('modeText')}</option>
                  <option value="voice">{t('modeVoice')}</option>
                </Select>
              )}
            </Field>

            {/* The split is the hint on the control that decides it, not a loose line. */}
            <Field label={t('roundShape')} hint={t('roundSplit', { hrCount, techCount })}>
              {(control) => (
                <Select
                  {...control}
                  value={targetQuestionCount}
                  onChange={(e) => setTargetQuestionCount(Number(e.target.value))}
                  disabled={busy}
                >
                  {ROUND_SHAPES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {formError ? (
            <p role="alert" className={styles.error}>
              {formError}
            </p>
          ) : null}

          <Button type="submit" size="lg" className={styles.cta} loading={busy}>
            {t('start')}
          </Button>
        </form>
      </WorkBody>
    </SplitShell>
  );
}
