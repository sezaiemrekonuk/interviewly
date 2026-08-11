/**
 * The `AiClient` method → prompt name + template variables mapping, in one place.
 *
 * `StubAiClient` and `LiveAiClient` compile the same prompts from the same arguments. When
 * that mapping lived in both, a new `{{var}}` in a prompt file would only ever be noticed by
 * whichever client the next test happened to run — the other would throw
 * `AI_PROMPT_BUILD_FAILED` in production. One table, both callers.
 */
import type {
  ConductTurnArgs,
  GenerateCandidatesArgs,
  GenerateInterviewTitleArgs,
  GenerateReportArgs,
  GenerateRoundQuestionsArgs,
  ReportIntegrity,
  ScoreAnswerArgs,
  TurnCompleteArgs,
} from './AiClient';

export const PROMPT_NAMES = {
  generateRoundQuestions: 'interview.question.generate',
  generateReport: 'interview.report.generate',
  scoreAnswer: 'interview.answer.score',
  generateCandidates: 'interview.question.candidates',
  generateInterviewTitle: 'interview.title.generate',
  conductTurn: 'interview.conduct.turn',
  turnComplete: 'interview.turn.complete',
} as const;

export type AiMethod = keyof typeof PROMPT_NAMES;

export function questionVars(args: GenerateRoundQuestionsArgs): Record<string, unknown> {
  return {
    roundType: args.roundType,
    count: args.count,
    language: args.language,
    jobListing: args.jobListing,
    candidateProfile: args.candidateProfile,
    candidateCv: args.candidateCv,
    priorTopics: args.priorTopics?.join(', ') || 'none',
  };
}

export function reportVars(args: GenerateReportArgs): Record<string, unknown> {
  return {
    language: args.language,
    perAnswerScores: args.perAnswerScores ? JSON.stringify(args.perAnswerScores) : 'none',
    transcript: args.transcript,
    candidateProfile: args.candidateProfile,
    candidateCv: args.candidateCv,
    endedReason: args.endedReason,
    // One string rather than two numbers: the prompt has to reason about the *ratio*, and a
    // model told "3" and "8" in separate fields reliably scores as though it saw eight.
    coverage: `${args.answeredCount} of ${args.plannedCount} planned questions were answered`,
    integrity: integrityLine(args.integrity),
  };
}

/** `1 time` / `3 times`. Cheaper than making the prompt parse "3 time(s)". */
function times(n: number): string {
  return n === 1 ? '1 time' : `${n} times`;
}

/**
 * C07 — the three integrity counts as ONE sentence, for the same reason `coverage` is one:
 * a model handed `injectionAttempts: 2` and `refusals: 1` in separate numeric fields treats
 * them as telemetry and writes a report that never mentions either. Prose it will act on.
 *
 * The zero case is stated positively and out loud rather than omitted. An absent variable is
 * a gap the model fills from the transcript, and a transcript containing an argument reads a
 * lot like a transcript containing a manipulation attempt if nothing says otherwise — v4's
 * "do not invent integrity problems" rule needs something concrete to point at.
 *
 * Ordering is load-bearing: counts first, quotes last. `PromptBuilder` truncates any bound
 * value at MAX_BLOCK_CHARS, so a candidate who pastes a novel loses their own quotes and
 * never the numbers.
 */
function integrityLine(integrity: ReportIntegrity): string {
  const attempts = integrity.flaggedUtterances.length;
  if (attempts === 0 && integrity.refusals === 0 && integrity.forcedAdvances === 0) {
    return (
      'no integrity concerns: no candidate message matched a manipulation pattern, the server ' +
      'never overruled the interviewer, and the interviewer was never forced to move on'
    );
  }

  const counts =
    `${attempts === 1 ? '1 candidate message' : `${attempts} candidate messages`} ` +
    'matched a manipulation pattern; ' +
    `the server overruled the interviewer ${times(integrity.refusals)}; ` +
    `the interviewer was forced to move on ${times(integrity.forcedAdvances)}`;

  if (attempts === 0) return counts;
  // ponytail: 300 chars per quote, uncapped in number. One flagged sentence is the signal —
  // the rest of a 4 000-character paste is padding, and the block cap above catches the
  // pathological case. Cap the list length too if a real interview ever produces dozens.
  const quoted = integrity.flaggedUtterances
    .map((text) => `"${text.slice(0, 300)}"`)
    .join(' | ');
  return `${counts}. The flagged candidate messages, verbatim: ${quoted}`;
}

