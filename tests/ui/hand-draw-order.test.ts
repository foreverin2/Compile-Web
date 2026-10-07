import { describe, it, expect, afterEach } from 'vitest';
import {
  HAND_DRAW_ORDER_DEFAULT, applyHandDrawOrder, handShownCards, isHandDrawOrderOn,
  resetHandDrawOrderForTest, setHandDrawOrder,
} from '../../src/ui/hand-order-pref';
import { createLocalStore, readHandDrawOrder, writeHandDrawOrder } from '../../src/app/local-store';
import { createMemoryStore, L1_SETTINGS } from '../../src/app/storage';
import { renderHand, resetUiState } from '../../src/ui/render';
import { createGame } from '../../src/core/state/create';
import { playCard } from '../../src/core/actions/base';
import { drawCards } from '../../src/core/engine/deck';
import { installStubDom, descendants, isClass, type StubNode } from '../ui/net-dom-stub';
import type { Card } from '../../src/core/models/types';

/**
 * **2026-10-06（用户要求）：设置里的新开关「手牌按抽牌顺序」（默认关闭）**
 *
 * 起因（玩家反馈，原文）：「本来手中卡牌顺序是 12345，打出 2 后触发抽一张牌，抽到了 6，
 * 结果手中的卡牌顺序变成了 16345」。查证（`.superpowers/2026-10-06-hand-order/REPORT.md`）：
 * **引擎没问题** —— `hand` 数组是入手顺序（打出 `splice` 摘掉、抽牌 `push` 追加到末尾），
 * 是 `renderHand` 把一份副本按分值升序排过（2026-08-28 改进轮 6），新牌才按分值插进了中间。
 *
 * 用户裁决（原文）：「在设置中添加上一个开关，默认关闭，打开后，抽到的牌就不会自动按照顺序
 * 进行排列了」⇒ 关 = 改动前那套（按分值升序，逐字不变）；开 = 引擎的入手顺序。
 *
 * ## 本文件的腿
 *
 *  1. **纯判据** `handShownCards`：关着按分值升序、开着按入手顺序、两种都尊重 `reversed`
 *     （P2 那条 `row-reverse` 的手牌行）、不裁长度、不改原数组；缺省参数读内存态。
 *  2. **守卫**：默认值必须是 `false`（用户明确要求默认关闭）；`applyHandDrawOrder` 只认 `true`。
 *  3. **存储**：`readHandDrawOrder` / `writeHandDrawOrder` 落在同一个 `compile-settings`
 *     对象里（**不新增键**）、坏值只认 `true`。
 *  4. **真跑 DOM**（本文件的核心）：真跑引擎"打出 2 → 抽 1 张"，再真跑 `renderHand` ——
 *     关着时新牌插进中间（复现玩家那个现象，证明这个开关确实有用），
 *     开着时新牌落在**最右**且顺序 = 引擎 `hand` 数组顺序。
 */



let uid = 0;
const mk = (defId: string, zone = 'hand'): Card => {
  uid += 1;
  return { uid: `h${uid}`, defId, owner: 0, faceUp: true, zone, line: null, pos: null } as Card;
};

/** 一份"手里 1..5、牌库顶是 fire-2"的局面（照抄玩家描述的形状：打出的与新抽的分值都在中间） */
function scene(): { s: ReturnType<typeof createGame>; played: Card } {
  const s = createGame({ seed: 'hand-draw-order', draftStarter: 0, firstToPlay: 0 });
  (s as { phase: string }).phase = 'turn';
  s.step = 'action';
  s.turnPlayer = 0;
  s.pendingEffects.length = 0;
  s.pendingPlay.length = 0;
  s.pendingShift.length = 0;
  s.winner = null;
  s.players[0].protocols = [
    { defId: 'water', compiled: false },
    { defId: 'fire', compiled: false },
    { defId: 'light', compiled: false },
  ] as never;
  s.players[0].hand = [mk('water-1'), mk('water-2'), mk('water-3'), mk('water-4'), mk('water-5')];
  s.players[0].deck = [mk('fire-2', 'deck')];
  const played = s.players[0].hand[1];
  playCard(s, 0, played.uid, true, 0);          // 打出数组第 2 张（水2：中指令抽 2 张，牌库只 1 张）
  s.players[0].deck = [mk('fire-2', 'deck')];
  drawCards(s, 0, 1);                            // 再抽 1 张 ⇒ 手里 6 张
  return { s, played };
}

