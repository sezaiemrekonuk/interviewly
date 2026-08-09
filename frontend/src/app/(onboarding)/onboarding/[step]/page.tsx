'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { use, useEffect, useState } from 'react';

import {
  cardProblem,
  toDrafts,
  toRows,
  type EducationDraft,
} from '../../../../components/profile/education-draft';
import {
  CvField,
  EducationFields,
  IdentityFields,
  InterestsFields,
  type IdentityValues,
  type InterestsValues,
} from '../../../../components/profile/profile-fields';
import { Meter } from '../../../../components/shell/meter';
import {
  RailBlock,
  RailFoot,
  RailMark,
  SplitShell,
  WorkBody,
  WorkTop,
} from '../../../../components/shell/split-shell';
import { Button } from '../../../../components/ui';
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

const TOTAL_STEPS = 3;

interface Draft {
  identity?: IdentityValues;
  education?: EducationDraft[];
  interests?: InterestsValues;
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
  const tFields = useTranslations('fields');
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
  const identity: IdentityValues = {
    fullName: draft.identity?.fullName ?? profile?.fullName ?? '',
    jobTitle: draft.identity?.jobTitle ?? profile?.jobTitle ?? '',
  };
  const interests: InterestsValues = {
    interestsText: draft.interests?.interestsText ?? profile?.interestsText ?? '',
  };
  const education = draft.education ?? toDrafts(profile?.education);
  // The server's copy, never a local echo of the last upload: `POST /uploads` writes
  // `users.cv_upload_id` itself, so the state below survives a reload because it is reading
  // the same thing a reload would read (issue 62).
  const cv = data?.cv ?? null;

  // Where the server says this account should resume — and whether that is still binding.
  // It is a deep-link guard: once the visitor has explicitly left that card behind in this
  // session, re-deriving it must not drag them back, or Skip can never advance at all.
  const resumeStep = data ? firstUnfilledStep(data.profile) : null;
  const mustResume = resumeStep !== null && resumeStep < step && !passedSteps.has(resumeStep);

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
    if (step === 1) return { step: 1, fields: identity };
    if (step === 2) return { step: 2, fields: { education: toRows(education) } };
    return { step: 3, fields: interests };
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

    // A half-typed education row is refused whole by the server, which would read here as a
    // bare "this step was not saved". Answer it in the card, where the row is.
    if (step === 2) {
      const problem = cardProblem(education);
      if (problem) {
        setSaveError(problem === 'year' ? 'educationYear' : 'educationIncomplete');
        return;
      }
    }

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

  // The two card-local problems carry their own sentence; an API code is looked up instead.
  const saveMessage =
    saveError === 'educationIncomplete' || saveError === 'educationYear'
      ? tFields(saveError)
      : saveError
        ? `${t('saveFailed')} ${errorMessage(saveError)}`
        : null;

  // Direction B's one shell: the rail says where in the flow this is and what the step is
  // for, the working surface holds the fields and nothing else.
  const rail = (
    <>
      <RailMark />

      <RailBlock
        label={t('progress', { step, total: TOTAL_STEPS })}
        note={t(`step${step}Subtitle`)}
      >
        {/* Decorative: the label above it is the same fact in words (ui §4.4). */}
        <Meter value={step} max={TOTAL_STEPS} tone="primary" decorative onRail />
      </RailBlock>

      {/* Which account is being set up. Two sign-ups in one browser is the whole reason. */}
      <RailFoot>
        <span className={styles.account}>{user?.email}</span>
      </RailFoot>
    </>
  );

  return (
    <SplitShell rail={rail}>
      <WorkTop title={t(`step${step}Title`)} />
      <WorkBody className={styles.body}>
        <div className={styles.form}>
          {step === 1 && (
            <IdentityFields
              values={identity}
              onChange={(patch) => setDraft((d) => ({ ...d, identity: { ...identity, ...patch } }))}
            />
          )}

          {step === 2 && (
            <>
              <EducationFields
                rows={education}
                onChange={(rows) => setDraft((d) => ({ ...d, education: rows }))}
              />
              {/* A06's `kind='cv'` upload — optional, and attached by `POST /uploads` itself
                  (the pointer on the user row, the text on `users.profile`), so it never travels
                  through the step-2 PATCH body and needs no Continue to persist. */}
              <CvField
                cv={cv}
                uploading={uploadCvMutation.isPending}
                error={cvError ? `${tFields('cvFailed')} ${errorMessage(cvError)}` : null}
                onFile={(file) => void uploadCv(file)}
                onReject={setCvError}
              />
            </>
          )}

          {step === 3 && (
            <InterestsFields
              values={interests}
              onChange={(patch) =>
                setDraft((d) => ({ ...d, interests: { ...interests, ...patch } }))
              }
            />
          )}
        </div>

        {saveMessage && (
          <p className={styles.banner} role="alert">
            {saveMessage}
          </p>
        )}

        <div className={styles.actions}>
          {step > 1 && (
            <Button
              variant="ghost"
              size="lg"
              onClick={() => router.push(`/onboarding/${step - 1}`)}
            >
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
      </WorkBody>
    </SplitShell>
  );
}
