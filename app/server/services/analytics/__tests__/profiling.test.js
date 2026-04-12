import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const profilingService = require('../profiling.js');

function createMockClient(...responses) {
  const query = vi.fn();
  responses.forEach((response) => {
    query.mockResolvedValueOnce(response);
  });

  return {
    client: {
      query,
      release: vi.fn(),
    },
    query,
  };
}

describe('analytics profiling service', () => {
  beforeEach(() => {
    profilingService.__resetDependencies();
  });

  afterEach(() => {
    profilingService.__resetDependencies();
    vi.restoreAllMocks();
  });

  it('treats spouse income 0 as complete for married profiles', () => {
    const missingFields = profilingService.utils.collectMissingFields(
      {
        age: 34,
        location: 'Tel Aviv',
        monthly_income: 12000,
        marital_status: 'married',
        household_size: 2,
        children_count: 1,
        occupation: 'Engineer',
        industry: 'Tech',
      },
      {
        monthly_income: 0,
      },
    );

    expect(missingFields).not.toContain('spouse_monthly_income');
  });

  it('maps locations and occupation fallbacks to the expected benchmark buckets', () => {
    expect(profilingService.utils.resolveLocationBenchmark('Tel Aviv')).toMatchObject({
      status: 'matched',
      key: 'tel_aviv_yafo',
      label: 'Tel Aviv-Yafo',
    });

    expect(profilingService.utils.resolveLocationBenchmark('Herzliya')).toMatchObject({
      status: 'fallback',
      key: 'urban_total',
    });

    expect(
      profilingService.utils.resolveOccupationBenchmark(
        { occupation: 'Engineer', industry: 'Tech' },
        32,
      ),
    ).toMatchObject({
      status: 'matched',
      groupKey: 'professionals',
      ageGroup: '25_34',
    });

    expect(
      profilingService.utils.resolveOccupationBenchmark(
        { occupation: '', industry: 'Retail' },
        41,
      ),
    ).toMatchObject({
      status: 'fallback',
      groupKey: 'service_sales',
      mappingSource: 'industry',
      ageGroup: '35_44',
    });
  });

  it('maps score bands on the exact configured boundaries', () => {
    expect(profilingService.utils.resolveScoreBand(29)).toBe('well_below_average');
    expect(profilingService.utils.resolveScoreBand(30)).toBe('below_average');
    expect(profilingService.utils.resolveScoreBand(44)).toBe('below_average');
    expect(profilingService.utils.resolveScoreBand(45)).toBe('near_average');
    expect(profilingService.utils.resolveScoreBand(59)).toBe('near_average');
    expect(profilingService.utils.resolveScoreBand(60)).toBe('above_average');
    expect(profilingService.utils.resolveScoreBand(74)).toBe('above_average');
    expect(profilingService.utils.resolveScoreBand(75)).toBe('well_above_average');
  });

  it('detects stale saved assessments when the profile hash changes', async () => {
    const profile = {
      id: 1,
      age: 32,
      birth_date: null,
      marital_status: 'single',
      occupation: 'Engineer',
      industry: 'Tech',
      monthly_income: 15000,
      location: 'Tel Aviv',
      children_count: 0,
      household_size: 1,
    };

    const savedAssessment = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      benchmarkVersion: profilingService.utils.BENCHMARK_PACK.version,
      score: 60,
      band: 'above_average',
      confidence: 0.9,
      comparators: [],
      metrics: {},
      narrative: {
        headline: 'Saved',
        summary: 'Saved summary',
        strengths: [],
        risks: [],
        actions: [],
        caveats: [],
      },
      sources: [],
    };

    const { client } = createMockClient(
      { rows: [profile] },
      { rows: [] },
      {
        rows: [
          {
            assessment_type: 'profiling',
            profile_hash: 'outdated-hash',
            benchmark_version: profilingService.utils.BENCHMARK_PACK.version,
            assessment_json: JSON.stringify(savedAssessment),
          },
        ],
      },
    );

    profilingService.__setDatabase({
      getClient: vi.fn().mockResolvedValue(client),
    });

    const result = await profilingService.getProfilingStatus({}, { now: new Date('2026-04-09T00:00:00.000Z') });

    expect(result).toMatchObject({
      missingFields: [],
      isStale: true,
      staleReasons: ['profile_changed'],
      assessment: savedAssessment,
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('generates, saves, and returns a profiling assessment', async () => {
    const profile = {
      id: 1,
      age: 32,
      birth_date: null,
      marital_status: 'married',
      occupation: 'Engineer',
      industry: 'Tech',
      monthly_income: 18000,
      location: 'Tel Aviv',
      children_count: 2,
      household_size: 4,
    };
    const spouse = {
      user_profile_id: 1,
      monthly_income: 9000,
    };
    const now = new Date('2026-04-09T12:00:00.000Z');

    const { client, query } = createMockClient(
      { rows: [profile] },
      { rows: [spouse] },
      { rows: [] },
      {
        rows: [
          {
            income: 81000,
            expenses: 45000,
            transaction_count: 36,
          },
        ],
      },
      { rows: [] },
    );

    profilingService.__setDatabase({
      getClient: vi.fn().mockResolvedValue(client),
    });
    profilingService.__setCreateCompletion(
      vi.fn().mockResolvedValue({
        success: true,
        message: {
          role: 'assistant',
          content: JSON.stringify({
            headline: 'Above the household benchmark',
            summary: 'Income is strong for this household size, but expenses still deserve attention.',
            strengths: ['Declared income is above the official household benchmark.'],
            risks: ['Expenses are still meaningful against the household benchmark.'],
            actions: ['Keep monitoring discretionary spending.'],
            caveats: ['Location comparison uses a city average rather than a neighborhood average.'],
          }),
        },
      }),
    );

    const result = await profilingService.generateProfilingAssessment(
      { openaiApiKey: 'sk-test-key' },
      { locale: 'en', now },
    );

    expect(result.missingFields).toEqual([]);
    expect(result.isStale).toBe(false);
    expect(result.staleReasons).toEqual([]);
    expect(result.assessment).toMatchObject({
      generatedAt: now.toISOString(),
      benchmarkVersion: profilingService.utils.BENCHMARK_PACK.version,
      narrative: {
        headline: 'Above the household benchmark',
        summary: 'Income is strong for this household size, but expenses still deserve attention.',
      },
    });
    expect(result.assessment.comparators).toHaveLength(5);
    expect(result.assessment.comparators.find((item) => item.key === 'nationalWageAnchor')?.weighted).toBe(false);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO profile_assessments'),
      expect.arrayContaining([
        'profiling',
        expect.any(String),
        profilingService.utils.BENCHMARK_PACK.version,
        'gpt-4.1-mini',
        now.toISOString(),
      ]),
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('fails when the AI response is not valid JSON', async () => {
    const profile = {
      id: 1,
      age: 32,
      birth_date: null,
      marital_status: 'single',
      occupation: 'Engineer',
      industry: 'Tech',
      monthly_income: 15000,
      location: 'Tel Aviv',
      children_count: 0,
      household_size: 1,
    };

    const { client } = createMockClient(
      { rows: [profile] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            income: 45000,
            expenses: 24000,
            transaction_count: 15,
          },
        ],
      },
    );

    profilingService.__setDatabase({
      getClient: vi.fn().mockResolvedValue(client),
    });
    profilingService.__setCreateCompletion(
      vi.fn().mockResolvedValue({
        success: true,
        message: {
          role: 'assistant',
          content: 'not-json',
        },
      }),
    );

    await expect(
      profilingService.generateProfilingAssessment(
        { openaiApiKey: 'sk-test-key' },
        { locale: 'en', now: new Date('2026-04-09T00:00:00.000Z') },
      ),
    ).rejects.toMatchObject({
      status: 502,
      message: 'Profiling AI response was not valid JSON',
    });

    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
