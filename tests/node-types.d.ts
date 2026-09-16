// 极简 node 环境声明：仅覆盖 tests 用到的 node 内置能力（项目未装 @types/node，
// 禁止 npm install；vitest 运行于 node，运行时真实可用，此处只为通过 tsc --noEmit）。
//
// ⚠️ `default` 导出是**必须**的：`scripts/*.mjs` 这类真实 ESM 模块被测试直接 import 时，
// vitest/vite 的外部化路径会以 `import fs from 'node:fs'` 形态加载它（G3 Task 8 实测：
// 只声明具名导出时，`readFileSync` 在生成脚本里是 undefined）。
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): {
    subarray(start: number, end?: number): { toString(encoding?: string): string };
  };
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
  // G3 Task 8（生成脚本 / 其行为腿需要）：写入与临时目录
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  const _default: {
    existsSync: typeof existsSync;
    readFileSync: typeof readFileSync;
    readdirSync: typeof readdirSync;
    statSync: typeof statSync;
    writeFileSync: typeof writeFileSync;
    mkdirSync: typeof mkdirSync;
    mkdtempSync: typeof mkdtempSync;
    rmSync: typeof rmSync;
  };
  export default _default;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  // G3 Task 8：生成脚本要相对化 + 规范化路径
  export function resolve(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(p: string): string;
  export const sep: string;
  const _default: {
    join: typeof join;
    resolve: typeof resolve;
    relative: typeof relative;
    dirname: typeof dirname;
    sep: string;
  };
  export default _default;
}
declare module 'node:os' {
  export function tmpdir(): string;
  const _default: { tmpdir: typeof tmpdir };
  export default _default;
}
declare module 'node:crypto' {
  export interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding?: string): string;
  }
  export function createHash(algorithm: string): Hash;
  const _default: { createHash: typeof createHash };
  export default _default;
}
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args?: string[],
    options?: { cwd?: string; encoding?: string },
  ): string;
}
