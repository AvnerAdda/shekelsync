// @vitest-environment node
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { installStdioErrorHandlers } = require('../stdio-errors');
const runnerPath = fileURLToPath(new URL('./stdio-errors.runner.cjs', import.meta.url));

describe('Electron terminal output errors', () => {
  it('handles a closed pipe on either output stream', () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    installStdioErrorHandlers([stdout, stderr]);
    for (const stream of [stdout, stderr]) {
      expect(() => stream.emit('error', Object.assign(new Error('write EPIPE'), {
        code: 'EPIPE',
      }))).not.toThrow();
    }
  });

  it('keeps unexpected output errors visible', () => {
    const stream = new EventEmitter();
    installStdioErrorHandlers([stream]);
    const error = Object.assign(new Error('I/O failure'), { code: 'EIO' });
    expect(() => stream.emit('error', error)).toThrow(error);
  });

  it.each(['stdout', 'stderr'])('survives logging after the parent closes %s', async (name) => {
    const child = fork(runnerPath, [name], { silent: true });
    const messages = [];
    let errors = '';
    child.stderr.on('data', (data) => { errors += data; });
    try {
      const result = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('message', (message) => {
          messages.push(message);
          if (message === 'ready') {
            child[name].destroy();
            child.send('write');
          }
        });
        child.on('exit', (code, signal) => resolve({ code, signal }));
      });
      expect(result, errors).toEqual({ code: 0, signal: null });
      expect(messages).toContain('EPIPE');
      expect(messages).toContain('still-running');
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });
});
