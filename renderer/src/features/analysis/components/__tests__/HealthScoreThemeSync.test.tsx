import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setHealthScore = vi.fn();
const get = vi.fn();

vi.mock('@renderer/contexts/ThemeContext', () => ({ useThemeMode: () => ({ setHealthScore }) }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get: (...args: unknown[]) => get(...args) } }));

import HealthScoreThemeSync from '../HealthScoreThemeSync';

const ok = (data: unknown) => ({ ok: true, status: 200, data });

describe('HealthScoreThemeSync', () => {
  beforeEach(() => {
    setHealthScore.mockReset();
    get.mockReset();
  });

  it('applies the 60-day score to the theme at launch', async () => {
    get.mockResolvedValue(ok({ overallHealthScore: 72, healthScoreMeta: { confidence: { savings: true } } }));
    render(<HealthScoreThemeSync />);
    await waitFor(() => expect(setHealthScore).toHaveBeenCalledWith(72));
    expect(get.mock.calls[0][0]).toMatch(/personal-intelligence\?startDate=\d{4}-\d{2}-\d{2}&endDate=/);
  });

  it('keeps the default accent when there is no usable data', async () => {
    get.mockResolvedValue(ok({ overallHealthScore: 20, healthScoreMeta: { confidence: { savings: false, runway: false } } }));
    render(<HealthScoreThemeSync />);
    await waitFor(() => expect(setHealthScore).toHaveBeenCalledWith(null));
  });

  it('refetches on dataRefresh', async () => {
    get.mockResolvedValueOnce(ok({ overallHealthScore: 50 })).mockResolvedValueOnce(ok({ overallHealthScore: 85 }));
    render(<HealthScoreThemeSync />);
    await waitFor(() => expect(setHealthScore).toHaveBeenCalledWith(50));
    act(() => { window.dispatchEvent(new Event('dataRefresh')); });
    await waitFor(() => expect(setHealthScore).toHaveBeenCalledWith(85));
  });
});
