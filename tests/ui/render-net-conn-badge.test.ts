/**
 * ★ 2026-10-02 修复：**「本地预览（未联机）」那个徽标只在本地预览时才挂**
 * （`.net-conn.net-conn-local`，`src/ui/render-net.ts` 的 `renderConnectionBadge`）。
 *
 * ## 修的是什么（真机读数，不是推测）
 *
 * 上一轮的联机排查在**真联机牌桌**上读到两端
 * `document.querySelector('.net-conn').className === 'net-conn net-conn-local'`，
 * 屏上（截图 `run-real-host-board-en.png` 的对手信息块底部）就是那一行 —— 而那时两端已经
 * 握手、硬币、打完草稿进了牌桌。出处是 `renderInfoBlock` 里那句**无条件**的
 * `if (!isSelf) info.appendChild(renderConnectionBadge())`。
 *
 * ## 判据与它的来源
 *
 * "这一屏有没有真对端"**不在渲染器手里**：`renderNetBoard` 只收 `GameState`，而两端各跑一份
 * 引擎、逐字节相同 ⇒ 它看不出网线那头有没有人。⇒ 由宿主如实交进来（`NetViewOpts.localPreview`；
 * 生产调用点 `src/main.ts` 的那一支传 `netGame === null`，而那一支只在联机局里可达 ⇒ 恒 `false`）。
 *
 * ⚠️ 判据**不许**用 `opts.onPreviewChange` 代替：那是开发者工具条的开关，dev 解锁后
 * **真联机对局也会传**（`main.ts` 的 `const dev = isDevUnlocked()` 那一段）⇒ 会错挂。
 *
 * ## 三条腿
 *
 *  1. **真联机（缺省 / `false`）**：一帧里 `.net-conn` **一个都不存在**（两个座位都跑），
 *     且**两块信息块照旧都在**（反控：不是"整块没画"把节点连带抹掉了）；
 *  2. **本地预览（`true`）**：**对手**那块里恰好一个 `.net-conn.net-conn-local`，
 *     文案逐字正确（中文字面 + 文案表同值），**自己那块 0 个**（结构没变：仍只挂对手那块）；
 *  3. 文案走 i18n：`EN` / `ZH` 两表都有这个键、中英**不同值**，英文帧里那个节点是英文、零汉字。
 *
 * ## ⚠️ 本文件证明不了的事（诚实披露）
 *
 *  - **证明不了**"真机屏幕上那一行真的没了"：这里跑的是手写桩 DOM（本仓没有 jsdom）。
 *    真机读数在 `.superpowers/2026-10-02-net-conn-badge/`（`cdp-draft-transition.mjs --mode real`
 *    两端的 `.net-conn` 节点数 / className / 对手信息块原文）。
 *  - **证明不了**"生产路径不会传成 `true`"：第 4 条是**源码腿**（读 `src/main.ts` 的调用点），
 *    不是行为腿 —— `main.ts` 一被 import 就把整个游戏跑起来（要真 DOM 与 rAF），
 *    在 node 里没有入口（同 `tests/ui/main-driver-wiring.test.ts` 头注声明的限度）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installStubDom, makeStubEl, descendants, isClass, type StubNode } from './net-dom-stub';
import { braceBlock, stripComments } from './source-text';
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

/** 一帧最简对局：草稿已过、轮到 `turnPlayer`、协议给全（与 `tests/i18n/net-board-en.test.ts` 同源）。 */
function baseState(viewSeat: PlayerId): S {
  const s = createGame({ seed: 'conn-badge', draftStarter: 0, firstToPlay: viewSeat });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
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

/** 真跑一帧 `renderNetBoard`（桩 DOM）。`opts` 里**不含 `localPreview`** = 缺省那一档。 */
function renderFrame(viewSeat: PlayerId, opts: { localPreview?: boolean } = {}): StubNode {
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, baseState(viewSeat), {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat, ...opts });
  return root;
}

const blocksOf = (root: StubNode): StubNode[] =>
  descendants(root).filter((n) => isClass(n, 'net-info-block'));
const blockOf = (root: StubNode, seat: 'self' | 'foe'): StubNode =>
  blocksOf(root).filter((n) => n.dataset.netSeat === seat)[0];
/** 某一块**子树里**的 `.net-conn`（按节点数判"在不在"，不猜位置）。 */
const badgesIn = (node: StubNode | undefined): StubNode[] =>
  node === undefined ? [] : descendants(node).filter((n) => isClass(n, 'net-conn'));
const CJK = /[\u3400-\u9fff]/;

const SEATS: readonly PlayerId[] = [0, 1];

