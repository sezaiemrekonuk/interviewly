import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Meter } from './meter';

describe('Meter', () => {
  it('renders a native progress element, so no style attribute is needed under CSP', () => {
    const { container } = render(<Meter value={41} label="Session elapsed" />);
    const el = container.querySelector('progress');
    expect(el).not.toBeNull();
    // The bug this replaces: a width in a style attribute, dropped by `style-src 'self'`.
    expect(el!.getAttribute('style')).toBeNull();
    expect(el!.value).toBe(41);
    expect(el!.max).toBe(100);
  });

  it('clamps a value past its ceiling instead of overflowing the track', () => {
    // Real case: spent_usd exceeds budget_usd on the call that trips the ceiling.
    const { container } = render(<Meter value={0.62} max={0.5} label="Budget" />);
    expect(container.querySelector('progress')!.value).toBe(0.5);
  });

  it('clamps a negative value to zero', () => {
    const { container } = render(<Meter value={-3} label="Mic level" />);
    expect(container.querySelector('progress')!.value).toBe(0);
  });

  it('survives a zero or negative max rather than dividing by it', () => {
    const { container } = render(<Meter value={1} max={0} label="Questions" />);
    const el = container.querySelector('progress')!;
    expect(el.max).toBe(1);
    expect(el.value).toBe(1);
  });

  it('is named for screen readers by default', () => {
    render(<Meter value={5} max={8} label="Question 5 of 8" />);
    expect(screen.getByLabelText('Question 5 of 8')).toBeInTheDocument();
  });

  it('is hidden when the same value is already stated in text beside it', () => {
    const { container } = render(<Meter value={5} max={8} label="ignored" decorative />);
    const el = container.querySelector('progress')!;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('aria-label')).toBeNull();
  });
});
