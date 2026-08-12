import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const DEFAULT_BASE_URL = process.env.LOADTEST_BASE_URL ?? 'http://localhost';
export const COMPOSE_FILES = ['-f', 'compose.yaml', '-f', 'compose.scale.yaml'];

export const SCENARIOS = {
  healthz: { method: 'GET', path: () => '/api/healthz', auth: false },
  readyz: { method: 'GET', path: () => '/api/readyz', auth: false },
  me: { method: 'GET', path: () => '/api/me', auth: true },
  'my-interviews': { method: 'GET', path: () => '/api/me/interviews', auth: true },
  'interview-state': { method: 'GET', path: (ctx) => `/api/interviews/${ctx.interviewId}/state`, auth: true },
  'web-home': { method: 'GET', path: () => '/', auth: false },
};

export function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export function summarise(samples) {
  const sorted = Float64Array.from(samples).sort();
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    samples: sorted.length,
    meanMs: sorted.length === 0 ? 0 : sum / sorted.length,
    minMs: sorted.length === 0 ? 0 : sorted[0],
    p50Ms: percentile(sorted, 0.5),
    p75Ms: percentile(sorted, 0.75),
    p90Ms: percentile(sorted, 0.9),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
  };
}

export async function docker(args) {
  const { stdout } = await exec('docker', args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

export async function composeIds(service) {
  const out = await docker(['compose', ...COMPOSE_FILES, 'ps', '-q', service]);
  return out ? out.split('\n').filter(Boolean) : [];
}

export async function login(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().find((value) => value.startsWith('session='));
  if (!cookie) throw new Error('login returned no session cookie');
  return cookie.split(';')[0];
}

export async function firstInterviewId(baseUrl, cookie) {
  const res = await fetch(`${baseUrl}/api/me/interviews`, { headers: { cookie } });
  if (!res.ok) throw new Error(`interview lookup failed: ${res.status}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.interviews ?? body.items ?? []);
  if (list.length === 0) throw new Error('the load-test account has no interview to read');
  return list[0].id;
}

export async function runScenario({
  baseUrl,
  name,
  connections,
  durationMs,
  warmupMs = 0,
  context = {},
  cookie,
  onMeasureStart,
}) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`unknown scenario: ${name}`);
  const url = `${baseUrl}${scenario.path(context)}`;
  const headers = scenario.auth ? { cookie } : {};
  if (scenario.auth && !cookie) throw new Error(`scenario ${name} needs a session cookie`);

  const latencies = [];
  const statuses = {};
  const instances = {};
  let bytes = 0;
  let failures = 0;
  let measuring = false;

  const drive = async () => {
    while (Date.now() < deadline) {
      const startedAt = performance.now();
      try {
        const res = await fetch(url, { method: scenario.method, headers, redirect: 'manual' });
        const body = await res.arrayBuffer();
        if (!measuring) continue;
        latencies.push(performance.now() - startedAt);
        bytes += body.byteLength;
        const bucket = `${Math.floor(res.status / 100)}xx`;
        statuses[bucket] = (statuses[bucket] ?? 0) + 1;
        const instance = res.headers.get('x-instance') ?? 'none';
        instances[instance] = (instances[instance] ?? 0) + 1;
      } catch {
        if (!measuring) continue;
        latencies.push(performance.now() - startedAt);
        failures += 1;
      }
    }
  };

  let deadline = Date.now() + warmupMs + durationMs;
  let cpuBaseline = process.cpuUsage();
  const workers = Array.from({ length: connections }, drive);
  if (warmupMs > 0) await new Promise((resolve) => setTimeout(resolve, warmupMs));
  if (onMeasureStart) await onMeasureStart();
  const startedAt = new Date();
  const startedHr = performance.now();
  cpuBaseline = process.cpuUsage();
  measuring = true;
  await Promise.all(workers);
  const elapsedMs = performance.now() - startedHr;
  const cpu = process.cpuUsage(cpuBaseline);

  const total = latencies.length;
  const ok = statuses['2xx'] ?? 0;
  return {
    scenario: name,
    url,
    method: scenario.method,
    connections,
    startedAt: startedAt.toISOString(),
    elapsedMs,
    requests: { total, ok, failures, statuses },
    throughputRps: elapsedMs === 0 ? 0 : (total / elapsedMs) * 1000,
    bytesPerSecond: elapsedMs === 0 ? 0 : (bytes / elapsedMs) * 1000,
    clientLatency: summarise(latencies),
    generator: {
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      coreUtilisationPct: elapsedMs === 0 ? 0 : ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100,
    },
    instanceDistribution: instances,
  };
}
