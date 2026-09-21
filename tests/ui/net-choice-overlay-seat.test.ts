import { describe, it, expect, afterEach } from 'vitest';
import { createGame } from '../../src/core/state/create';
import type { ChoiceCard, PlayerId } from '../../src/core/models/types';
import { renderNetBoard } from '../../src/ui/render-net';
import { setChoiceSelection, setHandSelection } from '../../src/ui/render';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { descendants, installStubDom, isClass, makeStubEl, queryAllIn, type StubNode } from './net-dom-stub';
import { makeCard } from '../helpers';

/**
 * **G5 T23 复现腿：`select` 的定向选牌浮层（`.choice-pick-overlay`）只许出现在操作方自己的屏幕上**
 *
 * ## 用户真机看到的现象（2026-09-21，两个真窗口）
 *
 * P2 打出 `speed-5`（"弃1张牌"，`src/core/effects/cards/speed.ts:168`，**没有** `chooser`
 * ⇒ 操作方 = 效果属主 = P2），**P1 的窗口**弹出一个居中的"P2 操作 — speed-5：弃1张牌"
 * 选牌浮层，列着 **P2 手牌的四张正面**；P2 自己的窗口上没有这个浮层。
 *
 * ## 根因（读源码即可定位，`src/ui/render-net.ts` 的 `renderChoiceUi`）
 *
 * 同一段里对"操作方那一侧"有**两条**出口：
 *  - 选择条 `.choice-bar`：走 `mountIfMine`（`who !== viewSeat` 直接 return）—— R11-3 的闸门；
 *  - 定向选牌浮层 `.choice-pick-overlay`：`if (offBoard.length > 0) wrap.appendChild(…)`
 *    —— **没有闸门**。
 * 于是"候选卡不在本屏 DOM 里"的那一侧（对手屏：对手手牌只剩数量占位、没有
 * `.card[data-uid]`，见 `buildP0Hand` / `buildP1Hand` 的 `handVisibility`）照样会
 * 把浮层挂出来 —— 既画错屏，也把操作方**手牌的正面**摊给对手看。
 *
 * ## 这条腿的判据（两条都必须在改后为真）
 *
 * 1. **对手屏（`viewSeat !== chooser`）**：既没有 `.choice-pick-overlay`，也没有任何
 *    `.choice-pick-card`（一张候选正面都不许露），也没有 `.choice-bar`；
 * 2. **操作方自己的屏（`viewSeat === chooser`）**：候选在棋盘上有 DOM 时不出浮层（走手牌高亮
 *    + 选择条），候选**不在**棋盘上时浮层**必须**出现 —— 否则"把浮层一律删掉"也会让第 1 条变绿，
 *    而那会把"时间0 从弃牌堆自选打出 / 透彻 从牌库选阈值卡"这类选择变成永久无法应答。
 *
 * ## 能力边界（如实写清）
 *
 * 桩 DOM 的 `addEventListener` 是 noop ⇒ 本腿证不了"点候选卡能不能选中"，只证**浮层挂没挂、
 * 挂在谁的屏上、露没露正面**。真浏览器的端到端仍归 CDP 门禁那一族。
 */
afterEach(() => {
  setChoiceSelection([], null);
  setHandSelection(null);
  setFxViewSeat(null);
});

type S = ReturnType<typeof createGame>;

/** 一帧最简对局：草稿已过、轮到 `turnPlayer`、协议给全（避免协议不匹配干扰）。 */
function baseState(turnPlayer: PlayerId): S {
  const s = createGame({ seed: 't23-choice-seat', draftStarter: 0, firstToPlay: turnPlayer });
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
    s.players[p].hand.push(makeCard('speed-0', p, 'hand', true, null));
    s.players[p].hand.push(makeCard('water-4', p, 'hand', true, null));
  }
  return s;
}

/** 往状态上挂一条 `select` 效果（`gen` 空转 —— 本腿只读 `prompt`，不推演效果）。 */
function withSelect(s: S, chooser: PlayerId, title: string, cards: ChoiceCard[]): void {
  s.pendingEffects.push({
    id: 'pe-t23',
    player: chooser,
    gen: (function* g(): Generator<never, void, never> { /* 本腿不推演 */ })() as never,
    sourceUid: 'src-t23',
    sourceDefId: 'speed-5',
    prompt: { kind: 'select', title, min: 1, max: 1, optional: false, candidates: cards },
    lastAnswer: null,
  });
}

/** 把某一玩家**手牌**（真 uid）当成候选：在操作方自己屏上它们有 `.card[data-uid]`。 */
function handCandidates(s: S, owner: PlayerId): ChoiceCard[] {
  return s.players[owner].hand.slice(0, 2).map((c) => ({
    uid: c.uid, defId: c.defId, faceUp: true, owner, zone: 'hand' as const, line: null, pos: null, label: c.defId,
  }));
}

