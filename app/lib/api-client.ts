import { getAuthorizationHeader } from '@/lib/session-store';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface ApiRequestOptions<TBody = unknown> {
  body?: TBody;
  headers?: Record<string, string>;
  params?: QueryParams;
  /** When true, skips automatic JSON serialisation for the request body. */
  rawBody?: boolean;
  /** Cancels the request when the caller no longer needs the result. */
  signal?: AbortSignal;
  /** Overrides the endpoint-specific timeout. Use 0 to disable the timeout. */
  timeoutMs?: number;
  /** Controls reads and writes to the shared GET response cache. */
  cacheMode?: 'default' | 'reload' | 'no-store';
}

export interface ApiResponse<TData = unknown> {
  status: number;
  statusText: string;
  ok: boolean;
  data: TData;
}

const SUPPORTED_LOCALES = ['he', 'en', 'fr'];
const FORECAST_DAILY_PATH = '/api/forecast/daily';
const FORECAST_CLIENT_CACHE_TTL_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const LONG_REQUEST_TIMEOUT_MS = 180_000;
const forecastResponseCache = new Map<string, { response: ApiResponse<unknown>; expiresAt: number }>();
const forecastInFlightRequests = new Map<string, Promise<ApiResponse<unknown>>>();
const sharedGetInFlightRequests = new Map<string, Promise<ApiResponse<unknown>>>();
type SharedResponseCacheEntry = {
  response: ApiResponse<unknown>;
  expiresAt: number;
  tags: string[];
};
const sharedResponseCache = new Map<string, SharedResponseCacheEntry>();

const SHARED_GET_CACHE_POLICIES: Array<{
  path: RegExp;
  ttlMs: number;
  tags: string[];
}> = [
  { path: /^\/api\/analytics\/personal-intelligence$/, ttlMs: 60_000, tags: ['analytics'] },
  { path: /^\/api\/analytics\/behavioral-patterns$/, ttlMs: 5 * 60_000, tags: ['analytics'] },
  { path: /^\/api\/analytics\/forecast-extended$/, ttlMs: 60_000, tags: ['analytics', 'forecast'] },
  { path: /^\/api\/analytics\/time-value$/, ttlMs: 5 * 60_000, tags: ['analytics'] },
  { path: /^\/api\/notifications\/snapshot-progress$/, ttlMs: 30_000, tags: ['analytics', 'notifications'] },
];

