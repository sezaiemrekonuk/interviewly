import type { MascotPose } from '@interviewly/types';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { messages, renderWithIntl } from '../test/render';
import { Mascot, mascotKey, mascotUrl } from './mascot';

// The five poses, typed — a sixth added to the union without a seed object is caught by
// `ui-checks/assets.test.ts`, not here.
const POSES: MascotPose[] = ['wave', 'point', 'think', 'cheer', 'shrug'];

// Same shape ui-checks/assets.test.ts asserts against the seed's own template.
const MASCOT_KEY_RE = /^mascot\/(wave|point|think|cheer|shrug)-[0-9a-f]{64}\.webp$/;

describe('mascotKey (ui §4.2.1)', () => {
  for (const pose of POSES) {
    it(`${pose} resolves to a content-addressed key`, () => {
      expect(mascotKey(pose)).toMatch(MASCOT_KEY_RE);
      expect(mascotKey(pose)).toContain(`mascot/${pose}-`);
    });
  }

  it('every pose resolves to a distinct key', () => {
    expect(new Set(POSES.map(mascotKey)).size).toBe(POSES.length);
  });

  it('the url is the key under the public asset prefix', () => {
    expect(mascotUrl('wave')).toBe(`/assets/${mascotKey('wave')}`);
  });
});

describe('<Mascot>', () => {
  it('renders the pose image at its immutable key', () => {
    renderWithIntl(<Mascot pose="think" alt="thinking" />);
    expect(screen.getByAltText('thinking')).toHaveAttribute('src', mascotUrl('think'));
  });

  it('preloads only the pose it renders (§8.1 landing budget)', () => {
    const { container } = renderWithIntl(<Mascot pose="wave" />);
    const preloads = [...document.querySelectorAll('link[rel="preload"][as="image"]')];
    expect(preloads.map((l) => l.getAttribute('href'))).toEqual([mascotUrl('wave')]);
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('falls back to the localized per-pose alt text', () => {
    renderWithIntl(<Mascot pose="cheer" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(messages.mascot.cheer);
  });

  it('renders decorative when alt is empty', () => {
    const { container } = renderWithIntl(<Mascot pose="shrug" alt="" />);
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });
});

/**
 * The seeded WebPs are 34-byte 1×1 placeholders — they *load*, so `onError` alone never
 * fires and every slot paints a stretched empty block. The width check is what catches it.
 */
describe('<Mascot> fallback (ui §4.2.1 graceful degradation)', () => {
  function decode(img: HTMLImageElement, naturalWidth: number) {
    Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true });
    fireEvent.load(img);
  }

  it('draws the inline character when the key resolves to a placeholder', () => {
    const { container } = renderWithIntl(<Mascot pose="wave" alt="waving" />);
    decode(container.querySelector('img')!, 1);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'waving' })).toHaveAttribute(
      'data-mascot-pose',
      'wave',
    );
  });

  it('draws the inline character when the image errors outright', () => {
    const { container } = renderWithIntl(<Mascot pose="think" />);
    fireEvent.error(container.querySelector('img')!);

    expect(screen.getByTestId('mascot-drawing')).toHaveAccessibleName(messages.mascot.think);
  });

  it('keeps the image once real artwork decodes', () => {
    const { container } = renderWithIntl(<Mascot pose="cheer" alt="cheering" />);
    decode(container.querySelector('img')!, 320);

    expect(container.querySelector('img')).toHaveAttribute('src', mascotUrl('cheer'));
    expect(screen.queryByTestId('mascot-drawing')).not.toBeInTheDocument();
  });

  it('keeps the drawn fallback decorative when alt is empty', () => {
    const { container } = renderWithIntl(<Mascot pose="shrug" alt="" size={160} />);
    decode(container.querySelector('img')!, 1);

    const svg = screen.getByTestId('mascot-drawing');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    // Same box as the image it replaced — a decorative fallback must not shift the layout.
    expect(svg).toHaveAttribute('width', '160');
    expect(svg).toHaveAttribute('height', '160');
    expect(container.querySelector('img')).toBeNull();
  });

  for (const pose of POSES) {
    it(`draws a ${pose} variant`, () => {
      const { container } = renderWithIntl(<Mascot pose={pose} alt="" />);
      decode(container.querySelector('img')!, 1);
      expect(screen.getByTestId('mascot-drawing')).toHaveAttribute('data-mascot-pose', pose);
    });
  }
});