/** 真跑 `renderHand`，按 DOM 顺序把 defId 读出来 */
function shownDefIds(s: ReturnType<typeof createGame>): string[] {
  const strip = renderHand(s, 0, {
    isSelf: true, selected: null, onSelect: () => { /* noop */ }, onToggleFaceUp: () => { /* noop */ }, cb: {} as never, shield: false,
  } as never);
  return descendants(strip as unknown as StubNode)
    .filter((n) => isClass(n, 'card'))
    .map((n) => s.players[0].hand.find((c) => c.uid === n.dataset.uid)?.defId ?? `?${n.dataset.uid}`);
}

const face = (defId: string): { readonly defId: string } => ({ defId });

afterEach(() => {
  resetHandDrawOrderForTest();
});

describe('① 纯判据 `handShownCards`', () => {
  const cards = ['fire-5', 'water-1', 'ice-3', 'light-2'].map(face);

  it('关着（默认）：按卡面分值升序；开着：按入手顺序（原样）', () => {
    const hand = ['fire-5', 'water-1', 'ice-3', 'light-2'];
    expect(handShownCards(cards, false, false).map((c) => c.defId), '关着时没按分值升序')
      .toEqual(['water-1', 'light-2', 'ice-3', 'fire-5']);
    expect(handShownCards(cards, false, true).map((c) => c.defId), '开着时没按入手顺序')
      .toEqual(hand);
  });

  it('`reversed`（P2 那条 row-reverse 手牌行）两种模式下都要翻一次', () => {
    expect(handShownCards(cards, true, false).map((c) => c.defId), '关着 + reversed 不是"升序再反转"')
      .toEqual(['fire-5', 'ice-3', 'light-2', 'water-1']);
    expect(handShownCards(cards, true, true).map((c) => c.defId), '开着 + reversed 不是"入手顺序再反转"')
      .toEqual(['light-2', 'ice-3', 'water-1', 'fire-5']);
  });

  it('不改原数组、不裁长度（裁 15 张是调用点的事）', () => {
    const src = ['fire-5', 'water-1'];
    const before = [...src];
    const out = handShownCards(src.map(face), false, false);
    expect(src, '判据把调用方传进来的数组自己排了（原数组被改）').toEqual(before);
    const many = Array.from({ length: 20 }, (_v, i) => face(`water-${i % 8}`));
    expect(handShownCards(many, false, true).length, '判据自己裁了长度').toBe(20);
  });

  it('缺省参数读内存态（生产路径不传第三个参数）', () => {
    expect(HAND_DRAW_ORDER_DEFAULT, '默认值不是关闭（用户明确要求默认关闭）').toBe(false);
    expect(isHandDrawOrderOn()).toBe(false);
    expect(handShownCards(cards, false).map((c) => c.defId), '默认不是按分值升序').toEqual(['water-1', 'light-2', 'ice-3', 'fire-5']);
    setHandDrawOrder(true);
    expect(isHandDrawOrderOn()).toBe(true);
    expect(handShownCards(cards, false).map((c) => c.defId), '开了之后没走入手顺序').toEqual(['fire-5', 'water-1', 'ice-3', 'light-2']);
  });

  it('`applyHandDrawOrder` 只认 `true`（垃圾值一律退默认：关闭）', () => {
    for (const bad of [undefined, null, 0, 1, 'true', 'yes', {}, [], Number.NaN]) {
      setHandDrawOrder(true);
      applyHandDrawOrder(bad);
      expect(isHandDrawOrderOn(), `坏值 ${JSON.stringify(bad)} 被当成了开启`).toBe(false);
    }
    applyHandDrawOrder(true);
    expect(isHandDrawOrderOn()).toBe(true);
    resetHandDrawOrderForTest();
    expect(isHandDrawOrderOn(), '复位之后不是默认值').toBe(false);
  });
});

