'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { use, useEffect, useState } from 'react';

import authStyles from '../../../../components/auth/auth.module.css';
import { Mascot } from '../../../../components/mascot';
import { apiPost, apiUpload } from '../../../../lib/api';
import {
  useProfile,
  useSaveProfileCard,
  type AccountProfile,
  type ProfileCard,
} from '../../../../lib/query';
import { useErrorMessage } from '../../../../lib/use-error-message';
import { useRequireAuth } from '../../../../lib/use-require-auth';

import styles from './onboarding.module.css';

const STEP_POSE = { 1: 'point', 2: 'think', 3: 'cheer' } as const;

/** The form's rows: `graduationYear` is a string until it is saved (an empty input is ''). */
interface EducationDraft {
  school: string;
  degree: string;
  field: string;
  graduationYear: string;
}

const EMPTY_ROW: EducationDraft = { school: '', degree: '', field: '', graduationYear: '' };

interface Draft {
  fullName?: string;
  jobTitle?: string;
  education?: EducationDraft[];
  interestsText?: string;
}

/** Which step a saved profile is missing, i.e. where server-driven resume lands. */
function firstUnfilledStep(profile: AccountProfile): 1 | 2 | 3 | null {
  if (!profile.fullName && !profile.jobTitle) return 1;
  if (!profile.education || profile.education.length === 0) return 2;
  if (!profile.hobbies?.length && !profile.interestsText) return 3;
  return null;
}

