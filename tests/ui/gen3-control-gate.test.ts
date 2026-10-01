import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import {
  clearGen3Persistent, gen3ControlChangedFx, gen3ControlCheckFx,
} from '../../src/ui/gen3-control';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { installStubDom, makeStubEl, setStubRectFor, type StubNode } from './net-dom-stub';

/**
 * ★ **2026-10-01 行为腿：控制权族特效的「色欲专属」门控**（用户口径，两次修正后的最终版）。
 *
 * 用户原话要点（第 1 轮）："我想知道这个特效是否和色欲的移动控制权的特效一样，原本是某个协议的
 * 专属特效，但是由于 bug 原因导致所有比较的情况都用上了"。
 * 用户原话要点（第 2 轮，我报错口径之后）："我之前希望的是将这些特效作为 3 代中部分协议的特色特效，
 * 而不是希望将其作为跨协议共用的特效，懂我意思吗，请修复"。
 * 追问门控判据时他答："**色欲协议所属的卡牌在触发控制权相关的效果时触发特效**"。
 * 用户原话要点（第 3 轮，对"判定条要不要也门控"改主意）："**算了，那根红蓝对比条还是作为公用的特效吧**"。
 *
 * ⇒ 最终口径（两件，别混）：
 *  - **C1 / C2 / C5**（有卡牌触发的那几件）：门 = 事件载荷 `reason==='effect'` 且
 *    `sourceDefId.startsWith('lust-')`（与 `lustDrivenControl` 同一套判据）。非色欲协议触发的
 *    控制权变化**不播** —— 本轮真正落地的那一半。
 *  - **C4**（判定阶段的对比条 + 数值盒 + 金圈）：**公用特效，不门控** —— 每回合判定阶段照旧播，
 *    与这局有没有色欲**无关**（它是"控制权判定"这条规则步骤的反馈，不是某个协议的归属感演出）。
 *    本文件为此专门留了一条**反向**腿：没有色欲的局里对比条照常出（曾按"色欲在场"门控过一版，
 *    已按用户第 3 轮口径回退 —— 那条腿现在是钉住"别再把它门控回去"的）。
 *
 * ## 这个桩能证明 / 不能证明
 *
 * 能：按测试喂进来的矩形/状态，**产出函数写没写 DOM**（层建没建、条有没有），以及节点数。
 * **不能**：真实布局、观感。真浏览器读数见
 * `.superpowers/2026-10-01-control-lust-gate/`（同族 CDP + 临时 vite）。
 */

