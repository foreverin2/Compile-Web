import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Sandbox note: the default 'forks' pool spawns child processes, which is
    // blocked on this host (EPERM); 'threads' runs in worker_threads instead.
    pool: 'threads',
  },
});
