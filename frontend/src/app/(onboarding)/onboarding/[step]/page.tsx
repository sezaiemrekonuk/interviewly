'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { use, useEffect, useState } from 'react';

import authStyles from '../../../../components/auth/auth.module.css';
import { apiGet, apiPost } from '../../../../lib/api';

import styles from './onboarding.module.css';

interface Education {
  school: string;
  degree: string;
  field: string;
  graduationYear: string;
}

interface Profile {
  fullName?: string;
  jobTitle?: string;
  dateOfBirth?: string;
  education?: Education[];
  hobbies?: string[];
  interestsText?: string;
}

const EMPTY_ROW: Education = { school: '', degree: '', field: '', graduationYear: '' };

/** Which step a saved profile is missing, i.e. where server-driven resume lands. */
function firstUnfilledStep(profile: Profile): 1 | 2 | 3 | null {
  if (!profile.fullName && !profile.jobTitle) return 1;
  if (!profile.education || profile.education.length === 0) return 2;
  if (!profile.hobbies?.length && !profile.interestsText) return 3;
  return null;
}

export default function OnboardingStepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step: stepParam } = use(params);
  const step = Number(stepParam) as 1 | 2 | 3;
  const t = useTranslations('onboarding');
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [education, setEducation] = useState<Education[]>([EMPTY_ROW]);
  const [interestsText, setInterestsText] = useState('');

  useEffect(() => {
    let active = true;
    apiGet<{ profile: Profile }>('/me/profile').then((result) => {
      if (!active || !result.data) return;
      const { profile } = result.data;

      // Deep-linking straight to a later step is only honoured once the earlier ones are
      // actually filled — the server, not the URL, decides where resume lands.
      const resumeStep = firstUnfilledStep(profile);
      if (resumeStep !== null && resumeStep < step) {
        router.replace(`/onboarding/${resumeStep}`);
        return;
      }

      setFullName(profile.fullName ?? '');
      setJobTitle(profile.jobTitle ?? '');
      setEducation(profile.education?.length ? profile.education : [EMPTY_ROW]);
      setInterestsText(profile.interestsText ?? '');
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [step, router]);

  async function goToNextStep() {
    if (step === 3) {
      await apiPost('/me/profile/complete', {});
      router.replace('/interviews/new');
      return;
    }
    router.push(`/onboarding/${step + 1}`);
  }

  async function saveAndContinue() {
    setSaving(true);
    if (step === 1) {
      await apiPost('/me/profile', { step: 1, fields: { fullName, jobTitle } });
    } else if (step === 2) {
      const rows = education
        .filter((row) => row.school || row.degree || row.field || row.graduationYear)
        .map((row) => ({ ...row, graduationYear: Number(row.graduationYear) }));
      await apiPost('/me/profile', { step: 2, fields: { education: rows } });
    } else {
      await apiPost('/me/profile', { step: 3, fields: { interestsText } });
    }
    setSaving(false);
    await goToNextStep();
  }

  async function skip() {
    if (step === 3) {
      await apiPost('/me/profile/complete', {});
      router.replace('/interviews/new');
      return;
    }
    router.push(`/onboarding/${step + 1}`);
  }

  if (loading) return null;

  return (
    <section className={authStyles.card}>
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
              onChange={(event) => setFullName(event.target.value)}
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
              onChange={(event) => setJobTitle(event.target.value)}
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
                  setEducation((rows) =>
                    rows.map((r, i) => (i === index ? { ...r, school: event.target.value } : r)),
                  )
                }
              />
              <input
                className={authStyles.input}
                placeholder={t('degreeLabel')}
                value={row.degree}
                onChange={(event) =>
                  setEducation((rows) =>
                    rows.map((r, i) => (i === index ? { ...r, degree: event.target.value } : r)),
                  )
                }
              />
              <input
                className={authStyles.input}
                placeholder={t('fieldLabel')}
                value={row.field}
                onChange={(event) =>
                  setEducation((rows) =>
                    rows.map((r, i) => (i === index ? { ...r, field: event.target.value } : r)),
                  )
                }
              />
              <input
                className={authStyles.input}
                placeholder={t('graduationYearLabel')}
                value={row.graduationYear}
                onChange={(event) =>
                  setEducation((rows) =>
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
              onClick={() => setEducation((rows) => [...rows, EMPTY_ROW])}
            >
              {t('addEducationRow')}
            </button>
          )}
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
              onChange={(event) => setInterestsText(event.target.value)}
            />
          </div>
        </div>
      )}

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
          disabled={saving}
          onClick={saveAndContinue}
        >
          {step === 3 ? t('finish') : t('continueButton')}
        </button>
      </div>
    </section>
  );
}
