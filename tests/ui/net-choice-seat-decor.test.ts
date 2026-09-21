import { describe, it, expect, afterEach, vi } from 'vitest';
import { createGame } from '../../src/core/state/create';
import type { ChoiceRequest, PlayerId } from '../../src/core/models/types';
import { renderNetBoard, verifyPageHooks } from '../../src/ui/render-net';
import * as renderMod from '../../src/ui/render';
import * as fxGen2 from '../../src/ui/fx-gen2';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { descendants, installStubDom, isClass, makeStubEl, queryAllIn, type StubNode } from './net-dom-stub';
import { makeCard } from '../helpers';

/**
 * **G5 T23 · 判据 1-4 的验收腿**（与 `net-choice-overlay-seat.test.ts` 的复现腿同源，但覆盖整个
 * “装饰”清单：浮层 / 调暗 / 候选高亮 / 线槽高亮 / 几何型 FX）。
 *
 * 复现腿（`net-choice-overlay-seat.test.ts`）只盯用户真机截图里那一格（`.choice-pick-overlay`）。
 * 而 `renderChoiceUi` 里同一族的产出还有：`.choice-dim`（别人选牌时把我的卡压暗）、
 * `.choice-target` / `.choice-selected`（候选发光 + 可点）、`select-line` 的
 * `.choice-target` / `.choice-line` + 整条带点击、以及 `deferredFx`（透彻牌库眼睛 / 幸运宣告骰子）。
 * 本文件把这些**逐条**在真跑的桩 DOM 上判一遍，并且**两个座位都判**（`chooser × viewSeat`
 * 四种组合），因为“只判一边”正是这类闸门漏掉一半的典型形态。
 *
 * ## 能力边界（如实写清，与复现腿同一套）
 *  - 桩的 `addEventListener` 只记监听、不模拟点击语义 ⇒ 本腿证不了“点了会不会选中”，
 *    只证**装饰挂没挂、挂在谁的屏上**（“对手能替我点头”那一半由此间接成立：带 `.choice-target`
 *    的节点同时也被挂了点击，两者在 `renderChoiceUi` 里是同一个 `if (mineSeat)` 块里的相邻两句）；
 *  - `deferredFx` 那两条用 `vi.spyOn` 盯**调用点**（几何型 FX 在零矩形桩上本就不出画面）。
 */
afterEach(() => {
  renderMod.setChoiceSelection([], null);
  renderMod.setHandSelection(null);
  setFxViewSeat(null);
  vi.restoreAllMocks();
});

type S = ReturnType<typeof createGame>;

/** **对手屏上一条装饰都不许有的**类名清单（判据 1 的字面清单）。
 *  `.choice-mode` **不在**这里 —— 它是"现在不能操作"的锁，两个座位都必须有（判据 1 后半句）。 */
const DECOR_CLASSES = [
  'choice-pick-overlay', 'choice-pick-card', 'choice-pick-label', 'choice-pick-panel',
  'choice-bar', 'choice-target', 'choice-selected', 'choice-dim', 'choice-line',
] as const;

/** 一帧最简对局：草稿已过、`turnPlayer` 显式写、协议给全；场上 1 张卡 + 双方各 2 张手牌。 */
function baseState(turnPlayer: PlayerId): S {
  const s = createGame({ seed: 't23-decor', draftStarter: 0, firstToPlay: turnPlayer });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
    // 手牌得自己发（本腿跳过草稿；`createGame` 之后手牌是空的）
    s.players[p].hand.push(makeCard('speed-0', p, 'hand', true, null));
    s.players[p].hand.push(makeCard('water-4', p, 'hand', true, null));
  }
  // 场上 1 张（P0 线 0）—— 「候选在场上」那一档要有 `.card[data-uid]` 可高亮
  s.players[0].stacks = [[{
    uid: 't23-c1', defId: 'fire-0', faceUp: true, owner: 0, zone: 'field', line: 0, pos: 0,
  }], [], []] as never;
  (s as { phase: string }).phase = 'turn';
  s.step = 'action';
  s.turnPlayer = turnPlayer;
  s.pendingEffects.length = 0;
  s.pendingPlay.length = 0;
  s.pendingShift.length = 0;
  s.winner = null;
  return s;
}

