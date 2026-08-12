import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import type { Request, RequestHandler } from 'express';

export const INSTANCE_ID = createHash('sha256').update(hostname()).digest('hex').slice(0, 8);
export const INSTANCE_HEADER = 'X-Instance';

const SAMPLE_CAP = 4096;

interface RouteStat {
  count: number;
  errors: number;
  statuses: Record<string, number>;
  totalMs: number;
  maxMs: number;
  samples: Float64Array;
  filled: number;
  cursor: number;
}

export interface LatencySummary {
  count: number;
  sampled: number;
  meanMs: number;
  minMs: number;
  p50Ms: number;
  p75Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface ProfilerSnapshot {
  instance: string;
  pid: number;
  startedAt: string;
  uptimeMs: number;
  windowStartedAt: string;
  windowMs: number;
  routes: Record<
    string,
    LatencySummary & { errors: number; statuses: Record<string, number>; rps: number }
  >;
  eventLoopDelayMs: { meanMs: number; p50Ms: number; p90Ms: number; p99Ms: number; maxMs: number };
  cpu: { userMs: number; systemMs: number; coreUtilisationPct: number };
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number; externalBytes: number };
  activeRequests: number;
}

const routes = new Map<string, RouteStat>();
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

const processStartedAt = new Date();
let windowStartedAt = processStartedAt;
let windowStartedHr = process.hrtime.bigint();
let cpuBaseline = process.cpuUsage();
let activeRequests = 0;

function statFor(key: string): RouteStat {
  let stat = routes.get(key);
  if (!stat) {
    stat = {
      count: 0,
      errors: 0,
      statuses: {},
      totalMs: 0,
      maxMs: 0,
      samples: new Float64Array(SAMPLE_CAP),
      filled: 0,
      cursor: 0,
    };
    routes.set(key, stat);
  }
  return stat;
}

export function routeKeyOf(req: Request): string {
  const path = req.route?.path;
  if (typeof path !== 'string') return `${req.method} (unmatched)`;
  const base = req.baseUrl || '';
  const full = `${base}${path === '/' && base ? '' : path}`;
  return `${req.method} ${full || '/'}`;
}

export function record(key: string, durationMs: number, statusCode: number): void {
  const stat = statFor(key);
  stat.count += 1;
  stat.totalMs += durationMs;
  if (durationMs > stat.maxMs) stat.maxMs = durationMs;
  const bucket = `${Math.floor(statusCode / 100)}xx`;
  stat.statuses[bucket] = (stat.statuses[bucket] ?? 0) + 1;
  if (statusCode >= 500) stat.errors += 1;
  stat.samples[stat.cursor] = durationMs;
  stat.cursor = (stat.cursor + 1) % SAMPLE_CAP;
  if (stat.filled < SAMPLE_CAP) stat.filled += 1;
}

function percentileOf(sorted: Float64Array, fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] as number;
}

function summarise(stat: RouteStat): LatencySummary {
  const sorted = stat.samples.slice(0, stat.filled).sort();
  return {
    count: stat.count,
    sampled: stat.filled,
    meanMs: stat.count === 0 ? 0 : stat.totalMs / stat.count,
    minMs: sorted.length === 0 ? 0 : (sorted[0] as number),
    p50Ms: percentileOf(sorted, 0.5),
    p75Ms: percentileOf(sorted, 0.75),
    p90Ms: percentileOf(sorted, 0.9),
    p95Ms: percentileOf(sorted, 0.95),
    p99Ms: percentileOf(sorted, 0.99),
    maxMs: stat.maxMs,
  };
}

export function resetProfiler(): void {
  routes.clear();
  loopDelay.reset();
  cpuBaseline = process.cpuUsage();
  windowStartedAt = new Date();
  windowStartedHr = process.hrtime.bigint();
}

export function snapshot(): ProfilerSnapshot {
  const windowMs = Number(process.hrtime.bigint() - windowStartedHr) / 1e6;
  const cpu = process.cpuUsage(cpuBaseline);
  const memory = process.memoryUsage();
  const perRoute: ProfilerSnapshot['routes'] = {};
  for (const [key, stat] of routes) {
    perRoute[key] = {
      ...summarise(stat),
      errors: stat.errors,
      statuses: stat.statuses,
      rps: windowMs === 0 ? 0 : (stat.count / windowMs) * 1000,
    };
  }
  return {
    instance: INSTANCE_ID,
    pid: process.pid,
    startedAt: processStartedAt.toISOString(),
    uptimeMs: Math.round(process.uptime() * 1000),
    windowStartedAt: windowStartedAt.toISOString(),
    windowMs,
    routes: perRoute,
    eventLoopDelayMs: {
      meanMs: loopDelay.mean / 1e6,
      p50Ms: loopDelay.percentile(50) / 1e6,
      p90Ms: loopDelay.percentile(90) / 1e6,
      p99Ms: loopDelay.percentile(99) / 1e6,
      maxMs: loopDelay.max / 1e6,
    },
    cpu: {
      userMs: cpu.user / 1000,
      systemMs: cpu.system / 1000,
      coreUtilisationPct: windowMs === 0 ? 0 : ((cpu.user + cpu.system) / 1000 / windowMs) * 100,
    },
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    },
    activeRequests,
  };
}

export const profiler: RequestHandler = (req, res, next) => {
  res.setHeader(INSTANCE_HEADER, INSTANCE_ID);
  const startedHr = process.hrtime.bigint();
  activeRequests += 1;
  res.on('close', () => {
    activeRequests -= 1;
    record(routeKeyOf(req), Number(process.hrtime.bigint() - startedHr) / 1e6, res.statusCode);
  });
  next();
};
