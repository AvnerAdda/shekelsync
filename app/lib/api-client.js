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
    const normalizedHeaders = normalizeHeaders(headers);
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
        const response = await requestFn(method, endpoint, payload, normalizedHeaders);
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
    const response = await fetch(endpoint, fetchOptions);
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
