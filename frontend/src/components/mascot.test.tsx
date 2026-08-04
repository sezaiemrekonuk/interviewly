import type { MascotPose } from '@interviewly/types';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../test/render';
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
    expect(screen.getByRole('img')).toHaveAccessibleName(/.+/);
  });

  it('renders decorative when alt is empty', () => {
    const { container } = renderWithIntl(<Mascot pose="shrug" alt="" />);
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });
});
