import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * ★ G6/T50：把签发服务自己的用例也放进**默认门禁**。
     *
     * 为什么不放进 `tests/`：那套用例住在它自己的交付目录里（`server/turn-cred/tests/`），
     * 与实现同进同出；而本仓门禁的扫描面是白名单，不加这一行它**一条都不会跑到**
     * （实测：`vitest` 报 `No test files found`）。服务本身仍然零依赖（只用 Node 内置模块）。
     */
    include: ['tests/**/*.test.ts', 'server/**/tests/**/*.test.ts'],
    environment: 'node',
    // Sandbox note: the default 'forks' pool spawns child processes, which is
    // blocked on this host (EPERM); 'threads' runs in worker_threads instead.
    pool: 'threads',
  },
});
