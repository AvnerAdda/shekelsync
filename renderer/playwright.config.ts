import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseUrl = 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: baseUrl,
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    cwd: __dirname,
    url: baseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
});
