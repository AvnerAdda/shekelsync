type TelemetryConfig = {
  dsn: string | null;
  environment?: string;
  release?: string;
  debug?: boolean;
};

/**
 * Crash reporting has been removed from the renderer.
 * Keep a stable async API so existing settings/contexts can call into it safely.
 */
export async function syncRendererTelemetry(
  _enabled: boolean,
  _config: TelemetryConfig | null,
) {
  return;
}
