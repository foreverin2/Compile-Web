#!/usr/bin/env node
/**
 * 构建后生成 `dist/sw-manifest.json`（G3 Task 8；设计稿 §8.1）。
 *
 * ## 为什么必须有它
 * `public/sw.js` 要预缓存"到底哪些文件"，而文件名带内容哈希（形如 `assets/app-<哈希>.js`）
 * ⇒ **清单不能手写**（每次构建都会漂）。所以：构建之后扫一遍 `dist/`，把结果写进清单，
 * sw.js 在 `install` 时读它。
 *
 * ## 版本键为什么是**内容哈希**
 * `version` = 全部被缓存文件「路径:sha256」排序拼接后的 sha256（取前 16 位）。
 * 任何一个文件变了版本就变 ⇒ `sw.js` 的 `cacheName` 随之更新 ⇒ 用户不会拿到旧代码，
 * 而"内容没变"的重新构建会得到**同一个**版本（不会无谓地让所有人重下）。
 *
 * ## 跳过谁
 * `sw.js` 自己与 `sw-manifest.json` 自己**不进**清单：清单给自己算哈希是自指（版本永远在变），
 * 而 sw.js 由浏览器按"字节不同即更新"的规则自己管（它就是更新探测器本身）。
 * 大体积的卡图 / 规则 PDF / 音效也**不进预缓存**（见下面 `SHELL_EXT` 那段：预缓存 = app shell）。
 *
 * ## 本文件的性质
 * 构建脚本，跑在 node 里、**不进浏览器产物** —— 所以可以用 `node:` 内置。
 * 它**不新增任何 npm 包**（零依赖是硬约束，本仓连 `@types/node` 都没有）。
 * 纯函数（`collectFiles` / `computeVersion` / `run`）被 `tests/ui/pwa-update.test.ts` 直接
 * import 来跑行为腿 —— 那些腿证明"清单来自磁盘内容"，而不是"脚本里有一份手写名单"。
 *
 * 用法：`node scripts/gen-sw-manifest.mjs [dist目录，缺省 dist]`
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
/*
 * ⚠️ 上面全部是**具名导入**，这是有意的（G3 Task 8 修复轮）：本脚本是真实 ESM、`.mjs`，在
 * vitest 的外部化路径下，只有具名导入是**不需要任何类型声明**就能工作的形态。此前的实现一度
 * 想改默认导入，并在 `tests/node-types.d.ts` 里为此加了 `default` 导出 —— 那条路**原理上不成立**
 * （`.d.ts` 只描述 `tests/` 侧看到的出口形状；`scripts/` 不在 `tsconfig.include` 里，`.mjs`
 * 根本不进 `tsc`），实测也复现不出。别改回默认导入，也别再往 `node-types.d.ts` 加 `default`。
 */

const DIST_DEFAULT = 'dist';
/** 不进清单的两个自己人（见文件头注） */
const SKIP = new Set(['sw-manifest.json', 'sw.js']);
/** 允许的后缀（app shell + 图标 + 字体；目录例外见下） */
const EXT_OK = /\.(html|js|mjs|css|json|png|jpg|jpeg|webp|gif|svg|ico|woff2|woff|ttf|otf|pdf|mp3|webmanifest)$/i;

/**
 * ## 预缓存 = **app shell**，不是整个 `dist/`（评审重要 2 / 设计稿 §8.1 原话）
 *
 * 设计稿 `docs/2026-09-13-联机与多端-设计稿.md:654` 写的是"预缓存 app shell（HTML/JS/CSS）"。
 * 之前这里只按后缀放行（含 `png|jpg|pdf|mp3`）⇒ 清单 437 文件 / **358.8 MiB**（含 327 MiB
 * 卡图），而 `sw.js` 的 `cache.addAll` 是**原子**的：弱网/配额/某个资产 404 会让整次 install
 * 失败，用户毫无提示。
 *
 * 现在的判据**只有两条**（从内容派生，没有手写文件名清单）：
 *  1. 后缀在 `SHELL_EXT` 里 ⇒ 进（html/js/mjs/css/json/webmanifest）。**这与目录无关**：
 *     vite 产出的 `assets/index-<哈希>.js|.css` 正是 app shell 本体，必须在里面。
 *  2. 路径首段是 `ICON_DIR`（`icons/`）⇒ 进（PWA 安装图标必须离线可用：3 个文件、约 0.18 MiB）。
 *
 * ⇒ 其余二进制（`assets/protocols/**` 卡图、`assets/rules/*.pdf`、`assets/battery/**` 未使用的
 * 电池图 …）**一律不预缓存**。它们仍能被 `sw.js` 的运行时 `fetch` 正常加载（缓存优先、未命中
 * 走网络），只是不占 install 的失败面。
 *
 * ⚠️ `tests/ui/pwa-update.test.ts` 有与这条注释对齐的腿：清单里不许出现图片/PDF。
 */
