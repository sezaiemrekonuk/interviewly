import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cpus, totalmem, platform, arch, release } from 'node:os';
import { argv, env, versions } from 'node:process';

import {
  COMPOSE_FILES,
  DEFAULT_BASE_URL,
  SCENARIOS,
  composeIds,
  docker,
  firstInterviewId,
  login,
  runScenario,
} from './lib.mjs';

const args = new Map(
  argv.slice(2).map((pair) => {
    const [key, ...rest] = pair.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);
const list = (key, fallback) => (args.get(key) ?? fallback).split(',').filter(Boolean);
const number = (key, fallback) => Number(args.get(key) ?? fallback);

const baseUrl = args.get('base') ?? DEFAULT_BASE_URL;
const replicaCounts = list('replicas', '1,2,4').map(Number);
const connectionCounts = list('connections', '8,64').map(Number);
const scenarioNames = list('scenarios', Object.keys(SCENARIOS).join(','));
const durationMs = number('duration', 12_000);
const warmupMs = number('warmup', 3_000);
const outPath = args.get('out') ?? `loadtest/results/scale-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const adminEmail = env.LOADTEST_EMAIL ?? 'admin@demo.com';
const adminPassword = env.LOADTEST_PASSWORD ?? env.SEED_ADMIN_PASSWORD ?? 'AdminDemo1!';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function dockerHost() {
  const info = await docker(['info', '--format', '{{.NCPU}}|{{.MemTotal}}|{{.ServerVersion}}|{{.OperatingSystem}}']);
  const [ncpu, memTotal, serverVersion, operatingSystem] = info.split('|');
  return {
    ncpu: Number(ncpu),
    memTotalBytes: Number(memTotal),
    serverVersion,
    operatingSystem,
  };
}

function gitSha() {
  return execSync('git rev-parse HEAD').toString().trim();
}

async function psql(sql) {
  const [id] = await composeIds('db');
  const out = await docker(['exec', id, 'psql', '-U', 'interviewly', '-d', 'interviewly', '-tAc', sql]);
  return out;
}

async function dbCounters() {
  const row = await psql(
    "select numbackends, xact_commit, tup_returned, blks_hit from pg_stat_database where datname='interviewly'",
  );
  const [numbackends, xactCommit, tupReturned, blksHit] = row.split('|').map(Number);
  const connections = Number(await psql("select count(*) from pg_stat_activity where datname='interviewly'"));
  return { numbackends, xactCommit, tupReturned, blksHit, connections };
}

async function redisClients() {
  const [id] = await composeIds('cache');
  const out = await docker(['exec', id, 'redis-cli', 'info', 'clients']);
  const match = out.match(/connected_clients:(\d+)/);
  return match ? Number(match[1]) : null;
}

async function dockerSample() {
  const out = await docker(['stats', '--no-stream', '--format', '{{json .}}']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.Name.startsWith('interviewly-'))
    .map((row) => ({
      name: row.Name,
      cpuPct: Number(row.CPUPerc.replace('%', '')),
      memUsage: row.MemUsage,
      memPct: Number(row.MemPerc.replace('%', '')),
      netIO: row.NetIO,
    }));
}

async function perfCall(path, method, cookie, replicas) {
  const byInstance = new Map();
  const attempts = replicas * 12 + 8;
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { cookie, origin: baseUrl },
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    const body = await res.json();
    const snapshot = method === 'POST' ? body.previous : body;
    byInstance.set(snapshot.instance, snapshot);
    if (byInstance.size === replicas) break;
  }
  if (byInstance.size !== replicas) {
    throw new Error(`${method} ${path} reached ${byInstance.size} of ${replicas} replicas`);
  }
  return [...byInstance.values()];
}

async function scaleTo(replicas) {
  await docker(['compose', ...COMPOSE_FILES, 'up', '-d', '--wait', `--scale`, `api=${replicas}`]);
  await sleep(8_000);
  const ids = await composeIds('api');
  if (ids.length !== replicas) throw new Error(`expected ${replicas} api containers, found ${ids.length}`);
  const seen = new Set();
  for (let i = 0; i < replicas * 12 + 8 && seen.size < replicas; i += 1) {
    const res = await fetch(`${baseUrl}/api/healthz`);
    seen.add(res.headers.get('x-instance'));
    await res.arrayBuffer();
  }
  if (seen.size !== replicas) {
    throw new Error(`edge reached ${seen.size} of ${replicas} api replicas — load balancing is not wired`);
  }
  return { containerIds: ids, instancesReachedThroughEdge: [...seen] };
}

const run = {
  schema: 'interviewly-loadtest/1',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  gitSha: gitSha(),
  target: 'docker-compose',
  baseUrl,
  host: {
    platform: platform(),
    release: release(),
    arch: arch(),
    hostCpus: cpus().length,
    hostMemBytes: totalmem(),
    node: versions.node,
    docker: await dockerHost(),
  },
  config: {
    replicaCounts,
    connectionCounts,
    scenarioNames,
    durationMs,
    warmupMs,
    composeFiles: COMPOSE_FILES.filter((entry) => entry !== '-f'),
    aiEnabled: false,
    logTransport: 'stdout',
    dbPoolPerProcess: Number(env.SCALE_DB_POOL ?? 10),
    generator: 'node fetch, closed loop, one in-flight request per connection',
  },
  scaleSteps: [],
  runs: [],
};

async function writeResults() {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`);
}

