function describeTelemetryState() {
  return {
    enabled: false,
    initialized: false,
    dsnConfigured: false,
    dsnHost: null,
    dsnProjectId: null,
    debug: false,
  };
}

module.exports = {
  parseTelemetryDsnMeta: () => ({ host: null, projectId: null }),
  describeTelemetryState,
};
