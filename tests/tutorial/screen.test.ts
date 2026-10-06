import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../ui/source-text';
import { EN, ZH } from '../../src/i18n';
import { TUT_LEVELS } from '../../src/tutorial/levels';
import type { TutSpot } from '../../src/tutorial/types';
import { placeSpotBoxes, spotBoxStyle, unionRect, applyNextButtonVisibility } from '../../src/ui/tutorial-screen';
import { installStubDom, makeStubEl, setStubRectFor, type StubNode } from '../ui/net-dom-stub';

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

  it('赢下之后停一会儿再换关，并且换关前收掉 render.ts 的胜利横幅', () => {
    const body = bodyOf(SCREEN, 'judgeAndAdvance');
    expect(body, '判过关之后没有走 gotoNextLevel').toContain('gotoNextLevel()');
    expect(body, '没有为 S0 单独留出"看完再走"的那一段').toMatch(/level\.id\s*===\s*'S0'/);
    expect(body, 'S0 那一支没有延后换关（立刻换关的话玩家一帧都看不到"赢"）').toMatch(/nextLevelTimer\s*=\s*setTimeout/);
    // ★ 反向：只许排**一个**定时器 —— judgeAndAdvance 会被重复调用（双击放大也走它），
    //   不设 guard 的话第二次 gotoNextLevel 会把 T0 直接跳过去
    expect(body, 'S0 那一支没有"只排一个定时器"的 guard（重复进判定会连跳两关）')
      .toMatch(/nextLevelTimer\s*===\s*null[\s\S]{0,80}?setTimeout\(/);
    const goto = bodyOf(SCREEN, 'gotoNextLevel');
    expect(goto, '换关前没有收胜利横幅（它会压在下一关 T0 要玩家点的那一片上）').toContain('dismissWinBanner()');
    expect(goto, '换关没有推进 levelId').toMatch(/levelAt\(levelIndex\(levelId\)\s*\+\s*1\)/);
    const dismiss = bodyOf(SCREEN, 'dismissWinBanner');
    expect(dismiss, '没有走 render.ts 自己那颗「返回主界面」').toContain('.win-confirm-btn');
    // 定时器要能被收掉（退出教程 / 重开这一关）
    expect(SCREEN, '退出时没有清掉那个延后换关的定时器').toMatch(/clearTimeout\(nextLevelTimer\)/);
    expect(bodyOf(SCREEN, 'openLevel'), '重开这一关时没有作废上一关的延后换关')
      .toMatch(/clearTimeout\(nextLevelTimer\)/);
  });

  it('chip 显示的是 1 起的序号，id 留在 dataset.level（S0 插进来不会排出「S0 T0 …」）', () => {
    const body = bodyOf(SCREEN, 'renderPanel');
    expect(body, 'chip 的文本又写回关卡 id 了（屏上会出现 S0 T0 T1… 的混排）')
      .not.toMatch(/el\(\s*'span'\s*,\s*'tutorial-chip'\s*,\s*l\.id\s*\)/);
    expect(body, 'chip 的文本不是 1 起的序号').toMatch(/tutorial-chip'\s*,\s*String\(levelIndex\(l\.id\)\s*\+\s*1\)/);
    expect(body, 'chip 上没有留 dataset.level（既有探针读的就是它）').toContain('chip.dataset.level = l.id');
  });
});

