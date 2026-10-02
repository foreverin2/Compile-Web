/**
 * ★ 2026-10-02（P3 第四批）：**选择条 / 草稿页 / 遮罩的英文帧**（真产出函数 + 真文案表）。
 *
 * ## 这条腿补的是什么洞
 *
 * 本轮的抽取把 `render.ts` / `render-net.ts` 的玩家可见文案搬进了 `src/i18n/`，但
 * **真机自查没抓到挂起选择那一帧**（`.choice-bar` 只在"有挂起选择"时渲染，构造它要
 * 真打出一张带选择效果的中部卡；CDP 那一轮试了热座与教学两条路都没落成牌）。
 * 一件事没验过就不许说它验过 ⇒ 这里用**已有的桩 DOM + 真产出函数**补一条**机检**腿：
 * 把语言切到 `en`，真跑 `renderNetBoard`，断言选择条上那几句**逐字等于英文表的值**。
 *
 * ## 为什么是`renderNetBoard`而不是`renderBoard`
 *
 * `render.ts` 的 `renderBoard` 要真 `document`（量矩形、绑拖拽），桩 DOM 撑不住；
 * `renderNetBoard` 在本仓已有成熟的桩 DOM 夹具（`./net-dom-stub`，见
 * `net-choice-overlay-seat.test.ts`），而它**复用同一个 `choiceBar`**（`render.ts` 导出）
 * ⇒ 选择条那一族键在英文下的形态是真的被跑到、真的被读回来的。
 *
 * ## 判据（三条，都不是"恒真"形态）
 *
 *  1. 英文帧里，`.choice-title` / `.choice-count` / `.choice-confirm` / `.choice-skip` /
 *     `.choice-hint` / `.operator-banner` 都**存在**且**逐字等于 `EN[...]` 填完占位符的值**；
 *  2. 同一帧里这些节点**一个汉字都没有**（`[\u3400-\u9fff]` 不命中）；
 *  3. 切回中文，同一帧逐字等于 `ZH[...]`（证明这条腿不是在"英文表恰好等于中文表"上恒真）。
 *
 * ★ 2026-10-02（P5）：`choice-title` **进了"英文帧零汉字"的判据面**（原来它带着引擎给的
 * `prompt.title` 中文，属登记的豁免面）。见 `src/i18n/engine-prompt.ts`：引擎文案一个字没动，
 * 显示层按模式表出英文；未命中就回退引擎原文（`engine-prompt-title.test.ts` 有回退腿）。
 * 这一处是**收紧**（豁免删掉、判据面变大），不是放宽。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installStubDom, makeStubEl, descendants, isClass, type StubNode } from '../ui/net-dom-stub';
import { createGame } from '../../src/core/state/create';
import { renderNetBoard, resetNetUiState } from '../../src/ui/render-net';
import { setChoiceSelection, setHandSelection } from '../../src/ui/render';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { EN } from '../../src/i18n/en';
import { ZH } from '../../src/i18n/zh';
import { setLang } from '../../src/i18n';
import type { ChoiceCard, PlayerId } from '../../src/core/models/types';

type S = ReturnType<typeof createGame>;

afterEach(() => {
  setLang('zh');
  setChoiceSelection([], null);
  setHandSelection(null);
  setFxViewSeat(null);
  resetNetUiState();
});

/** 一帧最简对局（照 `net-choice-overlay-seat.test.ts` 的 `baseState`） */
function baseState(turnPlayer: PlayerId): S {
  const s = createGame({ seed: 'i18n-choice-4', draftStarter: 0, firstToPlay: turnPlayer });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  s.step = 'action';
  s.turnPlayer = turnPlayer;
  s.pendingEffects.length = 0;
  s.pendingPlay.length = 0;
  s.pendingShift.length = 0;
  s.winner = null;
  // 手牌得自己发：本腿跳过了草稿（`createGame` 之后手牌是空的，草稿期才发）
  for (const p of [0, 1] as const) {
    s.players[p].hand.push({ uid: `i18n-h-${p}-0`, defId: 'speed-0', faceUp: true, owner: p, zone: 'hand', line: null, pos: null });
    s.players[p].hand.push({ uid: `i18n-h-${p}-1`, defId: 'water-4', faceUp: true, owner: p, zone: 'hand', line: null, pos: null });
  }
  return s;
}

/** 往状态上挂一条 **可选** `select-line` 效果（可选 ⇒ 选择条上会多一个「跳过」按钮） */
function withSelectLine(s: S, chooser: PlayerId, title: string): void {
  s.pendingEffects.push({
    id: 'pe-i18n-4',
    player: chooser,
    gen: (function* g(): Generator<never, void, never> { /* 本腿不推演 */ })() as never,
    sourceUid: 'src-i18n-4',
    sourceDefId: 'speed-5',
    prompt: { kind: 'select-line', title, min: 1, max: 1, optional: true, candidates: [], lines: [0, 1, 2] } as never,
    lastAnswer: null,
  });
}

function renderFrame(s: S, viewSeat: PlayerId): StubNode {
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat });
  return root;
}

/** 某个类名节点的正文（读不到就是 null） */
const textOf = (root: StubNode, cls: string): string | null => {
  const el = descendants(root).find((n) => isClass(n, cls));
  return el === undefined ? null : el.text;
};

const CJK = /[\u3400-\u9fff]/;

