import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { messages, renderWithIntl } from '../../test/render';

import { ScoreTrend } from './score-trend';

const POINTS = [
  { id: 'q1', score: 80, roundType: 'hr' as const },
  { id: 'q2', score: 40, roundType: 'tech' as const },
  { id: 'q3', score: 100, roundType: 'hr' as const },
];

const barsIn = (container: HTMLElement) => [...container.querySelectorAll('rect + rect')];

describe('ScoreTrend', () => {
  it('draws one column per answer and prints every score as text beside it', () => {
    const { container } = renderWithIntl(<ScoreTrend points={POINTS} overall={73} />);

    expect(barsIn(container)).toHaveLength(3);
    for (const point of POINTS) {
      expect(screen.getByText(String(point.score))).toBeInTheDocument();
    }
  });

  it('groups the columns by round without reordering the answers inside one', () => {
    const { container } = renderWithIntl(<ScoreTrend points={POINTS} overall={73} />);

    expect(screen.getByText(messages.report.roundHr)).toBeInTheDocument();
    expect(screen.getByText(messages.report.roundTech)).toBeInTheDocument();

    const bars = barsIn(container);
    expect(bars.map((bar) => Number(bar.getAttribute('x')))).toEqual(
      [...bars].map((bar) => Number(bar.getAttribute('x'))).sort((a, b) => a - b),
    );
    expect(bars.map((bar) => Number(bar.getAttribute('height')))).toEqual([128, 160, 64]);
  });

  it('runs the baseline through the overall score', () => {
    const { container } = renderWithIntl(<ScoreTrend points={POINTS} overall={73} />);

    const line = container.querySelector('line')!;
    expect(line.getAttribute('y1')).toBe(line.getAttribute('y2'));

    const tops = barsIn(container).map((bar) => Number(bar.getAttribute('y')));
    const baseline = Number(line.getAttribute('y1'));
    expect(Math.min(...tops)).toBeLessThan(baseline);
    expect(Math.max(...tops)).toBeGreaterThan(baseline);
  });
});