const SHELL_EXT = /\.(html|js|mjs|css|json|webmanifest)$/i;
/** 图标目录（站内路径的首段名）。它下面的 PNG 是安装图标，必须预缓存。 */
const ICON_DIR = 'icons';

/**
 * 递归列出目录下的文件（绝对路径）。目录不存在时抛错由调用方决定怎么报。
 */
export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

/**
 * 单个文件是否进预缓存清单。**纯函数**（只吃 rel 字符串），所以测试可以直接喂路径穷举，
 * 不需要造真实目录。
 */
export function isShellAsset(rel) {
  const segs = rel.split('/').filter(Boolean);
  if (segs.length > 1 && segs[0] === ICON_DIR) return true;
  return SHELL_EXT.test(rel);
}

/**
 * 收集应该进清单的文件，**按磁盘内容派生**：返回 `{ abs, rel }[]`，rel 是站内绝对路径
 * （形如 `/assets/app-<哈希>.js`），按 rel 升序（多平台稳定，不依赖 readdir 的顺序）。
 */
export function collectFiles(dist) {
  return walk(dist)
    .map((abs) => ({ abs, rel: '/' + relative(dist, abs).split(sep).join('/') }))
    .filter((f) => !SKIP.has(f.rel.slice(1)) && EXT_OK.test(f.rel) && isShellAsset(f.rel))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
}


/** 内容哈希版本键（16 位十六进制）。files 须是 collectFiles 的形状。 */
export function computeVersion(files) {
  const h = createHash('sha256');
  for (const f of files) {
    const inner = createHash('sha256').update(readFileSync(f.abs)).digest('hex');
    h.update(`${f.rel}:${inner}\n`);
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * 跑一次生成：读 `dist`，写 `dist/sw-manifest.json`，返回 `{ version, files, bytes }`。
 * **dist 不存在时抛一条可读的错**（本机陷阱：直接 readFileSync 会给用户一串 ENOENT 堆栈，
 * 完全看不出"要先构建"）。
 */
export function run(dist = DIST_DEFAULT) {
  const root = resolve(dist);
  if (!existsSync(root)) {
    throw new Error(`找不到构建产物目录 ${root} —— 请先跑 \`npx vite build\`（或 \`npm run build\`）再生成清单`);
  }
  const files = collectFiles(root);
  if (files.length === 0) {
    throw new Error(`${root} 里没有可缓存的程序文件 —— 产物是空的？先 \`npx vite build\``);
  }
  const version = computeVersion(files);
  const body = JSON.stringify({ version, files: files.map((f) => f.rel) }, null, 2);
  writeFileSync(join(root, 'sw-manifest.json'), body, 'utf8');
  return { version, files: files.map((f) => f.rel), bytes: body.length };
}

/* ── CLI ─────────────────────────────────────────────────────────────────────
 * 判断"是不是被直接执行"：`import.meta.url` 与 argv[1] 指向同一个文件。
 * ⚠️ 被测试 import 时**不得**产生副作用（否则跑一次测试就写一次 dist/）。
 */
const isMain = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return resolve(argv1) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const dist = process.argv[2] ?? DIST_DEFAULT;
  try {
    const r = run(dist);
    console.log(`sw-manifest.json：${r.files.length} 个文件，version=${r.version}`);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