function withPrompt(s: S, chooser: PlayerId, prompt: ChoiceRequest): void {
  s.pendingEffects.push({
    id: 'pe-t23-decor',
    player: chooser,
    gen: (function* g(): Generator<never, void, never> { /* 本腿不推演 */ })() as never,
    sourceUid: 't23-c1',      // luck 骰子的源卡：场上那张（有 [data-uid]）
    sourceDefId: 'luck-0',
    prompt,
    lastAnswer: null,
  });
}

/** 候选 = 场上那张卡（`fire-0` / `t23-c1`）⇒ 操作方屏走"高亮 + 其余置灰"，不出浮层。 */
const onBoardPrompt = (chooser: PlayerId): ChoiceRequest => ({
  kind: 'select', title: 'speed-5：弃1张牌', min: 1, max: 1, optional: false, chooser,
  candidates: [{
    uid: 't23-c1', defId: 'fire-0', faceUp: true, owner: 0, zone: 'field', line: 0, pos: 0, label: 'fire-0',
  }],
});

/** 候选 = 棋盘上没有单卡 DOM 的卡（弃牌堆/牌库那类，uid 是造的）⇒ 操作方屏必须有浮层。 */
const offBoardPrompt = (chooser: PlayerId, title: string): ChoiceRequest => ({
  kind: 'select', title, min: 1, max: 1, optional: false, chooser,
  candidates: ['t23-gone-1', 't23-gone-2'].map((uid, i) => ({
    uid, defId: i === 0 ? 'water-4' : 'plague-1', faceUp: true, owner: chooser,
    zone: 'trash' as const, line: null, pos: null, label: 'gone',
  })),
});

const linePrompt = (chooser: PlayerId): ChoiceRequest => ({
  kind: 'select-line', title: '选择目标线', min: 1, max: 1, optional: false, chooser,
  candidates: [], lines: [0, 1, 2],
});

const actionPrompt = (chooser: PlayerId): ChoiceRequest => ({
  kind: 'select-action', title: '请选择动作', min: 1, max: 1, optional: false, chooser,
  candidates: [], actions: ['action:flip'],
});

function renderFrame(s: S, viewSeat: PlayerId): StubNode {
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat });
  return root;
}

const countOf = (root: StubNode, sel: string): number => queryAllIn(root, sel).length;
const decorIn = (root: StubNode): string[] =>
  DECOR_CLASSES.filter((c) => descendants(root).some((n) => isClass(n, c)));

/** 浮层里露出的候选卡面文本 —— "对手屏一张正面都没露"的直接证据。 */
const overlayLabels = (root: StubNode): string[] =>
  descendants(root).filter((n) => isClass(n, 'choice-pick-label')).map((n) => n.text);

