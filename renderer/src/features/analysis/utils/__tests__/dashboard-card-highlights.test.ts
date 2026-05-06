import { describe, expect, it } from 'vitest';

import {
  buildPersonalityHighlightDescriptors,
  buildRhythmHighlightDescriptors,
} from '../dashboard-card-highlights';

describe('dashboard card highlights', () => {
  it('prioritizes average daily spend and flags low time precision in rhythm highlights', () => {
    expect(buildRhythmHighlightDescriptors({
      avgDailySpend: 120,
      weekendPercentage: 58,
      peakHour: 19,
      preciseTimePercentage: 42,
    })).toEqual([
      { key: 'avgDaily', priority: 'primary', tone: 'default' },
      { key: 'weekendShare', priority: 'secondary', tone: 'warning' },
      { key: 'peakHour', priority: 'secondary', tone: 'default' },
      { key: 'preciseTime', priority: 'secondary', tone: 'warning' },
    ]);
  });

  it('falls back to the first available rhythm metric when the primary metric is missing', () => {
    expect(buildRhythmHighlightDescriptors({
      avgDailySpend: null,
      weekendPercentage: null,
      peakHour: 8,
      preciseTimePercentage: null,
    })).toEqual([
      { key: 'peakHour', priority: 'primary', tone: 'default' },
    ]);
  });

  it('promotes the dominant personality mode and keeps the rest secondary', () => {
    expect(buildPersonalityHighlightDescriptors({
      impulsePercentage: 28,
      programmedPercentage: 72,
      programmedAmount: 640,
      impulseAmount: 120,
      recurringCount: 6,
      topCategoryWeekly: 180,
    })).toEqual([
      { key: 'planned', priority: 'primary', tone: 'success' },
      { key: 'recurringPatterns', priority: 'secondary', tone: 'default' },
      { key: 'topCategoryWeekly', priority: 'secondary', tone: 'default' },
      { key: 'programmedSpend', priority: 'secondary', tone: 'success' },
      { key: 'impulseSpend', priority: 'secondary', tone: 'warning' },
    ]);
  });

  it('flags an impulse-led personality as the primary warning state', () => {
    expect(buildPersonalityHighlightDescriptors({
      impulsePercentage: 61,
      programmedPercentage: 39,
      programmedAmount: null,
      impulseAmount: null,
      recurringCount: null,
      topCategoryWeekly: null,
    })[0]).toEqual({ key: 'impulse', priority: 'primary', tone: 'warning' });
  });
});