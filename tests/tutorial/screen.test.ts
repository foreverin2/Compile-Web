import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../ui/source-text';
import { EN, ZH } from '../../src/i18n';
import { TUT_LEVELS } from '../../src/tutorial/levels';

/**
 * ★ 2026-10-02（P2）：教学屏的**源码结构腿**与**文案腿**。
 *
 * 为什么不真跑屏：`src/ui/tutorial-screen.ts` 一上来就 `document.createElement` +
 * `renderApp`，本仓没有 jsdom（`vite.config.ts` 的 `environment: 'node'`）⇒ 屏那一层只能用
 * **源码腿 + 真机读数**（`.superpowers/a-verify/cdp-tutorial.mjs`）覆盖，
 * 判据本身（`src/tutorial/judge.ts`）则由 `tests/tutorial/levels.test.ts` 真跑。
 * 这与 `tests/i18n/onboarding.test.ts` 的分工同款。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string =>
  stripComments(readFileSync(`${REPO}${rel}`).subarray(0, 4 * 1024 * 1024).toString('utf8'));

const MAIN = read('src/main.ts');
const HOME = read('src/ui/home.ts');
const SCREEN = read('src/ui/tutorial-screen.ts');
const LOCAL_DATA = read('src/ui/local-data.ts');
const STORE = read('src/app/local-store.ts');
const CSS = stripComments(readFileSync(`${REPO}src/ui/styles-local.css`).subarray(0, 1024 * 1024).toString('utf8'));

/** 某个函数的函数体（剥过注释；与 `tests/i18n/onboarding.test.ts` 的 `bodyOf` 同款） */
function bodyOf(code: string, name: string): string {
  const at = code.indexOf(`function ${name}(`);
  expect(at, `找不到 function ${name}(`).toBeGreaterThan(0);
  let i = code.indexOf('{', at);
  const start = i;
  let depth = 0;
  for (; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return code.slice(start, i + 1);
}

describe('★ 入口接线（两处都指向教学屏）', () => {
  it('首页「新手教程」⇒ `nav.openTutorial`（**不再**是"待开发"的 toast）', () => {
    const at = HOME.indexOf("t('home.tutorial')");
    expect(at, '首页里找不到「新手教程」按钮').toBeGreaterThan(0);
    const line = HOME.slice(at, at + 160);
    expect(line, '首页那个按钮没有接到 nav.openTutorial').toContain('nav.openTutorial');
    // 反向：它**不再**弹 `toast.tutorial`（D1/P2 之前那是占位；现在这个按钮真的进教学）
    expect(line, '首页那个按钮还在弹"待开发"').not.toContain('toast.tutorial');
  });

  it('`HomeNav` 声明了 `openTutorial`（否则宿主接线是死代码）', () => {
    expect(HOME, 'HomeNav 里没有 openTutorial').toMatch(/openTutorial\(\):\s*void;/);
  });

  it('宿主把 `openTutorial` 接到 `showTutorial()`', () => {
    expect(MAIN, '宿主没把首页入口接到教学屏').toMatch(/openTutorial:\s*\(\)\s*=>\s*\{\s*showTutorial\(\);\s*\}/);
  });

  it('`showTutorial()`：离开首页 + 注入存储与退出接缝 + 幂等（不留第二屏）', () => {
    const body = bodyOf(MAIN, 'showTutorial');
    expect(body, '没有收拾首页（leaveHome）').toMatch(/leaveHome\s*\(\s*\)/);
    expect(body, '没有挂载教学屏').toMatch(/mountTutorial\s*\(\s*root\s*,\s*localStore/);
    expect(body, '不是幂等的（连点两次会叠两层浮层）')
      .toMatch(/querySelector\s*\(\s*'\.tutorial-overlay'\s*\)/);
    expect(body, '退出没有回首页').toMatch(/showHome\s*\(\s*\)/);
    // 进度落盘走既有那一条出口（不新造第二套）
    expect(body, '进度没有走 writeTutorialProgress').toMatch(/writeTutorialProgress\s*\(\s*localStore/);
    expect(body, '进度写失败没有走共享的本地化映射').toMatch(/applyWriteResult\s*\(/);
  });

  it('★ 向导第 3 步：「开始教学」⇒ 进教学屏；「跳过」⇒ 原样那句提示（**不变**）', () => {
    const body = bodyOf(MAIN, 'finishOnboarding');
    // 「开始教学」那一支必须进教学
    expect(body, '「开始教学」没有进教学屏').toMatch(/if\s*\(\s*outcome\.startTutorial\s*\)\s*\{[\s\S]{0,120}?showTutorial\s*\(\s*\)/);
    // 「跳过」那一支仍然是那句提示（用户口径，P1 的 D1 定稿）
    expect(body, '跳过那一支没有用 after-skip 那句').toMatch(/showHome\s*\(\s*t\('onboarding\.after-skip'\)\s*\)/);
    // 反向：`after-start`（"还在开发中"那句）**不再**被用作任何一支的提示
    expect(body, '「开始教学」还在用"还在开发中"那句提示（现在能进了）')
      .not.toContain("t('onboarding.after-start')");
  });

  it('「本地数据与隐私」屏有教学进度那一行（方案 §6：新存储要可见 + 可清除）', () => {
    expect(LOCAL_DATA, '屏上没有教学进度那一行').toContain("t('local-data.tutorial.label')");
    expect(LOCAL_DATA, '教学进度那一行没有读状态').toMatch(/readTutorialProgress\s*\(/);
    expect(LOCAL_DATA, '教学进度那一行没有"共几关"的读数').toMatch(/TUT_LEVELS\.length/);
    // 清除本机数据之后要重画回"还没开始"
    expect(LOCAL_DATA, '清完之后没有刷新教学进度那一行').toMatch(/refreshTutorial\s*\(\s*\)/);
  });
});

describe('★ 存储纪律：进度住在既有 L1_SETTINGS 里，零新增键', () => {
  it('`L1Settings` 加了 `tutorial` 字段（不是新键）', () => {
    expect(STORE, 'L1Settings 里没有 tutorial 字段').toMatch(/tutorial\?:\s*\{\s*done\?/);
  });

  it('存储键表里**没有**新的 tutorial 键（键表只有 load/save 那三个）', () => {
    const storage = read('src/app/storage.ts');
    // storage.ts 里的 L1_* 常量**不全是**存储键：前缀/探针键/版本号/上限都是参数。
    // 这里把**键表**（真正会出现在 localStorage 里的那三个）单独钉住 + 断言没有新增 tutorial 键。
    const all = [...storage.matchAll(/export const (L1_\w+)\s*=/g)].map((m) => m[1]);
    const KEYS = ['L1_SETTINGS', 'L1_DECKS', 'L1_CONSENT'];
    for (const k of KEYS) expect(all, `键表里少了 ${k}`).toContain(k);
    const extra = all.filter((k) => !KEYS.includes(k) && !/PREFIX|PROBE|SCHEMA|MAX_BYTES/.test(k));
    expect(extra, `出现了没归类的新 L1_* 常量（是存储键吗？）：${extra.join(', ')}`).toEqual([]);
    expect(all.some((k) => /TUTORIAL/i.test(k)), '新增了教学专用的存储键').toBe(false);
  });

  it('进度读写只走 `writeSettings`/`readSettings` 那两个出口（不自己碰 KV）', () => {
    const at = STORE.indexOf('export function readTutorialProgress');
    expect(at, '找不到 readTutorialProgress').toBeGreaterThan(0);
    const seg = STORE.slice(at, at + 1800);
    expect(seg, '读进度没有走 readSettings').toMatch(/readSettings\s*\(\s*store\s*\)/);
    expect(seg, '写进度没有走 writeSettings').toMatch(/writeSettings\s*\(\s*store\s*,\s*\{\s*tutorial/);
  });
});

describe('★ 文案腿：教学每一句中英都在，且两语言值不同', () => {
  /** 从关卡数据与屏里**生成式**收集用到的键（不写手写清单） */
  function tutorialKeysOf(code: string): string[] {
    return [...new Set([...code.matchAll(/'(tutorial\.[A-Za-z0-9_.-]+)'/g)].map((m) => m[1]))];
  }

  it('关卡数据里的每个键都在两张表里（缺一就是浮层上的一个空块）', () => {
    const levelSrc = read('src/tutorial/levels.ts');
    const keys = tutorialKeysOf(levelSrc);
    expect(keys.length, '关卡数据里一个 tutorial.* 键都没扫到 ⇒ 判据恒真').toBeGreaterThan(10);
    for (const k of keys) {
      expect(ZH[k], `中文表里没有 ${k}`).toBeTruthy();
      expect(EN[k], `英文表里没有 ${k}`).toBeTruthy();
      expect(EN[k], `${k} 的英文值与中文逐字相同（等于没翻）`).not.toBe(ZH[k]);
    }
    // 锚点：四关的标题与目标**键名**都在扫描面里（否则"每关一条腿"是空话）。
    // 键名由 `l.id` 拼出来：数据里每一条都是 `t('tutorial.T0.title')` 这种字面量，所以扫得到。
    for (const l of TUT_LEVELS) {
      expect(keys, `${l.id} 的标题键没被扫到`).toContain(`tutorial.${l.id}.title`);
      expect(keys, `${l.id} 的目标键没被扫到`).toContain(`tutorial.${l.id}.goal`);
    }
  });

  it('屏里用到的键也都存在（含走偏提示那三条）', () => {
    const keys = tutorialKeysOf(SCREEN);
    expect(keys.length, '屏里一个 tutorial.* 键都没扫到').toBeGreaterThan(5);
    for (const k of keys) {
      expect(ZH[k], `中文表里没有 ${k}`).toBeTruthy();
      expect(EN[k], `英文表里没有 ${k}`).toBeTruthy();
    }
    for (const k of ['tutorial.off.wrong-kind', 'tutorial.off.face-down', 'tutorial.off.rejected']) {
      expect(ZH[k], `走偏提示 ${k} 不在表里`).toBeTruthy();
      expect(EN[k], `走偏提示 ${k} 的英文不在表里`).toBeTruthy();
    }
  });

  it('★ `t()` 的实参必须是字面量（动态键禁令：这一条是本轮踩过两次的坑）', () => {
    // 扫 `src/tutorial/**` 与教学屏：每一处 `t(` 后面必须紧跟引号
    const files = [
      ...readdirSync(`${REPO}src/tutorial`).filter((n) => n.endsWith('.ts')).map((n) => `src/tutorial/${n}`),
      'src/ui/tutorial-screen.ts',
    ];
    let seen = 0;
    for (const f of files) {
      const code = read(f);
      for (const m of code.matchAll(/\bt\(\s*/g)) {
        const rest = code.slice((m.index ?? 0) + 2).trimStart();
        expect(rest.startsWith("'"), `${f} 里出现了动态键（\`t()\` 的实参不是字面量）`).toBe(true);
        seen += 1;
      }
    }
    expect(seen, '一处 `t(` 都没扫到 ⇒ 这条腿在空集合上恒真').toBeGreaterThan(10);
  });
});

describe('★ 版式（源码腿）：浮层不挡住棋盘、类名不打架', () => {
  it('`.tutorial-overlay` **不吃点击**（教学要玩家去操作棋盘）', () => {
    const at = CSS.indexOf('.tutorial-overlay {');
    expect(at, 'styles-local.css 里没有 .tutorial-overlay').toBeGreaterThan(0);
    const block = CSS.slice(at, CSS.indexOf('}', at));
    expect(block, '浮层没有 pointer-events: none ⇒ 它会把棋盘盖住，教学就废了')
      .toMatch(/pointer-events:\s*none/);
    expect(block, '浮层不是 fixed 定位').toMatch(/position:\s*fixed/);
    // 但面板与热点自己要吃点击（否则浮层上的按钮点不动）
    const panelAt = CSS.indexOf('.tutorial-panel {');
    expect(CSS.slice(panelAt, CSS.indexOf('}', panelAt)), '面板没有 pointer-events: auto')
      .toMatch(/pointer-events:\s*auto/);
    const spotAt = CSS.indexOf('.tutorial-spot {');
    expect(CSS.slice(spotAt, CSS.indexOf('}', spotAt)), '热点没有 pointer-events: auto')
      .toMatch(/pointer-events:\s*auto/);
  });

  it('`.tutorial-teach[hidden]` 有显式 display:none（本仓栽过"作者样式压掉 hidden"）', () => {
    expect(CSS, '缺这条兜底规则 ⇒ 讲解收起来之后真浏览器里还占着位置')
      .toMatch(/\.tutorial-teach\[hidden\]\s*\{[^}]*display:\s*none/);
    expect(CSS, '缺这条兜底规则 ⇒ T0 的热点在别的关卡里还看得见')
      .toMatch(/\.tutorial-spots\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  it('`.tutorial-*` 这一族类名在其余 CSS 里零命中（生成式扫 src/ui/*.css）', () => {
    const others = readdirSync(`${REPO}src/ui`).filter((n) => n.endsWith('.css') && n !== 'styles-local.css');
    expect(others.length, '除本文件外一份 CSS 都没读到').toBeGreaterThan(5);
    const mine = new Set([...CSS.matchAll(/\.(tutorial-[a-z0-9-]+)/g)].map((m) => m[1]));
    expect(mine.size, 'onboarding 类名少得离谱（正则失效？）').toBeGreaterThan(10);
    for (const f of others) {
      const text = readFileSync(`${REPO}src/ui/${f}`).subarray(0, 1024 * 1024).toString('utf8');
      const hits = [...mine].filter((c) => text.includes(c));
      expect(hits, `${f} 里也定义了这些 tutorial 类名（两份定义会打架）：${hits.join(', ')}`).toEqual([]);
    }
  });

  it('屏**不碰**红线文件（只是调用它们）', () => {
    expect(SCREEN, '屏直接改了 render.ts 的内部？').not.toMatch(/from '\.\/render'[\s\S]{0,40}setUiInternals/);
    // 它 import 的是 render.ts 的公开出口（renderApp / resetUiState / setDraftSelfSeat）
    expect(SCREEN, '屏没有走 renderApp 这个公开出口').toMatch(/renderApp\s*\(/);
    // 也不许自己碰存储实现（一切经 LocalStore）
    expect(SCREEN, '屏里出现了存储实现').not.toMatch(/localStorage|indexedDB|writeJson/);
  });
});
