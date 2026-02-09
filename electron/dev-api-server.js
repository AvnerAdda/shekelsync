require('./setup-module-alias');

const fs = require('fs');
const path = require('path');
const { appRoot, requireFromApp } = require('./paths');

// Keep env loading consistent with Electron dev runtime.
try {
  const dotenv = requireFromApp('dotenv');
  const envFile = path.join(appRoot, '.env.local');
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
  }
} catch (error) {
  console.warn('[dev-api] Unable to load dotenv configuration:', error.message);
}

const { setupAPIServer } = require('./server');

async function start() {
  try {
    const { server, port } = await setupAPIServer(null, {
      port: Number(process.env.ELECTRON_API_PORT) || undefined,
    });

    console.log(`[dev-api] API server ready on http://localhost:${port}`);

    const shutdown = () => {
      console.log('[dev-api] Shutting down API server...');
      server.close(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('[dev-api] Failed to start API server:', error);
    process.exit(1);
  }
}

start();
