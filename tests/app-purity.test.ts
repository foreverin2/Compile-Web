import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { codePositions, stripComments } from './ui/source-text';

/**
 * G3 Task 9 守卫：`src/app` 的**分层契约**（依赖方向严格单向 `ui → app → core`）。
 *
 * 规格出处：
 *  - 设计稿 `docs/2026-09-13-联机与多端-设计稿.md` §1.1（依赖方向）、§2.2 / §2.8（纯确定性）；
 *  - G3 计划 `docs/2026-09-16-G3-档案格式-实现计划.md` 的 Global Constraints
 *    「`src/app/` 也**不得**出现 `document`/`window`/`localStorage`/`indexedDB`/`navigator`/`fetch`」
 *    与「`fetch`/`XMLHttpRequest`/`WebSocket`/`RTCPeerConnection` 在 `src/app` 内零命中，Task 9 有守卫」。
 *
 * ## 为什么需要它（这条分层此前只有零散的部分守卫）
 *
 * 全仓此前只有扫 `src/core/` 的 `tests/core-purity.test.ts`。`src/ui/local-store-browser.ts:5-10`
 * 如实记着当时的缺口：「`tests/ui/local-store-browser.test.ts` 里那条文本腿**只覆盖 `storage.ts` 一个文件**，
 * 不含 `local-store.ts`，也不含 `document`/`window`/`fetch`/`indexedDB`/`navigator`」。
 * 本文件把"`app` 不碰浏览器、不碰 `ui`、不碰网络"变成**生成式**的可执行断言 ⇒
 * `local-store-browser.ts` 与 Task 6 两个文件里那三处**前向引用**（"Task 9 提供"）从写下那天起
 * 现在真的成立了。这是**守卫 + 收口**任务，本文件一行 `src` 都不改。
 *
 * ## 判据形态：**调用/成员访问形态**，不是字面命中
 *
 * G0 §2.8 与 Task 5 评审都实测过同一族假红/假绿：注释里提到 `localStorage` 不该算命中
 * （解释性注释——本仓 `src/app` 里就有大量这类注释，例如 `archive-fs.ts:8` 逐字列着
 * "`showOpenFilePicker` / `document` / `window` / `URL.createObjectURL` 一律零命中"）。
 * ⇒ 因此：**先 `stripComments` 剥注释，再按"后跟 `.` 或 `(`"的形态匹配**。
 *
 * ## ⚠️ 本轮的**补洞**（其它任务评审实测出来的缺口，务必保留）
 *
 * 计划 `:2876-2879` 的三条正则（`/\bdocument\s*\./`、`/\bwindow\s*\./`、`/\bfetch\s*\(/`）
 * **抓不到 `globalThis.window` / `globalThis.fetch` 这类裸全局形态**：
 * 换个前缀就绕开了同一个洞（`/\blocalStorage\b/` 恰好能抓到 `globalThis.localStorage`，
 * 但那只是**巧合**，不是覆盖）。⇒ 照抄 `tests/core-purity.test.ts:91` 已有的
 * `globalThis\s*\.\s*(…)` 分支（同一族洞在 G0 已被同一种修法堵过，不重新发明）。
 * 本文件另补 `typeof <浏览器全局>` 形态（读取全局名也构成依赖），以及 Global Constraints 明写
 * 但计划的正则表**漏掉**的 `XMLHttpRequest` / `WebSocket` / `RTCPeerConnection` /
 * `URL.createObjectURL` / `FileReader`。
 */

const APP_DIR = fileURLToPath(new URL('../src/app/', import.meta.url));

/** 生成式遍历 `src/app/**`（用 `statSync(...).isDirectory()` 递归：`readdirSync` 的声明不够递归） */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 相对路径（报错时好读；且与"文件数"判据无关，纯展示） */
function rel(file: string): string {
  return file.slice(APP_DIR.length).split('\\').join('/');
}

const FILES = walk(APP_DIR).sort();
const SOURCES = FILES.map((p) => ({
  path: rel(p),
  /** 剥注释后的源码：**字符串字面量原样保留**（判据不碰它们，见文件头注的"调用形态"） */
  code: stripComments(readFileSync(p).subarray(0, 4 * 1024 * 1024).toString('utf8')),
}));