describe('G5 T23 · 判据 1/3：对手屏一条装饰都不画，`.choice-mode` 仍然在', () => {
  const variants = [
    ['select·候选在场上', (c: PlayerId) => onBoardPrompt(c)],
    ['select·候选不在棋盘上', (c: PlayerId) => offBoardPrompt(c, 'time-0：从弃牌堆打出1张牌')],
    ['select-line', (c: PlayerId) => linePrompt(c)],
    ['select-action', (c: PlayerId) => actionPrompt(c)],
  ] as const;

  it.each(variants)('%s：chooser × viewSeat 四种组合下对手屏装饰全 0、锁仍在', (tag, build) => {
    const restore = installStubDom();
    try {
      for (const chooser of [0, 1] as const) {
        for (const viewSeat of [0, 1] as const) {
          const s = baseState(chooser);
          withPrompt(s, chooser, build(chooser));
          const where = `${tag}：chooser=${chooser}/viewSeat=${viewSeat}`;
          const foeRoot = renderFrame(s, viewSeat);

          // ── 反空集合：操作方那一屏真的进了选择分支（否则下面的判据会是空判据）──
          //    判据取"操作方屏的 .net-hands 有 .choice-mode"：`renderChoiceUi` 在**分流之前**
          //    就加它（R11-4 的挂点），所以它同时证明"这一帧有挂起选择"且"分支被走到了"。
          const chooserRoot = viewSeat === chooser ? foeRoot : renderFrame(s, chooser);
          const chooserHands = descendants(chooserRoot).find((n) => isClass(n, 'net-hands'));
          expect(chooserHands, `${where}：操作方屏上找不到 .net-hands`).toBeTruthy();
          expect(isClass(chooserHands!, 'choice-mode'),
            `${where}：操作方屏的 .net-hands 没有 .choice-mode —— 这一帧没进选择分支`).toBe(true);
          // 反向对照：操作方那一屏的座位锚点必须是**操作方那一帧**的座位（不是本帧的 viewSeat）
          expect(chooserHands!.dataset.viewSeat,
            `${where}：操作方那一帧的 .net-hands 座位锚点不对`).toBe(String(chooser));

          if (viewSeat !== chooser) {
            // ── 判据 1：对手屏一条装饰都不许有 ──
            const bad = decorIn(foeRoot);
            expect(bad, `${where}：对手屏上出现了装饰 [${bad.join(', ')}]`
              + ' —— 用户 2026-09-21 真机反馈的那一格（浮层被画到对手那一屏，还列出操作方手牌正面）')
              .toEqual([]);
            expect(overlayLabels(foeRoot), `${where}：对手屏上读到了候选卡面`).toEqual([]);
            // ── 判据 1 后半：锁（`.choice-mode`）必须**仍然**在，两处挂点都要有 ──
            const hands = descendants(foeRoot).find((n) => isClass(n, 'net-hands'));
            expect(hands, `${where}：对手屏上找不到 .net-hands`).toBeTruthy();
            expect(isClass(hands!, 'choice-mode'),
              `${where}：对手屏的 .net-hands 丢了 .choice-mode（"现在不能操作"的锁没了）`).toBe(true);
            const board = foeRoot.children.find((n) => isClass(n, 'net-board'));
            expect(board, `${where}：root 下没有 .net-board`).toBeTruthy();
            expect(isClass(board!, 'choice-mode'),
              `${where}：对手屏的板根丢了 .choice-mode（styles-net.css 第 6 节的镜像规则失效）`).toBe(true);
          } else {
            expect(countOf(foeRoot, '.choice-bar'), `${where}：操作方屏上没有选择条`).toBe(1);
          }
        }
      }
    } finally {
      restore();
    }
  });
});

describe('G5 T23 · 判据 2：操作方自己屏逐项不变（两个座位）', () => {
  it('select·候选在场上：候选卡 .choice-target、其余卡 .choice-dim、恰好一条 .choice-bar、无浮层', () => {
    const restore = installStubDom();
    try {
      for (const chooser of [0, 1] as const) {
        const s = baseState(chooser);
        withPrompt(s, chooser, onBoardPrompt(chooser));
        const root = renderFrame(s, chooser);
        const tag = `chooser=${chooser}`;
        // 反空集合：场上那张候选卡必须真的在 DOM 里（否则下面两条是空判据）
        expect(countOf(root, '.card[data-uid="t23-c1"]'), `${tag}：候选卡不在操作方屏的 DOM 里`).toBe(1);
        expect(countOf(root, '.card.choice-target'), `${tag}：候选卡没有 .choice-target`).toBe(1);
        expect(countOf(root, '.card.choice-dim'), `${tag}：其余卡没有 .choice-dim（自己选牌时自己的卡整体变灰）`)
          .toBeGreaterThan(0);
        expect(countOf(root, '.choice-pick-overlay'), `${tag}：候选在场上却出了浮层（与高亮重复）`).toBe(0);
        expect(countOf(root, '.choice-bar'), `${tag}：操作方屏上没有选择条`).toBe(1);
      }
    } finally {
      restore();
    }
  });

  it('select·候选不在棋盘上：必须出浮层 + 候选正面 + 选择条', () => {
    const restore = installStubDom();
    try {
      for (const chooser of [0, 1] as const) {
        const s = baseState(chooser);
        withPrompt(s, chooser, offBoardPrompt(chooser, 'time-0：从弃牌堆打出1张牌'));
        const root = renderFrame(s, chooser);
        const tag = `chooser=${chooser}`;
        expect(countOf(root, '.choice-pick-overlay'), `${tag}：操作方屏没有浮层 ⇒ 这个 prompt 永久无法应答`).toBe(1);
        expect(countOf(root, '.choice-pick-card'), `${tag}：浮层里的候选卡格数不对`).toBe(2);
        expect(overlayLabels(root), `${tag}：浮层里没有候选卡面文本`).toEqual(['water-4', 'plague-1']);
        expect(countOf(root, '.choice-bar'), `${tag}：操作方屏上没有选择条`).toBe(1);
      }
    } finally {
      restore();
    }
  });

  it('select-line：线槽带 .choice-target/.choice-line + 选择条（操作方屏）', () => {
    const restore = installStubDom();
    try {
      for (const chooser of [0, 1] as const) {
        const s = baseState(chooser);
        withPrompt(s, chooser, linePrompt(chooser));
        const root = renderFrame(s, chooser);
        const tag = `chooser=${chooser}`;
        expect(countOf(root, '.net-lane-band'), `${tag}：板根下没有 .net-lane-band（判据无从成立）`)
          .toBeGreaterThan(0);
        expect(countOf(root, '.choice-line'), `${tag}：没有线槽带 .choice-line`).toBe(3);
        expect(countOf(root, '.choice-target'), `${tag}：没有线槽带 .choice-target`).toBe(3);
        expect(countOf(root, '.choice-bar'), `${tag}：操作方屏上没有选择条`).toBe(1);
      }
    } finally {
      restore();
    }
  });

  it('select-action：选择条 + 动作按钮（操作方屏）', () => {
    const restore = installStubDom();
    try {
      for (const chooser of [0, 1] as const) {
        const s = baseState(chooser);
        withPrompt(s, chooser, actionPrompt(chooser));
        const root = renderFrame(s, chooser);
        expect(countOf(root, '.choice-bar'), `chooser=${chooser}：操作方屏上没有选择条`).toBe(1);
        expect(countOf(root, '.choice-action-btn'), `chooser=${chooser}：actions 的按钮没产出`).toBe(1);
      }
    } finally {
      restore();
    }
  });
});

