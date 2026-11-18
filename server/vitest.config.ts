import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Every test file boots the server on the same port.
    fileParallelism: false,
    // node:sqlite needs the flag on Node 22.12 (built in from 22.13 on, where the flag is a no-op).
    execArgv: ['--experimental-sqlite', '--disable-warning=ExperimentalWarning'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