function createRequestControlError(name: 'AbortError' | 'TimeoutError', message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function getRequestTimeoutMs(url: string, requestedTimeout?: number): number {
  if (requestedTimeout !== undefined) {
    return Number.isFinite(requestedTimeout) ? Math.max(0, requestedTimeout) : DEFAULT_REQUEST_TIMEOUT_MS;
  }
  const { path } = splitPathAndQuery(url);
  return /^\/api\/(?:chat|optimizer\/(?:generate|v2\/generate)|scrape|scraping)/.test(path)
    ? LONG_REQUEST_TIMEOUT_MS
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function getSharedGetCachePolicy(url: string) {
  const { path } = splitPathAndQuery(url);
  return SHARED_GET_CACHE_POLICIES.find((policy) => policy.path.test(path)) || null;
}

function hasNoCacheQuery(url: string): boolean {
  const { searchParams } = splitPathAndQuery(url);
  const noCache = (searchParams.get('noCache') || '').toLowerCase();
  return noCache === '1' || noCache === 'true';
}

export function invalidateApiCache(tags?: string[]): void {
  if (!tags || tags.length === 0) {
    sharedResponseCache.clear();
    forecastResponseCache.clear();
    return;
  }

  const requestedTags = new Set(tags);
  for (const [key, entry] of sharedResponseCache.entries()) {
    if (entry.tags.some((tag) => requestedTags.has(tag))) {
      sharedResponseCache.delete(key);
    }
  }
  if (requestedTags.has('analytics') || requestedTags.has('forecast')) {
    forecastResponseCache.clear();
  }
}

function splitPathAndQuery(url: string): { path: string; searchParams: URLSearchParams } {
  const [pathAndQuery = ''] = url.split('#');
  const [path = '', query = ''] = pathAndQuery.split('?');
  return { path, searchParams: new URLSearchParams(query) };
}

function getForecastCacheKey(url: string): string | null {
  const { path, searchParams } = splitPathAndQuery(url);
  if (path !== FORECAST_DAILY_PATH) return null;

  // Keep a shared key for forced/noCache and regular calls.
  searchParams.delete('noCache');
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

function shouldReadForecastClientCache(method: HttpMethod, url: string): boolean {
  if (method !== 'GET') return false;
  const { path, searchParams } = splitPathAndQuery(url);
  if (path !== FORECAST_DAILY_PATH) return false;
  const noCache = (searchParams.get('noCache') || '').toLowerCase();
  return noCache !== '1' && noCache !== 'true';
}

function getSharedGetRequestKey(
  method: HttpMethod,
  url: string,
  headers: Record<string, string>,
): string | null {
  if (method !== 'GET') {
    return null;
  }

  const sortedHeaders = Object.entries(headers)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}:${value}`);

  return JSON.stringify([url, sortedHeaders]);
}

function normalizeLocale(value?: string | null): string | null {
  if (!value || typeof value !== 'string') return null;
  const base = value.toLowerCase().split(',')[0].split('-')[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

function detectClientLocale(): string | null {
  if (typeof window === 'undefined') return null;

  const stored = normalizeLocale(window.localStorage?.getItem('app-locale'));
  if (stored) return stored;

  const docLang = normalizeLocale(document?.documentElement?.lang);
  if (docLang) return docLang;

  const navigatorLang = normalizeLocale(window.navigator?.language);
  if (navigatorLang) return navigatorLang;

  if (Array.isArray(window.navigator?.languages)) {
    for (const lang of window.navigator.languages) {
      const normalized = normalizeLocale(lang);
      if (normalized) return normalized;
    }
  }

  return null;
}

function isElectronApiAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.api?.request);
}

function normalizeHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, value]),
  );
}

function serializeBody(body: unknown, rawBody?: boolean): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (rawBody) {
    return body as string;
  }
  if (typeof body === 'string') {
    return body;
  }
  return JSON.stringify(body);
}

function appendQueryParams(endpoint: string, params?: QueryParams): string {
  if (!params || Object.keys(params).length === 0) return endpoint;

  const [pathAndQuery, hash = ''] = endpoint.split('#');
  const [path, existingQuery = ''] = pathAndQuery.split('?');
  const searchParams = new URLSearchParams(existingQuery);

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  const hashSuffix = hash ? `#${hash}` : '';
  return query ? `${path}?${query}${hashSuffix}` : `${path}${hashSuffix}`;
}

function deserializeData<T>(payload: unknown): T {
  return payload as T;
}

function isStructuredOptions(
  options: ApiRequestOptions<never> | Record<string, string>,
): options is ApiRequestOptions<never> {
  return 'headers' in options
    || 'params' in options
    || 'rawBody' in options
    || 'body' in options
    || 'signal' in options
    || 'timeoutMs' in options
    || 'cacheMode' in options;
}

async function request<TResponse = unknown, TBody = unknown>(
  method: HttpMethod,
  endpoint: string,
  options: ApiRequestOptions<TBody> = {},
): Promise<ApiResponse<TResponse>> {
  const {
    body,
    headers = {},
    rawBody,
    params,
    signal,
    timeoutMs: requestedTimeoutMs,
    cacheMode = 'default',
  } = options;
  const url = appendQueryParams(endpoint, params);
  if (signal?.aborted) {
    throw createRequestControlError('AbortError', `Request cancelled: ${method} ${url}`);
  }
  const normalizedHeaders = normalizeHeaders(headers);
  const locale = detectClientLocale();
  if (locale && !normalizedHeaders['accept-language'] && !normalizedHeaders['Accept-Language']) {
    normalizedHeaders['Accept-Language'] = locale;
  }
  const useElectronApi = isElectronApiAvailable();
  const finalHeaders: Record<string, string> = { ...normalizedHeaders };

  if (!useElectronApi) {
    const authHeaders = await getAuthorizationHeader();
    if (authHeaders.Authorization && !finalHeaders.Authorization) {
      finalHeaders.Authorization = authHeaders.Authorization;
    }
  }

  const executeRequest = async (): Promise<ApiResponse<TResponse>> => {
    const controller = !useElectronApi && typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
    const resolvedTimeoutMs = getRequestTimeoutMs(url, requestedTimeoutMs);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let removeAbortListener = () => {};

    const controlPromise = new Promise<never>((_resolve, reject) => {
      const abortRequest = () => {
        reject(createRequestControlError('AbortError', `Request cancelled: ${method} ${url}`));
        controller?.abort();
      };

      if (signal) {
        if (signal.aborted) {
          abortRequest();
        } else {
          signal.addEventListener('abort', abortRequest, { once: true });
          removeAbortListener = () => signal.removeEventListener('abort', abortRequest);
        }
      }

      if (resolvedTimeoutMs > 0) {
        timeoutId = setTimeout(() => {
          reject(createRequestControlError(
            'TimeoutError',
            `Request timed out after ${resolvedTimeoutMs}ms: ${method} ${url}`,
          ));
          controller?.abort();
        }, resolvedTimeoutMs);
      }
    });

    const transportPromise = (async (): Promise<ApiResponse<TResponse>> => {
      if (useElectronApi) {
        const electronApi = window.electronAPI;
        if (!electronApi?.api?.request) {
          throw new Error('Electron API bridge unavailable');
        }
        const requestFn = electronApi.api.request;
        const payload =
          method === 'GET' || method === 'DELETE'
            ? undefined
            : rawBody
              ? body
              : body && typeof body === 'string'
                ? body
                : body ?? undefined;

        const response = await requestFn(method, url, payload, finalHeaders);

        return {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          data: deserializeData<TResponse>(response.data),
        };
      }

      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...finalHeaders,
        },
        ...(controller ? { signal: controller.signal } : {}),
      };

      const serializedBody = serializeBody(body, rawBody);
      if (serializedBody !== undefined && method !== 'GET' && method !== 'DELETE') {
        fetchOptions.body = serializedBody;
      }

      const response = await fetch(url, fetchOptions);
      const text = await response.text();
      let parsed: unknown = text;

      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // leave as raw text
      }

      return {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        data: deserializeData<TResponse>(parsed),
      };
    })();

    try {
      return await Promise.race([transportPromise, controlPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      removeAbortListener();
    }
  };

  const forecastCacheKey = getForecastCacheKey(url);
  const canShareGetRequest = !signal
    && requestedTimeoutMs === undefined
    && cacheMode !== 'no-store';
  const canStoreForecastResponse = method === 'GET'
    && forecastCacheKey !== null
    && cacheMode !== 'no-store';
  const shouldReadCache = forecastCacheKey !== null
    && cacheMode === 'default'
    && shouldReadForecastClientCache(method, url);

  if (shouldReadCache && forecastCacheKey) {
    const now = Date.now();
    const cached = forecastResponseCache.get(forecastCacheKey);
    if (cached && now < cached.expiresAt) {
      return cached.response as ApiResponse<TResponse>;
    }

    if (canShareGetRequest) {
      const inFlight = forecastInFlightRequests.get(forecastCacheKey);
      if (inFlight) {
        return inFlight as Promise<ApiResponse<TResponse>>;
      }

      const requestPromise = executeRequest()
        .then((response) => {
          if (response.ok) {
            forecastResponseCache.set(forecastCacheKey, {
              response: response as ApiResponse<unknown>,
              expiresAt: Date.now() + FORECAST_CLIENT_CACHE_TTL_MS,
            });
          } else {
            forecastResponseCache.delete(forecastCacheKey);
          }
          return response;
        })
        .finally(() => {
          forecastInFlightRequests.delete(forecastCacheKey);
        });

      forecastInFlightRequests.set(
        forecastCacheKey,
        requestPromise as Promise<ApiResponse<unknown>>,
      );

      return requestPromise;
    }
  }

  const requestCacheKey = getSharedGetRequestKey(method, url, finalHeaders);
  const sharedGetRequestKey = canShareGetRequest ? requestCacheKey : null;
  const sharedCachePolicy = getSharedGetCachePolicy(url);
  const canStoreSharedResponse = Boolean(
    requestCacheKey
    && sharedCachePolicy
    && cacheMode !== 'no-store',
  );
  const canReadSharedResponse = canStoreSharedResponse
    && cacheMode === 'default'
    && !hasNoCacheQuery(url);

  if (canReadSharedResponse && requestCacheKey) {
    const cached = sharedResponseCache.get(requestCacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.response as ApiResponse<TResponse>;
    }
    if (cached) sharedResponseCache.delete(requestCacheKey);
  }

  if (requestCacheKey) {
    const inFlight = sharedGetRequestKey
      ? sharedGetInFlightRequests.get(sharedGetRequestKey)
      : null;
    if (inFlight) {
      return inFlight as Promise<ApiResponse<TResponse>>;
    }

    const requestPromise = executeRequest()
      .then((response) => {
        if (canStoreForecastResponse && forecastCacheKey) {
          if (response.ok) {
            forecastResponseCache.set(forecastCacheKey, {
              response: response as ApiResponse<unknown>,
              expiresAt: Date.now() + FORECAST_CLIENT_CACHE_TTL_MS,
            });
          } else {
            forecastResponseCache.delete(forecastCacheKey);
          }
        }
        if (response.ok && canStoreSharedResponse && sharedCachePolicy) {
          sharedResponseCache.set(requestCacheKey, {
            response: response as ApiResponse<unknown>,
            expiresAt: Date.now() + sharedCachePolicy.ttlMs,
            tags: sharedCachePolicy.tags,
          });
        }

        return response;
      })
      .finally(() => {
        if (sharedGetRequestKey) sharedGetInFlightRequests.delete(sharedGetRequestKey);
      });

    if (sharedGetRequestKey) {
      sharedGetInFlightRequests.set(
        sharedGetRequestKey,
        requestPromise as Promise<ApiResponse<unknown>>,
      );
    }

    return requestPromise;
  }

  const response = await executeRequest();

  if (method !== 'GET' && response.ok) {
    invalidateApiCache();
  }

  // Even forced/noCache requests can refresh the shared client cache for follow-up reads.
  if (canStoreForecastResponse && forecastCacheKey) {
    if (response.ok) {
      forecastResponseCache.set(forecastCacheKey, {
        response: response as ApiResponse<unknown>,
        expiresAt: Date.now() + FORECAST_CLIENT_CACHE_TTL_MS,
      });
    } else {
      forecastResponseCache.delete(forecastCacheKey);
    }
  }

  return response;
}

export const apiClient = {
  request,
  get<TResponse = unknown>(
    endpoint: string,
    options?: ApiRequestOptions<never> | Record<string, string>,
  ) {
    if (!options) {
      return request<TResponse>('GET', endpoint);
    }

    if (isStructuredOptions(options)) {
      return request<TResponse>('GET', endpoint, options);
    }

    return request<TResponse>('GET', endpoint, { headers: options as Record<string, string> });
  },
  delete<TResponse = unknown>(
    endpoint: string,
    options?: ApiRequestOptions<never> | Record<string, string>,
  ) {
    if (!options) {
      return request<TResponse>('DELETE', endpoint);
    }

    if (isStructuredOptions(options)) {
      return request<TResponse>('DELETE', endpoint, options);
    }

    return request<TResponse>('DELETE', endpoint, { headers: options as Record<string, string> });
  },
  post<TResponse = unknown, TBody = unknown>(
    endpoint: string,
    body?: TBody,
    options?: ApiRequestOptions<TBody>,
  ) {
    return request<TResponse, TBody>('POST', endpoint, { ...options, body });
  },
  put<TResponse = unknown, TBody = unknown>(
    endpoint: string,
    body?: TBody,
    options?: ApiRequestOptions<TBody>,
  ) {
    return request<TResponse, TBody>('PUT', endpoint, { ...options, body });
  },
  patch<TResponse = unknown, TBody = unknown>(
    endpoint: string,
    body?: TBody,
    options?: ApiRequestOptions<TBody>,
  ) {
    return request<TResponse, TBody>('PATCH', endpoint, { ...options, body });
  },
};

export default apiClient;
