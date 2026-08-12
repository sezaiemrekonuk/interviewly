import { describe, expect, it, beforeEach } from 'vitest';

import { INSTANCE_ID, record, resetProfiler, routeKeyOf, snapshot } from './profiler';

type RequestLike = Parameters<typeof routeKeyOf>[0];

const requestLike = (fields: { method: string; baseUrl?: string; route?: { path: string } }) =>
  fields as unknown as RequestLike;

describe('profiler', () => {
  beforeEach(() => {
    resetProfiler();
  });

  it('names a route by its mount point and pattern, not the concrete path', () => {
    expect(
      routeKeyOf(requestLike({ method: 'GET', baseUrl: '/interviews', route: { path: '/:id/state' } })),
    ).toBe('GET /interviews/:id/state');
    expect(routeKeyOf(requestLike({ method: 'GET', baseUrl: '', route: { path: '/healthz' } }))).toBe(
      'GET /healthz',
    );
    expect(routeKeyOf(requestLike({ method: 'POST', baseUrl: '' }))).toBe('POST (unmatched)');
  });

  it('reports percentiles over the recorded window', () => {
    for (let ms = 1; ms <= 100; ms += 1) record('GET /healthz', ms, 200);

    const route = snapshot().routes['GET /healthz'];
    expect(route?.count).toBe(100);
    expect(route?.p50Ms).toBe(50);
    expect(route?.p95Ms).toBe(95);
    expect(route?.p99Ms).toBe(99);
    expect(route?.maxMs).toBe(100);
    expect(route?.minMs).toBe(1);
    expect(route?.statuses).toEqual({ '2xx': 100 });
    expect(route?.errors).toBe(0);
  });

  it('counts 5xx as errors and keeps status classes apart', () => {
    record('GET /readyz', 5, 200);
    record('GET /readyz', 5, 503);
    record('GET /readyz', 5, 404);

    const route = snapshot().routes['GET /readyz'];
    expect(route?.errors).toBe(1);
    expect(route?.statuses).toEqual({ '2xx': 1, '4xx': 1, '5xx': 1 });
  });

  it('drops the window on reset and keeps a stable instance id', () => {
    record('GET /healthz', 10, 200);
    expect(Object.keys(snapshot().routes)).toEqual(['GET /healthz']);

    resetProfiler();

    expect(snapshot().routes).toEqual({});
    expect(snapshot().instance).toBe(INSTANCE_ID);
    expect(INSTANCE_ID).toMatch(/^[0-9a-f]{8}$/);
  });
});