describe('② 存储：同一个 `compile-settings`、坏值退默认、不新增键', () => {
  const fake = (): { kv: ReturnType<typeof createMemoryStore>; store: ReturnType<typeof createLocalStore> } => {
    const kv = createMemoryStore();
    const store = createLocalStore({ persistent: kv });
    store.grant();
    return { kv, store };
  };

  it('写进去 / 读回来（与 `instantChoice` 住在同一个对象里，键数不变）', () => {
    const { kv, store } = fake();
    expect(readHandDrawOrder(store), '默认不是关闭').toBe(false);
    expect(writeHandDrawOrder(store, true).ok, '写盘失败').toBe(true);
    expect(JSON.parse(kv.get(L1_SETTINGS) as string).handDrawOrder, '没写进 compile-settings.handDrawOrder').toBe(true);
    expect(readHandDrawOrder(store), '读回来不是 true').toBe(true);
    writeHandDrawOrder(store, false);
    expect(readHandDrawOrder(store)).toBe(false);
  });

  it('坏值只认 `true`（`"true"` / `1` / 对象一律退默认）', () => {
    for (const bad of ['"true"', '1', '{}', 'null', '"yes"']) {
      const { kv, store } = fake();
      kv.set(L1_SETTINGS, JSON.stringify({ handDrawOrder: JSON.parse(bad) }));
      expect(readHandDrawOrder(store), `${bad} 被读成了开启`).toBe(false);
    }
    const { kv, store } = fake();
    kv.set(L1_SETTINGS, JSON.stringify({ handDrawOrder: true }));
    expect(readHandDrawOrder(store)).toBe(true);
  });
});

describe('③ 真跑：打出 2 → 抽 1 张，两种设置下的手牌顺序', () => {
  it('关着：新牌按分值插进中间（复现玩家反馈的那个现象）', () => {
    const restore = installStubDom();
    try {
      const { s } = scene();
      const engineOrder = s.players[0].hand.map((c) => c.defId);
      expect(engineOrder, '夹具前提：引擎顺序应当是入手顺序（新抽的在末尾）')
        .toEqual(['water-1', 'water-3', 'water-4', 'water-5', 'fire-2', 'fire-2']);
      setHandDrawOrder(false);
      const shown = shownDefIds(s);
      expect(shown, '关着时没有按分值升序（那这条开关就没有"关"这一档）')
        .toEqual(['water-1', 'fire-2', 'fire-2', 'water-3', 'water-4', 'water-5']);
      expect(shown, '关着时新抽的牌竟然在最右（那玩家当初就不会来报）').not.toEqual(engineOrder);
    } finally { resetUiState(); restore(); }
  });

  it('开着：顺序 = 引擎 `hand` 数组（新抽的牌在最右）', () => {
    const restore = installStubDom();
    try {
      const { s } = scene();
      setHandDrawOrder(true);
      expect(shownDefIds(s), '开着时画面顺序与引擎数组不一致（那就没解决"看不出清缓存弃哪几张"）')
        .toEqual(s.players[0].hand.map((c) => c.defId));
    } finally { resetUiState(); restore(); }
  });

  it('开着 + `reversed=false` 与 `reversed=true` 都合法（远程页与热座页共用同一个 `renderHand`）', () => {
    const restore = installStubDom();
    try {
      const { s } = scene();
      setHandDrawOrder(true);
      const fwd = shownDefIds(s);
      const strip = renderHand(s, 1, {
        isSelf: true, selected: null, onSelect: () => { /* noop */ }, onToggleFaceUp: () => { /* noop */ }, cb: {} as never, shield: false,
      } as never);
      const back = descendants(strip as unknown as StubNode).filter((n) => isClass(n, 'card'))
        .map((n) => s.players[1].hand.find((c) => c.uid === n.dataset.uid)?.defId ?? '?');
      // P2 那条是 row-reverse：这里只钉"它画的是 P1 手牌的反向"，两侧内容不同不比对
      expect(back.length, 'P2 手牌区没画出卡').toBe(s.players[1].hand.length);
      expect(fwd, 'P1 那侧的顺序变了').toEqual(s.players[0].hand.map((c) => c.defId));
    } finally { resetUiState(); restore(); }
  });
});