const cookie = await login(baseUrl, adminEmail, adminPassword);
const interviewId = await firstInterviewId(baseUrl, cookie);
run.config.interviewId = interviewId;

for (const replicas of replicaCounts) {
  const step = await scaleTo(replicas);
  run.scaleSteps.push({ replicas, ...step, at: new Date().toISOString() });

  for (const name of scenarioNames) {
    for (const connections of connectionCounts) {
      let dbBefore = null;

      let sampling = null;
      const sampler = setTimeout(() => {
        sampling = (async () => ({
          docker: await dockerSample(),
          redisClients: await redisClients(),
          db: await dbCounters(),
        }))();
      }, warmupMs + Math.floor(durationMs * 0.5));

      const result = await runScenario({
        baseUrl,
        name,
        connections,
        durationMs,
        warmupMs,
        cookie,
        context: { interviewId },
        onMeasureStart: async () => {
          await perfCall('/api/admin/perf/reset', 'POST', cookie, replicas);
          dbBefore = await dbCounters();
        },
      });
      clearTimeout(sampler);
      const midRun = sampling ? await sampling : null;

      const dbAfter = await dbCounters();
      const snapshots = await perfCall('/api/admin/perf', 'GET', cookie, replicas);

      run.runs.push({
        replicas,
        ...result,
        server: {
          instances: snapshots.map((snapshot) => ({
            instance: snapshot.instance,
            windowMs: snapshot.windowMs,
            routes: snapshot.routes,
            eventLoopDelayMs: snapshot.eventLoopDelayMs,
            cpu: snapshot.cpu,
            memory: snapshot.memory,
          })),
        },
        resources: midRun,
        postgres: {
          before: dbBefore,
          after: dbAfter,
          xactCommitDelta: dbAfter.xactCommit - dbBefore.xactCommit,
          tupReturnedDelta: dbAfter.tupReturned - dbBefore.tupReturned,
        },
      });

      await writeResults();
      const line = run.runs.at(-1);
      console.log(
        `${String(replicas).padStart(2)}x api  ${name.padEnd(16)} c=${String(connections).padStart(3)}  ` +
          `${line.throughputRps.toFixed(1).padStart(8)} rps  p50 ${line.clientLatency.p50Ms.toFixed(1)}ms  ` +
          `p95 ${line.clientLatency.p95Ms.toFixed(1)}ms  ${JSON.stringify(line.requests.statuses)}`,
      );
    }
  }
}

run.finishedAt = new Date().toISOString();
await writeResults();
console.log(`\nwrote ${outPath}`);