describe('★ 2026-10-02：「本地预览（未联机）」徽标的判定', () => {
  it('① 真联机（缺省 / `localPreview: false`）⇒ 一帧里一个 `.net-conn` 都不产出；两块信息块照旧都在', () => {
    const restore = installStubDom();
    try {
      for (const seat of SEATS) {
        for (const opts of [{}, { localPreview: false }] as const) {
          const root = renderFrame(seat, opts);
          const tag = `viewSeat=${seat} opts=${JSON.stringify(opts)}`;
          expect(descendants(root).filter((n) => isClass(n, 'net-conn')).length,
            `${tag}：真联机牌桌上仍产出了「本地预览（未联机）」徽标（这就是本轮修的那个错标）`).toBe(0);
          expect(descendants(root).filter((n) => isClass(n, 'net-conn-local')).length,
            `${tag}：仍产出 .net-conn-local`).toBe(0);
          // ── 反控：不是"信息块整块没画"把徽标连带抹掉了 ──
          expect(blocksOf(root).length, `${tag}：两块信息块必须照旧都在`).toBe(2);
          for (const side of ['self', 'foe'] as const) {
            expect(blockOf(root, side), `${tag}：找不到 ${side} 那一块`).toBeTruthy();
            expect(descendants(blockOf(root, side)).filter((n) => isClass(n, 'net-piles')).length,
              `${tag}：${side} 那一块的牌库/弃牌堆没了 —— 判据面塌了`).toBe(1);
          }
        }
      }
    } finally {
      restore();
    }
  });

  it('② 本地预览（`localPreview: true`）⇒ 只有对手那块挂，文案逐字正确（两个座位）', () => {
    const restore = installStubDom();
    try {
      setLang('zh');
      for (const seat of SEATS) {
        const root = renderFrame(seat, { localPreview: true });
        const selfBadges = badgesIn(blockOf(root, 'self'));
        const foeBadges = badgesIn(blockOf(root, 'foe'));
        expect(selfBadges.length, `viewSeat=${seat}：自己那块不该有连接徽标（R6 起只挂对手那块）`).toBe(0);
        expect(foeBadges.length, `viewSeat=${seat}：本地预览时对手那块必须恰好一个徽标`).toBe(1);
        expect(foeBadges[0].cls, `viewSeat=${seat}：徽标的类名结构被改了`)
          .toBe('net-conn net-conn-local');
        // 逐字：既比**字面量**（防文案表被改得形似而意不同），也比**文案表**（防两处漂移）
        expect(foeBadges[0].text, `viewSeat=${seat}：徽标文案不是改动前那一句`)
          .toBe('● 本地预览（未联机）');
        expect(foeBadges[0].text).toBe(ZH['render-net.conn.local-preview']);
      }
    } finally {
      restore();
    }
  });

  it('③ 文案走 i18n：两表都有这个键、中英不同值；英文帧里那个节点是英文且零汉字', () => {
    const restore = installStubDom();
    try {
      expect(EN['render-net.conn.local-preview'], '英文表里没有这个键').toBeTruthy();
      expect(EN['render-net.conn.local-preview'], '中英同值 ⇒ 下面那条判据恒真')
        .not.toBe(ZH['render-net.conn.local-preview']);
      expect(CJK.test(EN['render-net.conn.local-preview']), '英文表里出现了汉字').toBe(false);
      setLang('en');
      const foe = badgesIn(blockOf(renderFrame(0, { localPreview: true }), 'foe'))[0];
      expect(foe, '英文帧里本地预览也没有徽标（文案腿的前提不成立）').toBeTruthy();
      expect(foe.text).toBe(EN['render-net.conn.local-preview']);
      expect(CJK.test(foe.text), `英文帧里徽标出现汉字：${foe.text}`).toBe(false);
    } finally {
      restore();
    }
  });

  it('④（源码腿）生产唯一的调用点把这一格交给事实 `netGame === null`，没有写死成 true', () => {
    // 为什么是文本腿：`main.ts` 一被 import 就把整个游戏跑起来（要真 DOM 与 rAF），
    // node 里没有入口 —— 同 `tests/ui/main-driver-wiring.test.ts` 头注声明的限度。
    const main = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
        .subarray(0, 8 * 1024 * 1024).toString('utf8'));
    const at = main.indexOf('renderNetBoard(root, state, cb,');
    expect(at, 'main.ts 里找不到联机牌桌那次 renderNetBoard 调用').toBeGreaterThanOrEqual(0);
    const opts = braceBlock(main, at);
    expect(opts, '调用点没有声明 localPreview ⇒ 走的会是缺省（真联机）那一档，判定成了隐式的')
      .toContain('localPreview:');
    expect(opts, '`localPreview` 没有接在"有没有联机局"这个事实上（判定必须来自真值，不能写死）')
      .toMatch(/localPreview:\s*\(?\s*netGame\s*===\s*null\s*\)?/);
    expect(opts, '生产路径上把 localPreview 写死成 true ⇒ 真联机牌桌上又会写上「未联机」')
      .not.toContain('localPreview: true');
    // 这一支只在联机局里可达：`renderMode = 'net'` 的两个写入点都在 `enterNetGame()` 里
    // （netGame 就绪之后）⇒ 上面那个表达式在这里恒 false。
    expect((main.match(/renderMode\s*=\s*'net'/g) ?? []).length,
      "renderMode = 'net' 的写入点数量变了 ⇒ 「这一支恒为真联机」的前提要重新核").toBe(2);
  });
});
