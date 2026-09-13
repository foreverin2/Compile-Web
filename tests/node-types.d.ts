// 极简 node 环境声明：仅覆盖 tests 用到的 node 内置能力（项目未装 @types/node，
// 禁止 npm install；vitest 运行于 node，运行时真实可用，此处只为通过 tsc --noEmit）。
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): {
    subarray(start: number, end?: number): { toString(encoding?: string): string };
  };
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args?: string[],
    options?: { cwd?: string; encoding?: string },
  ): string;
}
