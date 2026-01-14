import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const executablePath = chromium.executablePath();

if (!fs.existsSync(executablePath)) {
  console.warn(
    `[playwright] Browsers not installed (missing ${executablePath}); skipping e2e tests. ` +
      'Run `npx playwright install` to enable.',
  );
  process.exit(0);
}

const child = spawn('playwright', ['test', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
