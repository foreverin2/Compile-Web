/**
 * ★ 2026-10-02（P3 第四批）：**联机牌桌本页特有的人类可见文案在英文帧里是英文**
 * （真产出函数 `renderNetBoard` + 真文案表 + 桩 DOM）。
 *
 * ## 为什么这条腿必须有（补的是真机自查的洞）
 *
 * 本轮的 CDP 真机自查（`.superpowers/i18n-render/live/cdp-live4.mjs`）**没能进到联机牌桌**：
 * 两个无头 Chrome 走离屏邀请码握手时，加入方那一步的「出示回示码」没产出
 * （`ice` 收集在无网环境里超时）⇒ `.net-board` 一帧都没渲染出来。
 * 一件事没验过就不许说它验过 ⇒ 这里用**已有的桩 DOM 夹具**把那几处**在本页特有**的界面文案
 * （与热座同句的那些已经由 `choice-bar-en.test.ts` 覆盖）钉在英文帧上。
 *
 * ## 判据
 *
 *  1. 英文帧里这些节点都存在，且逐字等于 `EN[...]`（`{n}` 用夹具里的真值填）；
 *  2. 同一帧里**这几处**一个汉字都没有；
 *  3. 反向锚点：每一条的中英**不同值**（否则判据在"两表同值"上恒真）。
 *
 * ⚠️ **2026-10-02 联动**：`.net-conn`（「本地预览（未联机）」）从今天起**只在本地预览时才产出**
 * —— 见 `renderFrame` 里那一段与 `tests/ui/render-net-conn-badge.test.ts`。
 * 本帧是桩、没有会话 ⇒ 显式声明 `localPreview: true`，判据本身一条没动。
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
import type { PlayerId } from '../../src/core/models/types';

type S = ReturnType<typeof createGame>;

afterEach(() => {
  setLang('zh');
  setChoiceSelection([], null);
  setHandSelection(null);
  setFxViewSeat(null);
  resetNetUiState();
});

/** 一帧最简对局：草稿已过、轮到 `turnPlayer`、协议给全 */
function baseState(viewSeat: PlayerId): S {
  const s = createGame({ seed: 'i18n-net-4', draftStarter: 0, firstToPlay: viewSeat });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
    s.players[p].hand.push({ uid: `n-h-${p}-0`, defId: 'speed-0', faceUp: true, owner: p, zone: 'hand', line: null, pos: null });
    s.players[p].hand.push({ uid: `n-h-${p}-1`, defId: 'water-4', faceUp: true, owner: p, zone: 'hand', line: null, pos: null });
  }
  (s as { phase: string }).phase = 'turn';
  s.step = 'action';
  s.turnPlayer = viewSeat;
  s.pendingEffects.length = 0;
  s.pendingPlay.length = 0;
  s.pendingShift.length = 0;
  s.winner = null;
  return s;
}

function renderFrame(s: S, viewSeat: PlayerId): StubNode {
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, {
    viewSeat,
    // ── ★ 2026-10-02 修复的联动（**不是放宽判据**）──
    // 「本地预览（未联机）」那个徽标（`.net-conn`）从今天起**只在本地预览时才产出**
    // （真联机牌桌上它是错标，修法与理由见 `tests/ui/render-net-conn-badge.test.ts`）。
    // 本帧是手写桩、没有会话 ⇒ 语义上就是"本地预览"，所以这里**显式**声明这个前提，
    // 好让下面那两条"这个节点的英文逐字是什么"的断言仍然有一个真的被产出的节点可读。
    localPreview: true,
  });
  return root;
}

const textsOf = (root: StubNode, cls: string): string[] =>
  descendants(root).filter((n) => isClass(n, cls)).map((n) => n.text);
const textOf = (root: StubNode, cls: string): string | null => textsOf(root, cls)[0] ?? null;
const CJK = /[\u3400-\u9fff]/;

describe('★ P3 第四批：联机牌桌（render-net.ts）的英文帧', () => {
  it('连接徽标 / 线名 / 对手手牌标签 / 放大框空态：英文帧里逐字等于 `EN[...]` 且零汉字', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      const seat: PlayerId = 0;
      const s = baseState(seat);
      const root = renderFrame(s, seat);

      expect(textsOf(root, 'net-conn'), '没有 .net-conn').toContain(EN['render-net.conn.local-preview']);
      expect(textsOf(root, 'net-lane-name'), '没有 .net-lane-name').toEqual(
        ['1', '2', '3'].map((n) => EN['render-net.lane.name'].replace('{n}', n)));
      const handLabel = textOf(root, 'net-hand-label');
      expect(handLabel, '没有 .net-hand-label').toBe(
        EN['render-net.hand.foe-count'].replace('{n}', String(s.players[1 - seat].hand.length)));
      expect(textOf(root, 'net-zoom-box-head'), '没有放大框标题').toBe(EN['render-net.zoom.box-title']);
      expect(textOf(root, 'net-zoom-box-hint'), '没有放大框提示').toBe(EN['render-net.zoom.box-hint']);
      expect(textOf(root, 'diag-btn'), '没有导出按钮').toBe(EN['render.diag.export']);
      // 零汉字：只查**本页特有**那几处（板面卡名/协议名是数据层，见台账）
      for (const cls of ['net-conn', 'net-lane-name', 'net-hand-label', 'net-zoom-box-head', 'net-zoom-box-hint', 'diag-btn']) {
        for (const txt of textsOf(root, cls)) {
          expect(CJK.test(txt), `.${cls} 的英文帧里出现汉字：${txt}`).toBe(false);
        }
      }
      // 反向锚点：每一条中英不同值（判据不在"两表同值"上恒真）
      for (const k of ['render-net.conn.local-preview', 'render-net.lane.name', 'render-net.hand.foe-count',
        'render-net.zoom.box-title', 'render-net.zoom.box-hint', 'render.diag.export']) {
        expect(EN[k], `${k} 中英同值 ⇒ 上面那条恒真`).not.toBe(ZH[k]);
      }
    } finally {
      restore();
    }
  });

  it('反向（中文帧）：同一批节点逐字等于 `ZH[...]`', () => {
    const restore = installStubDom();
    try {
      setLang('zh');
      const seat: PlayerId = 1;
      const s = baseState(seat);
      const root = renderFrame(s, seat);
      expect(textsOf(root, 'net-conn')).toContain('● 本地预览（未联机）');
      expect(textsOf(root, 'net-lane-name')).toEqual(['线 1', '线 2', '线 3']);
      expect(textOf(root, 'net-zoom-box-head')).toBe('卡牌放大框');
      expect(textOf(root, 'diag-btn')).toBe('导出日志');
      expect(CJK.test(textOf(root, 'net-zoom-box-hint') ?? ''), '中文帧里没有汉字 ⇒ 判据面错了').toBe(true);
    } finally {
      restore();
    }
  });
});
