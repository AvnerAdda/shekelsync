const SERVICE_UNAVAILABLE_STATUS = 503;
const DEFAULT_EMBEDDED_API_TIMEOUT_MS = 10_000;
const DEFAULT_EXTERNAL_DEV_BASE_URL = 'http://localhost:3000';

function buildUnavailableResponse(message) {
  return {
    status: SERVICE_UNAVAILABLE_STATUS,
    statusText: 'Service Unavailable',
    ok: false,
    data: {
      error: 'Embedded API unavailable',
      message,
    },
  };
}

function withTimeout(promise, timeoutMs) {
  if (!promise || typeof promise.then !== 'function') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Embedded API did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function resolveApiTarget({
  getState,
  waitForEmbeddedApi,
  embeddedApiTimeoutMs = DEFAULT_EMBEDDED_API_TIMEOUT_MS,
  externalDevBaseUrl = DEFAULT_EXTERNAL_DEV_BASE_URL,
}) {
  const currentState = typeof getState === 'function' ? getState() || {} : {};

  if (currentState.skipEmbeddedApi) {
    return {
      baseUrl: externalDevBaseUrl,
      apiToken: null,
    };
  }

  if (currentState.apiPort) {
    return {
      baseUrl: `http://localhost:${currentState.apiPort}`,
      apiToken: currentState.apiToken || null,
    };
  }

  try {
    await withTimeout(Promise.resolve(waitForEmbeddedApi?.()), embeddedApiTimeoutMs);
  } catch (error) {
    return {
      error: buildUnavailableResponse(error.message || 'Embedded API server is still starting'),
    };
  }

  const nextState = typeof getState === 'function' ? getState() || {} : {};
  if (!nextState.apiPort) {
    return {
      error: buildUnavailableResponse('Embedded API server is not available yet'),
    };
  }

  return {
    baseUrl: `http://localhost:${nextState.apiPort}`,
    apiToken: nextState.apiToken || null,
  };
}

async function proxyApiRequest({
  method,
  endpoint,
  data,
  headers = {},
  fetchImpl = globalThis.fetch,
  getState,
  waitForEmbeddedApi,
  embeddedApiTimeoutMs,
  externalDevBaseUrl,
}) {
  const target = await resolveApiTarget({
    getState,
    waitForEmbeddedApi,
    embeddedApiTimeoutMs,
    externalDevBaseUrl,
  });

  if (target.error) {
    return target.error;
  }

  const url = `${target.baseUrl}${endpoint}`;
  const requestHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (target.apiToken) {
    requestHeaders.Authorization = `Bearer ${target.apiToken}`;
  }

  const fetchOptions = {
    method,
    headers: requestHeaders,
  };

  if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    fetchOptions.body = JSON.stringify(data);
  }

  try {
    const response = await fetchImpl(url, fetchOptions);
    const responseData = await response.text();

    let parsedData;
    try {
      parsedData = JSON.parse(responseData);
    } catch {
      parsedData = responseData;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      data: parsedData,
      ok: response.ok,
    };
  } catch (error) {
    return {
      status: 500,
      statusText: 'Internal Server Error',
      data: { error: error.message },
      ok: false,
    };
  }
}

module.exports = {
  DEFAULT_EMBEDDED_API_TIMEOUT_MS,
  DEFAULT_EXTERNAL_DEV_BASE_URL,
  SERVICE_UNAVAILABLE_STATUS,
  buildUnavailableResponse,
  proxyApiRequest,
  resolveApiTarget,
  withTimeout,
};
