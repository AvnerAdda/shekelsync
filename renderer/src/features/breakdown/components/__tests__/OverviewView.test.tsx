import { describe, expect, it } from 'vitest';
import {
  buildOverviewLeafParams,
  computeOverviewDelta,
  formatOverviewPieLabel,
  resolveOverviewHeaderTitle,
} from '../overview-helpers';

describe('OverviewView helpers', () => {
  it('computes deltas and guards against missing previous totals', () => {
    expect(computeOverviewDelta(120, 100)).toBe(20);
    expect(computeOverviewDelta(80, 100)).toBe(-20);
    expect(computeOverviewDelta(80, 0)).toBeNull();
    expect(computeOverviewDelta(80, undefined)).toBeNull();
  });

  it('builds leaf click params for each drill level', () => {
    expect(buildOverviewLeafParams(null, 10, 'Groceries')).toEqual({
      parentId: 10,
      categoryName: 'Groceries',
    });

    expect(
      buildOverviewLeafParams(
        {
          type: 'parent',
          parentId: 2,
          parentName: 'Housing',
        },
        11,
        'Rent',
      ),
    ).toEqual({
      subcategoryId: 11,
      categoryName: 'Rent',
    });

    expect(
      buildOverviewLeafParams(
        {
          type: 'subcategory',
          parentId: 2,
          subcategoryId: 11,
          subcategoryName: 'Rent',
        },
        12,
        'Landlord',
      ),
    ).toEqual({
      categoryName: 'Landlord',
    });
  });

  it('resolves header titles and pie labels', () => {
    const parentTitle = (name: string) => `Parent: ${name}`;
    const subcategoryTitle = (name: string) => `Sub: ${name}`;

    expect(
      resolveOverviewHeaderTitle(null, 'Overview', parentTitle, subcategoryTitle),
    ).toBe('Overview');
    expect(
      resolveOverviewHeaderTitle(
        { type: 'parent', parentId: 5, parentName: 'Housing' },
        'Overview',
        parentTitle,
        subcategoryTitle,
      ),
    ).toBe('Parent: Housing');
    expect(
      resolveOverviewHeaderTitle(
        {
          type: 'subcategory',
          parentId: 5,
          subcategoryId: 6,
          subcategoryName: 'Rent',
        },
        'Overview',
        parentTitle,
        subcategoryTitle,
      ),
    ).toBe('Sub: Rent');

    expect(formatOverviewPieLabel(50, 200)).toBe('25%');
    expect(formatOverviewPieLabel(undefined, 200)).toBe('0%');
    expect(formatOverviewPieLabel(50, 0)).toBe('0%');
  });
});
