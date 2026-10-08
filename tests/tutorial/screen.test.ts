import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../ui/source-text';
import { EN, ZH } from '../../src/i18n';
import { TUT_LEVELS, levelById } from '../../src/tutorial/levels';
import type { TutSpot } from '../../src/tutorial/types';
import {
  placeSpotBoxes, spotBoxStyle, unionRect, applyNextButtonVisibility, chipJumpTarget, chipA11y,
  countdownLabel, countdownOverlayElement, countdownSecondsOf,
  COUNTDOWN_TICK_MS, LEVEL_CLEAR_COUNTDOWN_MS,
  // ★ 2026-10-07（用户要求）：那句「建议 67%」只在第一关显示的**纯判据**（语义那半真跑）
  showsZoomHint,
} from '../../src/ui/tutorial-screen';
import { installStubDom, makeStubEl, setStubRectFor, queryAllIn, classOf, isClass, type StubNode } from '../ui/net-dom-stub';
import { renderBoard, resetUiState } from '../../src/ui/render';
import { buildLevelState } from '../../src/tutorial/setup';
import { observedOps, snapshot } from '../../src/tutorial/judge';
import { findCard } from '../../src/core/effects/context';
import { createLocalDriver } from '../../src/app/match-driver';

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

  it('★ 线编号必须跟界面口径（**1 起**）：教学文案里不许出现「线 0 / line 0」', () => {
    // 界面上线编号是 **1 起**：日志 `→ 线 ${op.targetLine + 1}`（`resolve.ts:320`）、
    // 编译按钮 `编译线 ${line + 1}`（`render.ts:5355`）。文案写 0 起会让玩家照着数错一位，
    // 而 T9 的观察点正是让玩家去读日志 ⇒ P6 当场把 68 条（zh 34 / en 34）改成 1 起，
    // 并留这条腿：以后加关卡时写回 0 起，当场红。
    const keys = Object.keys(ZH).filter((k) => k.startsWith('tutorial.'));
    expect(keys.length, '一条 tutorial.* 键都没扫到 ⇒ 这条腿在空集上恒真').toBeGreaterThan(50);
    const bad: string[] = [];
    let mentionsOne = 0;
    for (const [lang, table] of [['zh', ZH], ['en', EN]] as const) {
      for (const k of keys) {
        const v = table[k];
        if (/线 0|line 0/.test(v)) bad.push(`${lang} ${k}=${v}`);
        if (/线 1|line 1/.test(v)) mentionsOne += 1;
      }
    }
    expect(bad, `这些文案用了 0 起的线编号（玩家看到的日志与编译按钮都是 1 起）：${bad.join(' | ')}`).toEqual([]);
    // 反向锚点：真的有一批文案在写"线 1"（否则上面那条只是"什么都没匹配到"）
    expect(mentionsOne, '中英合计只有这么几条提到"线 1" ⇒ 扫描面可疑').toBeGreaterThan(10);
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

/**
 * ★ 2026-10-02（P6 任务 B）：**四件套在屏上真的显示了**（源码腿；真 DOM 那一半由
 * `.superpowers/a-verify/cdp-tutorial.mjs` 兜 —— 本仓没有 jsdom）。
 *
 * 为什么这条腿必须有：数据层有"每关四件套齐全"的生成式腿（`levels.test.ts`），
 * 但那只证明**数据在**。屏上不显示的话，玩家看到的还是"只念文字"——那正是用户要禁的形态。
 */
describe('★ 四件套在屏上：例子 → 步骤 → 观察点（三段都在，且顺序是这样）', () => {
  it('三段各自的容器都挂在面板上，且顺序是 例子 → 步骤 → 观察点', () => {
    const iScenario = SCREEN.indexOf("panel.appendChild(scenarioBox)");
    const iSteps = SCREEN.indexOf("panel.appendChild(stepsBox)");
    const iObserve = SCREEN.indexOf("panel.appendChild(observeBox)");
    expect(iScenario, '屏上没有"实战例子"那一段').toBeGreaterThan(0);
    expect(iSteps, '屏上没有"引导步骤"那一段').toBeGreaterThan(0);
    expect(iObserve, '屏上没有"观察点"那一段').toBeGreaterThan(0);
    expect(iScenario < iSteps && iSteps < iObserve, '三段没有按 例子 → 步骤 → 观察点 排列').toBe(true);
    // 三段都必须在**浮层**里（不是 body 上另起一层），而且类名是教学自己那一族
    expect(SCREEN).toContain("el('div', 'tutorial-scenario')");
    expect(SCREEN).toContain("el('div', 'tutorial-steps')");
    expect(SCREEN).toContain("el('div', 'tutorial-observe')");
  });

  it('renderPanel 每次重画都把三段填上（切语言也跟着走）', () => {
    const body = bodyOf(SCREEN, 'renderPanel');
    expect(body, '没填"实战例子"').toContain('level.scenario()');
    expect(body, '没填"观察点"').toContain('level.observe()');
    expect(body, '没填"引导步骤"').toContain('level.guidedSteps');
    // 三个小标题走 t()（中英都有；键名逐字写在这里，缺键扫描腿也看得见）
    expect(body, "没有「实战例子」这个小标题").toContain("t('tutorial.scenario.label')");
    expect(body, "没有「跟着做」这个小标题").toContain("t('tutorial.steps.label')");
    expect(body, "没有「你会看到」这个小标题").toContain("t('tutorial.observe.label')");
  });

  it('三条新类名在 styles-local.css 里都有样式（否则是真的裸块）', () => {
    for (const cls of ['.tutorial-scenario', '.tutorial-steps', '.tutorial-observe', '.tutorial-step-item']) {
      expect(CSS.includes(cls + ' ') || CSS.includes(cls + ',') || CSS.includes(cls + '{') || CSS.includes(cls + '\n') || CSS.includes(cls), `${cls} 没有样式`).toBe(true);
    }
  });
});

/**
 * ★ 2026-10-02（P6 任务 A.1）：**候选集合的观察通道**与"点了被压暗的牌"那一下。
 *
 * T7 的判据要的是 `ChoiceRequest.candidates` 的集合，而候选只存在于引擎的挂起效果上
 * （不是 DOM），所以屏得自己去读一次；"点了被压暗的牌"那一下则只有 body 级捕获监听盯得住
 * （红线上那一层给非候选卡加 `.choice-dim` 且不绑任何点击）。两条都钉在这里。
 */
describe('★ T7 的两条观察通道（候选集合 / 点了被压暗的牌）', () => {
  it('recordChoices 读的是引擎的 `ChoiceRequest.candidates`，按效果源归类', () => {
    const body = bodyOf(SCREEN, 'recordChoices');
    expect(body, '没有扫挂起的效果').toContain('state.pendingEffects');
    expect(body, '没有只看 select 类请求').toMatch(/prompt\.kind\s*!==\s*'select'/);
    expect(body, '没有读候选 uid').toContain('prompt.candidates.map((c) => c.uid)');
    expect(body, '没有按效果源归类').toContain('sourceDefId');
    // 它必须在每次动作之后被调到（否则候选集合永远记不下来）
    expect(bodyOf(SCREEN, 'judgeAndAdvance'), 'judgeAndAdvance 没有调 recordChoices').toContain('recordChoices()');
  });

  it('点了被压暗的牌 ⇒ 记一笔 `blockedPickTried`（捕获阶段挂在 document 上）', () => {
    const body = bodyOf(SCREEN, 'onDocClickCapture');
    expect(body, '没有看 `.card.choice-dim`（红线上那个"不在候选里"的类名）').toContain(".card.choice-dim");
    expect(body, '没有记下那一下').toContain('blockedPickTried');
    expect(SCREEN, '监听没有挂在 document 的捕获阶段（棋盘在 #app 里，不在浮层里）')
      .toMatch(/document\.addEventListener\('click',\s*onDocClickCapture,\s*true\)/);
    // 退出时必须撤掉（否则退出教程之后还在盯点击）。`close()` 是 handle 上的方法（不是
    // `function close(`），所以这里按"这对 add/remove 都在同一个文件里"来钉。
    expect(SCREEN, '退出时没撤监听').toMatch(/document\.removeEventListener\('click',\s*onDocClickCapture,\s*true\)/);
    expect(SCREEN.indexOf("removeEventListener('click', onDocClickCapture, true)"),
      'remove 出现在 add 之前（那是撤一个还没挂的监听）')
      .toBeGreaterThan(SCREEN.indexOf("addEventListener('click', onDocClickCapture, true)"));
  });

  it('T7 的提示按"做到哪一步"分三档，其中一档就是那句走偏解释', () => {
    const body = bodyOf(SCREEN, 'renderPanel');
    expect(body, "没有「先试着点被压住的那张」那一档").toContain("t('tutorial.T7.hint.try')");
    expect(body, "没有「点不动」那句解释").toContain("t('tutorial.choice.blocked')");
    expect(body, "没有「现在用腐化3」那一档").toContain("t('tutorial.T7.hint.pick')");
    // 「这次选择还没结束」的判据：挂起的 spirit-2 效果还带着 prompt
    expect(body, '没有判"这次选择还在进行中"').toMatch(/sourceDefId === 'spirit-2'/);
  });

  it('T9 的两步读数与判据同源（都走 judge 的 `revealSeen()`）', () => {
    expect(bodyOf(SCREEN, 'renderPanel'), '屏上没有用 revealSeen 给 T9 的读数').toContain('revealSeen(state)');
    expect(SCREEN, '屏没有 import revealSeen（自己重算一遍就是第二份真相）').toContain('revealSeen');
  });
});

/**
 * ★ 2026-10-02（P7）：后四关在屏上的两处接线（源码腿；动作链由 `levels.test.ts` 真跑引擎覆盖）。
 *
 * 这两条都是"漏了就不会有人发现"的地方：
 *  1. **T10 必须让引擎的步真的走一格**（`keepStep`）—— 少这一句，T10 永远过不了，
 *     而在无 jsdom 的 node 下屏跑不起来 ⇒ 只有源码腿看得见；
 *  2. **两个新动作 kind**（`advance` / `resolve-trigger`）必须真的转给 `driver.submit` ——
 *     少哪一支，T10 / T11 的棋盘按钮点了没反应。
 */
describe('★ P7 后四关的屏上接线（源码腿）', () => {
  it('T10 的「保留引擎步」规则真的接在 `handBackTurn` 上（`keepStep` 那条早退）', () => {
    const body = bodyOf(SCREEN, 'handBackTurn');
    expect(body, 'handBackTurn 没有读 keepStep ⇒ T10 的那次 advance 会被就地抹掉，这一关永远过不了')
      .toMatch(/currentLevel\(\)\.keepStep\s*===\s*true/);
    // 早退必须在那句"强制回到 action"**之前**（否则抹掉之后再早退就没意义了）
    expect(body.indexOf('keepStep'), 'keepStep 的早退排在"强制回到 action"之后')
      .toBeLessThan(body.indexOf("state.step = 'action'"));
    // 数据层：只有需要"让引擎的步真的走"的关卡声明它（T10 控制权 / T11 结束阶段）
    const keep = TUT_LEVELS.filter((l) => l.keepStep === true).map((l) => l.id);
    expect(keep, '声明 keepStep 的关卡不是 T10/T11').toEqual(['T10', 'T11']);
  });

  it('两个新动作 kind（advance / resolve-trigger）都转给了 `driver.submit`', () => {
    const body = bodyOf(SCREEN, 'tutorialCallbacks');
    expect(body, "advance 没有转给 driver（T10 的「下一步」点了没反应）")
      .toMatch(/a\.kind === 'advance'[\s\S]{0,900}?kind: 'advance'/);
    expect(body, "resolve-trigger 没有转给 driver（T11 的「结算触发」点了没反应）")
      .toMatch(/a\.kind === 'resolve-trigger'[\s\S]{0,900}?kind: 'resolve-trigger'/);
    // 白名单：需要它的正是 T10（控制权判定）与 T11（推进到结束阶段）
    expect(TUT_LEVELS.filter((l) => l.allowKinds.includes('advance')).map((l) => l.id),
      '放行 advance 的关卡变了').toEqual(['T10', 'T11']);
    expect(TUT_LEVELS.filter((l) => l.allowKinds.includes('resolve-trigger')).map((l) => l.id)).toEqual(['T11']);
  });

  it('后四关的提示区读数与判据同源（`triggersSeen` / `getLineValue` / 纯状态）', () => {
    const body = bodyOf(SCREEN, 'renderPanel');
    expect(body, '屏上没有用 triggersSeen 给 T11 的读数').toContain('triggersSeen(state.log)');
    expect(body, 'T12 的加成读数没有用引擎的 getLineValue（自己重算就是第二份真相）')
      .toMatch(/getLineValue\(state, 0, 1\)/);
    // 四条提示键都逐字写在这里（缺键扫描腿也看得见）
    for (const k of [
      'tutorial.T10.hint.go', 'tutorial.T11.hint.done',
      'tutorial.T12.hint.done', 'tutorial.T13.hint.compile',
    ]) {
      expect(body, `renderPanel 里没有 ${k}`).toContain(`t('${k}')`);
    }
  });
});

describe('★ 版式（源码腿）：浮层不挡住棋盘、类名不打架', () => {  it('`.tutorial-overlay` **不吃点击**（教学要玩家去操作棋盘）', () => {
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

/**
 * ★ 2026-10-02（**用户当天报的视觉缺陷**）：T0 的四个热点"搞错了 + 粘在上面"。
 *
 * 用户原话：「你看看教程页面的这个特效，是不是搞错了，另外这个特效也是**粘在上面**的」。
 * 原实现是一张写死**视口百分比**的 `SPOT_BOX` 表（`position: fixed` 浮层上的绝对定位）：
 *  1. 四个框与它们要标的元素（链路槽 / 协议卡 / 能量槽 / 控制组件）没有几何关系
 *     —— 实测 T0@1584×1305："控制权"那个框落在棋盘右下角，"链路"那个框压在协议格中段；
 *  2. 只在创建那一帧算一次 ⇒ 棋盘滚动、改窗口尺寸、整块缩放（触屏设备上
 *     `phone-landscape.ts` 给 `#app` 挂 `transform: scale(k)`）之后，四个框仍钉在视口原处。
 *
 * 下面五条腿：几何出处（实测矩形 + 纯函数）、跟随的三档触发、**反向**（不许再出现百分比）、
 * 以及"教学棋盘别带着首页那套内边距画"（那会让能量槽整块跑到视口外，"总值"没有可见目标）。
 * 真的几何读数在真机上另测（CDP：四个热点 rect 与目标 rect 逐边偏差 ≤ 0.02px，含 1280×900 /
 * 1920×940 / 1584×1305 三档换窗与滚动 400px 之后）。
 */
describe('★ T0 四个热点：几何量出来 + 跟着棋盘（用户 2026-10-02 报的缺陷）', () => {
  it('热点位置不再写视口百分比（反向腿：把百分比写回去 ⇒ 当场红）', () => {
    expect(SCREEN, '`SPOT_BOX` 那张百分比表又回来了').not.toContain('SPOT_BOX');
    expect(SCREEN, '还在往热点上写百分比').not.toMatch(/style\.(left|top|width|height)\s*=\s*[^;\n]*%/);
    // 正向锚点：几何必须从**实测矩形**出发（否则上面那条"不含百分比"可以靠"什么都不写"满足）
    expect(SCREEN, '没有量目标的实测矩形').toMatch(/getBoundingClientRect\s*\(/);
  });

  it('四个热点各自指向真元素：亮着框的链路槽 / 协议卡格 / 能量槽 / 控制组件', () => {
    const at = SCREEN.indexOf('const SPOT_TARGETS');
    expect(at, '找不到 SPOT_TARGETS').toBeGreaterThan(0);
    const block = SCREEN.slice(at, SCREEN.indexOf('};', at));
    expect(block, '链路热点没有指向链路槽').toContain("'.stack-slot.self'");
    expect(block, '协议热点没有指向协议格').toContain("'.protocol-cell'");
    expect(block, '总值热点没有指向能量槽').toContain("'.battery'");
    expect(block, '控制权热点没有指向控制组件').toContain("'.control-module'");
    // 并集 / 换算必须走那两个纯函数（另写一遍就是第二份几何真相）
    expect(SCREEN, '没有用并集纯函数').toMatch(/unionRect\(/);
    expect(SCREEN, '没有用换算纯函数').toMatch(/spotBoxStyle\(/);
  });

  it('跟随走既有注册表（`registerFollow`，与 C4 对比条同一条路）+ 三档触发都在', () => {
    expect(SCREEN, '热点层没有挂进跟随注册表').toMatch(/registerFollow\s*\(\s*spotLayer/);
    expect(SCREEN, "没有从既有跟随模块 import").toMatch(/from '\.\/fx-follow'/);
    // 触发档 ①：跟随管线本身由 render.ts 每帧 + main.ts 的滚动/缩放 rAF 驱动（不在本文件里）
    // 触发档 ②：内容尺寸自己变了（图片加载把棋盘撑高）——实测首帧 226.67/行 → 290/行
    expect(SCREEN, '没有盯内容尺寸变化（图片加载那一路会漏）').toMatch(/new ResizeObserver\(/);
    expect(SCREEN, '内容尺寸观察者没有真的盯上 #app（只 new 不 observe 等于没接）')
      .toMatch(/spotResize\?\.observe\(\s*root\s*\)/);
    // 触发档 ③：整块缩放/平移（fit 改写 <html> 的 --t39-*，不改布局盒 ⇒ ResizeObserver 看不见）
    expect(SCREEN, '没有盯 fit 缩放/平移').toMatch(/new MutationObserver\(/);
    expect(SCREEN, 'fit 观察者没有真的盯上 <html> 的 style/class（只 new 不 observe 等于没接）')
      .toMatch(/spotFitWatch\?\.observe\(\s*document\.documentElement\s*,\s*\{\s*attributes:\s*true\s*,\s*attributeFilter:\s*\[\s*'style'\s*,\s*'class'\s*\]\s*\}\s*\)/);
    // 两个观察者都要在退出时断开（否则退出教程之后还在盯）
    expect(SCREEN, '退出时没有断开内容尺寸观察者').toMatch(/spotResize\?\.disconnect\(\)/);
    expect(SCREEN, '退出时没有断开 fit 观察者').toMatch(/spotFitWatch\?\.disconnect\(\)/);
  });

  it('教学屏不留首页的 `screen-home`（否则能量槽整块在视口外，"总值"热点没有可见目标）', () => {
    expect(SCREEN, '没有摘掉首页那个类').toMatch(/classList\.remove\(\s*'screen-home'\s*\)/);
  });
});

describe('★ 热点几何的纯函数（真跑，不是文本腿）', () => {
  it('并集罩住每一个目标；空集与零面积 ⇒ null（调用方据此保持原位）', () => {
    const a = { left: 0, top: 145, right: 567, bottom: 435 };
    const b = { left: 0, top: 445, right: 567, bottom: 735 };
    const c = { left: 0, top: 745, right: 567, bottom: 1035 };
    expect(unionRect([a, b, c]), '三个链路槽的并集不对').toEqual({ left: 0, top: 145, right: 567, bottom: 1035 });
    expect(unionRect([]), '空集没有回 null').toBeNull();
    expect(unionRect([{ left: 5, top: 5, right: 5, bottom: 5 }]), '零面积（未布局/隐藏）没有回 null').toBeNull();
    // 反向：只取第一个（或只取"最后一个"）都必须红 —— 这条把"并集"与"挑一个"分开
    expect(unionRect([a, b, c])).not.toEqual(a);
  });

  it('换算成相对热点层的 px（两位小数；层有内边距/边框时也不会静默错位）', () => {
    const base = { left: 0, top: 0, right: 1584, bottom: 1305 };
    expect(spotBoxStyle({ left: 100, top: 157, right: 567, bottom: 1047 }, base))
      .toEqual({ left: '100.00px', top: '157.00px', width: '467.00px', height: '890.00px' });
    // 层自己偏了 12px（浮层一旦有内边距/边框），热点要跟着减掉
    const shifted = { left: 12, top: 12, right: 1596, bottom: 1317 };
    const shiftedStyle = spotBoxStyle({ left: 112, top: 169, right: 579, bottom: 1059 }, shifted);
    expect(shiftedStyle, '层偏移时不该回 null').not.toBeNull();
    expect(shiftedStyle?.left).toBe('100.00px');
    expect(spotBoxStyle(null, base), '无效盒子必须回 null（调用方保持原位）').toBeNull();
  });
});

/**
 * ★ 几何**行为腿**（`tests/ui/net-dom-stub` 的桩 DOM 真跑 `placeSpotBoxes`）。
 *
 * 为什么必须有：上面那两条是纯函数腿，"屏真的把实测矩形写进热点"这一层是**接线**，
 * 只有真跑一次才能证明（本仓没有 jsdom ⇒ 用桩；桩的边界见 `net-dom-stub.ts` 头注：
 * 矩形是**测试喂的常量**，不校验它与树的任何关系）。真浏览器里的读数另见 CDP。
 */
describe('★ 几何行为腿（桩 DOM 真跑 placeSpotBoxes）', () => {
  let restore: (() => void) | null = null;
  let body: StubNode;
  let layer: StubNode;
  const spots = new Map<TutSpot, StubNode>();

  beforeEach(() => {
    restore = installStubDom();
    body = document.body as unknown as StubNode;
    const el = (cls: string, rect: { left: number; top: number; width: number; height: number }): StubNode => {
      const n = makeStubEl('div');
      n.className = cls;
      setStubRectFor(n, rect);
      body.appendChild(n);
      return n;
    };
    // 三条自己侧的链路槽（与真机 1584×1305 的读数同形：x 100…567、行高 290、行距 300）
    el('stack-slot self', { left: 100, top: 157, width: 467, height: 290 });
    el('stack-slot self', { left: 100, top: 457, width: 467, height: 290 });
    el('stack-slot self', { left: 100, top: 757, width: 467, height: 290 });
    // 六格协议卡
    for (const top of [157, 457, 757]) {
      el('protocol-cell', { left: 577, top, width: 210, height: 290 });
      el('protocol-cell', { left: 797, top, width: 210, height: 290 });
    }
    // 自己侧三个能量槽（另外一侧刻意放一个更靠右的，验证"只取亮着框那一侧"）
    el('battery', { left: -18, top: 165, width: 92, height: 274 });
    el('battery', { left: -18, top: 465, width: 92, height: 274 });
    el('battery', { left: -18, top: 765, width: 92, height: 274 });
    el('battery', { left: 1511, top: 164, width: 92, height: 276 });
    const mod = el('control-module', { left: 512, top: 14, width: 560, height: 127 });
    mod.classList.add('neutral');
    layer = el('tutorial-spots', { left: 0, top: 0, width: 1584, height: 1305 });
    for (const spot of ['link', 'protocol', 'threshold', 'control'] as TutSpot[]) {
      const n = makeStubEl('button');
      n.className = 'tutorial-spot';
      n.dataset.spot = spot;
      layer.appendChild(n);
      spots.set(spot, n);
    }
    // 自己侧能量槽/链路槽要带上 data-player（`spotNodes` 按它挑"亮着框那一侧"）
    for (const n of body.children) if (n.classList.contains('battery')) n.dataset.player = n.dataset.player ?? '0';
    for (const n of body.children) if (n.classList.contains('stack-slot')) n.dataset.player = '0';
    // 右侧那个能量槽属于对手
    const bats = body.children.filter((n) => n.classList.contains('battery'));
    bats[bats.length - 1].dataset.player = '1';
  });

  afterEach(() => { restore?.(); restore = null; spots.clear(); });

  /** 把热点写出来的内联 px 读成四个数（缺一个就当 NaN，测试里立刻炸出来）。 */
  const box = (spot: TutSpot): [number, number, number, number] => {
    const s = spots.get(spot)!.style as Record<string, string>;
    return [Number.parseFloat(s.left), Number.parseFloat(s.top), Number.parseFloat(s.width), Number.parseFloat(s.height)];
  };

  it('四个热点分别落在各自目标的并集上（逐边偏差 ≤ 0.02px）', () => {
    placeSpotBoxes(layer as unknown as HTMLElement, spots as unknown as Map<TutSpot, HTMLElement>);
    expect(box('link'), '链路热点没有罩住三个链路槽的并集').toEqual([100, 157, 467, 890]);
    expect(box('protocol'), '协议热点没有罩住六格协议卡的并集').toEqual([577, 157, 430, 890]);
    // 只取自己侧（−18…74）：把对手侧那个也算进来会让框横跨整块棋盘、压住另外两个热点
    expect(box('threshold'), '总值热点没有只取亮着框那一侧的能量槽').toEqual([-18, 165, 92, 874]);
    expect(box('control'), '控制权热点没有罩住控制组件').toEqual([512, 14, 560, 127]);
  });

  it('目标整体平移 ⇒ 热点跟着平移同一个量（"不粘在屏幕上"的机检形态）', () => {
    placeSpotBoxes(layer as unknown as HTMLElement, spots as unknown as Map<TutSpot, HTMLElement>);
    const before = box('link');
    // 模拟"棋盘被滚动/缩放了"：所有目标的矩形一起平移（真实浏览器里就是 getBoundingClientRect
    // 读数的整体变化 —— 跟随管线每帧重跑这一段，所以热点必须跟着走）
    const dx = 37;
    const dy = -220;
    for (const n of body.children) {
      const r = (n as unknown as { getBoundingClientRect(): { left: number; top: number; width: number; height: number } }).getBoundingClientRect();
      if (n.classList.contains('stack-slot') || n.classList.contains('protocol-cell')
        || n.classList.contains('battery') || n.classList.contains('control-module')) {
        setStubRectFor(n, { left: r.left + dx, top: r.top + dy, width: r.width, height: r.height });
      }
    }
    placeSpotBoxes(layer as unknown as HTMLElement, spots as unknown as Map<TutSpot, HTMLElement>);
    const after = box('link');
    expect([after[0] - before[0], after[1] - before[1]], '热点没有跟着目标平移同一个量')
      .toEqual([dx, dy]);
    expect(after[2], '平移不该改变宽高').toBe(before[2]);
  });

  it('目标取不到（重画中途 / 这一族元素不在）⇒ 保持上一次的位置，不清零', () => {
    placeSpotBoxes(layer as unknown as HTMLElement, spots as unknown as Map<TutSpot, HTMLElement>);
    const before = box('control');
    // 把控制组件从树里摘掉（重画中途就是这种状态）：桩的 `remove()` 真的会从父节点摘掉自己。
    // ⚠️ 强转形状与 `tests/ui/net-conn-line.test.ts:281` 同款（桩的 `remove` 在接口上是 `unknown`）。
    const mod = body.children.find((n) => n.classList.contains('control-module'))!;
    (mod as unknown as { remove(): void }).remove();
    expect(body.children.includes(mod), '桩的 remove() 没把它摘下来 ⇒ 这条腿会假绿').toBe(false);
    placeSpotBoxes(layer as unknown as HTMLElement, spots as unknown as Map<TutSpot, HTMLElement>);
    expect(box('control'), '目标没了就把热点清零/跳到左上角了').toEqual(before);
  });
});

/**
 * ★ 2026-10-06（**用户当天报的缺陷**）：「别总是在每一次阶段中间都显示名为「下一步」的按钮，
 * 虽然按不了，但是会让玩家觉得困惑，由于这个是测试时才会用到的按钮，所以不要暴露给玩家」。
 *
 * 这一组同时给两层证据：
 *  1. **真跑的行为腿**（桩 DOM）：`applyNextButtonVisibility()` 在"不放行 advance"的关卡上
 *     真的把那颗按钮藏了、在放行的关卡上原样留着，而且**只藏按钮本身**（那句手牌提示还在）；
 *  2. **源码腿**：屏在每次 `paint()` 之后都做这一手、判据取自本关的 `allowKinds`。
 */
describe('★ 2026-10-06：棋盘的「下一步」不该露给玩家（.next-btn）', () => {
  let restore: (() => void) | null = null;
  beforeEach(() => { restore = installStubDom(); });
  afterEach(() => { restore?.(); restore = null; });

  /** 造一棵 `.action-bar > .next-block > (.hint + button.next-btn)` 的桩树 */
  function nextBlockTree(): { root: StubNode; block: StubNode; hint: StubNode; btn: StubNode } {
    const root = makeStubEl('div');
    const bar = makeStubEl('div');
    bar.className = 'action-bar';
    const block = makeStubEl('div');
    block.className = 'next-block';
    const hint = makeStubEl('span');
    hint.className = 'hint';
    hint.textContent = '拖一张牌到亮着的链路';
    const btn = makeStubEl('button');
    btn.className = 'btn next-btn';
    btn.textContent = '下一步';
    block.appendChild(hint);
    block.appendChild(btn);
    bar.appendChild(block);
    root.appendChild(bar);
    return { root, block, hint, btn };
  }
  const displayOf = (n: StubNode): unknown => (n.style as Record<string, unknown>).display;

  it('★ 真跑：不放行 advance ⇒ 按钮被藏；放行 ⇒ 原样（且只藏按钮，不碰那块与那句提示）', () => {
    const off = nextBlockTree();
    applyNextButtonVisibility(off.root as unknown as ParentNode, false);
    expect(displayOf(off.btn), '不放行 advance 的关卡上那颗「下一步」没被藏掉').toBe('none');
    expect(displayOf(off.hint), '把同一块里的手牌提示也藏了（只该藏按钮本身）').toBeUndefined();
    expect(displayOf(off.block), '把整块 .next-block 都藏了').toBeUndefined();
    expect(off.block.children.includes(off.btn), '按钮被摘出树了（只该藏，不该摘）').toBe(true);

    const on = nextBlockTree();
    applyNextButtonVisibility(on.root as unknown as ParentNode, true);
    expect(displayOf(on.btn), '放行 advance 的关卡（T10/T11）上那颗按钮被藏了').toBeUndefined();
  });

  it('★ 真跑：逐关按白名单过一遍 —— 藏/露与 `allowKinds.includes(\'advance\')` 完全一致', () => {
    const shown: string[] = [];
    for (const l of TUT_LEVELS) {
      const t = nextBlockTree();
      applyNextButtonVisibility(t.root as unknown as ParentNode, l.allowKinds.includes('advance'));
      const visible = displayOf(t.btn) === undefined;
      expect(visible, `${l.id} 的 .next-btn 可见性与 allowKinds 不一致`).toBe(l.allowKinds.includes('advance'));
      if (visible) shown.push(l.id);
    }
    // 锚点：只有真的要用它的两关露出来（否则上面那条可以在"全藏"上恒真）
    expect(shown, '会露出「下一步」的关卡不是 T10/T11').toEqual(['T10', 'T11']);
  });

  it('源码腿：每次 `paint()` 之后都按本关白名单做这一手（换关/动作后/切语言都覆盖）', () => {
    const paintBody = bodyOf(SCREEN, 'paint');
    expect(paintBody, 'paint() 里没有 renderApp').toContain('renderApp(');
    expect(paintBody, 'paint() 之后没有做「下一步」的可见性收尾（重画就把按钮带回来了）')
      .toContain('hideNextButton()');
    const hideBody = bodyOf(SCREEN, 'hideNextButton');
    expect(hideBody, 'hideNextButton 没有按本关白名单判').toMatch(/allowKinds\.includes\(\s*'advance'\s*\)/);
    expect(hideBody, 'hideNextButton 没有走那个可被真跑的导出函数').toContain('applyNextButtonVisibility(');
    // 反向锚点：那颗按钮的类名来自红线（render.ts:5416），屏这一侧只读它、不改它
    const impl = bodyOf(SCREEN, 'applyNextButtonVisibility');
    expect(impl, '没有按 `.next-btn` 这个既有类名定位那颗按钮').toContain(".next-btn");
    expect(impl, '没有把它藏掉').toMatch(/style\.display\s*=\s*'none'/);
    expect(impl, '放行时不该动它').toMatch(/if\s*\(\s*allowAdvance\s*\)\s*return/);
    expect(SCREEN, '屏里出现了对 render.ts 的内部改写（红线）').not.toContain('next-btn.addEventListener');
  });
});

/**
 * ★ 2026-10-06：**序章 S0 在屏上的接线**（源码腿 —— 无 jsdom，`mountTutorial` 跑不起来）。
 *
 * 三条都是"漏了就没有人发现"的地方：
 *  1. 打完那张补分的牌之后要把步交回 `check-compile`（引擎的真实编译判定那一步），
 *     否则玩家补到 10 分之后**没有任何按钮**可点；
 *  2. 赢下之后那一帧要**停一会儿**再换关（否则玩家一帧都看不到"赢"）；
 *  3. 换关之前要把 render.ts 挂出来的胜利横幅收掉（它压在下一关 T0 要玩家点的那一片上）。
 */
describe('★ S0（序章）的屏上接线（源码腿）', () => {
  it('打完牌之后把步交回 check-compile（`toCompileStepAfterPlay` 那条规则）', () => {
    const body = bodyOf(SCREEN, 'handBackTurn');
    expect(body, 'handBackTurn 没有读 toCompileStepAfterPlay ⇒ 补到 10 分之后玩家没有可点的按钮')
      .toMatch(/currentLevel\(\)\.toCompileStepAfterPlay\s*===\s*true/);
    expect(body, "没有把 step 摆回 'check-compile'").toMatch(/state\.step\s*=\s*'check-compile'/);
    // 数据层：只有序章声明它（别的关卡的时序一个字不动）
    expect(TUT_LEVELS.filter((l) => l.toCompileStepAfterPlay === true).map((l) => l.id)).toEqual(['S0']);
    // 提示区：等引擎真的要求编译那一步时，复用 T13 那条"点线 3 的编译"文案给玩家指路
    const panel = bodyOf(SCREEN, 'renderPanel');
    expect(panel, 'S0 在 check-compile 那一步没有给"点编译"的提示（定稿没有这一步的文案，复用 T13 那条）')
      .toMatch(/level\.id === 'S0'[\s\S]{0,120}?state\.step === 'check-compile'[\s\S]{0,120}?t\('tutorial\.T13\.hint\.compile'\)/);
  });

  it('★ 2026-10-07（用户要求）：「建议 67%」那句只在序章 S0 的面板上，且复用模式页那条文案', () => {
    // ① **真跑**判据本身（纯函数）：只有第一关为真，其余每一关都是假
    expect(showsZoomHint('S0'), '序章 S0 上不显示那句缩放提示').toBe(true);
    expect(TUT_LEVELS.filter((l) => showsZoomHint(l.id)).map((l) => l.id),
      '显示缩放提示的关卡不止第一关（或不止一关）').toEqual(['S0']);
    for (const l of TUT_LEVELS) {
      if (l.id !== 'S0') expect(showsZoomHint(l.id), `${l.id} 上也显示缩放提示`).toBe(false);
    }
    // ② 接线（源码腿）：面板按它切换，而且真的造了那个节点
    expect(SCREEN, '面板里没有造 `.tutorial-zoom-hint` 那个节点')
      .toMatch(/el\('p',\s*'tutorial-zoom-hint'\)/);
    const panel = bodyOf(SCREEN, 'renderPanel');
    expect(panel, '面板没走那个纯判据（判据分叉成第二处了）').toMatch(/showsZoomHint\(level\.id\)/);
    expect(panel, '缩放提示没有按判据隐藏').toMatch(/zoomHint\.hidden\s*=\s*!isFirstLevel/);
    // ③ 措辞复用模式页那一条（改一处三处同步，不新写第二份）
    expect(panel, '缩放提示没走 `mode.zoom-hint` 那条共享文案')
      .toMatch(/zoomHint\.textContent\s*=\s*t\('mode\.zoom-hint'\)/);
    expect(SCREEN, '教学屏里手写了第二份 67% 文案（应当复用 `mode.zoom-hint`）').not.toMatch(/67%/);
    // ④ 文案本身 = 用户 2026-10-07 给的那句（中英都在，且都点名滚轮）
    expect(ZH['mode.zoom-hint'], '中文那句不是用户给的措辞').toContain('67%');
    expect(ZH['mode.zoom-hint'], '中文那句没点名鼠标滚轮').toContain('鼠标滚轮');
    expect(EN['mode.zoom-hint'], '英文那句没跟着统一').toContain('mouse wheel');
    // ⑤ 版式：那一行有样式（没有样式它就是贴着面板边缘的一段裸文本）
    expect(CSS, '缺 `.tutorial-zoom-hint` 的样式').toMatch(/\.tutorial-zoom-hint\s*\{[^}]*font-size/);
  });

  it('★ handBackTurn 必须**无条件**交还 action 步（多动作关卡全靠它）', () => {
    const body = bodyOf(SCREEN, 'handBackTurn');
    // 反向：不许再有 `if (state.turnPlayer !== 0) { … step = 'action' }` 那个 guard
    expect(body, 'handBackTurn 又把"交还 action 步"关回 `turnPlayer !== 0` 里了 ⇒ T3/T4/T7/T9/T12 做完第一个动作就再也出不了第二张牌')
      .not.toMatch(/turnPlayer\s*!==\s*0\s*\)\s*\{[\s\S]{0,120}?step\s*=\s*'action'/);
    expect(body, "没有无条件写 state.step = 'action'").toMatch(/state\.step\s*=\s*'action'/);
    expect(body, '没有无条件写 turnPlayer = 0').toMatch(/state\.turnPlayer\s*=\s*0/);
    // 例外只有两处：S0 那一支（更早 return）与 keepStep（T10/T11）
    const iS0 = body.indexOf('toCompileStepAfterPlay');
    const iKeep = body.indexOf('keepStep');
    const iAction = body.indexOf("state.step = 'action'");
    expect(iS0, 'toCompileStepAfterPlay 那一支不在前面').toBeLessThan(iKeep);
    expect(iKeep, 'keepStep 的早退排在"交还 action 步"之后').toBeLessThan(iAction);
  });

  it('赢下之后换关前收掉 render.ts 的胜利横幅（S0 的 2.2 秒专属停留已并进统一倒计时）', () => {
    const body = bodyOf(SCREEN, 'judgeAndAdvance');
    expect(body, '判过关之后没有起那套统一倒计时').toContain('startLevelCountdown()');
    /**
     * ★ 反向（2026-10-06 用户第二次口径）：S0 那 2.2 秒的**专属**停留已经并进统一倒计时
     * ——「每一关完成后中间都要有5秒倒计时」⇒ 常量 `S0_WIN_HOLD_MS` 不该再存在。
     */
    expect(SCREEN, 'S0 的专属停留常量又回来了（用户要求所有关卡统一走 5 秒倒计时）')
      .not.toContain('S0_WIN_HOLD_MS');
    const goto = bodyOf(SCREEN, 'gotoNextLevel');
    expect(goto, '换关前没有收胜利横幅（它会压在下一关 T0 要玩家点的那一片上）').toContain('dismissWinBanner()');
    expect(goto, '换关没有推进 levelId').toMatch(/levelAt\(levelIndex\(levelId\)\s*\+\s*1\)/);
    const dismiss = bodyOf(SCREEN, 'dismissWinBanner');
    expect(dismiss, '没有走 render.ts 自己那颗「返回主界面」').toContain('.win-confirm-btn');
    // 定时器要能被收掉（退出教程 / 重开这一关都经 clearCountdown）
    expect(bodyOf(SCREEN, 'clearCountdown'), '没有清掉那个倒计时定时器').toMatch(/clearTimeout\(nextLevelTimer\)/);
    expect(bodyOf(SCREEN, 'openLevel'), '重开这一关时没有作废那个倒计时').toContain('clearCountdown()');
  });

  it('chip 显示的是 1 起的序号，id 留在 dataset.level（S0 插进来不会排出「S0 T0 …」）', () => {
    const body = bodyOf(SCREEN, 'renderPanel');
    expect(body, 'chip 的文本又写回关卡 id 了（屏上会出现 S0 T0 T1… 的混排）')
      .not.toMatch(/el\(\s*'span'\s*,\s*'tutorial-chip'\s*,\s*l\.id\s*\)/);
    expect(body, 'chip 的文本不是 1 起的序号').toMatch(/tutorial-chip'\s*,\s*String\(levelIndex\(l\.id\)\s*\+\s*1\)/);
    expect(body, 'chip 上没有留 dataset.level（既有探针读的就是它）').toContain('chip.dataset.level = l.id');
  });
});

/**
 * ★ 2026-10-06（**用户当天要求**）：「我希望点击已解锁关卡下方的小数字能够跳到对应的关卡并重新游玩该关卡」。
 *
 * 这一组给三层证据：
 *  1. **真跑的行为腿**（纯函数）：解锁口径与"点了去哪一关"在全部 15 关上逐关过一遍；
 *  2. **真跑的结构腿**（桩 DOM）：按那条判据造出 chip，逐关断言 `disabled` / 类名 / `aria-*`；
 *  3. **源码腿**：屏在 `renderPanel` 里真的按那条判据造 `<button>`，点了真的走 `restartLevel()`
 *     （那一支与面板上的「重开这一关」**共用**同一个函数），而且**不写进度**。
 *
 * ⚠️ 点下去那一下（`restartLevel` 真的换关并重建局面）在无 jsdom 的 node 下**跑不到**
 * （`mountTutorial` 一上来就 `document.createElement` + `renderApp`）⇒ 那一半只到源码腿。
 */
describe('★ 2026-10-06：已解锁关卡的 chip 可点（跳回那一关重玩）', () => {
  const ALL = TUT_LEVELS.map((l) => l.id);

  it('★ 真跑：解锁口径 = 到过的最远处以及它之前的每一关（`done` 里最大的下一关 ∪ 当前这一关）', () => {
    // 一份真实进度：过完 S0/T0、当前在 T1
    const done = ['S0', 'T0'];
    const current = 'T1';
    const clickable = ALL.filter((id) => chipJumpTarget(id, current, done, ALL) !== null);
    expect(clickable, '可点的 chip 不是「done + 当前这一关」').toEqual(['S0', 'T0', 'T1']);
    for (const id of clickable) {
      expect(chipJumpTarget(id, current, done, ALL), `${id} 点了没跳到它自己那一关`).toBe(id);
    }
    // 反向：还没学到的那些（T2 起）一枚都不许可点
    for (const id of ALL.filter((x) => !clickable.includes(x))) {
      expect(chipJumpTarget(id, current, done, ALL), `${id} 还没过却是可点的（点进去等于跳课）`).toBeNull();
    }
    // 换个进度：过到哪就解锁到哪（同一条规则，不是给某个 id 开的后门）
    const done2 = ['S0', 'T0', 'T1', 'T2'];
    expect(ALL.filter((id) => chipJumpTarget(id, 'T3', done2, ALL) !== null), '进度往前挪之后解锁面没跟着走')
      .toEqual(['S0', 'T0', 'T1', 'T2', 'T3']);
  });

  /**
   * ★★ 2026-10-06（**用户当天报的缺陷**）：「当我已经解锁了下一关并自动跳到下一关之后，我点击
   * 下方的数字回到上一关，下一关的跳转按钮会变灰并且无法跳回去，从第一关重来的按钮也会这样，
   * 请修复」。
   *
   * ## 复现与定性（下表就是实测读数）
   *
   * 变灰的是**那排数字 chip**（`.tutorial-chip-locked` + `disabled`，`styles-local.css:853`
   * 的 `opacity: .45` + `cursor: not-allowed`）—— 面板上 `restartLevelBtn` / `restartAllBtn`
   * 在代码里**从来没有**被 `disabled`（全文件只有 chip 那一处写 `chip.disabled = true`）。
   *
   * 根因是**解锁口径写窄了**：旧口径 `done ∪ {当前这一关}`。而"自动跳到下一关"的那个下一关
   * **还没进 `done`**（过完才写），一旦玩家点数字跳回上一关，`current` 就变小 ⇒ 那一关**两头
   * 都不占** ⇒ 当场锁上。读数（下面第一条腿逐字钉住这个形态）。
   */
  it('★ 复现读数（旧口径）：跳回上一关之后，自动跳过去的那一关被锁（用户看到的那一幕）', () => {
    const doneUpToT7: string[] = ALL.slice(0, ALL.indexOf('T7') + 1); // 过到 T7、当前在 T8
    // 旧口径（`done ∪ {当前这一关}`）逐字照抄，用来证明"这一条腿不是空的"
    const oldRule = (clicked: string, current: string): boolean =>
      doneUpToT7.includes(clicked) || clicked === current;
    expect(oldRule('T8', 'T7'), '复现失败：旧口径在"跳回 T7"之后居然还让 T8 可点').toBe(false);
    // 新口径：T8 是"最后过掉那关的下一关" ⇒ 仍然可点（不许回到"跳过去就回不来"）
    expect(chipJumpTarget('T8', 'T7', doneUpToT7, ALL), '跳回去之后下一关还锁着（用户报的缺陷）').toBe('T8');
    // ★ 用户第二半句「从第一关重来的按钮也会这样」：老进度里 `S0` 可能不在 `done`（序章是后插进来的）
    const legacy = ALL.slice(1, ALL.indexOf('T7') + 1); // 老进度：done = T0..T7，没有 S0
    expect(legacy.includes('S0'), '这份夹具的前提错了（它本来就不该含 S0）').toBe(false);
    expect(chipJumpTarget('S0', 'T7', legacy, ALL), '第一枚 chip（从第一关重来）在老进度里被锁着').toBe('S0');
  });

  it('★ 不许放宽成恒真：到过的最远处**之后**仍然一枚都不可点', () => {
    const doneUpToT7 = ALL.slice(0, ALL.indexOf('T7') + 1);
    // done 过到 T7 ⇒ 最远到 T8（下一关），T9 起全是锁的
    expect(ALL.filter((id) => chipJumpTarget(id, 'T7', doneUpToT7, ALL) !== null))
      .toEqual([...doneUpToT7, 'T8']);
    for (const id of ALL.slice(ALL.indexOf('T9'))) {
      expect(chipJumpTarget(id, 'T7', doneUpToT7, ALL), `${id} 还没到却是可点的（跳课）`).toBeNull();
    }
    // 空进度（没玩过）：只有第一关可点
    expect(ALL.filter((id) => chipJumpTarget(id, ALL[0], [], ALL) !== null), '空进度下不止第一关可点').toEqual([ALL[0]]);
  });

  it('★ 真跑：当前这一关自己也可点（与「重开这一关」同一件事），且未知 id 回 null', () => {
    expect(chipJumpTarget('T7', 'T7', [], ALL), '当前这一关自己不可点（那枚「重开这一关」就在旁边）').toBe('T7');
    // 反向：表里没有的 id（坏 dataset / 幽灵关）不许被当成可点
    expect(chipJumpTarget('TX', 'T7', ['TX'], ALL), '不在关卡表里的 id 被当成可点了').toBeNull();
    // 反向：`done` 里的幽灵 id 不许把解锁面往前推
    expect(chipJumpTarget('T2', 'T1', ['TX'], ALL), '幽灵 id 把 T2 也解锁了').toBeNull();
  });

  it('★ 真跑（桩 DOM）：逐关造出 chip —— `disabled` / `.tutorial-chip-locked` / `aria-*` 与判据逐关一致', () => {
    const restore = installStubDom();
    try {
      const done = ['S0', 'T0'];
      const current = 'T1';
      const row = makeStubEl('div');
      for (const id of ALL) {
        const a11y = chipA11y(id, current, done, ALL);
        const to = chipJumpTarget(id, current, done, ALL);
        // 与 `renderPanel` 里那几行同款（attribute 名逐字抄自产出代码，免得两处漂）
        const chip = makeStubEl('button');
        chip.className = 'tutorial-chip';
        chip.textContent = String(ALL.indexOf(id) + 1);
        chip.dataset.level = id;
        if (!a11y.enabled) {
          (chip as unknown as { disabled: boolean }).disabled = true;
          chip.classList.add('tutorial-chip-locked');
        }
        if (a11y.done) chip.classList.add('on');
        if (a11y.current) chip.classList.add('now');
        // ⚠️ 桩的 `StubNode` 接口**没有**声明 `setAttribute`（它只在索引签名里，测试侧读到的是
        //    `unknown`）—— 这里显式收窄一次，与 `tests/ui/pool-picker.test.ts:85` 的读法是同一族。
        const attrs = chip as unknown as { setAttribute(k: string, v: string): void };
        if (a11y.current) attrs.setAttribute('aria-current', 'true');
        if (to !== null) attrs.setAttribute('title', 'replay');
        row.appendChild(chip);
      }
      const chips = queryAllIn(row, 'button.tutorial-chip');
      expect(chips.length, `chip 不是 ${ALL.length} 枚（关卡数改了但这里没跟着走）`).toBe(ALL.length);
      for (const chip of chips) {
        const id = chip.dataset.level ?? '';
        const enabled = (chip as unknown as { disabled?: boolean }).disabled !== true;
        const expected = id === 'S0' || id === 'T0' || id === 'T1';
        expect(enabled, `${id} 的可点状态与解锁口径不一致`).toBe(expected);
        expect(isClass(chip, 'tutorial-chip-locked'), `${id} 的压暗类与可点状态不一致`).toBe(!expected);
        // 已完成 / 当前这两档的标注（`aria-current` 的取值照本仓既有写法用 'true'）
        expect(isClass(chip, 'on'), `${id} 的已完成类不对`).toBe(done.includes(id));
        expect(isClass(chip, 'now'), `${id} 的当前关类不对`).toBe(id === 'T1');
        const current标记 = (chip as unknown as { getAttribute(k: string): string | null }).getAttribute('aria-current');
        expect(current标记, `${id} 的 aria-current 不对`).toBe(id === 'T1' ? 'true' : null);
      }
    } finally {
      restore();
    }
  });

  it('源码腿：chip 是 `<button>`（键盘可达）、按 `chipJumpTarget()` 判、不可点的 `disabled` + 压暗类', () => {
    const body = bodyOf(SCREEN, 'renderPanel');
    expect(body, 'chip 还是只能看的 `<span>`（用户要的是能点）').not.toContain("el('span', 'tutorial-chip'");
    expect(body, 'chip 不是 `<button>`（`<button>` 天然键盘可达）').toContain("button('tutorial-chip'");
    expect(body, 'chip 没按解锁口径判').toContain('chipJumpTarget(');
    expect(body, '不可点的 chip 没有 disabled').toMatch(/chip\.disabled\s*=\s*true/);
    expect(body, '不可点的 chip 没有压暗类').toContain("classList.add('tutorial-chip-locked')");
    expect(body, '当前这一关没有 aria-current').toMatch(/setAttribute\(\s*'aria-current'/);
    expect(body, '已完成的 chip 没有 aria-label').toMatch(/setAttribute\(\s*'aria-label'/);
    // 解锁口径的唯一出处就在 `chipJumpTarget` / `chipFrontier` 里，屏上不许再写第二份
    const fn = bodyOf(SCREEN, 'chipJumpTarget');
    expect(fn, '解锁口径没判 all 里的成员资格').toContain('all.includes(clicked)');
    expect(fn, '解锁口径没走那个"到过的最远处"').toContain('chipFrontier(');
    expect(fn, '没过的关卡也被放行了').toMatch(/return\s+unlocked\s*\?\s*clicked\s*:\s*null/);
    const frontier = bodyOf(SCREEN, 'chipFrontier');
    expect(frontier, '最远处没算"最后过掉那关的下一关"（跳回去之后下一关会锁上 = 用户报的缺陷）')
      .toMatch(/all\.indexOf\(id\)\s*\+\s*1/);
    expect(frontier, '最远处没和"当前这一关"取较远者').toMatch(/Math\.max\(/);
    // `chipA11y` 直接复用同一处结论（`disabled` 与 title 不可能各判各的）
    expect(bodyOf(SCREEN, 'chipA11y'), 'chipA11y 自己又写了一份解锁判据').toContain('chipJumpTarget(');
  });

  it('源码腿：点击走 `restartLevel()`，与「重开这一关」**共用**同一条路，且不写进度', () => {
    const panel = bodyOf(SCREEN, 'renderPanel');
    expect(panel, '点了 chip 没有跳关重玩').toMatch(/restartLevel\(\s*l\.id\s*\)/);
    const restart = bodyOf(SCREEN, 'restartLevel');
    expect(restart, 'restartLevel 没有真的换 levelId').toMatch(/levelId\s*=\s*id/);
    expect(restart, 'restartLevel 没有重建本关（判定状态也要清）').toContain('openLevel()');
    // ⚠️ 反向：它一个字都不许写进度（跳回去看一遍不改变 done / current）
    for (const forbidden of ['advance(', 'restart(', 'writeProgress(', 'nav.saveProgress(']) {
      expect(restart, `restartLevel 里出现了写进度的调用 ${forbidden}`).not.toContain(forbidden);
    }
    // 「重开这一关」那颗按钮走的是同一个函数（用户要求"同一条路"）
    const btn = SCREEN.slice(SCREEN.indexOf('tutorial-restart-level'), SCREEN.indexOf('tutorial-restart-level') + 400);
    expect(btn, '「重开这一关」没有走 restartLevel（两条路会漂）').toContain('restartLevel(levelId)');
  });

  it('文案腿：跳关那句提示与两枚 title 在中英两张表里都有（否则 chip 上没有可读的名字）', () => {
    for (const k of ['tutorial.chip.hint', 'tutorial.chip.title.replay', 'tutorial.chip.title.done']) {
      expect(ZH[k], `中文表里没有 ${k}`).toBeTruthy();
      expect(EN[k], `英文表里没有 ${k}`).toBeTruthy();
      expect(EN[k], `${k} 的英文值与中文逐字相同（等于没翻）`).not.toBe(ZH[k]);
    }
    // 占位符 {n} 一字不差（两枚 title 都要把序号带出来）
    expect(ZH['tutorial.chip.title.replay']).toContain('{n}');
    expect(EN['tutorial.chip.title.replay']).toContain('{n}');
    expect(ZH['tutorial.chip.title.done']).toContain('{n}');
    expect(EN['tutorial.chip.title.done']).toContain('{n}');
    // 过完关之后那句"可以点"的说明真的在提示区里（两条腿都写在这里，缺键扫描也看得见）
    expect(bodyOf(SCREEN, 'renderPanel'), '提示区里没有那句"数字可以点"').toContain("t('tutorial.chip.hint')");
  });
});

/**
 * ★ 2026-10-06（**用户当天要求**）：「每一关完成后中间都要有5秒倒计时自动进入下一关的效果，
 * 而不是直接进入下一关，第三关的10秒等待改为5秒」。
 *
 * 这一组给三层证据：
 *  1. **真跑的行为腿**：`countdownSecondsOf()` 从 5000 一路减下去就是 5/4/3/2/1；
 *     `countdownLabel()` 把 `{n}` 填成两张表里那两句；`countdownOverlayElement()` 在桩 DOM 上
 *     真的造出那一层（类名是这一族、初始藏着、读数挂在里面）。
 *  2. **源码腿**：5 这个数只定义一处；过关之后统一走 `startLevelCountdown()`；末关（T13）
 *     不倒计时；退出 / 重开本关 / chip 跳关 / 到点换关四处都清。
 *  3. **反向腿**：T1 那 10 秒与 S0 那 2.2 秒的专属常量、`holdUntilNext`、旧键
 *     `tutorial.zoom.hold` 都不许再出现。
 *
 * ⚠️ `mountTutorial` 那一层（定时器真的到点换关）在无 jsdom 的 node 下**跑不到** ——
 * 桩 DOM 里没有 `MutationObserver` / `ResizeObserver`（屏一上来就 `new`）⇒ 那半截只到源码腿，如实登记。
 */
describe('★ 2026-10-06：过关之后中间数 5 秒再进下一关（统一倒计时）', () => {
  it('★ 真跑：5 秒、一秒一格 —— 5000/4000/3000/2000/1000 ⇒ 5/4/3/2/1', () => {
    const seen: number[] = [];
    for (let left = LEVEL_CLEAR_COUNTDOWN_MS; left > 0; left -= COUNTDOWN_TICK_MS) {
      seen.push(countdownSecondsOf(left));
    }
    expect(seen, '倒计时读到的秒数不是 5→4→3→2→1').toEqual([5, 4, 3, 2, 1]);
    // 锚点：这几个数就是用户点名的那个常量算出来的（不是测试自己写死的一串）
    expect(LEVEL_CLEAR_COUNTDOWN_MS, '倒计时不是 5 秒').toBe(5000);
    expect(COUNTDOWN_TICK_MS, '倒计时不是一秒一跳').toBe(1000);
    // 反向：最后一帧不显示 0（到点那一帧由 gotoNextLevel 接手）
    expect(countdownSecondsOf(0), '到点那一帧显示了 0').toBe(1);
  });

  it('★ 真跑：浮层上那句读数走 i18n 键 `tutorial.countdown`（中英各一条，{n} 就是秒数）', () => {
    for (const ms of [5000, 4000, 3000, 2000, 1000]) {
      const n = String(countdownSecondsOf(ms));
      expect(countdownLabel(ms), `剩余 ${ms}ms 时那句读数不对`)
        .toBe(ZH['tutorial.countdown'].replace('{n}', n));
    }
    expect(ZH['tutorial.countdown'], '中文表里没有 tutorial.countdown').toBeTruthy();
    expect(EN['tutorial.countdown'], '英文表里没有 tutorial.countdown').toBeTruthy();
    expect(EN['tutorial.countdown'], '中英两条一样（等于没翻）').not.toBe(ZH['tutorial.countdown']);
    expect(ZH['tutorial.countdown'], '中文那条没有占位符 {n}').toContain('{n}');
    expect(EN['tutorial.countdown'], '英文那条没有占位符 {n}（两端要一致）').toContain('{n}');
    /**
     * ★ 反向：T1 那 10 秒的旧键 `tutorial.zoom.hold` **已经删掉**（用户把等待改成 5 秒）——
     * 留着既没人读（死键腿会红）也会让人以为"这 10 秒还在"。
     */
    expect(ZH['tutorial.zoom.hold'], '旧的 tutorial.zoom.hold 还在中文表里').toBeUndefined();
    expect(EN['tutorial.zoom.hold'], '旧的 tutorial.zoom.hold 还在英文表里').toBeUndefined();
  });

  it('★ 真跑（桩 DOM）：倒计时浮层真的造出来了 —— 类名是这一族、初始藏着、读数挂在里面', () => {
    const restore = installStubDom();
    try {
      const { box, text } = countdownOverlayElement();
      expect(box.className, '浮层的类名不是 .tutorial-countdown').toContain('tutorial-countdown');
      expect(text.className, '读数那一条的类名不是 .tutorial-countdown-text').toContain('tutorial-countdown-text');
      expect((box as unknown as { hidden?: boolean }).hidden, '浮层不是初始藏着的（一进关就压在棋盘中上').toBe(true);
      expect(Array.from(box.children).includes(text), '读数没有挂在浮层里（那层就是个空壳）').toBe(true);
      // 反向：它**不是** `.tutorial-overlay` 那一族（倒计时单开一层，别跟热点层搅在一起）
      expect(box.className, '倒计时层与教学主浮层混在一层里了').not.toContain('tutorial-overlay');
    } finally {
      restore();
    }
  });

  it('源码腿：`.tutorial-countdown` 不吃点击、压得住胜利横幅、`[hidden]` 有显式兜底', () => {
    const at = CSS.indexOf('.tutorial-countdown {');
    expect(at, 'styles-local.css 里没有 .tutorial-countdown').toBeGreaterThan(0);
    const block = CSS.slice(at, CSS.indexOf('}', at));
    expect(block, '倒计时浮层没有 pointer-events: none ⇒ 这 5 秒里点不动 chip / 退出')
      .toMatch(/pointer-events:\s*none/);
    expect(block, '倒计时浮层不是 fixed 定位').toMatch(/position:\s*fixed/);
    // S0 打赢那一局的胜利横幅是 z-index:10000，倒计时要在它上面（否则被压住半截）
    expect(block, '倒计时浮层没有压在胜利横幅（10000）之上').toMatch(/z-index:\s*1[1-9]\d\d\d/);
    // 本仓栽过两次"作者样式压掉 hidden"：这一层自己是 display:flex，必须显式兜底
    expect(CSS, '缺这条兜底规则 ⇒ 倒计时收起来之后真浏览器里还占着位置')
      .toMatch(/\.tutorial-countdown\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  it('源码腿：5 这个数只定义一处、过关之后走的就是它（末关 T13 除外）', () => {
    expect(SCREEN, '没有那条"5 秒"的常量').toContain('const LEVEL_CLEAR_COUNTDOWN_MS = 5000;');
    expect(SCREEN.match(/LEVEL_CLEAR_COUNTDOWN_MS\s*=/g)?.length, '5 这个数被定义/赋值了不止一处').toBe(1);
    /**
     * 注释里写清这个数的出处（用户原话）。
     * ⚠️ 判据面必须用**原文**：`SCREEN` 是 `stripComments()` 过的（注释整段被抹掉），
     * 拿它查注释等于查一个空集。
     */
    const screenRaw = readFileSync(`${REPO}src/ui/tutorial-screen.ts`).subarray(0, 1_048_576).toString('utf8');
    const at = screenRaw.indexOf('const LEVEL_CLEAR_COUNTDOWN_MS');
    expect(at, '找不到那条倒计时常量').toBeGreaterThan(0);
    expect(screenRaw.slice(Math.max(0, at - 1600), at), '倒计时没有写清理由（用户原话）')
      .toContain('每一关完成后中间都要有5秒倒计时自动进入下一关的效果');

    const body = bodyOf(SCREEN, 'judgeAndAdvance');
    expect(body, '过关之后没有起倒计时').toContain('startLevelCountdown()');
    // ★ 末关例外：那句"所有关卡都过了"的早退必须**排在起倒计时之前**（T13 没有下一关）
    const iAll = body.indexOf('cleared-all');
    expect(iAll, '末关那句收尾不在 judgeAndAdvance 里').toBeGreaterThan(0);
    expect(iAll, '末关（T13）也会起倒计时 —— 它没有下一关').toBeLessThan(body.indexOf('startLevelCountdown()'));

    // ★ 反向：S0/T1 那两处旧停留的痕迹一个都不许留
    for (const gone of ['S0_WIN_HOLD_MS', 'T1_READ_HOLD_MS', 'holdUntilNext', 'tutorial.zoom.hold']) {
      expect(SCREEN, `旧的"延后换关 / 读卡停留"痕迹 ${gone} 还在屏里`).not.toContain(gone);
    }
  });

  it('源码腿：只排一个定时器 + 四个入口都清掉它并把浮层摘掉', () => {
    const start = bodyOf(SCREEN, 'startLevelCountdown');
    expect(start, '没有"只排一个"的 guard（重复进判定会连跳两关）')
      .toMatch(/nextLevelTimer\s*!==\s*null\s*\)\s*return/);
    expect(start, '没有把浮层显示出来').toMatch(/countdownBox\.hidden\s*=\s*false/);
    expect(start, '没有按剩余秒数刷那句读数').toContain('renderCountdown()');
    expect(start, '没有一秒一跳（没排那一格定时器）')
      .toMatch(/nextLevelTimer\s*=\s*setTimeout\(\s*step\s*,\s*COUNTDOWN_TICK_MS\s*\)/);
    expect(start, '到点没有换关').toContain('gotoNextLevel()');

    const clear = bodyOf(SCREEN, 'clearCountdown');
    expect(clear, '清倒计时没有作废定时器').toMatch(/clearTimeout\(nextLevelTimer\)/);
    expect(clear, '清倒计时没有把浮层摘掉（hidden）').toMatch(/countdownBox\.hidden\s*=\s*true/);
    // 到点换关
    expect(bodyOf(SCREEN, 'gotoNextLevel'), '到点换关没有清倒计时（留残影）').toContain('clearCountdown()');
    // 重开本关（chip 跳关与「重开这一关」都经它）
    expect(bodyOf(SCREEN, 'openLevel'), '重开本关没有清倒计时').toContain('clearCountdown()');
    expect(bodyOf(SCREEN, 'restartLevel'), 'chip 跳关没有走 openLevel（那样就不会清倒计时）').toContain('openLevel()');
    // 退出教程：清定时器 + 把 body 上那一层摘掉
    const closeAt = SCREEN.indexOf('close() {');
    expect(closeAt, '找不到 close()').toBeGreaterThan(0);
    expect(SCREEN.slice(closeAt, closeAt + 400), '退出教程没有清掉倒计时并把浮层摘掉')
      .toMatch(/clearCountdown\(\)[\s\S]{0,120}?countdownBox\.remove\(\)/);
  });
});

/**
 * ★ 2026-10-06（**用户要求改的那几条文案**）：T3 讲"换朝向"的路径**以真实 UI 为准**。
 *
 * 用户口径：那句改成说明"拖动前点击手中卡牌的翻面按钮即可更改打出的卡牌朝向"
 * （「两种各打一张」这个要求保留）。
 *
 * 为什么这一组要**真跑**渲染器：文案里点名的是"手中卡牌的**翻面按钮**"——那个按钮真的存在吗？
 * 存在（`render.ts` 的 `renderHand()`：action 步骤 + 轮到这一侧 ⇒ **每一张**自己的手牌上缘都带
 * 「翻面」浮出组，标签走键 `render.hand.flip`；未选中那些挂 `.play-btns-hover`，默认藏、
 * 鼠标移上去才显 —— 这是用户 2026-10-06 当天第二条口径）。这条腿在桩 DOM 上真开一局 T3、
 * 真的点一下选中、真的找那个按钮，缺了它这半句话就是**照着一个不存在的控件写的**。
 *
 * ⚠️ 顺带钉住"右键 / 按 R **换朝向**"这条路**不成立**：换朝向只有卡上缘的「翻面」按钮
 * （右键在 2026-10-06 之后确实存在，但它做的是**打开详情**，见下面那条腿的新口径）。
 * `bindCardDrag` 的 `keydown` 只认 `Escape`（`render.ts:6390`）⇒ T3 那两句不能再让玩家去按右键。
 */
describe('★ 2026-10-06：T3 的换朝向文案以真实 UI 为准（翻面按钮）', () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  /** 把一棵桩节点当成可点的东西点一下（桩的 `dispatchEvent` 不含派发节点自己） */
  const clickNode = (node: StubNode): void => {
    const label = node.text;
    const clicker = makeStubEl('span');
    node.appendChild(clicker);
    clicker.dispatchEvent({ type: 'click', target: clicker });
    node.textContent = label;
  };

  it('★ 真跑：T3 每一张手牌上缘都带「翻面」按钮（未选中的默认藏、选中那张常显），标签是 i18n 的 `render.hand.flip`', () => {
    /**
     * ⚠️ 单击选中是**延迟 320ms** 执行的（`bindClickOrDouble`：320ms 窗口内第二次点击算双击）
     * ⇒ 必须用假定时器把那一格推过去。`window.setTimeout` 在桩里就是全局 `setTimeout` 的转发，
     * `vi.useFakeTimers()` 对它生效（与 `tests/ui/gen3-stagger-axis.test.ts` 同款做法）。
     */
    vi.useFakeTimers();
    restore = installStubDom();
    try {
      const s = buildLevelState('T3');
      s.turnPlayer = 0;
      s.step = 'action';
      const root = makeStubEl('div');
      renderBoard(root as unknown as HTMLElement, s, {
        onAction: () => { /* 这一条只看按钮，不派发动作 */ },
        onRendered: () => { /* noop */ },
        rerender: () => { /* noop */ },
        onDraftPick: () => { /* noop */ },
        onDraftUnpick: () => { /* noop */ },
        onDraftBan: () => { /* noop */ },
        onWinReset: () => { /* noop */ },
      } as never);

      // ★ 2026-10-06（**用户口径**）：不再"选中之后才浮出" —— action 步骤下**每一张自己的手牌**
      //   都带「翻面」浮出组；未选中那些挂 `.play-btns-hover`（默认藏起来、`:hover` 才显形，
      //   规则在 `src/ui/styles-local.css`），选中那张不带这个类 ⇒ 常显（触屏点一下仍拿得到）。
      const hand = classOf(root, 'hand', (n) => n.dataset.player === '0')[0];
      expect(hand, '找不到 P1 的手牌容器（渲染结构被改了？）').toBeDefined();
      const handCards = classOf(hand, 'card').filter((n) => n.dataset.uid !== undefined);
      expect(handCards.length, '手牌一张都没画出来 ⇒ 这条腿在空集上恒真').toBeGreaterThan(0);
      const first = handCards[0];
      const groups = classOf(hand, 'play-btns');
      expect(groups.length,
        '「翻面」浮出组的数量不等于手牌张数 —— 旧口径（只给选中那张）会让没选中的卡上什么都没有'
      ).toBe(handCards.length);
      for (const g of groups) {
        expect(classOf(g, 'play-btn')[0]?.text, '「翻面」按钮的标签不是 render.hand.flip 那句')
          .toBe(ZH['render.hand.flip']);
        expect(isClass(g, 'play-btns-hover'),
          '未选中那张的浮出组没有 `play-btns-hover` ⇒ 它会常显（用户要的是"移上去才显示"）').toBe(true);
      }

      clickNode(first);            // 单击 = 选中
      vi.runOnlyPendingTimers();   // 把那次延迟的单击放出来（重画一帧）
      /**
       * 它挂在**被选中那张卡**的子树里（不是别处的一个裸按钮）。
       * ⚠️ 重画之后 `first` 已经是上一帧的旧节点（`renderApp` 每次重建 DOM）⇒ 必须**重新查**。
       */
      const selected = classOf(root, 'card').filter((n) => n.dataset.uid === first.dataset.uid && isClass(n, 'selected'));
      expect(selected.length, '选中之后那一张没有 `.selected`（选中的是谁？）').toBe(1);
      const selGroups = classOf(selected[0], 'play-btns');
      expect(selGroups.length, '选中之后卡上缘没有浮出「翻面」按钮（文案里点名的是它）').toBe(1);
      expect(isClass(selGroups[0], 'play-btns-hover'),
        '选中那张仍带 `play-btns-hover` ⇒ 触屏（没有 hover）上这个按钮会看不见').toBe(false);
      expect(classOf(root, 'play-btns').filter((g) => !isClass(g, 'play-btns-hover')).length,
        '重画之后"常显"的浮出组不止选中那一张').toBe(1);
    } finally {
      resetUiState();
      restore(); restore = null;
      vi.useRealTimers();
    }
  });

  it('★ 反向：全仓没有"右键 / 按 R **换朝向**"这条路（文案再写它就是让玩家按空）', () => {
    const render = stripComments(readFileSync(`${REPO}src/ui/render.ts`).subarray(0, 4 * 1024 * 1024).toString('utf8'));
    /**
     * ★ 2026-10-06 第二条口径之后本条改口径：右键**现在真的存在了**，但它做的是
     * **打开卡牌详情**（与双击同一条路），**不是换朝向**。所以原来的"`contextmenu` 零命中"
     * 不再成立，换成两条更准的：
     *  1. `contextmenu` 只出现在那个"打开详情"的绑定里（`bindRightClickDetail`），
     *     而且它调的是传进来的 `open`（= 双击那条路），不是朝向/选择那两条；
     *  2. 教学文案里依旧不许出现"右键 / 按 R"—— 换朝向只有卡上缘的「翻面」按钮这一条路。
     */
    expect(render, '右键那条路没了（用户 2026-10-06 要求"右键卡牌也能看详情"）')
      .toContain("node.addEventListener('contextmenu'");
    expect(render, 'contextmenu 的监听不在 `bindRightClickDetail` 里（多了一处自己写的右键处理？）')
      .toMatch(/export function bindRightClickDetail\(node: HTMLElement, open: \(\) => void, stopPropagation = false\): void \{[\s\S]{0,400}?node\.addEventListener\('contextmenu'/);
    expect(render, '右键没有 preventDefault（浏览器菜单会盖在详情上）')
      .toMatch(/addEventListener\('contextmenu', \(e\) => \{\s*e\.preventDefault\(\);/);
    // `bindClickOrDouble` 里右键挂在**同一个 double** 上（= 详情），不是 single（= 选择/固定展示）
    const cod = render.slice(render.indexOf('export function bindClickOrDouble('));
    expect(cod.slice(0, 1400), 'bindClickOrDouble 没有把右键接到 `double`（详情）上')
      .toMatch(/bindRightClickDetail\(node, double, stopPropagation\);/);
    expect(cod.slice(0, 1400), 'bindClickOrDouble 里另挂了原生 dblclick ⇒ 一次双击会开两次详情')
      .not.toContain("addEventListener('dblclick'");
    // 拖拽期间的键盘监听只认 Escape（`render.ts` 那条）
    expect(render, '拖拽键盘监听不止认 Escape 了 —— 请复核 T3 的文案').toContain("if (ev.key === 'Escape') cleanup();");
    /**
     * ★ 2026-10-06 **第二轮**（用户要求右键也能看详情）：判据从"右键零命中"收窄成两条 ——
     *  1. 「按 R」仍然零命中（那个键在本仓不存在）；
     *  2. 提「右键 / right-click」的句子**必须是在讲看详情**，不许把它写成换朝向那条路
     *     （换朝向只有卡上缘的「翻面」按钮）。
     */
    for (const [lang, table] of [['zh', ZH], ['en', EN]] as const) {
      const entries = Object.entries(table as Record<string, string>)
        .filter(([k]) => k.startsWith('tutorial.'));
      const rKey = entries.filter(([, v]) => /按 R|press R(?!ight)/i.test(v)).map(([k]) => k);
      expect(rKey, `${lang} 表里还有教学文案在教玩家按 R（那个键在本仓不存在）`).toEqual([]);
      const rightClick = entries.filter(([, v]) => /右键|right-click/i.test(v));
      expect(rightClick.length,
        `${lang} 表里一条"右键"都没有 ⇒ 下面那条判据是空集（T1 那句「（或右键）」被删了？）`)
        .toBeGreaterThan(0);
      for (const [k, v] of rightClick) {
        expect(v, `${lang} 的 ${k} 提了右键，但它说的不是"看详情"`)
          .toMatch(lang === 'zh' ? /详情|查看|看/ : /detail|view|open/i);
        expect(v, `${lang} 的 ${k} 把右键写成了换朝向那条路（换朝向只有「翻面」按钮）`)
          .not.toMatch(lang === 'zh' ? /右键[^。]{0,12}(翻面|朝向)/ : /right-click[^.]{0,20}(flip|orientation)/i);
      }
    }
    // 点名那四句（T3/T9/T11）逐条确认已经改成"点按钮 / 点选中"
    for (const k of ['tutorial.T3.steps.1', 'tutorial.T9.steps.3', 'tutorial.T11.steps.0']) {
      expect(ZH[k], `zh 的 ${k} 没写"选中"`).toContain('选中');
      expect(EN[k], `en 的 ${k} 没写 select`).toMatch(/select/i);
    }
    expect(ZH['tutorial.T9.steps.3'], 'zh 的 T9.steps.3 没写"翻成反面"').toContain('翻成反面');
    // 正向锚点：那两句真的说了"翻面按钮"（否则上面两条可以靠"什么都没有"满足）
    // ⚠️ 用正则而不是字面量：按钮名在本仓写成「翻面」（带书名号），英文写成 "Flip"
    expect(ZH['tutorial.T3.teach.2'], '中文的 T3 讲解没有说清是点按钮').toMatch(/翻面」?按钮/);
    expect(EN['tutorial.T3.teach.2'], '英文的 T3 讲解没有说清是点按钮').toMatch(/"?flip"? button/i);
    expect(ZH['tutorial.T3.steps.1'], '中文的 T3 步骤没有说"选中它"').toContain('选中');
    expect(EN['tutorial.T3.steps.1'], '英文的 T3 步骤没有说"select it"').toMatch(/select it/i);
  });
});

/** 某个桩节点的**全部后代**（含自己）—— 只在上面那条腿里用，避免与桩导出的 `descendants` 重名 */
function descendantsOf(n: StubNode): StubNode[] {
  const out: StubNode[] = [n];
  for (const c of n.children ?? []) out.push(...descendantsOf(c));
  return out;
}

/**
 * ★ 2026-10-06（**用户逐条给的替换**）：那几句文案的现状腿。
 *
 * 为什么值得单独钉：这几条是**用户点名改的**，而它们很容易在以后"顺手润色"时被改回去
 * （或中英只改一边）——按键名逐条比对，比人眼扫两张表可靠。
 *
 * ⚠️ 这里只钉**用户点名的那几个特征**（不整句比对）：整句比对会在标点这类无关改动上误报，
 * 而用户要的那几个词（"场上"/"翻面按钮"/"确认按钮"/"拖动"）少一个就是真的没改到。
 */
describe('★ 2026-10-06：用户逐条点名的文案替换（中英两边都在）', () => {
  const zh = (k: string): string => ZH[k] ?? '';
  const en = (k: string): string => EN[k] ?? '';

  it('S0：「你手上有 3 张协议」⇒「你场上有 3 张协议」（teach.1 与 scenario 两处都改了）', () => {
    for (const k of ['tutorial.S0.teach.1', 'tutorial.S0.scenario']) {
      expect(zh(k), `中文的 ${k} 还写着"手上有 3 张协议"`).not.toContain('你手上有 3 张协议');
      expect(zh(k), `中文的 ${k} 没写"场上有 3 张协议"`).toContain('你场上有 3 张协议');
      expect(en(k), `英文的 ${k} 还是 "you hold 3 protocols"`).not.toContain('you hold 3 protocols');
      expect(en(k), `英文的 ${k} 没写 "on the field"`).toContain('on the field');
    }
  });

  it('S0.scenario：编译门槛那句补齐（己方链路 10 点 + 第 3 条协议离编译只差 1 分）', () => {
    expect(zh('tutorial.S0.scenario'), '中文没写编译需要 10 点').toContain('编译需要己方链路点数达到 10 点');
    expect(zh('tutorial.S0.scenario'), '中文没写"第 3 条协议所在的链路"').toContain('第 3 条协议所在的链路');
    expect(zh('tutorial.S0.scenario'), '中文没写"离编译只差 1 分"').toContain('离编译只差 1 分');
    expect(zh('tutorial.S0.scenario'), '中文还留着旧那句"第 3 张所在的链路只差 1 分"').not.toContain('第 3 张所在的链路只差 1 分');
    expect(en('tutorial.S0.scenario'), '英文没写 10 点那条门槛').toMatch(/10 points/i);
    expect(en('tutorial.S0.scenario'), '英文没写"1 point short of compiling"').toMatch(/1 point short of compiling/i);
  });

  it('S0.steps.1 与 T0.goal：按用户逐字给的那两句', () => {
    expect(zh('tutorial.S0.steps.1'), 'S0 第一步不是用户给的那句').toBe('把这张牌拖动到第 3 条链路上。');
    expect(en('tutorial.S0.steps.1'), 'S0 第一步的英文没跟着改成 drag').toMatch(/^Drag that card onto the third line\.$/);
    expect(zh('tutorial.T0.goal'), 'T0 的目标不是用户给的那句')
      .toBe('认识以下的四个游戏指示区：控制权指示区、协议区、己方链路区、己方链路阈值显示区');
    for (const word of ['control indicator', 'protocol area', 'line area', 'threshold display']) {
      expect(en('tutorial.T0.goal'), `T0 目标的英文里没有 "${word}"`).toContain(word);
    }
  });

  it('T3：换朝向改成"翻面按钮"这条路（用户口径），「两种各打一张」保留', () => {
    expect(zh('tutorial.T3.teach.2'), 'T3 讲解没说"翻面按钮"').toMatch(/翻面」?按钮/);
    expect(zh('tutorial.T3.teach.2'), 'T3 讲解丢掉了"两种各打一张"这个判据要求').toContain('两种各打一张');
    expect(en('tutorial.T3.teach.2'), 'T3 讲解的英文丢掉了 one of each').toMatch(/one of each/i);
    expect(en('tutorial.T3.teach.2'), 'T3 讲解的英文没说 flip button').toMatch(/"?flip"? button/i);
    // T3 的第二步：把鼠标移到那张牌上、点它上缘的「翻面」
    // （★ 2026-10-06 第二条口径：按钮是"移上去就有"的，不再要求先点选中）
    expect(zh('tutorial.T3.steps.1'), 'T3 第二步不是"移上去点翻面"那条路')
      .toBe('把鼠标移到「流水1」上，点它上缘的「翻面」把它翻成反面（触屏设备：先点一下这张牌选中它）。');
    expect(en('tutorial.T3.steps.1'), 'T3 第二步的英文没写 "Move the mouse"').toMatch(/move the mouse/i);
    // 数据层：这一关的判据（一正一反）一个字都没动
    expect(levelById('T3').goal(), 'T3 的目标被顺手动过').toBe(zh('tutorial.T3.goal'));
  });

  it('★ 生成式：凡是教玩家点「翻面」的教学句，都要说明"鼠标移到牌上"这条路（用户 2026-10-06 口径）', () => {
    /**
     * 用户当天第二条口径：「翻面按钮应该是我鼠标移动到卡牌上就显示，而不是我选中这张卡之后才显示」。
     * 按钮改了，**所有教玩家点它的句子**就得跟着改 —— 否则文案还在教"先点一下选中"那套旧流程。
     * 键清单是**生成式**的（扫两张表），不写手写清单：以后新加的句子自动被这条腿管住。
     */
    const zhKeys = Object.entries(ZH as Record<string, string>)
      .filter(([k]) => k.startsWith('tutorial.'))
      .filter(([, v]) => v.includes('翻面'))
      .map(([k]) => k);
    expect(zhKeys.length, '中文表里一句提「翻面」的教学文案都没有 ⇒ 这条生成式腿是空集')
      .toBeGreaterThanOrEqual(4);
    const bad = zhKeys.filter((k) => !(ZH[k] ?? '').includes('鼠标移到'));
    expect(bad, `这几句还在教玩家点「翻面」却没说鼠标要移到哪张牌上：${bad.join(', ')}`).toEqual([]);
    // 英文那一边按**同一批键**比对（免得靠关键词筛英文时漏一句）
    for (const k of zhKeys) {
      expect(EN[k] ?? '', `英文的 ${k} 没写 "move the mouse"（中英只改了一边）`).toMatch(/move the mouse/i);
    }
  });

  it('T7.steps.4 与 T9.steps.4 句尾补上"确认按钮"那一句', () => {
    expect(zh('tutorial.T7.steps.4'), 'T7 那一步没有"确认按钮"').toContain('确认按钮');
    expect(en('tutorial.T7.steps.4'), 'T7 那一步的英文没有 confirm').toMatch(/confirm/i);
    // ★ 用户口径：它是在原句**句尾**加上的（不能把"点候选"这半句挤掉）
    expect(zh('tutorial.T7.steps.4'), 'T7 那一步丢了"点候选里的精神3"这半句').toContain('点「精神3」');
    expect(en('tutorial.T7.steps.4'), 'T7 那一步的英文丢了"tap Spirit 3"').toMatch(/tap Spirit 3/i);

    /**
     * ⚠️ **2026-10-06 订正**：用户口径里写的是「先点那张反面**流水2**」，但这一关盖在那张速度0
     * 上面的是**步骤 3 里刚打出的「流水5」**（`setup.ts` 的 `t9h-cover` = `water-5`；英文那一侧
     * 本来也写的是 `Water 5`）⇒ 中文按真实牌面写成「流水5」，中英一致。
     * 若用户想让这一关改成用流水2 当盖牌，那是改 `setup.ts` 的局面，不是改这句文案。
     */
    expect(zh('tutorial.T9.steps.4'), 'T9 那一步的牌名与局面不符（盖牌是流水5）')
      .toBe('把「黑暗4」正面拖到线 1，先点刚压上去的那张反面流水5，并点击控制台的确认按钮，接着点击想移动到的那一链路。');
    expect(en('tutorial.T9.steps.4'), 'T9 那一步的英文没有 confirm').toMatch(/confirm/i);
    expect(en('tutorial.T9.steps.4'), 'T9 那一步的英文没写"点哪条链路"').toMatch(/line you want to move it to/i);
    // ★ 用户口径里的判据部分要保住：先选那张反面牌、再选目标线（这一关的判据就是这两步）
    expect(zh('tutorial.T9.steps.4'), 'T9 那一步丢了"先点刚压上去的那张反面流水5"').toContain('先点刚压上去的那张反面流水5');
    expect(en('tutorial.T9.steps.4'), 'T9 那一步的英文丢了"tap that face-down Water 5 first"').toMatch(/face-down Water 5 first/i);
  });
});

/**
 * ★ 2026-10-06（**用户第二批逐条点名改的文案**）：中英两侧**逐字**钉住。
 *
 * 与上一组的分工：上一组钉的是"那几个词在不在"（用户第一次口述时只给了特征词），
 * 这一组是用户**整句给全**的 ⇒ 直接比对整句（标点也算），任何一侧漂了当场红。
 *
 * ⚠️ 两处"用户记错、按真实局面订正"的地方（都写在这里，免得以后有人"照用户原话改回去"）：
 *  1. 用户把这一步记成了 `T4.steps.0` 那句（原文「打出「精神2」，在弹出的候选里挑一张场上的牌。」）
 *     —— 那一串**逐字就是 `tutorial.T4.steps.0`**（不是 T7 的哪一步，T7 的牌被压在下面、
 *     根本没有"对方的火焰2"这个候选），所以改在 T4.steps.0 上；
 *  2. `T5` 手里那张是 **`corruption-0`（腐化0）**，不是用户口述的「瘟疫0」——
 *     `src/tutorial/setup.ts` 的 T5 分支是唯一出处（下面有一条**真跑**的腿钉住它）。
 */
describe('★ 2026-10-06（第二批）：用户逐字给的 10 条文案，中英逐句比对', () => {
  const zh = (k: string): string => ZH[k] ?? '';
  const en = (k: string): string => EN[k] ?? '';

  it('1. T0 那两步：按用户给的那句（左/中的位置口径 + 两个区的名字）', () => {
    expect(zh('tutorial.T0.steps.0'), 'T0 第一步不是用户给的那句')
      .toBe('点一下左边己方亮着的三条链路。');
    expect(zh('tutorial.T0.steps.1'), 'T0 第二步不是用户给的那句')
      .toBe('再点击中间 6 张协议卡的区域，以及左边的「己方链路阈值区」和上方的「控制权指向区」两个框。');
    for (const k of ['tutorial.T0.steps.0', 'tutorial.T0.steps.1']) {
      expect(en(k), `英文的 ${k} 里没有 six protocol cards 那一族说法`).toMatch(/six protocol cards|three glowing lines|threshold area|control direction area/);
      expect(zh(k), `中文的 ${k} 还写着"中间那三列"`).not.toContain('中间那三列');
    }
  });

  it('2. T4 的目标：原句 + 末尾那段"只有未被覆盖的牌能选中"的规则说明', () => {
    expect(zh('tutorial.T4.goal'), 'T4 的目标不是"原句 + 补的那段"')
      .toBe('用手里五张牌，各做一次翻转、偏转、抽牌、弃牌、回手。（一般翻转、偏转、回手这些指向场上卡牌的效果只能作用于未被覆盖的卡牌，已经被覆盖的卡牌不能被选中，除非卡牌效果中有明确说明是「所有卡牌」才行）');
    expect(zh('tutorial.T4.goal'), '原句那半截被挤掉了').toContain('用手里五张牌，各做一次翻转、偏转、抽牌、弃牌、回手。');
    expect(en('tutorial.T4.goal'), '英文没有跟上一句').toMatch(/not covered/i);
    expect(en('tutorial.T4.goal'), '英文丢了 all cards 那个例外').toMatch(/all cards/i);
  });

  it('3. T4 第一步：点名选对手那张火焰2 + 确认按钮（局面里真有这张牌）', () => {
    expect(zh('tutorial.T4.steps.0'), 'T4 第一步不是用户给的那句')
      .toBe('打出「精神2」，选择场上对方的火焰2卡牌，并点击控制台上的确认按钮。');
    expect(en('tutorial.T4.steps.0'), '英文没写 Fire 2').toMatch(/Fire 2/i);
    expect(en('tutorial.T4.steps.0'), '英文没写 confirm').toMatch(/confirm/i);
    // ★ 真跑：这一步点名的目标真的在 T4 开局局面上（对手线 1 那张 `fire-2`）
    const t4 = buildLevelState('T4');
    expect(t4.players[1].stacks[0]?.[0]?.defId, 'T4 对手线 1 那张不是火焰2（文案点名的目标不存在）').toBe('fire-2');
    expect(t4.players[0].hand.some((c) => c.defId === 'spirit-2'), 'T4 手里没有精神2').toBe(true);
  });

  it('3b. ★ 真跑（引擎）：照那句做一遍 —— 打出精神2、选对手那张火焰2、确认 ⇒ 判据记到 flip', () => {
    /**
     * 文案点名了一个**具体目标**，那就要证明"照它做真的能过关"：走一遍引擎的真链路
     * （`driver.submit`，与屏上 `cb.onAction` 同一套调用面），然后问 `observedOps`。
     */
    const s = buildLevelState('T4');
    const driver = createLocalDriver();
    const before = snapshot(s);
    expect(driver.submit(s, {
      player: s.turnPlayer, kind: 'play',
      args: { cardUid: 't4h-flip', faceUp: true, line: 0 },
    } as never).ok, '打出「精神2」被引擎拒了').toBe(true);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind, '打出「精神2」之后没有弹出选择（文案说的"选择卡牌"没有落点）').toBe('select');
    expect((top?.prompt?.candidates ?? []).some((c) => c.uid === 't4o-up'),
      '候选里没有文案点名的"对方的火焰2"').toBe(true);
    const chooser = top?.prompt?.chooser ?? top?.player ?? s.turnPlayer;
    expect(driver.submit(s, {
      player: chooser, kind: 'effect-choice',
      args: { promptId: top?.id ?? '', choice: ['t4o-up'] },
    } as never).ok, '选「对方的火焰2」被引擎拒了').toBe(true);
    expect(observedOps(before, snapshot(s)), '照文案做完这一遍，判据（T4 的五个动作之一）没记到 flip')
      .toContain('flip');
  });

  it('5. T4 第三步：回手那半句改成"选择一张卡牌进行回手"', () => {
    expect(zh('tutorial.T4.steps.2'), 'T4 第三步不是用户给的那句')
      .toBe('接着打出「精神1」（抽牌）、「精神5」（弃牌，挑那张 0 分的）、「流水4」（回手，选择一张卡牌进行回手）。');
    expect(zh('tutorial.T4.steps.2'), '还留着旧那半句"点线 1 那张"').not.toContain('点线 1 那张');
    expect(en('tutorial.T4.steps.2'), '英文还写着 take the card on line 1').not.toMatch(/take the card on line 1/i);
    expect(en('tutorial.T4.steps.2'), '英文没写 pick a card to return').toMatch(/pick a card to return/i);
  });

  it('6. T5 的目标：按用户那句写，但牌名按**真实局面**订正为「腐化0」', () => {
    // ★ 2026-10-06（用户第二次点名）：把"对手线 链路1"读起来重复的写法改成"对手链路 1"。
    expect(zh('tutorial.T5.goal'), 'T5 的目标不是用户给的那句（牌名已按局面订正）')
      .toBe('正常情况每回合只能出一张牌（部分卡牌效果能够让你出多张牌），现在把你手中的腐化0打出到对手链路 1 的那张牌上面（腐化0是一张特殊的卡牌，能够打出至对方链路中，正常情况下是不能打出至对方链路中的）');
    expect(zh('tutorial.T5.goal'), '又写回了重复的"对手线 链路1"').not.toContain('对手线 链路1');
    // 用户口述的牌名是「瘟疫0」，但这一关手里那张是 corruption-0 —— 下面这条真跑钉住局面
    expect(zh('tutorial.T5.goal'), '还留着用户口述的"瘟疫0"（与局面不符）').not.toContain('瘟疫0');
    expect(en('tutorial.T5.goal'), '英文没写 Corruption 0').toMatch(/Corruption 0/);
    expect(en('tutorial.T5.goal'), '英文没写 one card per turn').toMatch(/one card per turn/i);
    const t5 = buildLevelState('T5');
    expect(t5.players[0].hand.map((c) => c.defId), 'T5 手里那张不是腐化0（文案的牌名要跟着它）')
      .toEqual(['corruption-0']);
  });

  it('7/8/9/10. T7 的四句：按用户逐字给的那四句', () => {
    expect(zh('tutorial.T7.steps.1'), 'T7 第二步不是用户给的那句')
      .toBe('卡牌效果中没写明效果的指向对象无法作用于被覆盖的卡牌，卡牌效果中有写明「被覆盖」的卡牌效果能够作用于被覆盖的卡牌。');
    expect(zh('tutorial.T7.teach.1'), 'T7 讲解不是用户给的那句')
      .toBe('卡牌效果中有写明「所有牌」才能够作用于场上无论是否被覆盖的卡牌；写了「被覆盖的牌」才计算进被覆盖的卡牌。');
    expect(zh('tutorial.T7.steps.2'), 'T7 第三步不是用户给的那句')
      .toBe('换成选择场上亮着的卡牌后，然后点击控制台中确认按钮即可触发该效果（或者点「跳过」，把这次选择结束掉。）');
    expect(zh('tutorial.T7.steps.4'), 'T7 第五步不是用户给的那句')
      .toBe('这次在弹出的候选里点「精神3」，并点击控制台的确认按钮—— 你会发现该卡牌的效果能够选中被覆盖的卡牌。');
    // 英文两侧都要跟到位（逐条给出关键特征词，防"只改中文"）
    expect(en('tutorial.T7.steps.1'), '英文的 T7 第二步没写 covered').toMatch(/covered/i);
    expect(en('tutorial.T7.teach.1'), '英文的 T7 讲解丢了 all cards').toMatch(/all cards/i);
    expect(en('tutorial.T7.steps.2'), '英文的 T7 第三步没写 confirm').toMatch(/confirm/i);
    expect(en('tutorial.T7.steps.4'), '英文的 T7 第五步没写 confirm').toMatch(/confirm/i);
  });

  it('11. T8 的目标：把"编译会发生什么"写全（清线 + 协议翻到已编译面）', () => {
    expect(zh('tutorial.T8.goal'), 'T8 的目标不是用户给的那句')
      .toBe('编译己方链路1的精神协议，编译后该条链路中双方的卡牌都会立即被移至弃牌堆中，同时对应的协议会翻转至已编译面');
    expect(zh('tutorial.T8.goal'), 'T8 的目标还留着旧那句"把线 1 编译掉"').not.toBe('把线 1 编译掉。');
    expect(en('tutorial.T8.goal'), '英文没写 goes to its owner\'s trash').toMatch(/trash/i);
    expect(en('tutorial.T8.goal'), '英文没写 compiled side').toMatch(/compiled side/i);
    // 数据层：这一关的判据（编译线 1）一个字都没动
    expect(levelById('T8').goal(), 'T8 的目标被顺手动过').toBe(zh('tutorial.T8.goal'));
  });

  it('★ 边界：第 4 条（T9 那一步）本次**没动** —— 它在并行会话的范围里', () => {
    // 只钉"这里不是我们改的现场"：T9 那几步的键仍在、值非空，不比对内容
    for (const k of ['tutorial.T9.steps.0', 'tutorial.T9.steps.4', 'tutorial.T9.teach.4']) {
      expect(ZH[k], `中文表里没有 ${k}`).toBeTruthy();
      expect(EN[k], `英文表里没有 ${k}`).toBeTruthy();
    }
  });
});

/**
 * ★ 2026-10-06（**用户本轮逐字给的文案**）：`tutorial.T4.steps.1` 那一句。
 *
 * 用户原话（他不满、已提过多次）：「打出「黑暗4」，先点那张反面流水2，再点目标列 → 改为：
 * 打出「黑暗4」，先点那张反面流水2，并点击控制台上的确认按钮后，再点要偏移的那条链路」。
 *
 * 本仓在这一句上做了两处**体例订正**（都写进 `zh.ts` 的注释里）：
 *  1. 「偏移」→「**偏转**」（用户 2026-10-01 亲自要求统一过的术语）；
 *  2. 末尾补句号（与其余教学文案一致）。
 *
 * ⚠️ 这一条**不是** T9 的哪一步：第 11 关（T9）那张盖牌是**流水5**（`t9h-cover` = `water-5`），
 * 上一轮就错在把 T4 的说法移过去过。下面两条都各自钉住"牌名与局面一致"。
 */
describe('★ 2026-10-06：T4.steps.1 那一句（用户逐字给 + 本仓两处体例订正）', () => {
  it('中英逐字：确认按钮那半句必须在、且术语是「偏转」而不是「偏移」', () => {
    expect(ZH['tutorial.T4.steps.1'], 'T4 第二步不是用户要的那句')
      .toBe('打出「黑暗4」，先点那张反面流水2，并点击控制台上的确认按钮后，再点要偏转的那条链路。');
    // 用户原词是"偏移"，本仓统一术语是"偏转"（用户 2026-10-01 要求过统一）
    expect(ZH['tutorial.T4.steps.1'], '又写回了用户口述的"偏移"（与全仓术语不一致）').not.toContain('偏移');
    expect(ZH['tutorial.T4.steps.1'], '丢了用户要的"并点击控制台上的确认按钮后"').toContain('并点击控制台上的确认按钮后');
    expect(ZH['tutorial.T4.steps.1'], '丢了"先点那张反面流水2"').toContain('先点那张反面流水2');
    expect(ZH['tutorial.T4.steps.1'], '末尾没按本仓习惯补句号').toMatch(/。$/);
    expect(EN['tutorial.T4.steps.1'], '英文没有跟上这句（缺 confirm）').toMatch(/confirm/i);
    expect(EN['tutorial.T4.steps.1'], '英文没写那块要偏转的牌（face-down Water 2）').toMatch(/face-down Water 2/i);
    expect(EN['tutorial.T4.steps.1'], '英文没写"要偏转到哪条线"').toMatch(/line you want to shift it to/i);
  });

  it('★ 真跑（引擎）：照那句做一遍 —— 打出黑暗4 → 点那张反面流水2 → 确认 → 点目标链路 ⇒ 判据记到 shift', () => {
    /**
     * 这一句点名的是一条**两步选择**的动作链（`darkness.ts:62-70`：先 select 反面卡、再
     * select-line），而那半句新增的"确认按钮"正是两步之间那一下 —— 所以照它走一遍是必要的：
     * 少点那一下，玩家的选择根本不会被提交。
     */
    const s = buildLevelState('T4');
    // 前置：那张反面流水2 真的在场上、真的是反面（文案点名的目标）
    const target = findCard(s, 't4f-down');
    expect(target?.faceUp, 'T4 线 2 那张流水2 不是反面（文案点名的目标不存在）').toBe(false);
    expect(s.players[0].hand.some((c) => c.defId === 'darkness-4'), 'T4 手里没有黑暗4').toBe(true);

    const driver = createLocalDriver();
    const before = snapshot(s);
    // ① 打出「黑暗4」正面到线 3（它自己的黑暗协议线）
    expect(driver.submit(s, {
      player: s.turnPlayer, kind: 'play',
      args: { cardUid: 't4h-shift', faceUp: true, line: 2 },
    } as never).ok, '打出「黑暗4」被引擎拒了').toBe(true);
    // ② 第一步选择：候选里必须有那张反面流水2
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind, '打出「黑暗4」之后没有弹出选择').toBe('select');
    expect((top?.prompt?.candidates ?? []).some((c) => c.uid === 't4f-down'),
      '候选里没有文案点名的"那张反面流水2"').toBe(true);
    // ③ 点它 + **点确认**（`effect-choice` 就是控制台那颗确认按钮走的路）
    const chooser = top?.prompt?.chooser ?? top?.player ?? s.turnPlayer;
    expect(driver.submit(s, {
      player: chooser, kind: 'effect-choice',
      args: { promptId: top?.id ?? '', choice: ['t4f-down'] },
    } as never).ok, '选「反面流水2」并确认被引擎拒了').toBe(true);
    // ④ 第二步：点要偏转过去的那条链路（候选线里不含它原来那条 ⇒ 选线 1 = index 0）
    const linePrompt = s.pendingEffects[s.pendingEffects.length - 1];
    expect(linePrompt?.prompt?.kind, '确认之后没有弹出"选目标线"那一步（文案里"再点要偏转的那条链路"没有落点）')
      .toBe('select-line');
    expect(driver.submit(s, {
      player: linePrompt?.prompt?.chooser ?? linePrompt?.player ?? s.turnPlayer,
      kind: 'effect-choice',
      args: { promptId: linePrompt?.id ?? '', choice: ['line:0'] },
    } as never).ok, '选目标线被引擎拒了').toBe(true);
    // 判据记到 shift（T4 的五个动作之一），而且那张牌真的换了线
    expect(observedOps(before, snapshot(s)), '照文案做完这一遍，判据（T4 的五个动作之一）没记到 shift')
      .toContain('shift');
    expect(findCard(s, 't4f-down')?.line, '那张流水2 没有偏转到线 1').toBe(0);
  });

  it('★ 反向：T9 那句（第 11 关）盖牌是**流水5**，不许把 T4 的说法移过去', () => {
    // 第 11 关（T9）的盖牌是 `t9h-cover` = water-5；T4 的那张反面流水2 是 T4 的靶子
    const t9 = buildLevelState('T9');
    expect(t9.players[0].hand.some((c) => c.defId === 'water-5'), 'T9 手里没有流水5（盖牌变了？）').toBe(true);
    expect(ZH['tutorial.T9.steps.4'], 'T9 那一步的牌名与局面不符（该写流水5）').toContain('流水5');
    expect(ZH['tutorial.T9.steps.4'], 'T9 那一步混进了 T4 的"反面流水2"').not.toContain('流水2');
    expect(ZH['tutorial.T9.steps.4'], 'T9 那一步丢了"确认按钮"那半句').toContain('确认按钮');
    // 反过来：T4 的 setup 里那张靶子才叫流水2
    const t4 = buildLevelState('T4');
    expect(findCard(t4, 't4f-down')?.defId, 'T4 那张反面靶子不是流水2（文案点名的目标不存在）').toBe('water-2');
  });
});

/**
 * ★ 2026-10-06（**本轮新增/改动的两关**）：T6 拆两步、T7a 新插一关 —— 文案与屏上提示都在。
 *
 * 两张表都要有（缺键腿另有一处），这里额外钉**内容**：T6 的第一句必须让玩家先打出那张牌；
 * T7a 必须讲"未覆盖 / 被覆盖"两个状态，而且不提点数（实测覆盖之后这条线的总值是 3 → 5，
 * 写进文案会把这一课讲成算术课）。
 */
describe('★ 2026-10-06：T6（两步）与 T7a（牌能盖牌）的文案与提示接线', () => {
  it('T6：第一步是"打出流水1 造出未公开信息"，第二步才是对比两个对照', () => {
    expect(ZH['tutorial.T6.steps.0'], 'T6 第一步没让玩家打出那张牌').toContain('流水1');
    expect(ZH['tutorial.T6.steps.0'], 'T6 第一步没说清它会把牌库顶那张反面打出来').toContain('牌库顶');
    expect(ZH['tutorial.T6.steps.2'], 'T6 最后一步没有"对比两个对照"').toContain('对比');
    expect(ZH['tutorial.T6.teach.2'], 'T6 的讲解没说清"未公开信息是怎么产生的"').toContain('牌库顶');
    for (const k of ['tutorial.T6.steps.0', 'tutorial.T6.steps.1']) {
      expect(EN[k], `英文表里没有 ${k}`).toBeTruthy();
      expect(EN[k], `${k} 的英文没提到 deck/Water 1`).toMatch(/deck|Water 1/i);
    }
    expect(EN['tutorial.T6.steps.2'], '英文的最后一步没写"两张牌各自在哪条线"').toMatch(/line 1/);
    expect(EN['tutorial.T6.steps.2'], '英文的最后一步没写"对比"').toMatch(/compare/i);
    // 屏上的提示也要分两步：还没打出来时给"第一步"那一句
    const panel = bodyOf(SCREEN, 'renderPanel');
    expect(panel, 'T6 的提示区没有"先打出那张牌"这一步').toContain("t('tutorial.peek.make')");
    expect(panel, 'T6 的提示没有读判据用的同一份读数（secretFromDeckPlayed）').toContain('secretFromDeckPlayed(');
    expect(ZH['tutorial.peek.make'], '中文表里没有 tutorial.peek.make').toBeTruthy();
    expect(EN['tutorial.peek.make'], '英文表里没有 tutorial.peek.make').toBeTruthy();
    expect(EN['tutorial.peek.make'], 'tutorial.peek.make 中英一样（等于没翻）').not.toBe(ZH['tutorial.peek.make']);
  });

  it('T7a：讲清"未覆盖 / 被覆盖"两个状态，且不提点数', () => {
    // 中英两边的**键集**逐条一致（少一条就是浮层上一个空块 / 一句没翻的话）
    const zhKeys = Object.keys(ZH).filter((k) => k.startsWith('tutorial.T7a.')).sort();
    const enKeys = Object.keys(EN).filter((k) => k.startsWith('tutorial.T7a.')).sort();
    expect(zhKeys.length, `中文表里 T7a 的文案不全（${zhKeys.length} 条）`).toBeGreaterThanOrEqual(10);
    expect(enKeys, 'T7a 的中英键集不一致（只改了一边）').toEqual(zhKeys);
    expect(ZH['tutorial.T7a.title'], 'T7a 的标题不是"牌能盖牌"').toBe('牌能盖牌');
    // 两个状态都要讲到（teach.0 讲"未覆盖"，teach.1 讲"被覆盖"—— 这里按两句话合起来查）
    expect(ZH['tutorial.T7a.teach.0'], 'T7a 的第一句讲解没讲"未覆盖"').toContain('未覆盖');
    expect(ZH['tutorial.T7a.teach.1'], 'T7a 的第二句讲解没讲"被覆盖"').toContain('被覆盖');
    expect(ZH['tutorial.T7a.teach.2'], 'T7a 的第三句没把两个状态并起来说').toContain('未覆盖');
    expect(ZH['tutorial.T7a.teach.2'], 'T7a 的第三句没把两个状态并起来说').toContain('被覆盖');
    expect(ZH['tutorial.T7a.teach.1'], '没讲"被覆盖的牌还在场上"').toContain('还在场上');
    // 不提点数（实测 3 → 5；写进"覆盖会怎样"只会把这一课讲成算术课）
    for (const k of Object.keys(ZH).filter((x) => x.startsWith('tutorial.T7a.'))) {
      expect(ZH[k], `${k} 里出现了点数读数（这一课不讲点数）`).not.toMatch(/\d+\s*分/);
    }
    // 这一关只用己方场上的例子（文案里点名的两张牌都在**自己**那一侧）
    const s = buildLevelState('T7a');
    expect(s.players[0].stacks[0].map((c) => c.defId), 'T7a 自己线 1 上那张不是精神3').toEqual(['spirit-3']);
    expect(s.players[0].hand.map((c) => c.defId), 'T7a 手里那张不是精神5').toEqual(['spirit-5']);
    // 屏上提示走判据的那个函数（同一份读数）
    const panel = bodyOf(SCREEN, 'renderPanel');
    expect(panel, 'T7a 的提示区没有接线').toContain("t('tutorial.T7a.hint.go')");
    expect(panel, 'T7a 的提示没有读判据用的同一份读数（ownCardCovered）').toContain('ownCardCovered(');
  });
});

