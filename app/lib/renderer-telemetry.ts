type TelemetryConfig = {
  dsn: string | null;
  environment?: string;
  release?: string;
  debug?: boolean;
};

type RendererSentryModule = typeof import('@sentry/electron/renderer') & {
  close?: () => PromiseLike<boolean> | boolean;
};

let rendererTelemetryInitialized = false;
let pendingInitialization: Promise<RendererSentryModule> | null = null;
let rendererSentry: RendererSentryModule | null = null;

async function loadRendererSentry(): Promise<RendererSentryModule> {
  if (rendererSentry) {
    return rendererSentry;
  }

  if (!pendingInitialization) {
    pendingInitialization = import('@sentry/electron/renderer').then((module) => {
      rendererSentry = module;
      return module;
    });
  }

  try {
    return await pendingInitialization;
  } finally {
    pendingInitialization = null;
  }
}

export async function syncRendererTelemetry(enabled: boolean, config: TelemetryConfig | null) {
  if (!enabled) {
    if (rendererTelemetryInitialized && rendererSentry?.close) {
      try {
        await rendererSentry.close();
      } catch (error) {
        console.warn('[Telemetry] Failed to shut down renderer Sentry client', error);
      }
    }
    rendererTelemetryInitialized = false;
    return;
  }

  if (!config?.dsn || rendererTelemetryInitialized) {
    return;
  }

  try {
    const sentry = await loadRendererSentry();
    if (!sentry?.init) {
      console.warn('[Telemetry] Sentry module loaded but init method not available');
      return;
    }

    sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      debug: Boolean(config.debug),
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0'),
      beforeSend(event) {
        // Additional safety check - only send if still enabled
        return enabled ? event : null;
      },
    });
    rendererTelemetryInitialized = true;
    console.info('[Telemetry] Renderer Sentry initialized successfully');
  } catch (error) {
    console.error('[Telemetry] Renderer initialization failed', error);
    rendererTelemetryInitialized = false;
  }
}