describe('G5 T23 · 判据 2 后半：几何型 FX（透彻眼睛 / 幸运骰子）只在操作方屏排', () => {
  it('透彻：聪明眼睛只进操作方屏的 deferredFx', () => {
    const restore = installStubDom();
    try {
      for (const chooser of [0, 1] as const) {
        for (const viewSeat of [0, 1] as const) {
          const s = baseState(chooser);
          withPrompt(s, chooser, offBoardPrompt(chooser, '透彻：从牌库中选择阈值卡'));
          const eye = vi.spyOn(fxGen2, 'startClarityDeckEye');
          renderFrame(s, viewSeat);
          const want = viewSeat === chooser ? 1 : 0;
          expect(eye.mock.calls.length,
            `chooser=${chooser}/viewSeat=${viewSeat}：聪明眼睛被排了 ${eye.mock.calls.length} 次（期望 ${want}）`
            + '—— 对手屏上排它等于替操作方表演一遍他的效果').toBe(want);
          if (want === 1) expect(eye.mock.calls[0][0], '眼睛的玩家号不是操作方').toBe(chooser);
          eye.mockRestore();
        }
      }
    } finally {
      restore();
    }
  });

  it('luck：宣告骰子只进操作方屏的 deferredFx', () => {
    const restore = installStubDom();
    try {
      for (const chooser of [0, 1] as const) {
        for (const viewSeat of [0, 1] as const) {
          const s = baseState(chooser);
          withPrompt(s, chooser, { ...actionPrompt(chooser), title: 'luck-0：宣告数字' });
          const dice = vi.spyOn(fxGen2, 'startLuckDiceFx');
          renderFrame(s, viewSeat);
          const want = viewSeat === chooser ? 1 : 0;
          expect(dice.mock.calls.length,
            `chooser=${chooser}/viewSeat=${viewSeat}：幸运骰子被排了 ${dice.mock.calls.length} 次（期望 ${want}）`)
            .toBe(want);
          if (want === 1) expect(dice.mock.calls[0][0], '骰子的源卡 uid 不对').toBe('t23-c1');
          dice.mockRestore();
        }
      }
    } finally {
      restore();
    }
  });
});

