/**
 * `scripts/gen-sw-manifest.mjs` 的类型声明（G3 Task 8）。
 *
 * 为什么手写：构建脚本是 `.mjs` 且 `scripts/` **不在** `tsconfig.json` 的 `include` 里
 * （那里只有 `src` / `tests` / `vite.config.ts`）—— 它不进 `tsc`。但
 * `tests/ui/pwa-update.test.ts` 会 `import` 它的纯函数来跑"清单由磁盘派生"的行为腿，
 * 于是需要一份**只描述出口形状**的声明（不引依赖、不改 tsconfig）。
 *
 * 形状与 `gen-sw-manifest.mjs` 的导出逐条对应：文件名是 `gen-sw-manifest.d.mts`，
 * TypeScript 把它当作 `gen-sw-manifest.mjs` 的类型（`.d.mts` ↔ `.mjs`）。
 */

export interface SwManifestFile {
  /** 磁盘上的绝对路径 */
  abs: string;
  /** 站内绝对路径（`/assets/index-abc.js`），清单里存的就是它 */
  rel: string;
}

export interface SwManifestReport {
  version: string;
  files: string[];
  bytes: number;
}

export function walk(dir: string, out?: string[]): string[];
export function collectFiles(dist: string): SwManifestFile[];
export function computeVersion(files: SwManifestFile[]): string;
export function run(dist?: string): SwManifestReport;