export default function OnboardingStepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step: stepParam } = use(params);
  const stepNumber = Number(stepParam);
  const step: 1 | 2 | 3 = stepNumber === 1 || stepNumber === 2 || stepNumber === 3 ? stepNumber : 1;
  const t = useTranslations('onboarding');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  // useRequireAuth redirects UNAUTHENTICATED itself; don't ask for the profile before it has.
  const { data, isPending } = useProfile(!authLoading && Boolean(user));
  const saveCard = useSaveProfileCard();

  // Only the fields the user has actually touched. The server's copy is the fallback below,
  // so nothing has to be mirrored into state when the query resolves — no hydration effect,
  // and a post-save refetch cannot stamp on a live edit.
  const [draft, setDraft] = useState<Draft>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cvUploading, setCvUploading] = useState(false);
  const [uploadedCvId, setUploadedCvId] = useState<string | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);

  const profile = data?.profile;
  const fullName = draft.fullName ?? profile?.fullName ?? '';
  const jobTitle = draft.jobTitle ?? profile?.jobTitle ?? '';
  const interestsText = draft.interestsText ?? profile?.interestsText ?? '';
  const cvUploadId = uploadedCvId ?? data?.cvUploadId ?? null;
  const education =
    draft.education ??
    (profile?.education?.length
      ? profile.education.map((row) => ({ ...row, graduationYear: String(row.graduationYear) }))
      : [EMPTY_ROW]);

  function editEducation(update: (rows: EducationDraft[]) => EducationDraft[]) {
    setDraft((current) => ({ ...current, education: update(current.education ?? education) }));
  }

  useEffect(() => {
    if (!data) return;

    // Completed onboarding is terminal — step 1 is never re-shown (A06 idempotence).
    if (data.onboardingCompletedAt) {
      router.replace('/interviews/new');
      return;
    }

    // Deep-linking straight to a later step is only honoured once the earlier ones are
    // actually filled — the server, not the URL, decides where resume lands.
    const resumeStep = firstUnfilledStep(data.profile);
    if (resumeStep !== null && resumeStep < step) router.replace(`/onboarding/${resumeStep}`);
  }, [data, step, router]);

  async function uploadCv(file: File) {
    setCvUploading(true);
    setCvError(null);
    const result = await apiUpload<{ uploadId: string }>('cv', file);
    setCvUploading(false);
    if (!result.ok) {
      setCvError(result.code);
      return;
    }
    setUploadedCvId(result.data?.uploadId ?? null);
  }

  function cardFor(): ProfileCard {
    if (step === 1) return { step: 1, fields: { fullName, jobTitle } };
    if (step === 2) {
      return {
        step: 2,
        fields: {
          education: education
            .filter((row) => row.school || row.degree || row.field || row.graduationYear)
            .map((row) => ({ ...row, graduationYear: Number(row.graduationYear) })),
        },
      };
    }
    return { step: 3, fields: { interestsText } };
  }

  async function complete() {
    // Replay of an already-complete account answers 200 too — same navigation, no error.
    const result = await apiPost('/me/profile/complete', {});
    if (!result.ok) {
      setSaveError(result.code);
      return;
    }
    router.replace('/interviews/new');
  }

  async function saveAndContinue() {
    setSaveError(null);
    try {
      await saveCard.mutateAsync(cardFor());
    } catch (err) {
      // A refused save keeps the draft on screen and does not advance (screen table).
      setSaveError(err instanceof Error ? err.message : 'UNKNOWN');
      return;
    }
    if (step === 3) {
      await complete();
      return;
    }
    router.push(`/onboarding/${step + 1}`);
  }

  async function skip() {
    if (step === 3) {
      await complete();
      return;
    }
    router.push(`/onboarding/${step + 1}`);
  }

  // A redirect from the effect above is a navigation, not a render: a completed account or
  // a too-far deep-link must never flash the card on its way out.
  const resumeStep = data ? firstUnfilledStep(data.profile) : null;
  const leaving = Boolean(data?.onboardingCompletedAt) || (resumeStep !== null && resumeStep < step);
  if (authLoading || isPending || !data || leaving) return null;

  return (
    <section className={authStyles.card}>
      <Mascot pose={STEP_POSE[step]} size={96} className={styles.mascot} />
      <p className={styles.progress}>{t('progress', { step, total: 3 })}</p>
      <h1 className={authStyles.title}>{t(`step${step}Title`)}</h1>
      <p className={authStyles.subtitle}>{t(`step${step}Subtitle`)}</p>

      {step === 1 && (
        <div className={authStyles.form}>
          <div className={authStyles.field}>
            <label className={authStyles.label} htmlFor="fullName">
              {t('fullNameLabel')}
            </label>
            <input
              id="fullName"
              className={authStyles.input}
              value={fullName}
              onChange={(event) => setDraft((d) => ({ ...d, fullName: event.target.value }))}
            />
          </div>
          <div className={authStyles.field}>
            <label className={authStyles.label} htmlFor="jobTitle">
              {t('jobTitleLabel')}
            </label>
            <input
              id="jobTitle"
              className={authStyles.input}
              value={jobTitle}
              onChange={(event) => setDraft((d) => ({ ...d, jobTitle: event.target.value }))}
            />
          </div>
          {/* K8.7 non-negotiable: say what we do with the date of birth we collect. Not
              collected on this minimal build — see task Notes. */}
        </div>
      )}

      {step === 2 && (
        <div className={authStyles.form}>
          {education.map((row, index) => (
            <div key={index} className={styles.educationRow}>
              <input
                className={authStyles.input}
                placeholder={t('schoolLabel')}
                value={row.school}
                onChange={(event) =>
                  editEducation((rows) =>
                    rows.map((r, i) => (i === index ? { ...r, school: event.target.value } : r)),
                  )
                }
              />
              <input
                className={authStyles.input}
                placeholder={t('degreeLabel')}
                value={row.degree}
                onChange={(event) =>
                  editEducation((rows) =>
                    rows.map((r, i) => (i === index ? { ...r, degree: event.target.value } : r)),
                  )
                }
              />
              <input
                className={authStyles.input}
                placeholder={t('fieldLabel')}
                value={row.field}
                onChange={(event) =>
                  editEducation((rows) =>
                    rows.map((r, i) => (i === index ? { ...r, field: event.target.value } : r)),
                  )
                }
              />
              <input
                className={authStyles.input}
                placeholder={t('graduationYearLabel')}
                value={row.graduationYear}
                onChange={(event) =>
                  editEducation((rows) =>
                    rows.map((r, i) =>
                      i === index ? { ...r, graduationYear: event.target.value } : r,
                    ),
                  )
                }
              />
            </div>
          ))}
          {education.length < 5 && (
            <button
              type="button"
              className={styles.addRow}
              onClick={() => editEducation((rows) => [...rows, EMPTY_ROW])}
            >
              {t('addEducationRow')}
            </button>
          )}

          {/* A06's `kind='cv'` upload — optional, and stored on the user row rather than in
              `users.profile`, so it never travels through the step-2 PATCH body. */}
          <div className={authStyles.field}>
            <label className={authStyles.label} htmlFor="cvFile">
              {t('cvLabel')}
            </label>
            <input
              id="cvFile"
              type="file"
              accept="application/pdf"
              disabled={cvUploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadCv(file);
              }}
            />
            {cvUploading && <p className={styles.progress}>{t('cvUploading')}</p>}
            {cvUploadId && !cvUploading && <p className={styles.progress}>{t('cvUploaded')}</p>}
            {cvError && <p className={authStyles.fieldError}>{errorMessage(cvError)}</p>}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={authStyles.form}>
          <div className={authStyles.field}>
            <label className={authStyles.label} htmlFor="interestsText">
              {t('interestsLabel')}
            </label>
            <textarea
              id="interestsText"
              className={authStyles.input}
              value={interestsText}
              onChange={(event) => setDraft((d) => ({ ...d, interestsText: event.target.value }))}
            />
          </div>
        </div>
      )}

      {saveError && <p className={authStyles.fieldError}>{errorMessage(saveError)}</p>}

      <div className={styles.actions}>
        {step > 1 && (
          <button
            type="button"
            className={styles.backButton}
            onClick={() => router.push(`/onboarding/${step - 1}`)}
          >
            {t('back')}
          </button>
        )}
        <button type="button" className={styles.skipButton} onClick={skip}>
          {t('skipForNow')}
        </button>
        <button
          type="button"
          className={authStyles.submit}
          disabled={saveCard.isPending}
          onClick={saveAndContinue}
        >
          {step === 3 ? t('finish') : t('continueButton')}
        </button>
      </div>
    </section>
  );
}