const root = new URL('../../src/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 4 * 1024 * 1024).toString('utf8');
const controlTs = read('ui/gen3-control.ts');

/** 热座页几何（逐字照抄 `tests/ui/net-check-anchor.test.ts` 的探针实测常量）。 */
const HOTSEAT_SELF = {
  battery: { left: -18, top: 395, width: 92, height: 206 },
  slot: { left: 100, top: 387, width: 660, height: 220 },
  cell: { left: 770, top: 387, width: 210, height: 220 },
};

function place(node: StubNode, b: { left: number; top: number; width: number; height: number }): StubNode {
  setStubRectFor(node, b);
  return node;
}

/** 控制组件（`gen3ControlChangedFx` 没有它就直接返回 ⇒ 夹具必须先放一个）。 */
function makeControlModule(): void {
  const body = document.body as unknown as StubNode;
  const mod = makeStubEl('div');
  mod.className = 'control-module';
  place(mod, { left: 478, top: 14, width: 512, height: 127 });
  const img = place(makeStubEl('div'), { left: 478, top: 30, width: 50, height: 70 });
  img.classList.add('control-slider-img');
  const track = place(makeStubEl('div'), { left: 100, top: 40, width: 1200, height: 40 });
  track.classList.add('control-track');
  mod.appendChild(img);
  body.appendChild(track);
  body.appendChild(mod);
}

function card(uid: string, defId: string, owner: PlayerId, line: Line, over: Partial<Card> = {}): Card {
  return { uid, defId, owner, faceUp: true, zone: 'field', line, pos: 0, ...over } as unknown as Card;
}

/** 三条线给 P0 都放一张（线值 > 0 ⇒ 判定阶段三条条都产得出来）。`lust` 决定要不要色欲。 */
function makeState(lust: 'P0' | 'P1' | null): GameState {
  const s = createGame({ seed: 'ctrl-gate', draftStarter: 0, firstToPlay: 0 });
  s.players[0].stacks[0] = [card('g-0', 'fire-1', 0, 0)];
  s.players[0].stacks[1] = [card('g-1', 'fire-2', 0, 1)];
  s.players[0].stacks[2] = [card('g-2', 'fire-3', 0, 2)];
  if (lust === 'P0') s.players[0].stacks[2].push(card('g-lust0', 'lust-0', 0, 2));
  if (lust === 'P1') s.players[1].stacks[0] = [card('g-lust1', 'lust-0', 1, 0)];
  return s;
}

/** 当前 DOM 里控制权族瞬态层的节点数（C1/C2/C5 建在 `.g3ctrl-layer`，C4 建在 `.g3ctrl-check-layer`）。
 *  ⚠️ 两条分开查：`tests/ui/net-dom-stub.ts` 的极简选择器**不支持逗号组**（遇到就返回空），
 *  写成一条 `'.a, .b'` 会恒得 0 —— 那样本文件所有"没播"的断言都会变成恒真的空腿。 */
const transientCount = (): number =>
  document.querySelectorAll('.g3ctrl-layer').length + document.querySelectorAll('.g3ctrl-check-layer').length;
const cmpCount = (): number => document.querySelectorAll('.g3ctrl-cmp').length;

afterEach(() => {
  vi.useRealTimers();
  clearGen3Persistent();
  setFxViewSeat(null);
});

/* ============================================================================
 * 腿 A：C1 / C2 / C5 —— "色欲卡触发控制权效果"才播
 * ========================================================================== */

describe('★ 2026-10-01 · C1/C2/C5 只由色欲卡触发（`reason` + `sourceDefId`）', () => {
  it('色欲卡触发（reason=effect + sourceDefId=lust-*）⇒ 播（建层 + 牵引链）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setFxViewSeat(null);
      makeControlModule();
      gen3ControlChangedFx({ from: -1, to: 0, reason: 'effect', sourceDefId: 'lust-0' }, makeState(null));
      expect(transientCount(), '色欲卡触发的易主没有播 C1').toBe(1);
      expect(document.querySelectorAll('.g3ctrl-link').length, 'C1 的牵引链没建出来').toBe(3);
    } finally {
      restore();
    }
  });

  it('**非色欲**（新星2 / 嫉妒1）触发 ⇒ 不播：一个瞬态层、一条链、一个轻量提示都不建', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setFxViewSeat(null);
      makeControlModule();
      // 新星2（`nova-2` 的否则分支获得控制权）与嫉妒1（`envy-1` 底夺权）——两者都带 `reason='effect'`
      // 与**它们自己的** sourceDefId ⇒ 旧版会各播一套"轻量提示"（脉冲 + 文字标），本轮口径下必须全无。
      for (const src of ['nova-2', 'envy-1']) {
        gen3ControlChangedFx({ from: -1, to: 0, reason: 'effect', sourceDefId: src }, makeState(null));
        expect(transientCount(), `${src} 触发的易主播了控制权族特效（用户要的是色欲专属）`).toBe(0);
        expect(document.querySelectorAll('.g3ctrl-mini-pulse, .g3ctrl-mini-chip').length,
          `${src} 触发的易主冒出了 2026-09-13 那版"轻量提示"（那也是跨协议共用）`).toBe(0);
        expect(document.querySelectorAll('.g3ctrl-link').length).toBe(0);
      }
      // 反空集合：**同一个局面**换成色欲卡触发就必须播 —— 否则上面那三条是恒真（比如选择器全错）
      gen3ControlChangedFx({ from: -1, to: 0, reason: 'effect', sourceDefId: 'lust-4' }, makeState(null));
      expect(transientCount(), '反空集合失败：连色欲触发都没播 ⇒ 上面几条判据分辨不出"门控生效"与"函数坏了"')
        .toBe(1);
    } finally {
      restore();
    }
  });

  it('规则步骤（判定阶段 reason=check / 归还中立 return）⇒ 不播（那一刻没有"哪张卡触发"）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setFxViewSeat(null);
      makeControlModule();
      gen3ControlChangedFx({ from: -1, to: 0, reason: 'check' }, makeState('P0'));
      expect(transientCount(), '判定阶段导致的易主播了 C1（旧版那条"轻量提示"就是这里冒出来的）').toBe(0);
      gen3ControlChangedFx({ from: 0, to: -1, reason: 'return' }, makeState('P0'));
      expect(transientCount(), '编译/补满手牌归还控制权播了 C2').toBe(0);
    } finally {
      restore();
    }
  });

  it('源码腿：`gen3ControlChangedFx` 最前面就是色欲判据的门（防"只有分支里判、非色欲仍建层"）', () => {
    const fn = controlTs.slice(controlTs.indexOf('export function gen3ControlChangedFx'));
    const gate = fn.indexOf('if (!lustDrivenControl(p)) return;');
    expect(gate, '`gen3ControlChangedFx` 没有在最前面按色欲判据挡掉非色欲触发').toBeGreaterThan(-1);
    for (const key of ["layer('g3ctrl-layer'", 'controlImgRect()']) {
      expect(fn.indexOf(key), `${key} 出现在门之前（非色欲触发会建节点/查 DOM）`).toBeGreaterThan(gate);
    }
    // 判据只有一处（不许在别处再抄一份 `startsWith('lust-')`）
    expect((controlTs.match(/startsWith\('lust-'\)/g) ?? []).length,
      '`lust-` 判据被抄成了两份（两处真相迟早漂移）').toBe(1);
    // 旧的"跨协议共用轻量提示"整体删除（用户第 2 轮否掉的正是它）
    expect(controlTs, '`controlMiniFx` 还在（= 非色欲易主仍会播一套脉冲 + 文字标）').not.toContain('controlMiniFx');
  });
});

