import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: './community',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...baseConfig.use,
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Jerusalem',
    locale: 'en-US',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    ...baseConfig.webServer,
    command: `npm run preview -- --host 127.0.0.1 --port ${process.env.PLAYWRIGHT_PORT || '5173'}`,
  },
});
