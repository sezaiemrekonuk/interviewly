'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { use, useEffect, useState } from 'react';

import { Mascot } from '../../../../components/mascot';
import { Button, Field, FileInput, Input, Textarea } from '../../../../components/ui';
import { apiPost } from '../../../../lib/api';
import {
  useProfile,
  useSaveProfileCard,
  useUploadCv,
  type AccountProfile,
  type ProfileCard,
} from '../../../../lib/query';
import { useErrorMessage } from '../../../../lib/use-error-message';
import { useRequireAuth } from '../../../../lib/use-require-auth';

import styles from './onboarding.module.css';
import { passedSteps } from './session-steps';

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

/** Nothing to merge: no value, and no row that carries one. A save here is a no-op PATCH. */
function isEmptyCard(card: ProfileCard): boolean {
  return Object.values(card.fields).every((value) =>
    Array.isArray(value) ? value.length === 0 : !value,
  );
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
  const uploadCvMutation = useUploadCv();

  // Only the fields the user has actually touched. The server's copy is the fallback below,
  // so nothing has to be mirrored into state when the query resolves — no hydration effect,
  // and a post-save refetch cannot stamp on a live edit.
  const [draft, setDraft] = useState<Draft>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);

  const profile = data?.profile;
  const fullName = draft.fullName ?? profile?.fullName ?? '';
  const jobTitle = draft.jobTitle ?? profile?.jobTitle ?? '';
  const interestsText = draft.interestsText ?? profile?.interestsText ?? '';
  // The server's copy, never a local echo of the last upload: `POST /uploads` writes
  // `users.cv_upload_id` itself, so the hint below survives a reload because it is reading
  // the same thing a reload would read (issue 62).
  const cvUploadId = data?.cvUploadId ?? null;
  const education =
    draft.education ??
    (profile?.education?.length
      ? profile.education.map((row) => ({ ...row, graduationYear: String(row.graduationYear) }))
      : [EMPTY_ROW]);

  // Where the server says this account should resume — and whether that is still binding.
  // It is a deep-link guard: once the visitor has explicitly left that card behind in this
  // session, re-deriving it must not drag them back, or Skip can never advance at all.
  const resumeStep = data ? firstUnfilledStep(data.profile) : null;
  const mustResume = resumeStep !== null && resumeStep < step && !passedSteps.has(resumeStep);

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

    if (mustResume) router.replace(`/onboarding/${resumeStep}`);
  }, [data, mustResume, resumeStep, router]);

  async function uploadCv(file: File) {
    setCvError(null);
    try {
      await uploadCvMutation.mutateAsync(file);
    } catch (err) {
      // A refused upload leaves the previously attached CV — if any — exactly where it was.
      setCvError(err instanceof Error ? err.message : 'UNKNOWN');
    }
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

  /** Leave this card behind for the rest of the session, then move on. */
  function advance() {
    passedSteps.add(step);
    router.push(`/onboarding/${step + 1}`);
  }

  async function saveAndContinue() {
    setSaveError(null);
    const card = cardFor();

    // An untouched card is a Skip with extra steps: PATCHing `{ education: [] }` saves
    // nothing and only gives the request a way to fail.
    if (isEmptyCard(card)) {
      await skip();
      return;
    }

    try {
      await saveCard.mutateAsync(card);
    } catch (err) {
      // A refused save keeps the draft on screen and does not advance (screen table).
      setSaveError(err instanceof Error ? err.message : 'UNKNOWN');
      return;
    }
    if (step === 3) {
      await complete();
      return;
    }
    advance();
  }

  async function skip() {
    if (step === 3) {
      await complete();
      return;
    }
    advance();
  }

  // A redirect from the effect above is a navigation, not a render: a completed account or
  // a too-far deep-link must never flash the card on its way out.
  const leaving = Boolean(data?.onboardingCompletedAt) || mustResume;
  if (authLoading || isPending || !data || leaving) return null;

  return (
    <section className={styles.card}>
      <div className={styles.mascotSlot}>
        <Mascot pose={STEP_POSE[step]} size={112} />
      </div>
      <p className={styles.progress}>{t('progress', { step, total: 3 })}</p>
      <h1 className={styles.title}>{t(`step${step}Title`)}</h1>
      <p className={styles.subtitle}>{t(`step${step}Subtitle`)}</p>

      {step === 1 && (
        <div className={styles.form}>
          <Field label={t('fullNameLabel')} id="fullName">
            {(control) => (
              <Input
                {...control}
                autoComplete="name"
                value={fullName}
                onChange={(event) => setDraft((d) => ({ ...d, fullName: event.target.value }))}
              />
            )}
          </Field>
          <Field label={t('jobTitleLabel')} id="jobTitle">
            {(control) => (
              <Input
                {...control}
                autoComplete="organization-title"
                value={jobTitle}
                onChange={(event) => setDraft((d) => ({ ...d, jobTitle: event.target.value }))}
              />
            )}
          </Field>
          {/* K8.7 non-negotiable: say what we do with the date of birth we collect. Not
              collected on this minimal build — see task Notes. */}
        </div>
      )}

      {step === 2 && (
        <div className={styles.form}>
          {education.map((row, index) => (
            <div key={index} className={styles.educationRow}>
              <Field label={t('schoolLabel')}>
                {(control) => (
                  <Input
                    {...control}
                    value={row.school}
                    onChange={(event) =>
                      editEducation((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, school: event.target.value } : r,
                        ),
                      )
                    }
                  />
                )}
              </Field>
              <Field label={t('degreeLabel')}>
                {(control) => (
                  <Input
                    {...control}
                    value={row.degree}
                    onChange={(event) =>
                      editEducation((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, degree: event.target.value } : r,
                        ),
                      )
                    }
                  />
                )}
              </Field>
              <Field label={t('fieldLabel')}>
                {(control) => (
                  <Input
                    {...control}
                    value={row.field}
                    onChange={(event) =>
                      editEducation((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, field: event.target.value } : r)),
                      )
                    }
                  />
                )}
              </Field>
              <Field label={t('graduationYearLabel')}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="numeric"
                    value={row.graduationYear}
                    onChange={(event) =>
                      editEducation((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, graduationYear: event.target.value } : r,
                        ),
                      )
                    }
                  />
                )}
              </Field>
            </div>
          ))}
          {education.length < 5 && (
            <Button
              variant="ghost"
              size="lg"
              className={styles.addRow}
              onClick={() => editEducation((rows) => [...rows, EMPTY_ROW])}
            >
              {t('addEducationRow')}
            </Button>
          )}

          {/* A06's `kind='cv'` upload — optional, and attached by `POST /uploads` itself
              (the pointer on the user row, the text on `users.profile`), so it never travels
              through the step-2 PATCH body and needs no Continue to persist. */}
          <Field
            label={t('cvLabel')}
            id="cvFile"
            hint={
              uploadCvMutation.isPending
                ? t('cvUploading')
                : cvUploadId
                  ? t('cvUploaded')
                  : undefined
            }
            error={cvError ? `${t('cvFailed')} ${errorMessage(cvError)}` : undefined}
          >
            {({ id, 'aria-describedby': describedBy }) => (
              <FileInput
                id={id}
                aria-describedby={describedBy}
                accept="application/pdf"
                disabled={uploadCvMutation.isPending}
                invalid={Boolean(cvError)}
                onFile={(file) => {
                  // Clearing the picker is not a detach: the CV is already on the account,
                  // and there is no endpoint that would take it back off.
                  if (file) void uploadCv(file);
                }}
              />
            )}
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className={styles.form}>
          <Field label={t('interestsLabel')} id="interestsText">
            {(control) => (
              <Textarea
                {...control}
                value={interestsText}
                onChange={(event) => setDraft((d) => ({ ...d, interestsText: event.target.value }))}
              />
            )}
          </Field>
        </div>
      )}

      {saveError && (
        <p className={styles.banner} role="alert">
          {t('saveFailed')} {errorMessage(saveError)}
        </p>
      )}

      <div className={styles.actions}>
        {step > 1 && (
          <Button variant="ghost" size="lg" onClick={() => router.push(`/onboarding/${step - 1}`)}>
            {t('back')}
          </Button>
        )}
        <Button variant="ghost" size="lg" className={styles.skip} onClick={skip}>
          {t('skipForNow')}
        </Button>
        <Button size="lg" loading={saveCard.isPending} onClick={saveAndContinue}>
          {step === 3 ? t('finish') : t('continueButton')}
        </Button>
      </div>
    </section>
  );
}
