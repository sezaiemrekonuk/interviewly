import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { shapeInterviewDetail } from './interview-detail';

type Detail = Parameters<typeof shapeInterviewDetail>[0];
type Call = Parameters<typeof shapeInterviewDetail>[1][number];
type Event = Parameters<typeof shapeInterviewDetail>[2][number];

const AT = new Date('2026-08-11T09:00:00.000Z');

const interview = (over: Partial<Detail> = {}): Detail =>
  ({
    id: 'itv_1',
    user_id: 'usr_1',
    user: { id: 'usr_1', email_lower: 'ada@example.com', role: 'user' },
    occupation_cluster: { key: 'software_engineering', label: 'Software' },
    reports: [],
    mode: 'text',
    language: 'en',
    state: 'completed',
    ended_reason: 'completed',
    occupation: 'developer',
    target_question_count: 5,
    hr_question_count: 2,
    budget_usd: new Prisma.Decimal('0.5'),
    spent_usd: new Prisma.Decimal('0.123456'),
    elapsed_seconds: 300,
    created_at: AT,
    started_at: AT,
    ended_at: null,
    deleted_at: null,
    ...over,
  }) as Detail;

const call = (over: Partial<Call> = {}): Call =>
  ({
    id: 'call_1',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    prompt_uuid: 'uuid-1',
    prompt_version: 3,
    attempt_no: 1,
    fell_back_from: null,
    units: new Prisma.Decimal('1200'),
    unit_kind: 'token',
    input_tokens: 800,
    output_tokens: 400,
    cost_usd: new Prisma.Decimal('0.0004'),
    latency_ms: 950,
    trace_id: 'trace_1',
    created_at: AT,
    ...over,
  }) as Call;

describe('admin interview detail projection', () => {
  it('keeps money at six decimals as strings, never as numbers', () => {
    const body = shapeInterviewDetail(interview(), [call()], [], false);
    expect(body.interview.spentUsd).toBe('0.123456');
    expect(body.interview.budgetUsd).toBe('0.500000');
    expect(body.calls[0].costUsd).toBe('0.000400');
  });

  it('carries every field US-26 asks a call row for', () => {
    const [row] = shapeInterviewDetail(interview(), [call({ fell_back_from: 'openai' })], [], false)
      .calls;
    expect(row).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      promptUuid: 'uuid-1',
      promptVersion: 3,
      fellBackFrom: 'openai',
      units: '1200',
      unitKind: 'token',
      latencyMs: 950,
    });
  });

  it('keeps a voice call on its own per-second row rather than folding it into tokens', () => {
    const voice = call({
      id: 'call_2',
      provider: 'elevenlabs',
      unit_kind: 'second',
      units: new Prisma.Decimal('42.5'),
      input_tokens: null,
      output_tokens: null,
    });
    const [row] = shapeInterviewDetail(interview(), [voice], [], false).calls;
    expect(row.unitKind).toBe('second');
    expect(row.units).toBe('42.5');
    expect(row.inputTokens).toBeNull();
  });

  it('shows a deleted interview rather than hiding it, and dates it', () => {
    const body = shapeInterviewDetail(interview({ deleted_at: AT }), [], [], false);
    expect(body.interview.deleted).toBe(true);
    expect(body.interview.deletedAt).toBe('2026-08-11T09:00:00.000Z');
  });

  it('surfaces the report prompt lineage a rollback needs (US-28)', () => {
    const withReport = interview({
      reports: [{ status: 'ready', prompt_uuid: 'uuid-report', prompt_version: 2 }],
    } as Partial<Detail>);
    expect(shapeInterviewDetail(withReport, [], [], false).interview.report).toEqual({
      status: 'ready',
      promptUuid: 'uuid-report',
      promptVersion: 2,
    });
    expect(shapeInterviewDetail(interview(), [], [], false).interview.report).toBeNull();
  });

  it('passes the security and budget events through as the US-29 timeline', () => {
    const events: Event[] = [
      {
        id: 'aud_1',
        actor_user_id: 'usr_1',
        action: 'security.prompt_injection_suspected',
        subject_type: 'interview',
        subject_id: 'itv_1',
        trace_id: 'trace_1',
        metadata: { field: 'jobListing', patternId: 'ignore-previous-instructions' },
        created_at: AT,
      },
    ];
    const [event] = shapeInterviewDetail(interview(), [], events, false).events;
    expect(event.action).toBe('security.prompt_injection_suspected');
    expect(event.metadata).toEqual({
      field: 'jobListing',
      patternId: 'ignore-previous-instructions',
    });
  });

  it('reports truncation rather than letting a short list read as a complete one', () => {
    expect(shapeInterviewDetail(interview(), [call()], [], true).callsTruncated).toBe(true);
  });
});
