function parseTelemetryDsnMeta(dsn) {
  if (!dsn) {
    return { host: null, projectId: null };
  }
  try {
    const url = new URL(dsn);
    return {
      host: url.host || null,
      projectId: url.pathname.replace('/', '') || null,
    };
  } catch {
    return { host: null, projectId: null };
  }
}

function describeTelemetryState({ enabled = false, initialized = false } = {}) {
  const meta = parseTelemetryDsnMeta(process.env.SENTRY_DSN || null);
  return {
    enabled,
    initialized,
    dsnConfigured: Boolean(process.env.SENTRY_DSN),
    dsnHost: meta.host,
    dsnProjectId: meta.projectId,
    debug: process.env.SENTRY_DEBUG === 'true',
  };
}

module.exports = {
  parseTelemetryDsnMeta,
  describeTelemetryState,
};