/**
 * The one call whose variables are mostly conversation. `conversation` is flattened here
 * rather than in the client so both clients send the provider the same bytes — a builder that
 * received an array would `String(...)` it into `[object Object]` and the prompt would be
 * silently blind to the interview it is conducting.
 */
export function conductVars(args: ConductTurnArgs): Record<string, unknown> {
  return {
    personaBrief: args.personaBrief,
    personaName: args.personaName,
    roundType: args.roundType,
    language: args.language,
    jobListing: args.jobListing,
    candidateProfile: args.candidateProfile,
    candidateCv: args.candidateCv,
    currentQuestion: args.currentQuestion ?? 'none — you have not asked anything yet',
    currentIntent: args.currentIntent ?? 'none recorded',
    remainingTopics: args.remainingTopics.join(', ') || 'none',
    conversation: formatConversation(args.conversation),
    turnsLeftOnQuestion: args.turnsLeftOnQuestion,
    allowedActions: allowedActions(args).join(', '),
  };
}

/** `SPEAKER: text` blocks, oldest first — the shape the score prompt already uses for turns. */
function formatConversation(turns: ConductTurnArgs['conversation']): string {
  if (turns.length === 0) return 'none — the interview has not started';
  const speaker = { user: 'CANDIDATE', assistant: 'INTERVIEWER', system: 'SYSTEM' } as const;
  return turns.map((t) => `${speaker[t.role]}: ${t.content}`).join('\n\n');
}

/**
 * The guards, stated to the model as well as enforced by the server. Enforcement alone would
 * be enough for correctness and produces a worse interview: an interviewer that keeps trying
 * to hand over and keeps being refused spends its turns on the refusal instead of the
 * candidate. Telling it the truth up front is cheaper than correcting it afterwards — but it
 * is a hint, never the check. `conductor.ts` re-derives all of this.
 */
function allowedActions(args: ConductTurnArgs): string[] {
  // On the last turn a question has, `continue` is not a choice the server will honour:
  // `clampAction`'s drift guard rewrites it into an advance and writes "the interviewer was
  // moved on automatically" into the transcript. Offering it anyway is how a candidate ends up
  // cut off mid-clarification — the interviewer asks one more probe, the server overrules it,
  // and the round reads as a skip. Taking it off the list makes the interviewer close the
  // question in its own words instead, which is the same advance without the seam.
  const actions =
    args.turnsLeftOnQuestion <= 1 ? ['next_question'] : ['continue', 'next_question', 'show_widget'];
  if (args.mayHandOver) actions.push('handover');
  if (args.mayEnd) actions.push('end_interview');
  return actions;
}

export function turnCompleteVars(args: TurnCompleteArgs): Record<string, unknown> {
  return {
    language: args.language,
    // The gate reads a fragment against what was asked, so the opening turn — no question yet
    // — still has to compile rather than fail the build on a null.
    currentQuestion: args.currentQuestion ?? 'none — the interview has not started',
    utterance: args.utterance,
  };
}

export function scoreVars(args: ScoreAnswerArgs): Record<string, unknown> {
  return {
    language: args.language,
    question: args.question,
    transcript: args.transcript,
    candidateProfile: args.candidateProfile,
  };
}

export function titleVars(args: GenerateInterviewTitleArgs): Record<string, unknown> {
  return {
    language: args.language,
    jobListing: args.jobListing,
  };
}

export function candidateVars(args: GenerateCandidatesArgs): Record<string, unknown> {
  return {
    language: args.language,
    priorScore: args.priorScore,
    priorQuestion: args.priorQuestion,
    topicsUsed: args.topicsUsed.join(', ') || 'none',
  };
}
