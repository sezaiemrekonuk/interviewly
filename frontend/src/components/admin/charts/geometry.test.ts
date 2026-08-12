import { describe, expect, it } from 'vitest';

import { bands, donutSlices, labelledIndexes, niceMax, stackBands, tickValues } from './geometry';

describe('niceMax', () => {
  it('never returns a ceiling below the value it was given', () => {
    for (const value of [0.3, 1, 1.4, 2.6, 7, 12, 340, 0.000004, 99_999]) {
      expect(niceMax(value)).toBeGreaterThanOrEqual(value);
    }
  });

  it('snaps to a 1/2/2.5/5/10 step of the value decade', () => {
    expect(niceMax(1)).toBe(1);
    expect(niceMax(1.4)).toBe(2);
    expect(niceMax(2.6)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(340)).toBe(500);
  });

  it('gives a drawable axis for an empty or negative series', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
    expect(niceMax(-Infinity)).toBe(1);
  });
});

describe('tickValues', () => {
  it('spans zero to the max inclusive', () => {
    expect(tickValues(100, 4)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe('labelledIndexes', () => {
  it('always includes the first and last index', () => {
    const picked = labelledIndexes(90, 4);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(89);
  });

  it('returns every index when the series is shorter than the label budget', () => {
    expect(labelledIndexes(3, 4)).toEqual([0, 1, 2]);
  });

  it('never repeats an index', () => {
    const picked = labelledIndexes(5, 4);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('draws nothing for an empty series', () => {
    expect(labelledIndexes(0, 4)).toEqual([]);
  });
});

describe('bands', () => {
  it('fills the width exactly, gaps included', () => {
    const laid = bands(4, 100, 4);
    const last = laid[3];
    expect(last.x + last.width).toBeCloseTo(100);
  });

  it('does not produce a negative width when the gaps exceed the box', () => {
    expect(bands(10, 8, 4).every((band) => band.width >= 0)).toBe(true);
  });

  it('is empty for no categories', () => {
    expect(bands(0, 100, 4)).toEqual([]);
  });
});

describe('stackBands', () => {
  const plot = { width: 100, height: 100 };

  it('stacks each series on the running total below it', () => {
    const [lower, upper] = stackBands(
      [
        [50, 50],
        [50, 50],
      ],
      plot,
      100,
    );
    expect(lower).toBe('0.0,50.0 100.0,50.0 100.0,100.0 0.0,100.0');
    expect(upper).toBe('0.0,0.0 100.0,0.0 100.0,50.0 0.0,50.0');
  });

  it('returns one polygon per series', () => {
    expect(stackBands([[1], [2], [3]], plot, 10)).toHaveLength(3);
  });

  it('draws nothing rather than dividing by zero on an empty or unscaled series', () => {
    expect(stackBands([[]], plot, 100)).toEqual(['']);
    expect(stackBands([[1, 2]], plot, 0)).toEqual(['']);
  });

  it('clamps a total that overflows the axis instead of drawing above the plot', () => {
    const [only] = stackBands([[200]], plot, 100);
    expect(only).not.toContain('-');
  });
});

describe('donutSlices', () => {
  const circumference = 400;

  it('consumes the whole circle across the slices', () => {
    const values = [50, 30, 20];
    const slices = donutSlices(values, circumference, 0);
    const drawn = slices.reduce((sum, slice) => sum + Number(slice.dash.split(' ')[0]), 0);
    expect(drawn).toBeCloseTo(circumference);
  });

  it('offsets each slice by the arc length before it', () => {
    const slices = donutSlices([50, 50], circumference, 0);
    expect(slices[0].offset).toBe(-0);
    expect(slices[1].offset).toBe(-200);
  });

  it('opens a gap between neighbours without shifting where they start', () => {
    const gapped = donutSlices([50, 50], circumference, 2);
    expect(Number(gapped[0].dash.split(' ')[0])).toBeCloseTo(198);
    expect(gapped[1].offset).toBe(-200);
  });

  it('does not eat a slice too small to carry the gap', () => {
    const [tiny] = donutSlices([1, 999], circumference, 2);
    expect(Number(tiny.dash.split(' ')[0])).toBeGreaterThan(0);
  });

  it('draws an empty ring when nothing was spent', () => {
    expect(donutSlices([0, 0], circumference)).toEqual([
      { dash: '0 400', offset: 0 },
      { dash: '0 400', offset: 0 },
    ]);
  });
});
