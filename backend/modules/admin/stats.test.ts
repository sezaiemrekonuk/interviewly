/**
 * Issue 85. The two full-table scans moved into Postgres; the JS that survived is the fold
 * over the already-grouped occupation rows, and it is the only part that can silently
 * produce a different `perOccupation` than the scan did. So that is what is pinned here:
 * the totals, the modal label, and the tie-break the old sort left to row order.
 */
import { describe, expect, it } from 'vitest';

import { summariseOccupations } from './stats';

const clusters = new Map([
  ['c1', 'software_engineering'],
  ['c2', 'design'],
]);

const group = (id: string, occupation: string, count: number) => ({
  occupation_cluster_id: id,
  occupation,
  _count: { _all: count },
});

describe('summariseOccupations', () => {
  it('sums a cluster across its occupations and labels it with the modal one', () => {
    expect(
      summariseOccupations(
        [group('c1', 'developer', 70), group('c1', 'backend engineer', 7), group('c2', 'designer', 12)],
        clusters,
      ),
    ).toEqual([
      { cluster: 'software_engineering', label: 'developer', count: 77 },
      { cluster: 'design', label: 'designer', count: 12 },
    ]);
  });

  it('breaks a modal tie on occupation, not on row order', () => {
    const [first] = summariseOccupations([group('c1', 'developer', 5), group('c1', 'architect', 5)], clusters);
    const [reversed] = summariseOccupations([group('c1', 'architect', 5), group('c1', 'developer', 5)], clusters);

    expect(first.label).toBe('architect');
    expect(reversed.label).toBe(first.label);
  });

  it('orders clusters by count desc, then key', () => {
    expect(
      summariseOccupations([group('c2', 'designer', 3), group('c1', 'developer', 3)], clusters).map(
        (r) => r.cluster,
      ),
    ).toEqual(['design', 'software_engineering']);
  });

  it('drops a group whose cluster is unknown rather than inventing a key', () => {
    expect(summariseOccupations([group('gone', 'developer', 9)], clusters)).toEqual([]);
  });
});