/** 棋盘上没有单卡 DOM 的候选（弃牌堆 / 牌库那类）：uid 是造的，谁屏上都不存在。 */
function offBoardCandidates(owner: PlayerId): ChoiceCard[] {
  return ['gone-1', 'gone-2'].map((uid, i) => ({
    uid, defId: i === 0 ? 'water-4' : 'plague-1', faceUp: true, owner,
    zone: 'trash' as const, line: null, pos: null, label: 'gone',
  }));
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

const countOf = (root: StubNode, sel: string): number => queryAllIn(root, sel).length;

/** 浮层里露出的卡面文本（`.choice-pick-label`）：用来证"对手屏上一张正面都没露"。 */
const overlayLabels = (root: StubNode): string[] =>
  descendants(root).filter((n) => isClass(n, 'choice-pick-label')).map((n) => n.text);

describe('G5 T23 · `select` 浮层只挂在操作方那一屏（对手屏不许出现、更不许露手牌正面）', () => {
  it('候选是操作方手牌（speed-5 那一格）：对手屏 0 个浮层 / 0 张正面，操作方屏也没有浮层（走手牌高亮）', () => {
    const restore = installStubDom();
    try {
      const chooser: PlayerId = 1;
      const foe: PlayerId = 0;
      const s = baseState(chooser);
      const cards = handCandidates(s, chooser);
      expect(cards.length, '夹具失败：操作方手里没有牌').toBeGreaterThan(0);
      withSelect(s, chooser, 'speed-5：弃1张牌', cards);

      // ── 对手屏（我 = P1，操作方是 P2）：这是用户截图里那一格 ──
      const foeRoot = renderFrame(s, foe);
      expect(countOf(foeRoot, '.choice-pick-overlay'),
        '对手屏上出现了"操作方选牌"浮层（用户真机截图里那一格：画错了屏）').toBe(0);
      expect(countOf(foeRoot, '.choice-pick-card'),
        '对手屏上出现了候选卡格（操作方的手牌正面会因此泄给对手）').toBe(0);
      expect(overlayLabels(foeRoot), '对手屏上读到了候选卡面').toEqual([]);
      // R11-3 既有纪律的对照：选择条在对手屏上本来就不挂
      expect(countOf(foeRoot, '.choice-bar'), '对手屏上出现了选择条（R11-3 被破坏）').toBe(0);

      // ── 操作方自己的屏：候选就是他自己的手牌 ⇒ 有 `.card[data-uid]` ⇒ 走高亮，不需要浮层 ──
      const mineRoot = renderFrame(s, chooser);
      expect(countOf(mineRoot, '.choice-pick-overlay'),
        '操作方屏上对"自己手牌里的候选"也出了浮层（与手牌高亮重复）').toBe(0);
      expect(countOf(mineRoot, '.choice-bar'), '操作方屏上没有选择条（他要靠它确认）').toBe(1);
    } finally {
      restore();
    }
  });

  it('候选不在棋盘上（时间0 / 透彻那类）：操作方屏**必须**有浮层，对手屏仍然 0 个', () => {
    const restore = installStubDom();
    try {
      const chooser: PlayerId = 1;
      const foe: PlayerId = 0;
      const s = baseState(chooser);
      withSelect(s, chooser, 'time-0：从弃牌堆打出1张牌', offBoardCandidates(chooser));

      const mineRoot = renderFrame(s, chooser);
      expect(countOf(mineRoot, '.choice-pick-overlay'),
        '操作方屏上没有出定向选牌浮层 ⇒ 弃牌堆/牌库那类候选没有可点节点，这个 prompt 永久无法应答').toBe(1);
      expect(countOf(mineRoot, '.choice-pick-card'), '浮层里没有候选卡格').toBe(2);

      const foeRoot = renderFrame(s, foe);
      expect(countOf(foeRoot, '.choice-pick-overlay'),
        '对手屏上出现了"操作方从弃牌堆选牌"的浮层').toBe(0);
      expect(countOf(foeRoot, '.choice-pick-card'), '对手屏上出现了候选卡格').toBe(0);
    } finally {
      restore();
    }
  });

  it('操作方 = 房主（chooser 0）、我 = P2 时同样成立（两个座位都判，不是只判一边）', () => {
    const restore = installStubDom();
    try {
      const chooser: PlayerId = 0;
      const foe: PlayerId = 1;
      const s = baseState(chooser);
      withSelect(s, chooser, 'speed-5：弃1张牌', handCandidates(s, chooser));

      expect(countOf(renderFrame(s, foe), '.choice-pick-overlay'), 'P2 屏上出现了 P1 的选牌浮层').toBe(0);
      expect(countOf(renderFrame(s, foe), '.choice-pick-card'), 'P2 屏上出现了 P1 手牌的候选卡格').toBe(0);
      expect(countOf(renderFrame(s, chooser), '.choice-bar'), 'P1 自己屏上没有选择条').toBe(1);
    } finally {
      restore();
    }
  });
});
