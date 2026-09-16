// 极简 node 环境声明：仅覆盖 tests 用到的 node 内置能力。
// 本仓**未装 `@types/node`**（零依赖硬约束，禁止 npm install），而 vitest 跑在 node 上、
// 这些内置在**运行时真实可用** —— 这份声明只为让 `tsc --noEmit` 通过，不描述运行时行为。
//
// ⚠️ **不提供 `default` 导出**（G3 Task 8 修复轮收回）：`.d.ts` 只是类型声明，**不可能**影响
// `scripts/*.mjs` 的运行时；且 `scripts/` 不在 `tsconfig.json` 的 `include` 里（只有
// `src`/`tests`/`vite.config.ts`），`.mjs` 根本不进 `tsc`。此前这里加的 `default` 导出
// （以及"必须要有 default，否则 readFileSync 在生成脚本里是 undefined"那条注释）原理上不成立，
// 实测也复现不出（把生成脚本改成具名导入 + 删掉四处 default ⇒ tsc 0 错 / 全量测试全绿 /
// `npm run build` OK）。本仓的记录里明确写着"不许为某处扩 node 类型声明"
// （见 `tests/app/match-file.test.ts:669-670` 附近的禁令），所以此处只保留**具名**声明。
//
// 唯一消费方（`Get-ChildItem tests -Recurse -Include *.ts` 的 import 扫描；G3 Task 8 修复轮 2 补正 N-4）：
//   `tests/ui/pwa-update.test.ts` 的临时目录夹具（`mkdtempSync`/`mkdirSync`/`writeFileSync`/
//   `rmSync`/`tmpdir`）与全文读取（`readFileSync`/`statSync`/`existsSync`）；
//   ⚠️ `existsSync` **不是**单一消费方（上一版注释漏列了）：`tests/data/cards2.test.ts:2` 也用它
//   （实测：删掉这条声明 ⇒ `tsc` 报 2 条错 —— `tests/data/cards2.test.ts(2,24)` **与**
//   `tests/ui/pwa-update.test.ts(2,24)`）。其余测试文件用 `readFileSync`/`readdirSync`/`statSync`/
//   `join`/`fileURLToPath`。
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): {
    subarray(start: number, end?: number): { toString(encoding?: string): string };
  };
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean; size: number };
  // G3 Task 8（其临时目录夹具需要）：写入与临时目录
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare module 'node:os' {
  /** 唯一消费方：`tests/ui/pwa-update.test.ts` 的临时目录夹具 */
  export function tmpdir(): string;
}
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args?: string[],
    options?: { cwd?: string; encoding?: string },
  ): string;
}