/** 模块说明符（`from '…'` 与动态 `import('…')` 两种形态；均已剥注释） */
function specifiersOf(code: string): string[] {
  return [
    ...[...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
}

/**
 * `globalThis.<浏览器全局>` 分支（**照抄 `tests/core-purity.test.ts:91` 的形态**，只补了
 * `serviceWorker` 与 `RTCPeerConnection`：本仓 `src/app` 里 `serviceWorker` 也是禁项）。
 */
const GLOBAL_THIS_BROWSER =
  /\bglobalThis\s*\.\s*(?:window|document|navigator|fetch|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|RTCPeerConnection|serviceWorker|showOpenFilePicker|showSaveFilePicker|requestAnimationFrame|cancelAnimationFrame|getRandomValues|crypto)\b/;

/**
 * 被禁的**调用 / 成员访问**形态。标签只用于报错可读性。
 *
 * 分两族（这是刻意的，不是随手写）：
 *  - **无歧义族**（`localStorage` / `indexedDB` / `XMLHttpRequest` …）：裸标识符即违规 ——
 *    游戏逻辑里不会有人把局部变量命名成这些名字，所以整词匹配的假阳风险是 0；
 *  - **有歧义族**（`document` / `window` / `navigator` / `fetch`）：只认"后跟 `.` 或 `(`"的形态
 *    （计划 `:2837` 的硬口径：否则注释/局部同名变量会假红），另加 `globalThis.` 与 `typeof` 两个绕行形态。
 */
const BANNED: ReadonlyArray<readonly [string, RegExp]> = [
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['document', /\bdocument\s*\./],
  ['window', /\bwindow\s*\./],
  ['navigator', /\bnavigator\s*\./],
  ['fetch 调用', /\bfetch\s*\(/],
  ['serviceWorker', /\bserviceWorker\b/],
  ['showOpenFilePicker / showSaveFilePicker', /\bshow(Open|Save)FilePicker\b/],
  ['getRandomValues', /\bgetRandomValues\b/],
  // Global Constraints 明写"零命中"，但计划 `:2872-2883` 的正则表**漏了它们**（本任务补上）
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['RTCPeerConnection', /\bRTCPeerConnection\b/],
  ['URL.createObjectURL / revokeObjectURL', /\bURL\s*\.\s*(?:create|revoke)ObjectURL\b/],
  ['FileReader', /\bFileReader\b/],
  ['requestAnimationFrame / cancelAnimationFrame 调用', /\b(?:request|cancel)AnimationFrame\s*\(/],
  // ⚠️ 补洞：裸全局形态（计划的正则对这三个完全盲）
  ['globalThis.<浏览器全局>', GLOBAL_THIS_BROWSER],
  ['typeof <浏览器全局>', /\btypeof\s+(?:document|window|navigator|localStorage|sessionStorage|indexedDB)\b/],
];

/** 对**任意**源码（真文件或合成样本）跑一遍浏览器 API 判据，返回人可读的命中清单 */
function browserApiHits(code: string): string[] {
  return BANNED.filter(([, re]) => re.test(code)).map(([label]) => label);
}

describe('src/app 的分层契约（ui → app → core；app 不碰浏览器/网络/UI）', () => {
  it('至少扫到了本阶段的全部 app 模块（生成式：文件数必须 >= 6，防"目录被清空后测试静默通过"）', () => {
    // 现状 7 个：archive-fs / archive-io / card-data-hash / local-store / match-file / privacy / storage。
    // 这里**不写文件名清单**（写死清单会在"新增模块漏扫"时假绿）—— 只钉下界。
    expect(FILES.length, `src/app 下只扫到 ${FILES.length} 个 .ts 文件（目录被清空/路径写错？）`).toBeGreaterThanOrEqual(6);
    for (const s of SOURCES) {
      expect(s.code.length, `${s.path} 读成空串（判据会在空串上恒真）`).toBeGreaterThan(50);
    }
  });

  it('浏览器 API 零命中（localStorage/indexedDB/document/window/navigator/fetch/… 与 globalThis.X 绕行）', () => {
    const hits: string[] = [];
    for (const { path, code } of SOURCES) {
      for (const label of browserApiHits(code)) hits.push(`${path}: ${label}`);
    }
    expect(hits, `src/app 里出现浏览器 API（应挪到 src/ui）：\n${hits.join('\n')}`).toEqual([]);
  });

  it('判据自证（正控 + 反控）：同一套正则在**合成样本**上能分辨"调用形态"与"注释/字符串"', () => {
    // 正控：计划 `:2871` 列出的七种形态**每一种**都必须被抓到（否则那条腿是假的）
    for (const sample of [
      'const a = localStorage.getItem("k");',      // 成员访问
      'indexedDB.open("db");',                      // 宽松族
      'document.createElement("div");',             // 调用形态
      'const w = window.innerWidth;',               // 成员访问
      'navigator.serviceWorker.register("sw.js");', // 成员访问
      'const r = await fetch("/x");',               // 调用形态
      'crypto.getRandomValues(new Uint8Array(4));', // 调用形态
    ]) {
      expect(browserApiHits(sample), `正控失效：${sample} 没被抓到`).not.toEqual([]);
    }
    // ⚠️ **补洞的正控**（这是本轮的核心）：裸全局形态必须被抓到 —— 计划旧正则对它们零命中
    for (const sample of [
      'const w = globalThis.window;',
      'const f = globalThis.fetch;',
      'const d = globalThis.document;',
      'const n = globalThis.navigator;',
      'const s = globalThis.serviceWorker;',
      'if (typeof document !== "undefined") { }',
      'if (typeof window !== "undefined") { }',
    ]) {
      expect(browserApiHits(sample), `补洞失效：裸全局形态没被抓到：${sample}`).not.toEqual([]);
    }
    // 反控：注释里提到这些名字**不算**命中（`stripComments` 之后再判 —— 与"调用形态"口径配套）
    expect(
      browserApiHits(stripComments('// 这里提到 localStorage / document.createElement / fetch( 都不算\nconst a = 1;')),
      '注释被判成违规（假红方向）',
    ).toEqual([]);
    // 反控：合法的纯逻辑代码**一条都不许**被误判
    expect(
      browserApiHits('export function pick(xs) { return xs.length > 0 ? xs[0] : null; }'),
      '纯逻辑被判成违规（判据恒假）',
    ).toEqual([]);
  });

  it('不得 import src/ui（依赖方向严格单向）', () => {
    const hits: string[] = [];
    for (const { path, code } of SOURCES) {
      for (const spec of specifiersOf(code)) {
        if (/(^|\/)ui\//.test(spec)) hits.push(`${path}: ${spec}`);
      }
    }
    expect(hits, `src/app 反向依赖了 src/ui：\n${hits.join('\n')}`).toEqual([]);
    // 锚点：说明符提取器真的工作（否则上面那条在空数组上恒真）
    expect(
      specifiersOf(stripComments("import { x } from '../ui/home';\nconst y = import('./ui/z');")),
      '说明符提取器没扫到 src/ui（锚点失效）',
    ).toEqual(['../ui/home', './ui/z']);
    expect(specifiersOf(stripComments("import { z } from './local-store';"))).toEqual(['./local-store']);
  });

  it('不得出现 Math.random / Date.now（随机源只能在 match-seed.ts；档案时间由调用方传入）', () => {
    const hits: string[] = [];
    for (const { path, code } of SOURCES) {
      if (/\bMath\.random\s*\(/.test(code)) hits.push(`${path}: Math.random`);
      if (/\bDate\.now\s*\(/.test(code)) hits.push(`${path}: Date.now`);
    }
    expect(hits, `src/app 自行取随机/读时钟：\n${hits.join('\n')}`).toEqual([]);
    // 正控：两条判据各自能红（`archive-io.ts:95` 的注释里逐字写着"不是 `Date.now()`"，剥注释后必须消失）
    expect(/\bMath\.random\s*\(/.test('const x = Math.random();')).toBe(true);
    expect(/\bDate\.now\s*\(/.test('const t = Date.now();')).toBe(true);
  });

  it('纯逻辑模块不得带副作用式写盘（Node 内置模块零命中）', () => {
    const hits: string[] = [];
    for (const { path, code } of SOURCES) {
      for (const spec of specifiersOf(code)) if (spec.startsWith('node:')) hits.push(`${path}: ${spec}`);
    }
    expect(hits, `src/app import 了 Node 内置模块：\n${hits.join('\n')}`).toEqual([]);
    expect(specifiersOf(stripComments("import { readFileSync } from 'node:fs';")), '正控失效').toEqual(['node:fs']);
  });
});

describe('codePositions 判据本身可用（防守卫假绿）', () => {
  it('注释里提到 localStorage 不算命中（两条路线的语义都钉住）', () => {
    const src = '// 这里提到 localStorage 是允许的\nconst a = 1;';
    // ① 本文件守卫用的那条路线：`stripComments` 之后词面命中为 0
    expect(browserApiHits(stripComments(src)), '注释被判成违规（守卫会假红）').toEqual([]);
    // ② 共用助手 `codePositions` 自己的语义：注释区**不是**代码位、真代码位是。
    //    ⚠️ **不能**写 `codePositions(stripComments(src))`：剥注释把注释内容换成了**等长空白**，
    //    而空白在 `codePositions` 的语义里属于"非注释非字符串" = **代码位** ⇒ 那个组合会把
    //    注释区的下标判成 true（计划 `:2915-2921` 的原始写法就是这个形态，实测必红）。
    //    要判"注释里的名字不是代码位"，必须把**原始**源码交给 `codePositions`（它自己会跳注释）。
    const isCode = codePositions(src);
    expect(isCode[src.indexOf('localStorage')], 'codePositions 把注释里的字符当成了代码（守卫会假红）').toBe(false);
    expect(isCode[src.indexOf('const')], 'codePositions 把代码当成了注释（守卫会假绿）').toBe(true);
  });
});
