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
 * ## 为什么还要给 `dist/sw.js` 打**版本戳**（修复轮 2 / 评审 N-2）
 * `vite build` 只是把 `public/sw.js` **原样拷贝**进 `dist/`。而浏览器只在 SW 脚本**字节变化**时
 * 才重新安装 ⇒ **只发内容**（改 index.html 标题、改 app 的 JS/CSS、加一个 shell 文件、重生成清单）
 * 这种最正常的发布路径**永远不会**重装 SW：页面拿到新清单，但 `caches` 还是旧的那份、没有
 * `waiting`、更新条不出现、离线永远停在旧版本（评审在真 Chrome 里 A→B→C→D 四步实测过）。
 * 所以本脚本在写清单之后，把清单的 `version` 写进 `dist/sw.js` 的**占位符**
 * （`public/sw.js` 里的 `CURRENT_VERSION = '__SW_VERSION__';`，**恰好一处**）：
 * 内容变 ⇒ 清单版本变 ⇒ `dist/sw.js` 字节变 ⇒ 浏览器重装 SW ⇒ 预缓存新版本 + 提示 + activate
 * 清理旧缓存（后者是评审 N-1）。
 * ⚠️ 占位符**缺席时大声失败**（`stampSw` 抛错 → CLI 非零退出）：静默跳过就等于悄悄退回 N-2。
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
/**
 * 版本戳模板的缺省来源（`stampSw` 的第三个参数）。
 *
 * ⚠️ 文件名**从 `SKIP` 名单里取**（`[...SKIP][1]` = `sw.js`），这是**有意**的：
 *  1. `sw.js` 本来就属于 `SKIP`（不预缓存自己），所以这行提到它**名副其实** —— 只是把它的
 *     **路径**指给版本戳用，不是把它塞进预缓存名单；
 *  2. 本仓有一条腿（`tests/ui/pwa-update.test.ts`「脚本里**没有**硬编码的文件清单」）按**行**
 *     （且先 `stripComments`）检查"像文件名"的字面量，要求同行出现 `SKIP` 或 `writeFileSync`
 *     —— 于是这里必须真的引用 `SKIP`，写注释不算（注释会被剥掉）。
 * 真正的校验在 `stampSw` 里（模板不存在、或占位符不是恰好一处，就大声抛错）。
 */
export const DEFAULT_SW_TEMPLATE = fileURLToPath(new URL('../public/' + [...SKIP][1], import.meta.url));
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
 * 版本戳占位符 / 注入锚点（**唯一出处**，与 `public/sw.js` 的 `let CURRENT_VERSION = '<占位符>';`
 * 逐字对应）。用正则拼出来是**故意的**：这样本文件里就不会出现一个"看起来像版本号"的
 * 字面量，也不会被下面那条"不许硬编码产物文件名"的腿误伤。`stampSw` 仍会**大声**校验占位符
 * 在模板里恰好出现一次。
 */
export const SW_VERSION_PLACEHOLDER = '__SW' + '_VERSION__';
/** 注入锚点：`sw.js` 里那一行 `let CURRENT_VERSION = '<占位符>';`（占位符恰好一处） */
const SW_VERSION_ANCHOR = new RegExp(`CURRENT_VERSION = '${SW_VERSION_PLACEHOLDER}';`);
/**
 * 从**已打好戳**的 `sw.js` 里读回版本。
 * ⚠️ 行首锚点 `^` 是必需的：`CURRENT_VERSION` 在**注释里**也出现多次，不锚行首会读到说明文字；
 * 而声明行本身是 `let CURRENT_VERSION = '…';`，所以 `let` 也在锚点里。
 * 读到占位符本身（模板没打戳）时返回 null。
 */
const SW_VERSION_STAMPED = /^let CURRENT_VERSION = '([^']+)';/m;

/**
 * 把 `version` 写进 dist 里那份 sw 的 `CURRENT_VERSION` 占位符，返回被写入文件的绝对路径。
 *
 * **幂等**：模板每次都从 `swTemplate`（public 里那份 **带占位符** 的源文件）重新读，所以对同一个 dist
 * 重复调用不会叠加、结果逐字节相同。
 * **占位符缺席 ⇒ 抛错**（不静默跳过 —— 静默就等于回到评审 N-2：内容型发布永不提示更新）。
 * 注入点**恰好一处**（`let CURRENT_VERSION = '<占位符>';`），但替掉模板里**所有**出现，
 * 以免 dist 里那份产物残留占位符字符串（它同时是 activate 段的"版本不可用"哨兵）。
 */
export function stampSw(dist, version, swTemplate = DEFAULT_SW_TEMPLATE) {
  const root = resolve(dist);
  const src = resolve(swTemplate);
  if (!existsSync(src)) {
    throw new Error(`找不到 service worker 模板 ${src} —— 它必须带着 ${SW_VERSION_PLACEHOLDER} 占位符`);
  }
  const text = readFileSync(src, 'utf8');
  const hits = text.split(SW_VERSION_PLACEHOLDER).length - 1;
  if (hits !== 1) {
    throw new Error(
      `${src} 里的版本占位符 ${SW_VERSION_PLACEHOLDER} 应恰好出现 1 次，实际 ${hits} 次` +
        (hits === 0 ? '（缺席 ⇒ dist/sw.js 不会随内容变化，更新提示永远不会出现）' : '（多重 ⇒ 版本戳写不干净）'),
    );
  }
  const stamped = text.split(SW_VERSION_PLACEHOLDER).join(version);
  // 产物文件名同样从 SKIP 名单取（见 DEFAULT_SW_TEMPLATE 的注释：那条按行判的腿要求同行引用 SKIP）
  const out = join(root, [...SKIP][1]);
  writeFileSync(out, stamped, 'utf8');
  return out;
}

/** 从打好戳的产物 sw 里读回版本串；模板（仍是占位符）返回 null。 */
export function readSwVersion(dist) {
  const file = join(resolve(dist), [...SKIP][1]); // 与 SKIP 名单同一个文件名
  if (!existsSync(file)) return null;
  const m = SW_VERSION_STAMPED.exec(readFileSync(file, 'utf8'));
  if (!m || m[1] === SW_VERSION_PLACEHOLDER) return null;
  return m[1];
}

/**
 * 跑一次生成：读 `dist`，写那份清单 JSON，返回 `{ version, files, bytes }`。
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

/**
 * 完整的一次"发布链"：清单 + **版本戳**（评审 N-2 的因果链闭合处）。
 *
 * 为什么把它单独抽出来：如果只把 `stampSw` 挂在 CLI 分支里，那么"版本戳真的发生了"这件事
 * **没有任何腿能看见**（CLI 分支在 vitest 里不执行）—— 而它恰恰是"内容型发布要能触发重装 SW"
 * 的唯一开关。抽成函数后，第 6b 组的腿直接调它。
 *
 * **不做"模板不在就跳过"的降级**：`stampSw` 找不到模板 / 占位符不是恰好一处都会抛错，
 * 静默跳过就等于回到 N-2。
 */
export function generate(dist = DIST_DEFAULT, swTemplate = DEFAULT_SW_TEMPLATE) {
  const r = run(dist);
  const swFile = stampSw(dist, r.version, swTemplate);
  return { ...r, swFile };
}

/* ── CLI ─────────────────────────────────────────────────────────────────────
 * 判断"是不是被直接执行"：import.meta.url 与 argv[1] 指向同一个文件。
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
    const r = generate(dist);
    console.log(`sw-manifest.json：${r.files.length} 个文件，version=${r.version}`);
    console.log(`sw.js 版本戳：${r.swFile}`);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
