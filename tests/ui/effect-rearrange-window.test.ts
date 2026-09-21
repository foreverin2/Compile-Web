import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChoiceRequest, GameState, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { resolveMiddle } from '../../src/core/effects/resolve';
import { renderBoard } from '../../src/ui/render';
import { renderNetBoard } from '../../src/ui/render-net';
import {
  closeControlRearrangeModal, openControlRearrangeModal,
} from '../../src/ui/control-rearrange';
import { makeCard } from '../helpers';
import { functionBody, stripComments } from './source-text';
import {
  classOf, descendants, drainRaf, installStubDom, isClass, makeStubEl, type StubNode,
} from './net-dom-stub';

/**
 * **G5 T25：所有会"重排协议"的卡都走动量4那种整屏重排窗口（2026-09-22 用户交办）**
 *
 * 用户原话的意图：把**所有能触发重排效果的卡**做成动量4那种整屏窗口，而不是弹一排布局按钮。
 * 盘点（`grep -rn "action:order" src`）后真正还在弹按钮的只剩 `nova-2` 一张：
 *
 * | 形态 | 卡 | 本任务 |
 * | --- | --- | --- |
 * | `select-action` + 5 条 `action:order:XYZ`（布局按钮） | `momentum-4`（已窗口化）、`nova-2` | **改 nova-2** |
 * | 玩家点选**两个协议位**交换（`select-line` ×2 ⇒ `rearrangeProtocols{a,b}`） | `chaos-1` / `flexibility-3` / `nova-0` / `psychic-2` / `spirit-4` / `water-2` | **不动**（语义是"交换指定的两张"，改成任意排列 = 规则变更） |
 * | 引擎固定 0↔2 交换（无玩家选择） | `fulcrum-3` | 不动 |
 * | 持控者的常规重排（刷新/编译前） | `controlRearrangeFlow` | 已在用 body 级窗口，不动 |
 *
 * ## 这个文件证明什么 / 不能证明什么
 *
 * **能**（前两组是"真跑一次渲染器、拿元素树"的行为腿，DOM 是共用桩 `./net-dom-stub`）：
 *  1. 判据 2：**两个渲染器**（热座 `renderBoard` / 远程页 `renderNetBoard`）各喂一条**带
 *     `rearrangeSide`** 的 `select-action` 请求 ⇒ `.choice-action-btn` 数量为 0、提示行在树里；
 *     反控 = 同一条请求**去掉** `rearrangeSide` ⇒ 5 个按钮回来（否则前一条是空腿）；
 *  2. 判据 3：`openControlRearrangeModal({…, skipLabel, onSkip})` 在桩上**真跑**，树里有「跳过」、
 *     且**点它真的调到 `onSkip`**；不传 `onSkip` ⇒ 没有这个按钮（反空转）；
 *  3. 判据 1 / 4：源码文本腿（`nova.ts` 的标记与 5 条 actions、`rearrangeSide` 在 `src/core`
 *     里没有引擎读者、`main.ts` 只在 `prompt.optional` 时给跳过）。
 * **不能**：真浏览器里"nova-2 覆盖着新星牌"那一格的端到端（要真实牌局构造 + 真窗口），
 * 本轮**没验**，留给用户真机（与 `momentum-4` 同一条登记）。
 */

