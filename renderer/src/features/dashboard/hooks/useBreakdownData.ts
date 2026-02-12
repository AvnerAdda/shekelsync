import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { BreakdownType } from '@renderer/types/analytics';
import { useLocaleSettings } from '@renderer/i18n/I18nProvider';

interface UseBreakdownDataOptions {
  startDate: Date;
  endDate: Date;
  initialTypes?: BreakdownType[];
  enabled?: boolean;
}

interface UseBreakdownDataResult {
  breakdownData: Record<BreakdownType, any>;
  breakdownLoading: Record<BreakdownType, boolean>;
  breakdownErrors: Record<BreakdownType, Error | null>;
  fetchBreakdown: (type: BreakdownType) => Promise<void>;
  refreshBreakdowns: (types?: BreakdownType[]) => void;
}

const TYPES: BreakdownType[] = ['expense', 'income', 'investment'];
const DEFAULT_INITIAL_TYPES: BreakdownType[] = ['expense', 'income'];
export const BREAKDOWN_CACHE_TTL_MS = 60_000;

type CacheEntry = {
  data: any;
  timestamp: number;
};

const breakdownCache = new Map<string, CacheEntry>();

export function makeCacheKey(type: BreakdownType, start: Date, end: Date, locale: string): string {
  return `${type}:${start.toISOString()}:${end.toISOString()}:${locale}`;
}

export function createInitialState<T>(value: T): Record<BreakdownType, T> {
  return {
    expense: value,
    income: value,
    investment: value,
  };
}

export function normalizeBreakdownTypes(initialTypes?: BreakdownType[]): BreakdownType[] {
  const sourceInitialTypes = initialTypes ?? DEFAULT_INITIAL_TYPES;
  const seen = new Set<BreakdownType>();
  const list: BreakdownType[] = [];
  sourceInitialTypes.forEach((type) => {
    if (TYPES.includes(type) && !seen.has(type)) {
      seen.add(type);
      list.push(type);
    }
  });
  return list;
}

export function useBreakdownData({
  startDate,
  endDate,
  initialTypes,
  enabled = true,
}: UseBreakdownDataOptions): UseBreakdownDataResult {
  const [breakdownData, setBreakdownData] = useState(() => createInitialState<any>(null));
  const [breakdownLoading, setBreakdownLoading] = useState(() => createInitialState(false));
  const [breakdownErrors, setBreakdownErrors] = useState(() => createInitialState<Error | null>(null));
  const requestIdsRef = useRef(createInitialState(0));
  const { locale } = useLocaleSettings();

  const resetState = useCallback(() => {
    setBreakdownData(createInitialState<any>(null));
    setBreakdownErrors(createInitialState<Error | null>(null));
  }, []);

  useEffect(() => {
    resetState();
  }, [enabled, endDate, startDate, locale, resetState]);

  const fetchBreakdown = useCallback(async (type: BreakdownType) => {
    if (!enabled) {
      return;
    }
    const cacheKey = makeCacheKey(type, startDate, endDate, locale);
    const cached = breakdownCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < BREAKDOWN_CACHE_TTL_MS) {
      setBreakdownData((prev) => ({ ...prev, [type]: cached.data }));
      setBreakdownErrors((prev) => ({ ...prev, [type]: null }));
      return;
    }

    const params = new URLSearchParams({
      type,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
    params.append('includeTransactions', '0');
    if (locale) {
      params.append('locale', locale);
    }

    const requestId = ++requestIdsRef.current[type];
    setBreakdownLoading((prev) => ({ ...prev, [type]: true }));
    setBreakdownErrors((prev) => ({ ...prev, [type]: null }));

    try {
      const response = await apiClient.get(`/api/analytics/breakdown?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${type} breakdown`);
      }

      if (requestId !== requestIdsRef.current[type]) {
        return;
      }

      breakdownCache.set(cacheKey, { data: response.data, timestamp: now });
      setBreakdownData((prev) => ({ ...prev, [type]: response.data }));
    } catch (err) {
      if (requestId !== requestIdsRef.current[type]) {
        return;
      }

      setBreakdownData((prev) => ({ ...prev, [type]: null }));
      setBreakdownErrors((prev) => ({ ...prev, [type]: err as Error }));
    } finally {
      if (requestId === requestIdsRef.current[type]) {
        setBreakdownLoading((prev) => ({ ...prev, [type]: false }));
      }
    }
  }, [enabled, endDate, locale, startDate]);

  const normalizedInitialTypes = useMemo(
    () => normalizeBreakdownTypes(initialTypes),
    [initialTypes],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    normalizedInitialTypes.forEach((type) => {
      void fetchBreakdown(type);
    });
  }, [enabled, fetchBreakdown, normalizedInitialTypes]);

  const refreshBreakdowns = useCallback(
    (types?: BreakdownType[]) => {
      if (!enabled) {
        return;
      }
      const targetTypes = types && types.length
        ? types
        : normalizedInitialTypes.length
          ? normalizedInitialTypes
          : TYPES;

      targetTypes.forEach((type) => {
        void fetchBreakdown(type);
      });
    },
    [enabled, fetchBreakdown, normalizedInitialTypes],
  );

  return {
    breakdownData,
    breakdownLoading,
    breakdownErrors,
    fetchBreakdown,
    refreshBreakdowns,
  };
}