describe('★ P3 第四批：选择条的英文帧（真产出函数 + 真文案表）', () => {
  it('英文：选择条上那几句逐字等于 `EN[...]`，且一个汉字都没有', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      const chooser: PlayerId = 0;
      const s = baseState(chooser);
      withSelectLine(s, chooser, 'speed-5：偏转到哪条链路');
      const root = renderFrame(s, chooser);

      // 判据 ①：六处逐字等于英文表（`{title}` 那一格是引擎给的中文标题，只断言外壳）
      expect(textOf(root, 'operator-banner'), '没有 operator-banner').toBe(
        EN['render-net.choice.operator'].replace('{n}', '1'));
      expect(textOf(root, 'choice-title'), '没有 choice-title').toBe(
        EN['render.choice.title'].replace('{who}', 'P1').replace('{title}', 'speed-5: which line to shift to'));
      expect(textOf(root, 'choice-hint'), '没有 choice-hint').toBe(EN['render.choice.hint-line']);
      expect(textOf(root, 'choice-skip'), '没有 choice-skip').toBe(EN['render.choice.skip']);
      // 判据 ②：**整个选择条**一个汉字都没有。
      // ★ 2026-10-02（P5）：`choice-title` 这一轮**从豁免面挪进了判据面** —— 上一版它带着
      //    引擎给的 `prompt.title`（`speed-5：偏转到哪条链路`，红线数据层）所以"有意保留中文"，
      //    本轮的显示层替换（`enginePromptTitle()`）之后它**必须是英文**。
      //    这是一次**收紧**，不是放宽：豁免面被删掉了，判据面反而变大。
      for (const cls of ['operator-banner', 'choice-title', 'choice-hint', 'choice-skip']) {
        expect(CJK.test(textOf(root, cls) ?? ''), `${cls} 的英文帧里出现了汉字：${String(textOf(root, cls))}`)
          .toBe(false);
      }
      // 反向锚点：同一句在**中文**模式下仍是引擎原文（证明上面那条不是因为"夹具根本没渲染标题"）
      setLang('zh');
      const zhState = baseState(chooser);
      withSelectLine(zhState, chooser, 'speed-5：偏转到哪条链路');
      const zhRoot = renderFrame(zhState, chooser);
      expect(textOf(zhRoot, 'choice-title'), '中文帧里引擎标题应当逐字仍是引擎原文').toBe(
        ZH['render.choice.title'].replace('{who}', 'P1').replace('{title}', 'speed-5：偏转到哪条链路'));
      expect(EN['render.choice.skip'], '英文的「跳过」与中文一样 ⇒ 这条腿恒真').not.toBe(ZH['render.choice.skip']);
    } finally {
      restore();
    }
  });

  it('反向（中英不同）：切回中文，同一帧逐字等于 `ZH[...]`', () => {
    const restore = installStubDom();
    try {
      setLang('zh');
      const chooser: PlayerId = 0;
      const s = baseState(chooser);
      withSelectLine(s, chooser, 'speed-5：偏转到哪条链路');
      const root = renderFrame(s, chooser);
      expect(textOf(root, 'operator-banner')).toBe(ZH['render-net.choice.operator'].replace('{n}', '1'));
      expect(textOf(root, 'choice-hint')).toBe(ZH['render.choice.hint-line']);
      expect(textOf(root, 'choice-skip')).toBe('跳过');
      expect(CJK.test(textOf(root, 'choice-hint') ?? ''), '中文帧里没有汉字 ⇒ 判据面错了').toBe(true);
    } finally {
      restore();
    }
  });

  it('`select`（有候选、带确认按钮）：`choice-count` / `choice-confirm` 在英文下是英文', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      const chooser: PlayerId = 0;
      const s = baseState(chooser);
      const cards: ChoiceCard[] = s.players[0].hand.slice(0, 2).map((c) => ({
        uid: c.uid, defId: c.defId, faceUp: true, owner: chooser, zone: 'hand' as const,
        line: null, pos: null, label: c.defId,
      }));
      expect(cards.length, '夹具失败：手牌是空的').toBeGreaterThan(0);
      s.pendingEffects.push({
        id: 'pe-i18n-4b', player: chooser,
        gen: (function* g(): Generator<never, void, never> { /* 不推演 */ })() as never,
        sourceUid: 'src', sourceDefId: 'speed-5',
        prompt: { kind: 'select', title: 'speed-5：弃1张牌', min: 1, max: 1, optional: false, candidates: cards } as never,
        lastAnswer: null,
      });
      const root = renderFrame(s, chooser);
      expect(textOf(root, 'choice-count'), '没有 choice-count').toBe(
        EN['render.choice.count'].replace('{n}', '0').replace('{max}', '1'));
      expect(textOf(root, 'choice-confirm'), '没有 choice-confirm').toBe(EN['render.choice.confirm']);
      expect(textOf(root, 'choice-title'), '没有 choice-title').toBe(
        EN['render.choice.title'].replace('{who}', 'P1').replace('{title}', 'speed-5: discard 1 card'));
      expect(CJK.test(`${String(textOf(root, 'choice-count'))}${String(textOf(root, 'choice-confirm'))}${String(textOf(root, 'choice-title'))}`),
        '英文帧的计数/确认/标题里出现汉字').toBe(false);
      // 反向锚点：确认/计数这两条中英**不同值** ⇒ 上面那两条不是在"中英同值"上恒真
      expect(ZH['render.choice.confirm'], '英文的「确认」与中文一样').not.toBe(EN['render.choice.confirm']);
      expect(ZH['render.choice.count'], '英文的计数与中文一样').not.toBe(EN['render.choice.count']);
    } finally {
      restore();
    }
  });
});