const root = new URL('../../src/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 4 * 1024 * 1024).toString('utf8');
const MAIN = stripComments(read('main.ts'));
const NOVA_TS = read('core/effects/cards/nova.ts');

/* ============================================================================
 * 夹具：**引擎真产出的** nova-2 选择请求（不是手抄的字面量）
 * ========================================================================== */

/** nova-2 盖在一张**正面** nova-1 上 ⇒ `belowIsNova` 成立 ⇒ 走"你可以重排你的协议"那一支。 */
function nova2State(owner: PlayerId): GameState {
  const s = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
  }
  s.phase = 'turn';
  s.turnPlayer = owner;
  const line = 0 as const;
  s.players[owner].stacks[line].push(
    makeCard('nova-1', owner, 'field', true, line, s.players[owner].stacks[line].length),
  );
  const src = makeCard('nova-2', owner, 'field', true, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(src);
  resolveMiddle(s, owner, src);
  return s;
}

/** 引擎产出的那条请求（带 `rearrangeSide`）。 */
function nova2Prompt(owner: PlayerId): { s: GameState; prompt: ChoiceRequest } {
  const s = nova2State(owner);
  const top = s.pendingEffects[s.pendingEffects.length - 1];
  if (!top?.prompt) throw new Error('夹具失败：nova-2 没有产出选择请求（belowIsNova 不成立？）');
  return { s, prompt: top.prompt };
}

/* ============================================================================
 * 桩夹具
 * ========================================================================== */

let restore: (() => void) | null = null;
afterEach(() => { if (restore !== null) { restore(); restore = null; } });

const noop = (): void => { /* noop */ };
const CB = {
  onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
  onDraftBan: noop, onWinReset: noop,
};

/**
 * 在 `node` 上**真派发一次点击**。桩的 `dispatchEvent` 只向祖先冒泡、不调用派发节点自己的
 * 监听器（`net-dom-stub.ts` 头注）⇒ 挂一个空 `<span>` 子节点、在**它**上派发，冒泡路径必然
 * 经过 `node`（与 `replay-bar.test.ts` 的 `clickNode` / `local-consent.test.ts` 的 `clickIn` 同源）。
 */
function clickNode(node: StubNode): void {
  const label = node.text;
  const clicker = makeStubEl('span');
  node.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
  node.textContent = label;
}

/** 真跑一帧热座渲染器。 */
function hotSeatFrame(s: GameState): StubNode {
  const el = makeStubEl('div');
  renderBoard(el as unknown as HTMLElement, s, CB as never);
  return el;
}

/** 真跑一帧远程页渲染器（`viewSeat` = 操作方那一屏）。 */
function netFrame(s: GameState, viewSeat: PlayerId): StubNode {
  const el = makeStubEl('div');
  renderNetBoard(el as unknown as HTMLElement, s, CB as never, { viewSeat, verifyHooks: false } as never);
  return el;
}

/* ============================================================================
 * 判据 2：UI 不再画那 5 个布局按钮（两个渲染器各判一次）
 * ========================================================================== */

describe('G5 T25 判据 2：带 `rearrangeSide` 的选择请求不画布局按钮（热座 + 远程页）', () => {
  it('热座 renderBoard：nova-2 的真请求 ⇒ `.choice-action-btn` 为 0、提示行在树里', async () => {
    restore = installStubDom();
    const { s, prompt } = nova2Prompt(0);
    expect(prompt.rearrangeSide, '夹具前提：nova-2 的请求没带 rearrangeSide').toBe(0);
    const el = hotSeatFrame(s);
    await drainRaf();
    expect(classOf(el, 'choice-action-btn').length,
      '热座屏仍然画了 5 个 `action:order:*` 布局按钮（用户要的整屏窗口没生效）').toBe(0);
    const notes = classOf(el, 'choice-note');
    expect(notes.length, '没有"由窗口承接"的提示行 ⇒ 玩家看不到去哪操作').toBe(1);
    expect(notes[0].text, '提示行文案不是重排窗口那条').toContain('重排协议');
  });

  it('远程页 renderNetBoard：同一条真请求 ⇒ 同样零按钮、提示行在树里（另一个分支）', async () => {
    restore = installStubDom();
    const { s, prompt } = nova2Prompt(1);
    expect(prompt.rearrangeSide, '夹具前提：nova-2 的请求没带 rearrangeSide').toBe(1);
    const el = netFrame(s, 1);
    await drainRaf();
    expect(classOf(el, 'choice-action-btn').length,
      '远程页仍然画了 5 个 `action:order:*` 布局按钮（两个渲染器各有一条分支，别只改一条）').toBe(0);
    expect(classOf(el, 'choice-note').length, '远程页没有"由窗口承接"的提示行').toBe(1);
  });

  it('反空转：同一条请求**去掉** `rearrangeSide` ⇒ 5 个按钮回来（否则上面两条是空腿）', async () => {
    restore = installStubDom();
    const { s } = nova2Prompt(0);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    delete (top.prompt as { rearrangeSide?: PlayerId }).rearrangeSide;
    const el = hotSeatFrame(s);
    await drainRaf();
    const btns = classOf(el, 'choice-action-btn');
    expect(btns.length, '去掉 rearrangeSide 之后按钮也没了 ⇒ 判据 2 证不了"是 rearrangeSide 起的作用"')
      .toBe(5);
    expect(classOf(el, 'choice-note').length).toBe(0);
  });
});

/* ============================================================================
 * 判据 3：窗口的「跳过」真的存在、真的能点，且不传就不出现
 * ========================================================================== */

describe('G5 T25 判据 3：草稿窗口的「跳过」（nova-2 那半步是 optional，原按钮流有这个出口）', () => {
  /** 一局可以开窗的状态（`renderModal` 在 `phase !== 'turn'` 时会自我关闭，且要读三条协议）。 */
  function openState(): GameState {
    const s = createGame();
    for (const pid of [0, 1] as PlayerId[]) {
      s.players[pid].protocols = [
        { defId: 'fire', compiled: false },
        { defId: 'light', compiled: false },
        { defId: 'darkness', compiled: false },
      ];
    }
    s.phase = 'turn';
    return s;
  }

  it('传了 skipLabel + onSkip ⇒ 树里有「跳过」，点它真的调到 onSkip 且窗口关闭', () => {
    restore = installStubDom();
    let skipped = 0;
    openControlRearrangeModal({
      getState: openState,
      title: 'nova-2：覆盖着新星牌——你可以重排你的协议',
      submitLabel: '完成重排',
      mode: 'draft',
      sides: [0],
      sessionKey: 'effect:probe',
      canCommit: () => false,
      skipLabel: '跳过',
      onSkip: () => { skipped += 1; },
      onCommit: noop,
    });
    const body = (globalThis as unknown as { document: { body: StubNode } }).document.body;
    const skip = classOf(body, 'rearrange-skip');
    expect(skip.length, '没渲染出「跳过」按钮 ⇒ 可选的重排变成"必须摆一次"').toBe(1);
    expect(skip[0].text, '「跳过」按钮文案不对').toBe('跳过');
    clickNode(skip[0]);
    expect(skipped, '点了「跳过」但 onSkip 没被调到').toBe(1);
    expect(descendants(body).filter((n) => isClass(n, 'rearrange-overlay')).length,
      '点了「跳过」之后窗口没关（应走 effect-choice 空应答，窗口必须收掉）').toBe(0);
    closeControlRearrangeModal();
  });

  it('反空转：不传 onSkip ⇒ 没有「跳过」（非 optional 的 momentum-4 不许长出这个按钮）', () => {
    restore = installStubDom();
    openControlRearrangeModal({
      getState: openState,
      title: 'momentum-4：重排你的协议',
      submitLabel: '完成重排',
      mode: 'draft',
      sides: [0],
      sessionKey: 'effect:probe2',
      canCommit: () => false,
      onCommit: noop,
    });
    const body = (globalThis as unknown as { document: { body: StubNode } }).document.body;
    expect(classOf(body, 'rearrange-skip').length,
      '没传 onSkip 也画了「跳过」⇒ 必选的重排被放行了').toBe(0);
    expect(classOf(body, 'rearrange-done').length, '「完成重排」应当仍在（反空转的分母）').toBe(1);
    closeControlRearrangeModal();
  });
});

/* ============================================================================
 * 判据 1 的源码腿 + 判据 4
 * ========================================================================== */

describe('G5 T25 判据 1（源码腿）：nova-2 带上标记，且 5 条 actions 一个不少', () => {
  it('nova2Middle 的这条请求含 `rearrangeSide: ctx.player`，actions 仍是 5 条 `action:order:*`', () => {
    const body = stripComments(NOVA_TS);
    // nova2Middle 是**生成器**（`function*`），而共用的 `functionBody` 按 `` function ${name}( ``
    // 定位（生成器对不上）⇒ 这里按"这个声明到下一个声明之间"切片，并要求切到足够长度。
    const at = body.indexOf('function* nova2Middle(');
    expect(at, 'nova.ts 里找不到 nova2Middle（结构被改动？）').toBeGreaterThan(-1);
    const next = body.indexOf('function* ', at + 1);
    const fn = body.slice(at, next > 0 ? next : at + 1200);
    expect(fn.length, '抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(200);
    expect(fn, 'nova-2 那条请求没有 `rearrangeSide: ctx.player`（与 momentum.ts:62 逐字同款）')
      .toContain('rearrangeSide: ctx.player');
    expect(fn, '`actions` 被改动了 —— 引擎靠它校验应答（窗口完成时回填的正是其中一条）')
      .toContain('actions: NOVA_PERMS.map((p) => `action:order:${p}`)');
    // 常量本身必须是那 5 条（不是被换成别的）
    expect(body, 'NOVA_PERMS 不再是 5 条 3 位排列').toContain("const NOVA_PERMS = ['021', '102', '120', '201', '210'];");
  });

  it('`rearrangeSide` 在引擎里没有读者：`src/core` 下只有 momentum / nova 的赋值与 types 的声明', () => {
    const files = ['core/effects/cards/momentum.ts', 'core/effects/cards/nova.ts', 'core/models/types.ts'];
    const hits: string[] = [];
    for (const rel of files) {
      const text = stripComments(read(rel));
      for (const m of text.matchAll(/rearrangeSide/g)) hits.push(`${rel}:${m.index}`);
    }
    // 恰好 3 处：momentum 的注释被 strip 掉了 ⇒ 只剩赋值；nova 赋值；types 声明
    expect(hits.length, `src/core 里 rearrangeSide 的出现次数变了：${hits.join(', ')}`).toBe(3);
    expect(stripComments(read('core/models/types.ts')), 'types.ts 里没有可选字段声明')
      .toContain('rearrangeSide?: PlayerId');
  });

  it('图鉴口径：nova-2 只有 `op-rearrange` 这一类重排标签（`misc-window` 已被用户删掉）', () => {
    const tags = read('data/cardEffectTags.ts');
    const row = tags.split('\n').find((l) => l.startsWith("  'nova-2': ["));
    expect(row, '生成物里找不到 nova-2 那一行（夹具前提）').toBeTruthy();
    expect(row!, 'nova-2 没有 op-rearrange ⇒ 它不在"会重排协议的卡"那一类里').toContain("'op-rearrange'");
    expect(row!, '`misc-window` 又回到 nova-2 身上了（用户要求删掉这一类）').not.toContain('misc-window');
    expect(tags, '生成物里还有 misc-window 这个类（用户要求删掉，不是改名）').not.toContain("id: 'misc-window'");
  });
});

describe('G5 T25 判据 4：`main.ts` 只在 `optional` 时传「跳过」', () => {
  it('syncRearrangeModalForEffect 体内同时出现 `prompt.optional` 与 `skipLabel`，空应答是 `choice: []`', () => {
    const body = functionBody(MAIN, 'syncRearrangeModalForEffect');
    expect(body.length, '抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(300);
    expect(body, '没有按 `prompt.optional` 判 ⇒ 必选的重排（momentum-4）也会长出「跳过」')
      .toContain('prompt.optional');
    expect(body, '开窗那一坨里没有 `skipLabel`').toContain('skipLabel');
    expect(body, '跳过的空应答语义与 choice-skip 不一致（应是 `choice: []`）')
      .toMatch(/onSkip: \(\) => cb\.onAction\(\{ kind: 'effect-choice', promptId: top\.id, choice: \[\] \}\)/);
    // 必须是**同一个三元/条件**罩着这两个字段（不是"文件里恰好都有"）
    const at = body.indexOf('...(prompt.optional');
    expect(at, '`skipLabel` 没有被 `prompt.optional` 罩在同一个对象字面量展开里').toBeGreaterThan(-1);
    const seg = body.slice(at, at + 320);
    expect(seg, '`skipLabel` 不在 `prompt.optional` 那个分支里').toContain('skipLabel');
    expect(seg, '`onSkip` 不在 `prompt.optional` 那个分支里').toContain('onSkip');
  });
});