/* ============================================================================
 * 腿 B：C4 —— "这局色欲在场"才播对比条（用户 bug 的核心）
 * ========================================================================== */

/** 热座页三条线（判定方 P0）。 */
function laneFixture(): void {
  const body = document.body as unknown as StubNode;
  for (const l of [0, 1, 2] as Line[]) {
    const row = makeStubEl('div');
    row.className = 'lane-row';
    const slot = place(makeStubEl('div'), HOTSEAT_SELF.slot);
    slot.classList.add('stack-slot'); slot.dataset.player = '0'; slot.dataset.line = String(l);
    const cell = place(makeStubEl('div'), HOTSEAT_SELF.cell);
    cell.classList.add('protocol-cell'); cell.dataset.player = '0'; cell.dataset.line = String(l);
    const bat = place(makeStubEl('div'), HOTSEAT_SELF.battery);
    bat.classList.add('battery'); bat.dataset.player = '0'; bat.dataset.line = String(l);
    row.appendChild(slot); row.appendChild(cell); row.appendChild(bat);
    body.appendChild(row);
  }
  makeControlModule();
}

describe('★ 2026-10-01 · C4 判定阶段：**公用**特效 —— 没有色欲的局照常出对比条', () => {
  it('没有色欲的局（用户 2026-09-30 报 bug 那局 `[water,fire,life]` vs `[speed,light,darkness]`）⇒ 照常出 3 条', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setFxViewSeat(null);
      laneFixture();
      const s = makeState(null);
      // 用户那局的协议构成（一张色欲都没有）
      s.players[0].stacks[0] = [card('w-0', 'water-0', 0, 0)];
      s.players[0].stacks[1] = [card('f-0', 'fire-0', 0, 1)];
      s.players[0].stacks[2] = [card('l-0', 'life-0', 0, 2)];
      s.players[1].stacks[0] = [card('sp-0', 'speed-0', 1, 0)];
      s.players[1].stacks[1] = [card('li-0', 'light-0', 1, 1)];
      s.players[1].stacks[2] = [card('dk-0', 'darkness-0', 1, 2)];
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [0, 1], gained: true }, s);
      // ★ 用户第 3 轮拍板（"算了，那根红蓝对比条还是作为公用的特效吧"）：
      //   判定阶段的对比条/数值盒/金圈是**公用**的规则反馈 ⇒ 这局有没有色欲都照常播。
      //   ⚠️ 这条腿是**反向**的（曾按"色欲在场"门控，已回退）：它现在钉的是"别再把它门控回去"。
      expect(cmpCount(), '没有色欲的局里对比条没出（C4 是公用特效，不该被色欲门控）').toBe(3);
      expect(transientCount(), '没有色欲的局里连判定层都没建（标题/结果/金圈都该照常）').toBe(1);
      // 反空集合：**同一个几何夹具**换一局"色欲在场"的局面，产出必须**逐字相同** ——
      // 否则上面那条证明不了"公用"（比如两条路都恒为 3 却各自走不同分支）。
      // ⚠️ 先清掉上一条的层再跑第二次（判定层是 body 级浮层，两次调用会**叠加**：
      //    忘了清就会读到 6 条，而不是"产出被色欲影响了" —— 这是夹具噪声，不是被测代码的问题）。
      clearGen3Persistent();
      for (const n of document.querySelectorAll('.g3ctrl-check-layer') as unknown as Array<{ remove(): void }>) n.remove();
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [0, 1], gained: true }, makeState('P0'));
      expect(cmpCount(), '有色欲的局面反而多/少了对比条 ⇒ C4 仍被色欲影响（用户要的是公用）').toBe(3);
    } finally {
      restore();
    }
  });

  it('色欲在场（自己侧 / 对手侧）时同样出 3 条：产出与色欲无关', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setFxViewSeat(null);
      laneFixture();
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [0], gained: true }, makeState('P1'));
      expect(cmpCount(), '色欲在对手场上时判定阶段没出对比条').toBe(3);
    } finally {
      restore();
    }
  });

  it('反面 / 被盖的 lust-0 同样不影响产出（C4 不看色欲，这一条锁住"没有偷偷读它"）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setFxViewSeat(null);
      laneFixture();
      // ① 反面的 lust-0
      const faceDown = makeState(null);
      faceDown.players[0].stacks[2].push(card('g-lust0', 'lust-0', 0, 2, { faceUp: false }));
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [0], gained: true }, faceDown);
      expect(cmpCount(), '反面的 lust-0 影响了产出（C4 是公用特效，不该读色欲）').toBe(3);
      // 两次调用之间要清层（判定层是 body 级浮层，不清就叠加成 6 条 —— 夹具噪声）
      clearGen3Persistent();
      for (const n of document.querySelectorAll('.g3ctrl-check-layer') as unknown as Array<{ remove(): void }>) n.remove();
      // ② lust-0 被另一张牌盖住
      const covered = makeState(null);
      covered.players[0].stacks[2].push(card('g-lust0', 'lust-0', 0, 2));
      covered.players[0].stacks[2].push(card('g-cover', 'fire-5', 0, 2));
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [0], gained: true }, covered);
      expect(cmpCount(), '被盖住的 lust-0 影响了产出（C4 是公用特效，不该读色欲）').toBe(3);
    } finally {
      restore();
    }
  });

  it('源码腿：C4 里**没有**任何"色欲在场"的门（用户第 3 轮口径的机检形式）', () => {
    const fn = controlTs.slice(controlTs.indexOf('export function gen3ControlCheckFx'));
    const body = fn.slice(0, fn.indexOf('/** 给一枚 C4 元素打上'));
    expect(body, 'C4 又被按"色欲在场"门控回去了（用户要的是公用特效）').not.toContain('lustHoldOf(');
    expect(body, 'C4 里出现了 `lust-` 判据（它不该读色欲）').not.toContain("startsWith('lust-')");
    // 反空集合：这一段的切片必须真的覆盖到产出主体（否则"不含 lustHoldOf"是切太短换来的）
    expect(body, '切片没覆盖到 C4 的产出主体 ⇒ 上面两条是空腿').toContain("layer('g3ctrl-check-layer'");
    // `lustHoldOf` 仍在（C3/C6 与它自己那条同步器要用），只是 C4 不用
    const holds = controlTs.slice(controlTs.indexOf('export function lustHoldOf'));
    expect(holds.slice(0, 400)).toContain("c.defId === 'lust-0' && c.faceUp && isUncovered(s, c)");
  });
});
