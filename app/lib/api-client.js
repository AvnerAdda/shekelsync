/* eslint-env browser */
const SUPPORTED_LOCALES = ['he', 'en', 'fr'];
const FORECAST_DAILY_PATH = '/api/forecast/daily';
const FORECAST_CLIENT_CACHE_TTL_MS = 15000;
const forecastResponseCache = new Map();
const forecastInFlightRequests = new Map();

function splitPathAndQuery(url) {
    const [pathAndQuery = ''] = url.split('#');
    const [path = '', query = ''] = pathAndQuery.split('?');
    return { path, searchParams: new URLSearchParams(query) };
}
function getForecastCacheKey(url) {
    const { path, searchParams } = splitPathAndQuery(url);
    if (path !== FORECAST_DAILY_PATH)
        return null;
    searchParams.delete('noCache');
    const query = searchParams.toString();
    return query ? `${path}?${query}` : path;
}
function shouldReadForecastClientCache(method, url) {
    if (method !== 'GET')
        return false;
    const { path, searchParams } = splitPathAndQuery(url);
    if (path !== FORECAST_DAILY_PATH)
        return false;
    const noCache = (searchParams.get('noCache') || '').toLowerCase();
    return noCache !== '1' && noCache !== 'true';
}

function normalizeLocale(value) {
  if (!value || typeof value !== 'string') return null;
  const base = value.toLowerCase().split(',')[0].split('-')[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

function detectClientLocale() {
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

function isElectronApiAvailable() {
    return typeof window !== 'undefined' && Boolean(window.electronAPI?.api?.request);
}
function normalizeHeaders(headers = {}) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, value]));
}
function serializeBody(body, rawBody) {
    if (body === undefined || body === null) {
        return undefined;
    }
    if (rawBody) {
        return body;
    }
    if (typeof body === 'string') {
        return body;
    }
    return JSON.stringify(body);
}
function deserializeData(payload) {
    return payload;
}
async function request(method, endpoint, options = {}) {
    const { body, headers = {}, rawBody } = options;
    const url = endpoint;
    const normalizedHeaders = normalizeHeaders(headers);
    const locale = detectClientLocale();
    if (locale && !normalizedHeaders['accept-language'] && !normalizedHeaders['Accept-Language']) {
        normalizedHeaders['Accept-Language'] = locale;
    }
    const executeRequest = async () => {
        if (isElectronApiAvailable()) {
            const electronApi = window.electronAPI;
            if (!electronApi?.api?.request) {
                throw new Error('Electron API bridge unavailable');
            }
            const requestFn = electronApi.api.request;
            const payload = method === 'GET' || method === 'DELETE'
                ? undefined
                : rawBody
                    ? body
                    : body && typeof body === 'string'
                        ? body
                        : body ?? undefined;
            const response = await requestFn(method, url, payload, normalizedHeaders);
            return {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok,
                data: deserializeData(response.data),
            };
        }
        const fetchOptions = {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...normalizedHeaders,
            },
        };
        const serializedBody = serializeBody(body, rawBody);
        if (serializedBody !== undefined && method !== 'GET' && method !== 'DELETE') {
            fetchOptions.body = serializedBody;
        }
        const response = await fetch(url, fetchOptions);
        const text = await response.text();
        let parsed = text;
        try {
            parsed = text ? JSON.parse(text) : null;
        }
        catch {
            // leave as raw text
        }
        return {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            data: deserializeData(parsed),
        };
    };
    const forecastCacheKey = getForecastCacheKey(url);
    const shouldReadCache = forecastCacheKey !== null && shouldReadForecastClientCache(method, url);
    if (shouldReadCache && forecastCacheKey) {
        const now = Date.now();
        const cached = forecastResponseCache.get(forecastCacheKey);
        if (cached && now < cached.expiresAt) {
            return cached.response;
        }
        const inFlight = forecastInFlightRequests.get(forecastCacheKey);
        if (inFlight) {
            return inFlight;
        }
        const requestPromise = executeRequest()
            .then((response) => {
            if (response.ok) {
                forecastResponseCache.set(forecastCacheKey, {
                    response,
                    expiresAt: Date.now() + FORECAST_CLIENT_CACHE_TTL_MS,
                });
            }
            else {
                forecastResponseCache.delete(forecastCacheKey);
            }
            return response;
        })
            .finally(() => {
            forecastInFlightRequests.delete(forecastCacheKey);
        });
        forecastInFlightRequests.set(forecastCacheKey, requestPromise);
        return requestPromise;
    }
    const response = await executeRequest();
    if (forecastCacheKey) {
        if (response.ok) {
            forecastResponseCache.set(forecastCacheKey, {
                response,
                expiresAt: Date.now() + FORECAST_CLIENT_CACHE_TTL_MS,
            });
        }
        else {
            forecastResponseCache.delete(forecastCacheKey);
        }
    }
    return response;
}
export const apiClient = {
    request,
    get(endpoint, headers) {
        return request('GET', endpoint, { headers });
    },
    delete(endpoint, headers) {
        return request('DELETE', endpoint, { headers });
    },
    post(endpoint, body, options) {
        return request('POST', endpoint, { ...options, body });
    },
    put(endpoint, body, options) {
        return request('PUT', endpoint, { ...options, body });
    },
    patch(endpoint, body, options) {
        return request('PATCH', endpoint, { ...options, body });
    },
};
export default apiClient;