describe('G5 T23 · 判据 1 的合成对照：`renderNetBoard` 自带的运行时自查在对手屏上没有 Choice 相关的失败', () => {
  /**
   * **为什么要这一条**：判据 1 的两半（"装饰全 0" + "锁仍然是真"）在本文件里由上面那些断言分别证明，
   * 而 `renderNetBoard` 的 `opts.verifyHooks` 正是**生产代码里那份**逐条核对（21 条 A 类钩子 +
   * 约束 7/8/9/11 …）。让它在**有挂起选择的对手屏**那一帧整份 `✓`，并把"这一帧真的进了选择分支"
   * 一起钉住（`.net-hands.choice-mode`）—— 只看 `✓` 一个词的话，"把判据改宽"也能过，所以两半都读。
   *
   * 能力边界：`verifyPageHooks` 只看**标记与类名**（它自己没有布局引擎），所以这条不证观感。
   */
  it('对手屏(有挂起选择)：自查里唯一的 fatal 是桩的逗号组缺口，且 .net-hands 仍带 .choice-mode', () => {
    const restore = installStubDom();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* 反面证据：不许有失败告警 */ });
    try {
      for (const viewSeat of [0, 1] as const) {
        const chooser: PlayerId = viewSeat === 0 ? 1 : 0;   // 操作方 = 对手
        const s = baseState(chooser);
        withPrompt(s, chooser, offBoardPrompt(chooser, 'time-0：从弃牌堆打出1张牌'));
        const root = makeStubEl('div');
        const noop = (): void => { /* noop */ };
        const cb = {
          onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
          onDraftBan: noop, onWinReset: noop,
          // 不传 onPreviewChange：一帧"真实联机"形态（没有预览工具条）
        };
        renderNetBoard(root as unknown as HTMLElement, s, cb as never, { viewSeat });
        const wrap = root.children.find((n) => isClass(n, 'net-board'));
        expect(wrap, `viewSeat=${viewSeat}：root 下没有 .net-board`).toBeTruthy();
        const summary = verifyPageHooks(wrap as unknown as HTMLElement, viewSeat,
          { turnPlayer: s.turnPlayer, operator: chooser });
        const hands = descendants(root).find((n) => isClass(n, 'net-hands'));
        expect(isClass(hands!, 'choice-mode'),
          `viewSeat=${viewSeat}：这一帧没进选择分支（下面的自查会是空判据）`).toBe(true);
        console.log(`\n===== 对手屏自查（viewSeat=${viewSeat}，操作方=P${chooser + 1}）=====\n  ${summary}`);
        // ⚠️ **这条腿跑在桩 DOM 上，而桩的选择器引擎不支持逗号组**（`queryAllIn` 遇到 `,` 直接返空）
        //    ⇒ `.trash-pile.p1/.p2` 那条探针**必然**报 1 项。这是**桩的能力缺口**，不是本页缺陷：
        //    真浏览器里同一个选择器命中 2 个（大厅 CDP 门那条链上跑的就是真 DOM）。
        //    所以判据取"**除那一条外，整份自查零失败**"，并把形状钉死：
        //    任何**额外**的 fatal 都会让"1 项"这个计数或"（探测 …）$"这个结尾不匹配。
        expect(summary, `viewSeat=${viewSeat}：对手屏的运行时自查出现了**除逗号组探针之外**的失败`
          + '（本页这一帧的钩子 / 约束有问题）')
          .toMatch(/^自查 ✗ 1 项：/);
        expect(summary, `viewSeat=${viewSeat}：那唯一一条 fatal 不是桩的逗号组缺口 —— `
          + `说明本页这一帧有别的问题（原文：${summary}）`).toContain('.trash-pile');
        // 告警侧同一判据：**除**那一条桩缺口之外，一条失败告警都不许有
        // （`verifyPageHooks` 失败时会把明细整段 `console.warn`，所以这里是"有没有别的失败"的读侧）。
        const fails = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('失败项'));
        expect(fails.filter((m) => !m.includes('.trash-pile')),
          `viewSeat=${viewSeat}：自查留下了**非桩缺口**的失败告警`).toEqual([]);
        warn.mockClear();
      }
    } finally {
      warn.mockRestore();
      restore();
    }
  });
});

describe('G5 T23 · 判据 4：无 pending 时照旧清空共享选择态', () => {
  it('setChoiceSelection([], null) 仍被调用（render.ts 的拖拽闸门靠它解除）', () => {
    const restore = installStubDom();
    try {
      const s = baseState(0);   // baseState 已清空 pendingEffects ⇒ 走"无 prompt"那条出口
      const spy = vi.spyOn(renderMod, 'setChoiceSelection');
      renderFrame(s, 0);
      renderFrame(s, 1);
      const clears = spy.mock.calls.filter((c) => Array.isArray(c[0]) && c[0].length === 0 && c[1] === null);
      expect(clears.length, '无 pending 时没有调用 setChoiceSelection([], null) —— '
        + 'render.ts:5583 的"选择模式禁止拖拽打牌"会永久锁死').toBeGreaterThanOrEqual(2);
    } finally {
      restore();
    }
  });
});
