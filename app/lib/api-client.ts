import { getAuthorizationHeader, getSession } from '@/lib/session-store';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type QueryParams = Record<string, string | number | boolean | null | undefined>;

interface ApiRequestOptions<TBody = unknown> {
  body?: TBody;
  headers?: Record<string, string>;
  params?: QueryParams;
  /** When true, skips automatic JSON serialisation for the request body. */
  rawBody?: boolean;
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
const forecastResponseCache = new Map<string, { response: ApiResponse<unknown>; expiresAt: number }>();
const forecastInFlightRequests = new Map<string, Promise<ApiResponse<unknown>>>();

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
  return 'headers' in options || 'params' in options || 'rawBody' in options || 'body' in options;
}

async function request<TResponse = unknown, TBody = unknown>(
  method: HttpMethod,
  endpoint: string,
  options: ApiRequestOptions<TBody> = {},
): Promise<ApiResponse<TResponse>> {
  const { body, headers = {}, rawBody, params } = options;
  const url = appendQueryParams(endpoint, params);
  const normalizedHeaders = normalizeHeaders(headers);
  const locale = detectClientLocale();
  if (locale && !normalizedHeaders['accept-language'] && !normalizedHeaders['Accept-Language']) {
    normalizedHeaders['Accept-Language'] = locale;
  }
  const authHeaders = await getAuthorizationHeader();
  const session = await getSession();
  const finalHeaders: Record<string, string> = { ...normalizedHeaders };

  if (authHeaders.Authorization && !finalHeaders.Authorization) {
    finalHeaders.Authorization = authHeaders.Authorization;
  }
  if (session?.accessToken && !finalHeaders['X-Auth-Access-Token']) {
    finalHeaders['X-Auth-Access-Token'] = session.accessToken;
  }
  if (session?.user?.id && !finalHeaders['X-Auth-User-Id']) {
    finalHeaders['X-Auth-User-Id'] = session.user.id;
  }
  if (session?.user?.email && !finalHeaders['X-Auth-User-Email']) {
    finalHeaders['X-Auth-User-Email'] = session.user.email;
  }
  if (session?.user?.name && !finalHeaders['X-Auth-User-Name']) {
    finalHeaders['X-Auth-User-Name'] = session.user.name;
  }

  const executeRequest = async (): Promise<ApiResponse<TResponse>> => {
    if (isElectronApiAvailable()) {
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
  };

  const forecastCacheKey = getForecastCacheKey(url);
  const shouldReadCache = forecastCacheKey !== null && shouldReadForecastClientCache(method, url);

  if (shouldReadCache && forecastCacheKey) {
    const now = Date.now();
    const cached = forecastResponseCache.get(forecastCacheKey);
    if (cached && now < cached.expiresAt) {
      return cached.response as ApiResponse<TResponse>;
    }

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

  const response = await executeRequest();

  // Even forced/noCache requests can refresh the shared client cache for follow-up reads.
  if (forecastCacheKey) {
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
