import { createWriteStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';

import PDFDocument from 'pdfkit';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(SCRIPT_DIR, 'results');
const SCHEMA = 'interviewly-loadtest/1';

const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const INK = '#111111';
const GREY = '#666666';
const HAIRLINE = '#cccccc';
const ACCENT = '#1a5fb4';
const MARGIN = 40;
const TITLE_SIZE = 17;
const HEADING_SIZE = 12;
const BODY_SIZE = 9;
const SMALL_SIZE = 7.5;
const CELL_PAD = 4;
const ROW_HEIGHT = 15;
const MISSING = '—';

function parseArgs(tokens) {
  let input = null;
  let out = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--out') {
      out = tokens[i + 1] ?? null;
      i += 1;
    } else if (token.startsWith('--out=')) {
      out = token.slice('--out='.length);
    } else if (!token.startsWith('--')) {
      input = token;
    }
  }
  return { input, out };
}

function newestResultFile() {
  if (!existsSync(RESULTS_DIR)) return null;
  const candidates = readdirSync(RESULTS_DIR)
    .filter((name) => name.startsWith('scale-') && name.endsWith('.json'))
    .map((name) => {
      const path = join(RESULTS_DIR, name);
      return { path, modifiedAt: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  return candidates.length === 0 ? null : candidates[0].path;
}

function fail(message) {
  console.error(`report: ${message}`);
  exit(1);
}

const args = parseArgs(argv.slice(2));
const inputPath = args.input ? resolve(args.input) : newestResultFile();
if (!inputPath) fail(`no input given and no scale-*.json found in ${RESULTS_DIR}`);
if (!existsSync(inputPath)) fail(`input file not found: ${inputPath}`);

let report;
try {
  report = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (error) {
  fail(`input file is not valid JSON: ${inputPath} (${error.message})`);
}
if (!report || report.schema !== SCHEMA) {
  fail(`unsupported schema in ${inputPath}: expected "${SCHEMA}", found ${JSON.stringify(report?.schema ?? null)}`);
}

const outPath = resolve(args.out ?? join(SCRIPT_DIR, 'report.pdf'));

const runs = Array.isArray(report.runs) ? report.runs : [];
if (runs.length === 0) fail(`input file has no runs: ${inputPath}`);

const config = report.config ?? {};
const host = report.host ?? {};
const dockerHost = host.docker ?? {};
const gitSha = typeof report.gitSha === 'string' ? report.gitSha : MISSING;

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value) => (typeof value === 'string' && value.length > 0 ? value : null);

const unique = (values) => [...new Set(values)];
const sortNumbers = (values) => [...values].sort((a, b) => a - b);

const replicaLevels = sortNumbers(unique(runs.map((run) => num(run.replicas)).filter((value) => value !== null)));
const connectionLevels = sortNumbers(unique(runs.map((run) => num(run.connections)).filter((value) => value !== null)));
const scenarioNames = unique(runs.map((run) => text(run.scenario) ?? MISSING));
const topConnections = connectionLevels.length > 0 ? connectionLevels[connectionLevels.length - 1] : null;
const minReplicas = replicaLevels.length > 0 ? replicaLevels[0] : null;
const maxReplicas = replicaLevels.length > 0 ? replicaLevels[replicaLevels.length - 1] : null;

const findRun = (scenario, replicas, connections) =>
  runs.find(
    (run) => run.scenario === scenario && num(run.replicas) === replicas && num(run.connections) === connections,
  ) ?? null;

function formatRps(value) {
  if (value === null) return MISSING;
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function formatMs(value) {
  return value === null ? MISSING : value.toFixed(2);
}

function formatPct(value) {
  return value === null ? MISSING : `${value.toFixed(1)}%`;
}

function formatFactor(value) {
  return value === null ? MISSING : value.toFixed(2);
}

function formatCount(value) {
  return value === null ? MISSING : value.toLocaleString('en-US');
}

function formatBytes(value) {
  if (value === null) return MISSING;
  if (value === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function busiestRouteKey(run) {
  const totals = new Map();
  for (const instance of run.server?.instances ?? []) {
    for (const [key, route] of Object.entries(instance.routes ?? {})) {
      const count = num(route?.count);
      if (count === null) continue;
      if (key.endsWith('/admin/perf') || key.endsWith('/admin/perf/reset')) continue;
      totals.set(key, (totals.get(key) ?? 0) + count);
    }
  }
  let best = null;
  for (const [key, count] of totals) {
    if (best === null || count > best.count) best = { key, count };
  }
  if (best === null) return null;
  const clientTotal = num(run.requests?.total);
  if (clientTotal !== null && best.count < clientTotal * 0.2) return null;
  return best.key;
}

function worstInstanceRouteValue(run, field) {
  const key = busiestRouteKey(run);
  if (key === null) return null;
  let worst = null;
  for (const instance of run.server?.instances ?? []) {
    const value = num(instance.routes?.[key]?.[field]);
    if (value === null) continue;
    if (worst === null || value > worst) worst = value;
  }
  return worst;
}

function instanceShares(run) {
  const distribution = run.instanceDistribution ?? {};
  const entries = Object.entries(distribution).filter(([, count]) => num(count) !== null);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([instance, count]) => ({ instance, count, sharePct: total === 0 ? null : (count / total) * 100 }));
}

function apiContainers(run) {
  return (run.resources?.docker ?? []).filter((container) => /-api-\d+$/.test(container?.name ?? ''));
}

function apiCpuSum(run) {
  const containers = apiContainers(run);
  const values = containers.map((container) => num(container.cpuPct)).filter((value) => value !== null);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

function postgresConnections(run) {
  return num(run.resources?.db?.connections) ?? num(run.postgres?.after?.connections);
}

function eventLoopP99List(run) {
  return (run.server?.instances ?? []).map((instance) => ({
    instance: text(instance.instance) ?? MISSING,
    p99Ms: num(instance.eventLoopDelayMs?.p99Ms),
  }));
}

function scalingFactor(scenario, connections) {
  if (minReplicas === null || maxReplicas === null || minReplicas === maxReplicas) return null;
  const low = num(findRun(scenario, minReplicas, connections)?.throughputRps);
  const high = num(findRun(scenario, maxReplicas, connections)?.throughputRps);
  if (low === null || high === null || low === 0) return null;
  return high / low;
}

const doc = new PDFDocument({
  size: 'A4',
  margin: MARGIN,
  bufferPages: true,
  info: {
    Title: 'Interviewly — scaling, latency and performance report',
    Author: 'Interviewly',
  },
});

const stream = createWriteStream(outPath);
doc.pipe(stream);

const contentWidth = doc.page.width - MARGIN * 2;
const bottomLimit = () => doc.page.height - MARGIN - 22;

function ensure(height) {
  if (doc.y + height > bottomLimit()) doc.addPage();
}

function title(value) {
  doc.font(BOLD).fontSize(TITLE_SIZE).fillColor(INK).text(value, MARGIN, doc.y, { width: contentWidth });
  doc.moveDown(0.4);
}

function heading(value) {
  ensure(46);
  doc.moveDown(0.8);
  doc.font(BOLD).fontSize(HEADING_SIZE).fillColor(INK).text(value, MARGIN, doc.y, { width: contentWidth });
  doc
    .moveTo(MARGIN, doc.y + 2)
    .lineTo(MARGIN + contentWidth, doc.y + 2)
    .lineWidth(1)
    .strokeColor(ACCENT)
    .stroke();
  doc.y += 8;
  doc.font(FONT).fontSize(BODY_SIZE).fillColor(INK);
}

function subheading(value) {
  ensure(34);
  doc.moveDown(0.5);
  doc.font(BOLD).fontSize(BODY_SIZE + 0.5).fillColor(INK).text(value, MARGIN, doc.y, { width: contentWidth });
  doc.moveDown(0.2);
  doc.font(FONT).fontSize(BODY_SIZE).fillColor(INK);
}

function paragraph(value, colour = INK) {
  const height = doc.font(FONT).fontSize(BODY_SIZE).heightOfString(value, { width: contentWidth });
  ensure(height);
  doc.fillColor(colour).text(value, MARGIN, doc.y, { width: contentWidth });
  doc.moveDown(0.25);
}

function bullets(items) {
  for (const item of items) {
    const height = doc.font(FONT).fontSize(BODY_SIZE).heightOfString(item, { width: contentWidth - 12 });
    ensure(height + 2);
    const y = doc.y;
    doc.fillColor(ACCENT).circle(MARGIN + 3, y + 4, 1.6).fill();
    doc.fillColor(INK).text(item, MARGIN + 12, y, { width: contentWidth - 12 });
    doc.moveDown(0.2);
  }
}

function definitions(pairs) {
  const labelWidth = 150;
  for (const [label, value] of pairs) {
    const printable = value === null || value === undefined || value === '' ? MISSING : String(value);
    const height = Math.max(
      doc.font(FONT).fontSize(BODY_SIZE).heightOfString(printable, { width: contentWidth - labelWidth }),
      12,
    );
    ensure(height + 2);
    const y = doc.y;
    doc.font(BOLD).fontSize(BODY_SIZE).fillColor(GREY).text(label, MARGIN, y, { width: labelWidth - 6 });
    doc
      .font(FONT)
      .fontSize(BODY_SIZE)
      .fillColor(INK)
      .text(printable, MARGIN + labelWidth, y, { width: contentWidth - labelWidth });
    doc.y = y + height + 2;
  }
}

function table(columns, rows) {
  const weightTotal = columns.reduce((sum, column) => sum + column.width, 0);
  const widths = columns.map((column) => (column.width / weightTotal) * contentWidth);
  const offsets = widths.map((_, index) => MARGIN + widths.slice(0, index).reduce((sum, value) => sum + value, 0));
  const headerHeight =
    Math.max(
      12,
      ...columns.map((column, index) =>
        doc.font(BOLD).fontSize(SMALL_SIZE).heightOfString(column.label, { width: widths[index] - CELL_PAD * 2 }),
      ),
    ) + 7;

  const drawHeader = () => {
    const y = doc.y;
    doc.font(BOLD).fontSize(SMALL_SIZE).fillColor(INK);
    columns.forEach((column, index) => {
      doc.text(column.label, offsets[index] + CELL_PAD, y + 3, {
        width: widths[index] - CELL_PAD * 2,
        align: column.align ?? 'left',
      });
    });
    doc
      .moveTo(MARGIN, y + headerHeight - 1)
      .lineTo(MARGIN + contentWidth, y + headerHeight - 1)
      .lineWidth(0.9)
      .strokeColor(INK)
      .stroke();
    doc.y = y + headerHeight;
  };

  ensure(headerHeight + ROW_HEIGHT * 2);
  drawHeader();

  for (const row of rows) {
    const cells = row.map((cell) => (cell === null || cell === undefined || cell === '' ? MISSING : String(cell)));
    const heights = cells.map((cell, index) =>
      doc.font(FONT).fontSize(SMALL_SIZE).heightOfString(cell, { width: widths[index] - CELL_PAD * 2 }),
    );
    const rowHeight = Math.max(ROW_HEIGHT, Math.max(...heights) + 6);
    if (doc.y + rowHeight > bottomLimit()) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.font(FONT).fontSize(SMALL_SIZE).fillColor(INK);
    cells.forEach((cell, index) => {
      doc.text(cell, offsets[index] + CELL_PAD, y + 3, {
        width: widths[index] - CELL_PAD * 2,
        align: columns[index].align ?? 'left',
      });
    });
    doc
      .moveTo(MARGIN, y + rowHeight)
      .lineTo(MARGIN + contentWidth, y + rowHeight)
      .lineWidth(0.4)
      .strokeColor(HAIRLINE)
      .stroke();
    doc.y = y + rowHeight;
  }
  doc.moveDown(0.5);
  doc.font(FONT).fontSize(BODY_SIZE).fillColor(INK);
}

const barShades = ['#d0d0d0', '#8f8f8f', '#4a4a4a', '#222222'];
const shadeFor = (index, total) => (index === total - 1 ? ACCENT : barShades[index % barShades.length]);
const dashFor = (index) => [[], [4, 2], [1.5, 1.5], [6, 2, 1.5, 2], [3, 1], [8, 3]][index % 6];

function chartFrame(heightPoints, headingText, axisLabelY) {
  ensure(heightPoints + 110);
  subheading(headingText);
  const top = doc.y + 6;
  const plotLeft = MARGIN + 46;
  const plotRight = MARGIN + contentWidth - 4;
  const plotBottom = top + heightPoints;
  doc
    .moveTo(plotLeft, top)
    .lineTo(plotLeft, plotBottom)
    .lineTo(plotRight, plotBottom)
    .lineWidth(0.8)
    .strokeColor(INK)
    .stroke();
  doc.save();
  doc.rotate(-90, { origin: [MARGIN + 10, plotBottom] });
  doc
    .font(FONT)
    .fontSize(SMALL_SIZE)
    .fillColor(GREY)
    .text(axisLabelY, MARGIN + 10, plotBottom - 8, { width: heightPoints, align: 'center' });
  doc.restore();
  return { top, plotLeft, plotRight, plotBottom };
}

function drawYAxis(frame, maxValue, formatter) {
  const { top, plotLeft, plotRight, plotBottom } = frame;
  doc.font(FONT).fontSize(SMALL_SIZE - 0.5).fillColor(GREY);
  doc.text('0', plotLeft - 42, plotBottom - 4, { width: 38, align: 'right' });
  if (maxValue === null) return;
  doc.text(formatter(maxValue), plotLeft - 42, top - 4, { width: 38, align: 'right' });
  doc
    .moveTo(plotLeft, top)
    .lineTo(plotRight, top)
    .lineWidth(0.4)
    .strokeColor(HAIRLINE)
    .stroke();
}

function drawLegend(entries, drawSwatch) {
  ensure(30);
  const columnsPerRow = Math.min(entries.length, 4);
  const cellWidth = contentWidth / columnsPerRow;
  let y = doc.y + 4;
  entries.forEach((entry, index) => {
    const column = index % columnsPerRow;
    if (column === 0 && index > 0) y += 12;
    const x = MARGIN + column * cellWidth;
    drawSwatch(entry, x, y);
    doc.font(FONT).fontSize(SMALL_SIZE).fillColor(INK).text(entry.label, x + 22, y - 2, {
      width: cellWidth - 26,
      lineBreak: false,
      ellipsis: true,
    });
  });
  doc.y = y + 16;
}

function drawGroupedBars(connections) {
  const values = new Map();
  let maxValue = null;
  for (const scenario of scenarioNames) {
    for (const replicas of replicaLevels) {
      const value = num(findRun(scenario, replicas, connections)?.throughputRps);
      values.set(`${scenario}|${replicas}`, value);
      if (value !== null && (maxValue === null || value > maxValue)) maxValue = value;
    }
  }
  const height = 170;
  const frame = chartFrame(height, `Throughput by replica count — connections = ${connections}`, 'requests / second');
  drawYAxis(frame, maxValue, formatRps);
  const plotWidth = frame.plotRight - frame.plotLeft;
  const groupWidth = plotWidth / scenarioNames.length;
  const barWidth = Math.max(4, (groupWidth - 12) / Math.max(1, replicaLevels.length));

  scenarioNames.forEach((scenario, groupIndex) => {
    const groupLeft = frame.plotLeft + groupIndex * groupWidth;
    replicaLevels.forEach((replicas, barIndex) => {
      const value = values.get(`${scenario}|${replicas}`);
      const x = groupLeft + 6 + barIndex * barWidth;
      if (value === null || maxValue === null || maxValue === 0) {
        doc.font(FONT).fontSize(SMALL_SIZE - 1.5).fillColor(GREY).text(MISSING, x, frame.plotBottom - 10, {
          width: barWidth,
          align: 'center',
          lineBreak: false,
        });
        return;
      }
      const barHeight = (value / maxValue) * (height - 12);
      doc
        .rect(x, frame.plotBottom - barHeight, barWidth - 1.5, barHeight)
        .fillColor(shadeFor(barIndex, replicaLevels.length))
        .fill();
      doc
        .font(FONT)
        .fontSize(SMALL_SIZE - 2)
        .fillColor(INK)
        .text(formatRps(value), x - 3, frame.plotBottom - barHeight - 8, {
          width: barWidth + 6,
          align: 'center',
          lineBreak: false,
        });
    });
    doc
      .font(FONT)
      .fontSize(SMALL_SIZE - 0.5)
      .fillColor(INK)
      .text(scenario, groupLeft, frame.plotBottom + 4, { width: groupWidth, align: 'center', lineBreak: false });
  });

  doc.y = frame.plotBottom + 16;
  doc.font(FONT).fontSize(SMALL_SIZE).fillColor(GREY).text('scenario', MARGIN, doc.y, {
    width: contentWidth,
    align: 'center',
  });
  drawLegend(
    replicaLevels.map((replicas, index) => ({ label: `${replicas} api replica(s)`, index })),
    (entry, x, y) => {
      doc.rect(x, y, 14, 8).fillColor(shadeFor(entry.index, replicaLevels.length)).fill();
    },
  );
}

function drawLatencyLines(connections) {
  const series = scenarioNames.map((scenario) => ({
    scenario,
    points: replicaLevels.map((replicas) => ({
      replicas,
      value: num(findRun(scenario, replicas, connections)?.clientLatency?.p95Ms),
    })),
  }));
  let maxValue = null;
  for (const entry of series) {
    for (const point of entry.points) {
      if (point.value !== null && (maxValue === null || point.value > maxValue)) maxValue = point.value;
    }
  }
  const height = 170;
  const frame = chartFrame(
    height,
    `Client p95 latency by replica count — connections = ${connections}`,
    'p95 latency (ms)',
  );
  drawYAxis(frame, maxValue, formatMs);
  const plotWidth = frame.plotRight - frame.plotLeft;
  const step = replicaLevels.length > 1 ? (plotWidth - 30) / (replicaLevels.length - 1) : 0;
  const xFor = (index) => frame.plotLeft + 15 + step * index;
  const yFor = (value) => frame.plotBottom - (maxValue === null || maxValue === 0 ? 0 : (value / maxValue) * (height - 14));

  series.forEach((entry, seriesIndex) => {
    const colour = seriesIndex === 0 ? ACCENT : barShades[(seriesIndex + 1) % barShades.length];
    doc.strokeColor(colour).lineWidth(1.1);
    const dash = dashFor(seriesIndex);
    if (dash.length > 0) doc.dash(dash[0], { space: dash[1] });
    let started = false;
    entry.points.forEach((point, index) => {
      if (point.value === null) return;
      const x = xFor(index);
      const y = yFor(point.value);
      if (!started) {
        doc.moveTo(x, y);
        started = true;
      } else {
        doc.lineTo(x, y);
      }
    });
    if (started) doc.stroke();
    doc.undash();
    entry.points.forEach((point, index) => {
      if (point.value === null) return;
      const x = xFor(index);
      const y = yFor(point.value);
      doc.circle(x, y, 1.8).fillColor(colour).fill();
      doc
        .font(FONT)
        .fontSize(SMALL_SIZE - 2)
        .fillColor(INK)
        .text(formatMs(point.value), x - 16, y - 9, { width: 32, align: 'center', lineBreak: false });
    });
  });

  replicaLevels.forEach((replicas, index) => {
    doc
      .font(FONT)
      .fontSize(SMALL_SIZE - 0.5)
      .fillColor(INK)
      .text(`${replicas}`, xFor(index) - 20, frame.plotBottom + 4, { width: 40, align: 'center', lineBreak: false });
  });

  doc.y = frame.plotBottom + 16;
  doc.font(FONT).fontSize(SMALL_SIZE).fillColor(GREY).text('api replicas', MARGIN, doc.y, {
    width: contentWidth,
    align: 'center',
  });
  drawLegend(
    series.map((entry, index) => ({ label: entry.scenario, index })),
    (entry, x, y) => {
      const colour = entry.index === 0 ? ACCENT : barShades[(entry.index + 1) % barShades.length];
      const dash = dashFor(entry.index);
      if (dash.length > 0) doc.dash(dash[0], { space: dash[1] });
      doc.moveTo(x, y + 4).lineTo(x + 16, y + 4).lineWidth(1.2).strokeColor(colour).stroke();
      doc.undash();
      doc.circle(x + 8, y + 4, 1.8).fillColor(colour).fill();
    },
  );
}

title('Interviewly — scaling, latency and performance report');
doc.font(FONT).fontSize(BODY_SIZE).fillColor(INK);
definitions([
  ['run window', `${text(report.startedAt) ?? MISSING} to ${text(report.finishedAt) ?? MISSING}`],
  ['git sha', gitSha],
  ['target', text(report.target)],
  ['base url', text(report.baseUrl)],
  ['source file', inputPath],
  ['schema', text(report.schema)],
  ['runs recorded', formatCount(runs.length)],
]);

heading('1. Environment');
table(
  [
    { label: 'property', width: 34 },
    { label: 'value', width: 66 },
  ],
  [
    ['host platform', `${text(host.platform) ?? MISSING} ${text(host.release) ?? MISSING}`],
    ['host arch', text(host.arch)],
    ['host cpus', formatCount(num(host.hostCpus))],
    ['host memory', formatBytes(num(host.hostMemBytes))],
    ['node', text(host.node)],
    ['docker cpus', formatCount(num(dockerHost.ncpu))],
    ['docker memory', formatBytes(num(dockerHost.memTotalBytes))],
    ['docker server version', text(dockerHost.serverVersion)],
    ['docker operating system', text(dockerHost.operatingSystem)],
  ],
);
paragraph(
  'Caveat: the load generator and the system under test share this one machine. Generator CPU competes with api, web, database and cache containers for the same cores, so absolute throughput is a floor, not a ceiling, and latency includes contention the generator itself creates.',
  GREY,
);

heading('2. Method');
subheading('Scenarios exercised');
table(
  [
    { label: 'scenario', width: 22 },
    { label: 'method', width: 10 },
    { label: 'url', width: 68 },
  ],
  scenarioNames.map((scenario) => {
    const sample = runs.find((run) => run.scenario === scenario);
    return [scenario, text(sample?.method), text(sample?.url)];
  }),
);
subheading('Generator configuration');
definitions([
  ['duration per cell', num(config.durationMs) === null ? null : `${formatCount(num(config.durationMs))} ms`],
  ['warmup per cell', num(config.warmupMs) === null ? null : `${formatCount(num(config.warmupMs))} ms`],
  ['connection levels', connectionLevels.length === 0 ? null : connectionLevels.join(', ')],
  ['replica counts', replicaLevels.length === 0 ? null : replicaLevels.join(', ')],
  ['generator', text(config.generator)],
  ['ai enabled', typeof config.aiEnabled === 'boolean' ? String(config.aiEnabled) : null],
  ['log transport', text(config.logTransport)],
  ['db pool per process', formatCount(num(config.dbPoolPerProcess))],
  ['compose files', Array.isArray(config.composeFiles) ? config.composeFiles.join(', ') : null],
  ['interview id', text(config.interviewId)],
]);

heading('3. Instance fan-out proof');
paragraph(
  'Each scale step scaled the api service, then probed the edge until every replica had answered. The counts below are the evidence that N replicas actually served traffic rather than one replica absorbing it all.',
);
table(
  [
    { label: 'replicas requested', width: 16, align: 'right' },
    { label: 'containers', width: 12, align: 'right' },
    { label: 'distinct instances via edge', width: 20, align: 'right' },
    { label: 'instance ids', width: 34 },
    { label: 'at', width: 18 },
  ],
  (report.scaleSteps ?? []).map((step) => [
    formatCount(num(step.replicas)),
    formatCount(Array.isArray(step.containerIds) ? step.containerIds.length : null),
    formatCount(Array.isArray(step.instancesReachedThroughEdge) ? step.instancesReachedThroughEdge.length : null),
    Array.isArray(step.instancesReachedThroughEdge) ? step.instancesReachedThroughEdge.join(', ') : null,
    text(step.at),
  ]),
);
subheading('Per-run share of requests by instance');
table(
  [
    { label: 'replicas', width: 9, align: 'right' },
    { label: 'scenario', width: 18 },
    { label: 'conns', width: 8, align: 'right' },
    { label: 'requests', width: 12, align: 'right' },
    { label: 'instance share', width: 53 },
  ],
  runs.map((run) => {
    const shares = instanceShares(run);
    return [
      formatCount(num(run.replicas)),
      text(run.scenario),
      formatCount(num(run.connections)),
      formatCount(num(run.requests?.total)),
      shares.length === 0
        ? null
        : shares.map((share) => `${share.instance} ${formatPct(share.sharePct)} (${formatCount(share.count)})`).join(' · '),
    ];
  }),
);

heading('4. Throughput scaling');
for (const connections of connectionLevels) {
  subheading(`Requests per second — connections = ${connections}`);
  table(
    [
      { label: 'scenario', width: 24 },
      ...replicaLevels.map((replicas) => ({ label: `${replicas} replicas`, width: 14, align: 'right' })),
      {
        label:
          minReplicas === null || maxReplicas === null
            ? 'scaling factor'
            : `factor ${maxReplicas}x / ${minReplicas}x`,
        width: 16,
        align: 'right',
      },
    ],
    scenarioNames.map((scenario) => [
      scenario,
      ...replicaLevels.map((replicas) => formatRps(num(findRun(scenario, replicas, connections)?.throughputRps))),
      formatFactor(scalingFactor(scenario, connections)),
    ]),
  );
}

heading('5. Latency');
paragraph(
  'Client latency is measured by the generator around the whole request. Server latency comes from the in-process route profiler; where several replicas served a scenario the worst instance is reported. The overhead column is client p95 minus server p95 on that worst instance.',
);
for (const scenario of scenarioNames) {
  subheading(scenario);
  const rows = [];
  for (const connections of connectionLevels) {
    for (const replicas of replicaLevels) {
      const run = findRun(scenario, replicas, connections);
      if (!run) continue;
      const clientP95 = num(run.clientLatency?.p95Ms);
      const serverP95 = worstInstanceRouteValue(run, 'p95Ms');
      rows.push([
        formatCount(replicas),
        formatCount(connections),
        formatMs(num(run.clientLatency?.p50Ms)),
        formatMs(clientP95),
        formatMs(num(run.clientLatency?.p99Ms)),
        formatMs(num(run.clientLatency?.maxMs)),
        busiestRouteKey(run) ?? MISSING,
        formatMs(worstInstanceRouteValue(run, 'p50Ms')),
        formatMs(serverP95),
        formatMs(worstInstanceRouteValue(run, 'p99Ms')),
        clientP95 === null || serverP95 === null ? MISSING : formatMs(clientP95 - serverP95),
      ]);
    }
  }
  table(
    [
      { label: 'replicas', width: 8, align: 'right' },
      { label: 'conns', width: 7, align: 'right' },
      { label: 'client p50', width: 9, align: 'right' },
      { label: 'client p95', width: 9, align: 'right' },
      { label: 'client p99', width: 9, align: 'right' },
      { label: 'client max', width: 9, align: 'right' },
      { label: 'busiest route', width: 17 },
      { label: 'srv p50', width: 8, align: 'right' },
      { label: 'srv p95', width: 8, align: 'right' },
      { label: 'srv p99', width: 8, align: 'right' },
      { label: 'edge+net p95', width: 10, align: 'right' },
    ],
    rows,
  );
}

heading('6. Charts');
if (topConnections !== null) {
  drawGroupedBars(topConnections);
  drawLatencyLines(topConnections);
}

heading('7. Resource use');
paragraph(
  topConnections === null
    ? 'No connection level recorded.'
    : `Sampled mid-run at the highest connection level (connections = ${topConnections}). Docker CPU percentages are per container as reported by docker stats; the sum column adds the api containers together.`,
);
const topRuns = runs.filter((run) => num(run.connections) === topConnections);
table(
  [
    { label: 'scenario', width: 17 },
    { label: 'replicas', width: 8, align: 'right' },
    { label: 'api cpu sum', width: 10, align: 'right' },
    { label: 'event-loop p99 per instance', width: 29 },
    { label: 'pg conns', width: 9, align: 'right' },
    { label: 'redis clients', width: 10, align: 'right' },
    { label: 'xact commits', width: 11, align: 'right' },
  ],
  topRuns.map((run) => [
    text(run.scenario),
    formatCount(num(run.replicas)),
    formatPct(apiCpuSum(run)),
    eventLoopP99List(run).length === 0
      ? null
      : eventLoopP99List(run)
          .map((entry) => `${entry.instance} ${formatMs(entry.p99Ms)} ms`)
          .join(' · '),
    formatCount(postgresConnections(run)),
    formatCount(num(run.resources?.redisClients)),
    formatCount(num(run.postgres?.xactCommitDelta)),
  ]),
);
subheading('Container detail');
const containerRows = [];
for (const run of topRuns) {
  for (const container of run.resources?.docker ?? []) {
    containerRows.push([
      text(run.scenario),
      formatCount(num(run.replicas)),
      text(container.name),
      formatPct(num(container.cpuPct)),
      text(container.memUsage),
      formatPct(num(container.memPct)),
      text(container.netIO),
    ]);
  }
}
if (containerRows.length === 0) {
  paragraph('No docker samples were recorded for the runs at this connection level.', GREY);
} else {
  table(
    [
      { label: 'scenario', width: 16 },
      { label: 'replicas', width: 8, align: 'right' },
      { label: 'container', width: 24 },
      { label: 'cpu', width: 9, align: 'right' },
      { label: 'memory', width: 17 },
      { label: 'mem %', width: 8, align: 'right' },
      { label: 'net io', width: 18 },
    ],
    containerRows,
  );
}

subheading('Generator load');
paragraph(
  'The generator shares the host with the stack. A run whose generator core utilisation approaches 100 per cent of one core is bounded by the generator rather than by the replicas, and its throughput is a floor rather than a capacity.',
);
table(
  [
    { label: 'scenario', width: 20 },
    { label: 'replicas', width: 9, align: 'right' },
    { label: 'generator core %', width: 14, align: 'right' },
    { label: 'requests', width: 12, align: 'right' },
    { label: 'rps', width: 12, align: 'right' },
  ],
  topRuns.map((run) => [
    text(run.scenario),
    formatCount(num(run.replicas)),
    formatPct(num(run.generator?.coreUtilisationPct)),
    formatCount(num(run.requests?.total)),
    formatRps(num(run.throughputRps)),
  ]),
);

heading('8. Findings the data supports');
const findings = [];
if (topConnections !== null && minReplicas !== null && maxReplicas !== null && minReplicas !== maxReplicas) {
  for (const scenario of scenarioNames) {
    const low = findRun(scenario, minReplicas, topConnections);
    const high = findRun(scenario, maxReplicas, topConnections);
    const lowRps = num(low?.throughputRps);
    const highRps = num(high?.throughputRps);
    const factor = scalingFactor(scenario, topConnections);
    if (lowRps === null || highRps === null || factor === null) {
      findings.push(
        `${scenario}: throughput at ${minReplicas} replica(s) is ${formatRps(lowRps)} rps and at ${maxReplicas} replica(s) is ${formatRps(highRps)} rps (connections = ${topConnections}); the scaling factor cannot be derived from these fields.`,
      );
      continue;
    }
    const cpu = apiCpuSum(high);
    const cpuNote = cpu === null ? 'api container cpu was not sampled for that run' : `api container cpu summed to ${formatPct(cpu)} across ${apiContainers(high).length} api container(s)`;
    if (factor <= 1.1) {
      findings.push(
        `${scenario} did not scale: ${formatRps(lowRps)} rps at ${minReplicas} replica(s) versus ${formatRps(highRps)} rps at ${maxReplicas} replica(s) is a factor of ${formatFactor(factor)} (connections = ${topConnections}), while ${cpuNote}.`,
      );
    } else {
      findings.push(
        `${scenario} throughput went from ${formatRps(lowRps)} rps at ${minReplicas} replica(s) to ${formatRps(highRps)} rps at ${maxReplicas} replica(s), a factor of ${formatFactor(factor)} (connections = ${topConnections}), while ${cpuNote}.`,
      );
    }
  }
}

let worstShare = null;
for (const run of runs) {
  const shares = instanceShares(run);
  if (shares.length < 2) continue;
  const spread = num(shares[0].sharePct) === null || num(shares[shares.length - 1].sharePct) === null
    ? null
    : shares[0].sharePct - shares[shares.length - 1].sharePct;
  if (spread === null) continue;
  if (worstShare === null || spread > worstShare.spread) worstShare = { run, shares, spread };
}
if (worstShare) {
  findings.push(
    `The widest load-balancer spread was in ${worstShare.run.scenario} at ${formatCount(num(worstShare.run.replicas))} replicas, connections = ${formatCount(num(worstShare.run.connections))}: ${worstShare.shares.map((share) => `${share.instance} took ${formatPct(share.sharePct)}`).join(', ')} — a gap of ${worstShare.spread.toFixed(1)} percentage points between busiest and quietest instance.`,
  );
}

let peakPgConnections = null;
for (const run of runs) {
  const value = postgresConnections(run);
  if (value === null) continue;
  if (peakPgConnections === null || value > peakPgConnections.value) peakPgConnections = { value, run };
}
if (peakPgConnections) {
  findings.push(
    `Postgres connections peaked at ${formatCount(peakPgConnections.value)} during ${peakPgConnections.run.scenario} at ${formatCount(num(peakPgConnections.run.replicas))} replicas, connections = ${formatCount(num(peakPgConnections.run.connections))}, with a configured pool of ${formatCount(num(config.dbPoolPerProcess))} per api process.`,
  );
}

let peakEventLoop = null;
for (const run of runs) {
  for (const entry of eventLoopP99List(run)) {
    if (entry.p99Ms === null) continue;
    if (peakEventLoop === null || entry.p99Ms > peakEventLoop.p99Ms) peakEventLoop = { ...entry, run };
  }
}
if (peakEventLoop) {
  findings.push(
    `The highest event-loop delay p99 was ${formatMs(peakEventLoop.p99Ms)} ms on instance ${peakEventLoop.instance} during ${peakEventLoop.run.scenario} at ${formatCount(num(peakEventLoop.run.replicas))} replicas, connections = ${formatCount(num(peakEventLoop.run.connections))}.`,
  );
}

let worstOverhead = null;
for (const run of runs) {
  const clientP95 = num(run.clientLatency?.p95Ms);
  const serverP95 = worstInstanceRouteValue(run, 'p95Ms');
  if (clientP95 === null || serverP95 === null) continue;
  const overhead = clientP95 - serverP95;
  if (worstOverhead === null || overhead > worstOverhead.overhead) worstOverhead = { overhead, clientP95, serverP95, run };
}
if (worstOverhead) {
  findings.push(
    `The largest gap between client and server p95 was ${formatMs(worstOverhead.overhead)} ms in ${worstOverhead.run.scenario} at ${formatCount(num(worstOverhead.run.replicas))} replicas, connections = ${formatCount(num(worstOverhead.run.connections))}: client p95 ${formatMs(worstOverhead.clientP95)} ms against worst-instance server p95 ${formatMs(worstOverhead.serverP95)} ms on route ${busiestRouteKey(worstOverhead.run) ?? MISSING}.`,
  );
}

let peakGenerator = null;
for (const run of runs) {
  const value = num(run.generator?.coreUtilisationPct);
  if (value === null) continue;
  if (peakGenerator === null || value > peakGenerator.value) peakGenerator = { value, run };
}
if (peakGenerator) {
  const saturated = runs.filter((run) => (num(run.generator?.coreUtilisationPct) ?? 0) >= 90);
  findings.push(
    `Generator core utilisation peaked at ${formatPct(peakGenerator.value)} of one core during ${peakGenerator.run.scenario} at ${formatCount(num(peakGenerator.run.replicas))} replicas, connections = ${formatCount(num(peakGenerator.run.connections))}; ${saturated.length === 0 ? 'no run reached 90 per cent, so no throughput figure here is a measurement of the generator' : `${formatCount(saturated.length)} run(s) reached 90 per cent or more and their throughput is bounded by the generator`}.`,
  );
}

const failingRuns = runs.filter((run) => (num(run.requests?.failures) ?? 0) > 0);
if (failingRuns.length === 0) {
  findings.push(`No run reported a transport failure: requests.failures is 0 in all ${formatCount(runs.length)} runs.`);
} else {
  for (const run of failingRuns) {
    findings.push(
      `${run.scenario} at ${formatCount(num(run.replicas))} replicas, connections = ${formatCount(num(run.connections))} reported ${formatCount(num(run.requests?.failures))} failures out of ${formatCount(num(run.requests?.total))} requests, statuses ${JSON.stringify(run.requests?.statuses ?? {})}.`,
    );
  }
}

const nonSuccess = runs.filter((run) => {
  const statuses = run.requests?.statuses ?? {};
  return Object.keys(statuses).some((bucket) => bucket !== '2xx' && (num(statuses[bucket]) ?? 0) > 0);
});
for (const run of nonSuccess) {
  findings.push(
    `${run.scenario} at ${formatCount(num(run.replicas))} replicas, connections = ${formatCount(num(run.connections))} returned non-2xx responses: ${JSON.stringify(run.requests?.statuses ?? {})}.`,
  );
}

const missingResources = runs.filter((run) => !run.resources);
if (missingResources.length > 0) {
  findings.push(
    `${formatCount(missingResources.length)} of ${formatCount(runs.length)} runs carry no mid-run resource sample, so their container cpu, redis and database figures are absent rather than zero.`,
  );
}

bullets(findings);

heading('9. Caveats');
bullets([
  'The generator is closed loop: one in-flight request per connection, so a slow response throttles the offered load. There is no coordinated-omission correction, and reported latency is the latency of requests that were actually sent.',
  'Generator and system under test run on the same host, competing for the same cores and memory.',
  'Authentication uses a single seeded user and a single session cookie, so session lookup caching is warmer than a real multi-user population would be.',
  'AI providers are stubbed for this run (config.aiEnabled is false), so no scenario exercises a model call or its latency.',
  'Only the api service was scaled. The web tier, database, cache and edge each stayed at one instance and are shared across every replica count.',
  'One run per cell: each replica/scenario/connection combination was measured once, so cell-to-cell differences below run-to-run noise carry no signal.',
  'Docker stats, redis client counts and database counters are single samples taken mid-run, not averages over the measurement window.',
]);

const pages = doc.bufferedPageRange();
for (let index = pages.start; index < pages.start + pages.count; index += 1) {
  doc.switchToPage(index);
  doc.page.margins.bottom = 0;
  doc
    .font(FONT)
    .fontSize(SMALL_SIZE)
    .fillColor(GREY)
    .text(
      `${gitSha}   ·   page ${index + 1} of ${pages.count}`,
      MARGIN,
      doc.page.height - MARGIN + 6,
      { width: contentWidth, align: 'center', lineBreak: false },
    );
}

doc.end();
await new Promise((resolveClose, rejectClose) => {
  stream.on('finish', resolveClose);
  stream.on('error', rejectClose);
});
console.log(`wrote ${outPath} (${pages.count} pages) from ${inputPath}`);
