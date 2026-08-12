export interface Plot {
  width: number;
  height: number;
}

export interface Band {
  x: number;
  width: number;
}

const STEPS = [1, 2, 2.5, 5, 10];

export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const decade = 10 ** exponent;
  const step = STEPS.find((candidate) => value <= candidate * decade) ?? 10;
  return step * decade;
}

export function tickValues(max: number, steps: number): number[] {
  return Array.from({ length: steps + 1 }, (_, index) => (max * index) / steps);
}

export function labelledIndexes(length: number, count: number): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, index) => index);
  const gap = (length - 1) / (count - 1);
  return [...new Set(Array.from({ length: count }, (_, index) => Math.round(index * gap)))];
}

export function bands(count: number, width: number, gap: number): Band[] {
  if (count <= 0) return [];
  const each = Math.max(0, (width - gap * (count - 1)) / count);
  return Array.from({ length: count }, (_, index) => ({ x: index * (each + gap), width: each }));
}

export function stackBands(series: number[][], plot: Plot, max: number): string[] {
  const length = series[0]?.length ?? 0;
  if (length === 0 || max <= 0) return series.map(() => '');

  const step = length === 1 ? 0 : plot.width / (length - 1);
  const x = (index: number) => (length === 1 ? plot.width / 2 : index * step);
  const y = (total: number) => plot.height - (Math.min(total, max) / max) * plot.height;

  const running = new Array<number>(length).fill(0);
  return series.map((values) => {
    const floor = running.map((total, index) => `${x(index).toFixed(1)},${y(total).toFixed(1)}`);
    for (let index = 0; index < length; index += 1) running[index] += values[index] ?? 0;
    const ceiling = running.map((total, index) => `${x(index).toFixed(1)},${y(total).toFixed(1)}`);
    return [...ceiling, ...floor.reverse()].join(' ');
  });
}

export interface Slice {
  dash: string;
  offset: number;
}

export function donutSlices(values: number[], circumference: number, gap = 2): Slice[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => ({ dash: `0 ${circumference}`, offset: 0 }));

  let consumed = 0;
  return values.map((value) => {
    const length = (value / total) * circumference;
    const drawn = Math.max(0, length - (length > gap ? gap : 0));
    const slice = { dash: `${drawn.toFixed(2)} ${(circumference - drawn).toFixed(2)}`, offset: -consumed };
    consumed += length;
    return slice;
  });
}
