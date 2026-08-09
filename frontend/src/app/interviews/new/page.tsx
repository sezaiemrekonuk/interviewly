'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useState, type ReactNode } from 'react';

import { ListingUpload } from '../../../components/setup/listing-upload';
import {
  RailBlock,
  RailFoot,
  RailMark,
  SplitShell,
  WorkBody,
  WorkTop,
} from '../../../components/shell/split-shell';
import { Button, Field, Input } from '../../../components/ui';
import { DEFAULT_LANDING_PATH } from '../../../lib/auth-redirect';
import { useCreateInterview, useSubmitProfile } from '../../../lib/query';
import { useErrorMessage } from '../../../lib/use-error-message';
import { useRequireAuth } from '../../../lib/use-require-auth';

import styles from './setup.module.css';

// I03's body has no round-shape enum, only `targetQuestionCount` (plus `hrQuestionCount` for
// the custom shape). These are the offered lengths; `custom` is the escape hatch.
const LENGTHS = [
  { key: 'fast', count: 6, label: 'lengthFast', meta: 'lengthFastMeta' },
  { key: 'medium', count: 10, label: 'lengthMedium', meta: 'lengthMediumMeta' },
  { key: 'long', count: 15, label: 'lengthLong', meta: 'lengthLongMeta' },
] as const;

type LengthKey = (typeof LENGTHS)[number]['key'] | 'custom';

// Per-round ceilings, mirroring I03's `setup.ts` — HR maxes out at 5, technical at 13.
const MAX_HR = 5;
const MAX_TECH = 13;

// Mirrors I03's deterministic split so the shape is visible *before* the create. The 201
// returns the same two counts, but setup navigates away on success, so the response copy is
// never on screen — this preview is the only place the split can be read (see task Notes).
function splitRounds(target: number): { hrCount: number; techCount: number } {
  const hrCount = Math.min(Math.max(2, Math.round(target * 0.4)), MAX_HR);
  return { hrCount, techCount: target - hrCount };
}

const ESCAPES: Record<string, string> = { n: '\n', '\\': '\\' };

/**
 * `?prefill=` carries a listing through a link — a job board, a shared URL, a bookmarklet.
 * Some senders represent newlines as C-style escapes (e.g. `\\n`). Only `\\n` and `\\\\` are
 * unescaped here so sequences like `C:\\temp` are not mutated.
 */
function unescapeText(raw: string): string {
  return raw.replace(/\\([n\\\\])/g, (_, char: string) => ESCAPES[char]);
}

/**
 * One hairline box, one lit cell — the same segmented control the locale switcher uses, built
 * on native radios so arrow keys, the label click target and the form semantics come free.
 */
function Segmented<T extends string>({
  legend,
  note,
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  legend: ReactNode;
  note?: ReactNode;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; meta?: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className={styles.group} disabled={disabled}>
      <legend className={styles.legend}>{legend}</legend>
      {note ? <p className={styles.groupNote}>{note}</p> : null}
      <div className={styles.track}>
        {options.map((option) => (
          <label key={option.value} className={styles.segment}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className={styles.segmentInput}
            />
            <span className={styles.segmentBody}>
              <span className={styles.segmentLabel}>{option.label}</span>
              {option.meta ? <span className={styles.segmentMeta}>{option.meta}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function InterviewSetup() {
  const { user, loading } = useRequireAuth();
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations('setup');
  const errorMessage = useErrorMessage();
  const create = useCreateInterview();
  const submitProfile = useSubmitProfile();

  const [mode, setMode] = useState<'text' | 'voice'>('voice');
  const [lengthKey, setLengthKey] = useState<LengthKey>('medium');
  const [customHr, setCustomHr] = useState('4');
  const [customTech, setCustomTech] = useState('6');
  const [jobText, setJobText] = useState(() => unescapeText(params.get('prefill') ?? ''));
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  if (loading || !user) return null;

  // The form is locked for the whole create→profile chain: `create.isPending` alone would
  // re-enable the CTA during the profile call and let a second submit fire mid-flow.
  const busy = create.isPending || submitProfile.isPending;

  const preset = LENGTHS.find((l) => l.key === lengthKey);
  const hr = Number(customHr);
  const tech = Number(customTech);
  const { hrCount, techCount } = preset
    ? splitRounds(preset.count)
    : { hrCount: hr, techCount: tech };
  const targetQuestionCount = hrCount + techCount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!jobText.trim()) {
      setFormError(errorMessage('LISTING_REQUIRED'));
      return;
    }

    // The custom shape is the only one that can be out of range, and it is checked here rather
    // than left to the 400: `min`/`max` on a number input are advisory, and the server's
    // VALIDATION_ERROR would not say which of the two fields was wrong.
    if (
      !preset &&
      (!Number.isInteger(hr) ||
        !Number.isInteger(tech) ||
        hr < 1 ||
        tech < 1 ||
        hr > MAX_HR ||
        tech > MAX_TECH)
    ) {
      setFormError(t('lengthCustomInvalid', { hrMax: MAX_HR, techMax: MAX_TECH }));
      return;
    }

    try {
      const result = await create.mutateAsync({
        mode,
        jobText: jobText.trim(),
        uploadId: uploadId ?? undefined,
        targetQuestionCount,
        // Omitted for a preset: the server owns the 40/60 split and re-deriving it here would
        // give it a second home. Sent for custom, which is the whole point of custom.
        ...(preset ? {} : { hrQuestionCount: hrCount }),
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
      <RailMark href="/" />
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
        {/* `noValidate`: `min`/`max` here are advisory hints (see the comment above), not a gate
            — native constraint validation would otherwise block the submit silently and the
            JS check below, which gives the specific too-many-HR / too-many-technical message,
            would never run. */}
        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          {/* The listing is the subject of this screen, so it leads the form. */}
          <ListingUpload
            value={jobText}
            onJobText={setJobText}
            onUploaded={setUploadId}
            disabled={busy}
          />

          <Segmented
            legend={t('mode')}
            name="mode"
            value={mode}
            disabled={busy}
            onChange={setMode}
            options={[
              { value: 'voice', label: t('modeVoice'), meta: t('modeVoiceMeta') },
              { value: 'text', label: t('modeText'), meta: t('modeTextMeta') },
            ]}
          />

          <Segmented
            legend={t('roundShape')}
            note={t('lengthCapNote')}
            name="length"
            value={lengthKey}
            disabled={busy}
            onChange={setLengthKey}
            options={[
              ...LENGTHS.map((l) => ({
                value: l.key as LengthKey,
                label: t(l.label),
                meta: t(l.meta),
              })),
              { value: 'custom' as LengthKey, label: t('lengthCustom') },
            ]}
          />

          {preset ? (
            <p className={styles.note}>{t('roundSplit', { hrCount, techCount })}</p>
          ) : (
            <div className={styles.row}>
              <Field label={t('customHr')}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_HR}
                    value={customHr}
                    onChange={(e) => setCustomHr(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>

              <Field label={t('customTech')}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_TECH}
                    value={customTech}
                    onChange={(e) => setCustomTech(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>
            </div>
          )}

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

/**
 * `useSearchParams` (the `?prefill=` listing) opts the tree into request-time rendering, and
 * Next requires the boundary to be explicit. Null fallback: this resolves in the same tick.
 */
export default function InterviewSetupPage() {
  return (
    <Suspense fallback={null}>
      <InterviewSetup />
    </Suspense>
  );
}
